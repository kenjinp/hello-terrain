import type { TaskRef } from "../../tasks/task.types";
import { TASK_DEF } from "../../tasks/task.types";
import type { CacheStrategy, Lane } from "../../types";
import { executeTaskCompiled } from "./executeTask";
import type { RunContext, RunDeps, RunState, TaskNodeRuntime } from "./types";

// What `pendingDepsCount` holds for a task that is no longer waiting. Kept in the same map as
// the counts so that the scheduler needs no further per-run collections.
const RUNNING = -1;
const DONE = -2;

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
  // Hot-loop fast path: if all explicit targets are cached and clean, skip scheduler setup.
  // This avoids allocating required-closure sets and dependency-count maps in the common case.
  let allTargetsClean = true;
  for (const t of targets) {
    const n = state.tasksMap.get(t.id);
    if (!n) throw new deps.UnknownTaskError(t.id);
    const cache = n.ref[TASK_DEF].options.cache ?? ("memo" as CacheStrategy);
    if (!(cache !== "none" && n.state === "ready" && !state.isTaskDirty(n))) {
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
    if (cache !== "none" && n.state === "ready" && !state.isTaskDirty(n)) {
      ctx.cacheHits += 1;
      if (state.shouldEmit("task:cacheHit"))
        state.emit({ type: "task:cacheHit", runId: ctx.runId, taskId: id, at: ctx.nowMs() });
    }
  }

  const { mustRun, mustRunSet } = computeMustRun(state, deps, topoOrder, requiredTaskIds);

  // pending dependency counts only consider task->task deps that are also scheduled to run.
  // Once a task leaves the queue its entry turns into RUNNING and then DONE.
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

  /** How many of a task's dependencies this run still has to compute. */
  const pendingDeps = (taskId: string) => {
    let count = 0;
    const incoming = state.dagGetIncomingIds(taskId);
    if (incoming) {
      for (const depId of incoming) {
        if (mustRunSet.has(depId) && pendingDepsCount.get(depId) !== DONE) count += 1;
      }
    }
    return count;
  };

  const unblockDependent = (dependentId: string) => {
    if (!mustRunSet.has(dependentId)) return;
    const waitingFor = pendingDepsCount.get(dependentId) ?? 0;
    // Running, done, or already queued.
    if (waitingFor <= 0) return;
    const next = waitingFor - 1;
    pendingDepsCount.set(dependentId, next);
    if (next === 0) {
      const depNode = state.tasksMap.get(dependentId);
      if (depNode) pushReady(depNode);
    }
  };

  const finished = (taskId: string) => {
    const node = state.tasksMap.get(taskId);
    if (node && node.state !== "ready") {
      // The result was built on a value that `ctx.teardownPrevious()` released meanwhile, so it
      // was thrown away. The task runs again once what it reads is back.
      const count = pendingDeps(taskId);
      pendingDepsCount.set(taskId, count);
      if (count === 0) pushReady(node);
      return;
    }
    pendingDepsCount.set(taskId, DONE);
    const dependents = state.dagGetAdjacenciesIds(taskId);
    if (dependents) for (const dependentId of dependents) unblockDependent(dependentId);
  };

  // `ctx.teardownPrevious()` in `taskId` took the values of everything downstream of it away.
  // Dependents that are dirty anyway are already waiting for it. This schedules the others:
  // the ones this run had skipped as clean (a `cache: "once"` task, and what sits behind it) and
  // the ones it had already computed.
  const invalidated = (taskId: string) => {
    const affected: string[] = [];
    const seen = new Set<string>();
    const stack = [...(state.dagGetAdjacenciesIds(taskId) ?? [])];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const next = state.dagGetAdjacenciesIds(id);
      if (next) for (const nextId of next) stack.push(nextId);
      // One that is executing right now is dealt with when it finishes.
      if (!requiredTaskIds.has(id) || pendingDepsCount.get(id) === RUNNING) continue;
      mustRunSet.add(id);
      // No longer done. The counts below must see that for every affected task first.
      pendingDepsCount.set(id, 0);
      affected.push(id);
    }
    for (const id of affected) pendingDepsCount.set(id, pendingDeps(id));
  };

  const launch = (n: TaskNodeRuntime<L, Res>): boolean => {
    const id = n.ref.id;
    // Queued before a release put a dependency back in front of it, or queued twice.
    if ((pendingDepsCount.get(id) ?? 0) !== 0) return false;
    pendingDepsCount.set(id, RUNNING);
    const p = executeTaskCompiled(deps, state, ctx, n, finished, invalidated);
    inFlight.add(p);
    p.finally(() => inFlight.delete(p));
    return true;
  };

  while (true) {
    let launchedAny = false;
    for (const queue of readyByLane.values()) {
      while (queue.length) {
        if (launch(queue.shift()!)) launchedAny = true;
      }
    }

    if (inFlight.size === 0) break;
    if (!launchedAny) await Promise.race(inFlight);
    if (ctx.signal.aborted && ctx.status !== "ok") break;
  }

  await Promise.allSettled(inFlight);
}
