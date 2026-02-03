import type { Lane } from "../../types";
import { TASK_DEF } from "../../tasks/task.types";
import type { CacheStrategy } from "../../types";
import type { RunContext, RunDeps, RunState } from "./types";
import { executeTaskDiscovery } from "./executeTask";

export async function runDiscovery<L extends Lane, Res>(
  deps: RunDeps,
  state: RunState<L, Res>,
  ctx: RunContext<L, Res>,
  targets: readonly { id: string }[],
): Promise<void> {
  const currentlyComputing = new Set<string>();

  const computeTask = async (taskId: string): Promise<void> => {
    const node = state.tasksMap.get(taskId);
    if (!node) throw new deps.UnknownTaskError(taskId);

    // Fast path: memo cache hit.
    const cache = node.ref[TASK_DEF].options.cache ?? ("memo" as CacheStrategy);
    if (cache === "memo" && node.state === "ready" && !state.isTaskDirty(node)) {
      ctx.cacheHits += 1;
      if (state.shouldEmit("task:cacheHit"))
        state.emit({ type: "task:cacheHit", runId: ctx.runId, taskId, at: ctx.nowMs() });
      return;
    }

    if (currentlyComputing.has(taskId)) throw new deps.CyclicalGraphError(taskId);
    currentlyComputing.add(taskId);
    try {
      await executeTaskDiscovery(deps, state, ctx, node, computeTask);
    } finally {
      currentlyComputing.delete(taskId);
    }
  };

  await Promise.all(targets.map((t) => computeTask(t.id)));
}

