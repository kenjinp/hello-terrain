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
  return async function run<L extends Lane, Res>(
    state: RunState<L, Res>,
    options?: RunOptions<L, Res>,
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
        return {
          runId,
          status: "ok",
          startedAt,
          finishedAt,
          durationMs: Math.max(0, finishedAt - startedAt),
          taskCount: 0,
          cacheHits: targets.length,
        };
      }
    }

    const ctx = createRunContext<L, Res>(deps, runId, startedAt, options);

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

    const finishedAt = deps.nowMs();
    if (state.shouldEmit("run:finish"))
      state.emit({ type: "run:finish", runId, at: finishedAt, status: ctx.status });

    return {
      runId,
      status: ctx.status,
      startedAt,
      finishedAt,
      durationMs: Math.max(0, finishedAt - startedAt),
      taskCount: ctx.taskCount,
      cacheHits: ctx.cacheHits,
    };
  };
}

