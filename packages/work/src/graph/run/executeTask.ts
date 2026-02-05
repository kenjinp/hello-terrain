import type { TaskContext } from "../../tasks/task.types";
import { TASK_DEF } from "../../tasks/task.types";
import type { CacheStrategy, Lane } from "../../types";
import { createGetForCompiled, createGetForDiscovery } from "./getters";
import type { RunContext, RunDeps, RunState, TaskNodeRuntime } from "./types";

function taskLane<L extends Lane, Res>(n: TaskNodeRuntime<L, Res>): L {
  return (n.ref[TASK_DEF].options.lane ?? "cpu") as unknown as L;
}

function taskCache<L extends Lane, Res>(n: TaskNodeRuntime<L, Res>): CacheStrategy {
  return (n.ref[TASK_DEF].options.cache ?? ("memo" as CacheStrategy)) as CacheStrategy;
}

function createWork<L extends Lane, Res>(
  task: TaskNodeRuntime<L, Res>,
  workCalled: { value: boolean },
) {
  const prev = task.value;
  return ((fn: (prev: unknown) => unknown) => {
    if (workCalled.value) {
      throw new Error(
        `Task "${task.ref.id}" called work() more than once. Only one work() call is allowed per task.`,
      );
    }
    workCalled.value = true;
    return fn(prev);
  }) as any;
}

function commitDeps<L extends Lane, Res>(
  state: RunState<L, Res>,
  taskId: string,
  n: TaskNodeRuntime<L, Res>,
  nextDeps: Set<string>,
) {
  const prevDeps = state.dagGetIncomingIds(taskId);
  let changed = false;

  if (prevDeps) {
    // Remove stale edges
    const toRemove: string[] = [];
    for (const depId of prevDeps) {
      if (!nextDeps.has(depId)) toRemove.push(depId);
    }
    if (toRemove.length) {
      changed = true;
      for (const depId of toRemove) state.dagRemoveEdgeId(depId, taskId);
    }
  }

  // Add new edges
  if (prevDeps) {
    for (const depId of nextDeps) {
      if (!prevDeps.has(depId)) {
        changed = true;
        state.dagAddEdgeId(depId, taskId);
      }
    }
  } else if (nextDeps.size > 0) {
    changed = true;
    for (const depId of nextDeps) state.dagAddEdgeId(depId, taskId);
  }

  // n.deps is treated as a reusable scratch set; do not overwrite it.
  if (changed) state.markStructureChanged();
}

function finalizeSuccess<L extends Lane, Res>(
  state: RunState<L, Res>,
  ctx: RunContext<L, Res>,
  taskId: string,
  n: TaskNodeRuntime<L, Res>,
  output: unknown,
  dependenciesSeen: Set<string>,
  taskStartedAt: number,
) {
  n.depsKnown = true;
  commitDeps(state, taskId, n, dependenciesSeen);

  n.lastDepVersions.clear();
  for (const depId of dependenciesSeen) n.lastDepVersions.set(depId, state.currentVersion(depId));

  n.value = output;
  n.error = undefined;
  n.state = "ready";
  n.version += 1;
  (n as any).lastComputedRunId = ctx.runId;
  ctx.taskCount += 1;
  state.dirtyTasks.delete(taskId);

  const finishedAt = ctx.nowMs();
  if (state.shouldEmit("task:finish")) {
    state.emit({
      type: "task:finish",
      runId: ctx.runId,
      taskId,
      at: finishedAt,
      durationMs: Math.max(0, finishedAt - taskStartedAt),
    });
  }
}

function finalizeError<L extends Lane, Res>(
  deps: RunDeps,
  state: RunState<L, Res>,
  ctx: RunContext<L, Res>,
  taskId: string,
  n: TaskNodeRuntime<L, Res>,
  error: unknown,
  taskStartedAt: number,
  abort: boolean,
) {
  const erroredAt = ctx.nowMs();
  if (state.shouldEmit("task:error")) {
    state.emit({
      type: "task:error",
      runId: ctx.runId,
      taskId,
      at: erroredAt,
      durationMs: Math.max(0, erroredAt - taskStartedAt),
      error,
    });
  }

  n.error = error;
  n.state = "error";
  ctx.status = ctx.signal.aborted ? "cancelled" : "error";
  if (abort) ctx.controller.abort(error);
}

