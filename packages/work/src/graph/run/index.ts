import type { TaskRef } from "../../tasks/task.types";
import { TASK_DEF } from "../../tasks/task.types";
import type { Lane } from "../../types";
import type { CacheStrategy } from "../../types";
import type { RunOptions, RunReport } from "../graph.types";
import { runCompiled } from "./compiled";
import { runDiscovery } from "./discovery";
import { createRunContext } from "./runContext";
import type { RunDeps, RunFn, RunState } from "./types";

export function createRun(deps: RunDeps): RunFn {
  // Not an async function: the fast path has nothing to await, and returning `runSlow()` from
  // one would cost every other run an extra promise and three microtask ticks.
  return function run<L extends Lane, Res>(
    state: RunState<L, Res>,
    options?: RunOptions<L, Res>,
  ): Promise<RunReport> {
    try {
      return start(deps, state, options);
    } catch (error) {
      return Promise.reject(error);
    }
  };
}

function start<L extends Lane, Res>(
  deps: RunDeps,
  state: RunState<L, Res>,
  options: RunOptions<L, Res> | undefined,
): Promise<RunReport> {
  const runId = deps.createRunId();
  const startedAt = deps.nowMs();
  if (state.shouldEmit("run:start")) state.emit({ type: "run:start", runId, at: startedAt });

  const targets =
    options?.targets && options.targets.length > 0
      ? options.targets
      : (state.allTaskRefNodes as readonly TaskRef<any>[]);

  // Hot-loop fast path: if there are no listeners and no abort signal, avoid allocating per-run
  // context objects when everything is already memo-cached and clean.
  const hasAnyListeners =
    state.shouldEmit("run:start") ||
    state.shouldEmit("run:finish") ||
    state.shouldEmit("task:cacheHit") ||
    state.shouldEmit("task:start") ||
    state.shouldEmit("task:finish") ||
    state.shouldEmit("task:error");

  if (!hasAnyListeners && !options?.signal) {
    let allTargetsClean = true;
    for (const t of targets) {
      const n = state.tasksMap.get(t.id);
      if (!n) throw new deps.UnknownTaskError(t.id);
      const cache = (n.ref[TASK_DEF].options.cache ?? "memo") as CacheStrategy;
      if (!(cache !== "none" && n.state === "ready" && !state.isTaskDirty(n))) {
        allTargetsClean = false;
        break;
      }
    }

    if (allTargetsClean) {
      // Keep topo cache in sync if structure changed.
      state.compileTopologyIfNeeded();
      const finishedAt = deps.nowMs();
      return Promise.resolve<RunReport>({
        runId,
        status: "ok",
        startedAt,
        finishedAt,
        durationMs: Math.max(0, finishedAt - startedAt),
        taskCount: 0,
        cacheHits: targets.length,
      });
    }
  }

  return runSlow(deps, state, options, runId, startedAt, targets);
}

/**
 * Everything past the cached fast path. Kept out of `run` on purpose: inside one large async
 * function V8's escape analysis gives up, and the fast path starts allocating an iterator per
 * dependency (2 kB per run became 10 kB on a 100-task chain).
 */
async function runSlow<L extends Lane, Res>(
  deps: RunDeps,
  state: RunState<L, Res>,
  options: RunOptions<L, Res> | undefined,
  runId: string,
  startedAt: number,
  targets: readonly TaskRef<any>[],
): Promise<RunReport> {
  const ctx = createRunContext<L, Res>(deps, runId, startedAt, options, state.epoch());
  state.runStarted(ctx);

  let finishedAt = startedAt;
  try {
    // If any target task hasn't discovered deps yet, skip compilation and use on-demand evaluation.
    const needsDiscovery = targets.some((t) => {
      const n = state.tasksMap.get(t.id);
      return n ? !n.depsKnown : false;
    });

    try {
      if (needsDiscovery) {
        await runDiscovery(deps, state, ctx, targets);
        state.compileTopologyIfNeeded();
      } else {
        await runCompiled(deps, state, ctx, targets);
      }
    } catch {
      if (ctx.signal.aborted && ctx.status === "ok") ctx.status = "cancelled";
    }

    finishedAt = deps.nowMs();
    if (state.shouldEmit("run:finish"))
      state.emit({ type: "run:finish", runId, at: finishedAt, status: ctx.status });
  } finally {
    ctx.detach?.();
    // Retired values are torn down once no run can still be reading them. In a `finally` because
    // a throwing listener must not leave the run registered: that would hold back every later
    // teardown. The run does not wait for them: `graph.settled()` does.
    state.runFinished(ctx);
  }

  return {
    runId,
    status: ctx.status,
    startedAt,
    finishedAt,
    durationMs: Math.max(0, finishedAt - startedAt),
    taskCount: ctx.taskCount,
    cacheHits: ctx.cacheHits,
  };
}
