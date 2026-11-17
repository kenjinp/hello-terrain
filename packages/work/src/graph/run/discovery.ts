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
  // In-flight task executions for this run (used to dedupe concurrent compute requests).
  const inFlight = new Map<string, Promise<void>>();

  // `ctx.teardownPrevious()` takes the values of every dependent away, including ones this run
  // had already served from cache or computed.
  let invalidated = false;
  const onInvalidated = () => {
    invalidated = true;
  };

  const computeTask = async (taskId: string, stack: Set<string>): Promise<void> => {
    // True cycle detection is per-call-stack: if a task requests itself upstream, the graph is cyclical.
    if (stack.has(taskId)) throw new deps.CyclicalGraphError(taskId);

    // If someone else is already computing this task, await their result.
    const existing = inFlight.get(taskId);
    if (existing) return existing;

    const node = state.tasksMap.get(taskId);
    if (!node) throw new deps.UnknownTaskError(taskId);

    // Fast path: cache hit.
    const cache = node.ref[TASK_DEF].options.cache ?? ("memo" as CacheStrategy);
    if (cache !== "none" && node.state === "ready" && !state.isTaskDirty(node)) {
      ctx.cacheHits += 1;
      if (state.shouldEmit("task:cacheHit"))
        state.emit({ type: "task:cacheHit", runId: ctx.runId, taskId, at: ctx.nowMs() });
      return;
    }

    const nextStack = new Set(stack);
    nextStack.add(taskId);

    const p = executeTaskDiscovery(
      deps,
      state,
      ctx,
      node,
      (missingId) => computeTask(missingId, nextStack),
      onInvalidated,
    );
    inFlight.set(taskId, p);
    try {
      await p;
    } finally {
      inFlight.delete(taskId);
    }
  };

  await Promise.all(targets.map((t) => computeTask(t.id, new Set())));

  // Bring those back. Whatever lost its value is upstream of a target that lost its own.
  while (invalidated && !ctx.signal.aborted) {
    invalidated = false;
    const again = targets.filter((t) => state.tasksMap.get(t.id)?.state === "idle");
    if (again.length === 0) break;
    await Promise.all(again.map((t) => computeTask(t.id, new Set())));
  }
}