export async function executeTaskDiscovery<L extends Lane, Res>(
  deps: RunDeps,
  state: RunState<L, Res>,
  ctx: RunContext<L, Res>,
  n: TaskNodeRuntime<L, Res>,
  computeMissing: (taskId: string) => Promise<void>,
): Promise<void> {
  const taskId = n.ref.id;
  const lane = taskLane(n);

  const cache = taskCache(n);
  if (cache !== "none" && n.state === "ready" && !state.isTaskDirty(n)) {
    ctx.cacheHits += 1;
    if (state.shouldEmit("task:cacheHit"))
      state.emit({ type: "task:cacheHit", runId: ctx.runId, taskId, at: ctx.nowMs() });
    return;
  }

  // Retry loop for MissingTaskValueError: compute upstream, then retry.
  while (true) {
    if (ctx.signal.aborted) throw ctx.signal.reason ?? new deps.CancelledError();

    const dependenciesSeen = n.deps;
    dependenciesSeen.clear();
    const workCalled = { value: false };
    const get = createGetForDiscovery({
      deps,
      state,
      ctx,
      taskId,
      dependenciesSeen,
      workCalled,
    });
    const work = createWork(n, workCalled);

    const sema = ctx.getSemaphore(lane);
    const release = sema ? await sema.acquire() : undefined;
    let releasedEarly = false;
    const taskStartedAt = ctx.nowMs();
    try {
      n.state = "running";
      if (state.shouldEmit("task:start"))
        state.emit({ type: "task:start", runId: ctx.runId, taskId, at: taskStartedAt, lane });

      const taskCtx: TaskContext<L, Res> = {
        lane,
        signal: ctx.signal,
        now: ctx.nowMs,
        resources: ctx.options?.resources as Res | undefined,
      };

      const output = await n.ref[TASK_DEF].compute(get as any, work as any, taskCtx);
      finalizeSuccess(state, ctx, taskId, n, output, dependenciesSeen, taskStartedAt);
      return;
    } catch (error) {
      if (error instanceof deps.MissingTaskValueError) {
        if (release) {
          releasedEarly = true;
          release();
        }
        await computeMissing(error.taskId);
        continue;
      }

      finalizeError(deps, state, ctx, taskId, n, error, taskStartedAt, true);
      throw error;
    } finally {
      if (release && !releasedEarly) release();
    }
  }
}

export async function executeTaskCompiled<L extends Lane, Res>(
  deps: RunDeps,
  state: RunState<L, Res>,
  ctx: RunContext<L, Res>,
  n: TaskNodeRuntime<L, Res>,
  onUnblockDependent: (dependentId: string) => void,
): Promise<void> {
  const taskId = n.ref.id;
  const lane = taskLane(n);

  const sema = ctx.getSemaphore(lane);
  const release = sema ? await sema.acquire() : undefined;
  const taskStartedAt = ctx.nowMs();
  try {
    if (ctx.signal.aborted) throw ctx.signal.reason ?? new deps.CancelledError();

    const dependenciesSeen = n.deps;
    dependenciesSeen.clear();
    const workCalled = { value: false };
    const get = createGetForCompiled({
      deps,
      state,
      ctx,
      taskId,
      dependenciesSeen,
      workCalled,
    });
    const work = createWork(n, workCalled);

    n.state = "running";
    if (state.shouldEmit("task:start"))
      state.emit({ type: "task:start", runId: ctx.runId, taskId, at: taskStartedAt, lane });

    const taskCtx: TaskContext<L, Res> = {
      lane,
      signal: ctx.signal,
      now: ctx.nowMs,
      resources: ctx.options?.resources as Res | undefined,
    };

    const output = await n.ref[TASK_DEF].compute(get as any, work as any, taskCtx);
    finalizeSuccess(state, ctx, taskId, n, output, dependenciesSeen, taskStartedAt);

    const dependents = state.dagGetAdjacenciesIds(taskId);
    if (dependents) for (const dependentId of dependents) onUnblockDependent(dependentId);
  } catch (error) {
    finalizeError(deps, state, ctx, taskId, n, error, taskStartedAt, true);
  } finally {
    release?.();
  }
}
