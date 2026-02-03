import type { TaskRef } from "../../tasks/task.types";
import { TASK_DEF } from "../../tasks/task.types";
import type { CacheStrategy, Lane } from "../../types";
import { executeTaskCompiled } from "./executeTask";
import type { RunContext, RunDeps, RunState, TaskNodeRuntime } from "./types";

function computeRequiredClosure<L extends Lane, Res>(
  state: RunState<L, Res>,
  deps: RunDeps,
  targets: readonly TaskRef<any>[],
): Set<string> {
  const required = new Set<string>();
  const stack = targets.map((t) => t.id);
  while (stack.length) {
    const id = stack.pop()!;
    if (required.has(id)) continue;
    required.add(id);
    const node = state.tasksMap.get(id);
    if (!node) throw new deps.UnknownTaskError(id);
    for (const depId of state.dagGetIncomingIds(id) ?? []) {
      if (state.tasksMap.has(depId)) stack.push(depId);
    }
  }
  return required;
}

function computeMustRun<L extends Lane, Res>(
  state: RunState<L, Res>,
  deps: RunDeps,
  topoOrder: readonly string[],
  requiredTaskIds: Set<string>,
): { mustRun: TaskNodeRuntime<L, Res>[]; mustRunSet: Set<string> } {
  const mustRun: TaskNodeRuntime<L, Res>[] = [];
  const mustRunSet = new Set<string>();
  for (const id of topoOrder) {
    if (!requiredTaskIds.has(id)) continue;
    const n = state.tasksMap.get(id);
    if (!n) throw new deps.UnknownTaskError(id);
    const cache = n.ref[TASK_DEF].options.cache ?? ("memo" as CacheStrategy);
    if (cache === "none" || state.isTaskDirty(n)) {
      mustRun.push(n);
      mustRunSet.add(id);
    }
  }
  return { mustRun, mustRunSet };
}

export async function runCompiled<L extends Lane, Res>(
  deps: RunDeps,
  state: RunState<L, Res>,
  ctx: RunContext<L, Res>,
  targets: readonly TaskRef<any>[],
): Promise<void> {
  // Hot-loop fast path: if all explicit targets are memo-cached and clean, skip scheduler setup.
  // This avoids allocating required-closure sets and dependency-count maps in the common case.
  let allTargetsClean = true;
  for (const t of targets) {
    const n = state.tasksMap.get(t.id);
    if (!n) throw new deps.UnknownTaskError(t.id);
    const cache = n.ref[TASK_DEF].options.cache ?? ("memo" as CacheStrategy);
    if (!(cache === "memo" && n.state === "ready" && !state.isTaskDirty(n))) {
      allTargetsClean = false;
      break;
    }
  }
  if (allTargetsClean) {
    // Keep topo cache in sync if structure changed.
    state.compileTopologyIfNeeded();
    ctx.cacheHits += targets.length;
    if (state.shouldEmit("task:cacheHit")) {
      const at = ctx.nowMs();
      for (const t of targets)
        state.emit({ type: "task:cacheHit", runId: ctx.runId, taskId: t.id, at });
    }
    return;
  }

  state.compileTopologyIfNeeded();
  const topoOrder = state.getTopoOrder();

  const requiredTaskIds = computeRequiredClosure(state, deps, targets);

  // Cache hits accounting (required only).
  for (const id of requiredTaskIds) {
    const n = state.tasksMap.get(id);
    if (!n) continue;
    const cache = n.ref[TASK_DEF].options.cache ?? ("memo" as CacheStrategy);
    if (cache === "memo" && n.state === "ready" && !state.isTaskDirty(n)) {
      ctx.cacheHits += 1;
      if (state.shouldEmit("task:cacheHit"))
        state.emit({ type: "task:cacheHit", runId: ctx.runId, taskId: id, at: ctx.nowMs() });
    }
  }

  const { mustRun, mustRunSet } = computeMustRun(state, deps, topoOrder, requiredTaskIds);

  // pending dependency counts only consider task->task deps that are also scheduled to run.
  const pendingDepsCount = new Map<string, number>();
  for (const n of mustRun) {
    let count = 0;
    for (const depId of state.dagGetIncomingIds(n.ref.id) ?? []) {
      if (state.tasksMap.has(depId) && mustRunSet.has(depId)) count += 1;
    }
    pendingDepsCount.set(n.ref.id, count);
  }

  const readyByLane = new Map<L, TaskNodeRuntime<L, Res>[]>();
  const pushReady = (n: TaskNodeRuntime<L, Res>) => {
    const lane = (n.ref[TASK_DEF].options.lane ?? "cpu") as unknown as L;
    const q = readyByLane.get(lane);
    if (q) q.push(n);
    else readyByLane.set(lane, [n]);
  };

  for (const n of mustRun) {
    if ((pendingDepsCount.get(n.ref.id) ?? 0) === 0) pushReady(n);
  }

  const inFlight = new Set<Promise<void>>();

  const unblockDependent = (dependentId: string) => {
    if (!mustRunSet.has(dependentId)) return;
    const next = (pendingDepsCount.get(dependentId) ?? 0) - 1;
    pendingDepsCount.set(dependentId, next);
    if (next === 0) {
      const depNode = state.tasksMap.get(dependentId);
      if (depNode) pushReady(depNode);
    }
  };

  const launch = (n: TaskNodeRuntime<L, Res>) => {
    const p = executeTaskCompiled(deps, state, ctx, n, unblockDependent);
    inFlight.add(p);
    p.finally(() => inFlight.delete(p));
  };

  while (true) {
    let launchedAny = false;
    for (const queue of readyByLane.values()) {
      while (queue.length) {
        launchedAny = true;
        launch(queue.shift()!);
      }
    }

    if (inFlight.size === 0) break;
    if (!launchedAny) await Promise.race(inFlight);
    if (ctx.signal.aborted && ctx.status !== "ok") break;
  }

  await Promise.allSettled(inFlight);
}
