import { dispose, isDisposable } from "../../tasks/dispose";
import type { TaskContext, TaskScope } from "../../tasks/task.types";
import { TASK_DEF } from "../../tasks/task.types";
import type { CacheStrategy, Lane } from "../../types";
import { isReference, owns } from "../teardown";
import { createGetForCompiled, createGetForDiscovery } from "./getters";
import type {
  Execution,
  OnInvalidated,
  RunContext,
  RunDeps,
  RunState,
  TaskNodeRuntime,
} from "./types";

function taskLane<L extends Lane, Res>(n: TaskNodeRuntime<L, Res>): L {
  return (n.ref[TASK_DEF].options.lane ?? "cpu") as unknown as L;
}

function taskCache<L extends Lane, Res>(n: TaskNodeRuntime<L, Res>): CacheStrategy {
  return (n.ref[TASK_DEF].options.cache ?? ("memo" as CacheStrategy)) as CacheStrategy;
}

function createExecution(): Execution {
  return {
    workCalled: false,
    reads: undefined,
    entries: undefined,
    sealed: false,
    released: undefined,
  };
}

function sealedMessage(taskId: string, method: string): string {
  return (
    'Task "' +
    taskId +
    '" called ctx.' +
    method +
    "() after it finished. The context is only valid while the task is computing."
  );
}

function assertOpen(exec: Execution, taskId: string, method: string) {
  if (exec.sealed) throw new Error(sealedMessage(taskId, method));
}

/**
 * Per-execution context.
 *
 * `scope` is a plain property holding plain closures, on purpose. Creating it in a getter on
 * first use looks cheaper, but an object literal with an accessor gets a hidden class of its
 * own each time it is evaluated, and hidden classes live in old space: a hot loop of
 * recomputing tasks then pays for major GCs (measured: +35% per run and pauses of 5 to 12 ms).
 */
function createTaskContext<L extends Lane, Res>(
  state: RunState<L, Res>,
  ctx: RunContext<L, Res>,
  n: TaskNodeRuntime<L, Res>,
  lane: L,
  exec: Execution,
  onInvalidated: OnInvalidated,
): TaskContext<L, Res> {
  const taskId = n.ref.id;

  // The methods close over the execution, so they are safe to destructure.
  const scope: TaskScope = {
    use(value) {
      assertOpen(exec, taskId, "scope.use");
      if (value === null || value === undefined) return value;
      if (!isDisposable(value)) {
        throw new TypeError(
          'Task "' +
            taskId +
            '" called ctx.scope.use() with a value that has no Symbol.dispose or Symbol.asyncDispose',
        );
      }
      // The same object registered twice is still disposed once.
      if (!owns(exec.entries, value)) {
        (exec.entries ??= []).push({ value, fn: dispose, deferred: false });
      }
      return value;
    },

    adopt(value, teardown) {
      assertOpen(exec, taskId, "scope.adopt");
      if (typeof teardown !== "function") {
        throw new TypeError('Task "' + taskId + '" called ctx.scope.adopt() without a function');
      }
      if (!isReference(value) || !owns(exec.entries, value)) {
        (exec.entries ??= []).push({ value, fn: teardown, deferred: false });
      }
      return value;
    },

    defer(fn) {
      assertOpen(exec, taskId, "scope.defer");
      if (typeof fn !== "function") {
        throw new TypeError('Task "' + taskId + '" called ctx.scope.defer() without a function');
      }
      (exec.entries ??= []).push({ value: undefined, fn, deferred: true });
    },
  };

  return {
    lane,
    signal: ctx.signal,
    now: ctx.nowMs,
    resources: ctx.options?.resources as Res | undefined,
    scope,

    teardownPrevious() {
      if (exec.sealed) {
        return Promise.reject(new Error(sealedMessage(taskId, "teardownPrevious")));
      }
      if (exec.released === undefined) {
        const released = state.teardown.releasePrevious(n);
        // Dependents lost their values with it. The scheduler has to bring them back.
        if (released) onInvalidated(taskId);
        exec.released = released ?? Promise.resolve();
      }
      return exec.released;
    },
  };
}

function createWork<L extends Lane, Res>(task: TaskNodeRuntime<L, Res>, exec: Execution) {
  return ((fn: (prev: unknown) => unknown) => {
    if (exec.workCalled) {
      throw new Error(
        `Task "${task.ref.id}" called work() more than once. Only one work() call is allowed per task.`,
      );
    }
    exec.workCalled = true;
    // Read here, not when the task starts: `ctx.teardownPrevious()` may have released the value.
    return fn(task.value);
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
  exec: Execution,
) {
  const teardown = state.teardown;
  // The value owns these from here on. Cleared first, so that nothing below can hand them to
  // `discard()` a second time.
  const entries = exec.entries;
  const reads = exec.reads;
  exec.entries = undefined;
  exec.reads = undefined;

  // The graph was disposed while this task was computing. Nothing will ever read the value.
  if (ctx.epoch !== state.epoch()) {
    teardown.orphan(n, output, entries, reads, "disposed");
    return;
  }

  n.depsKnown = true;
  commitDeps(state, taskId, n, dependenciesSeen);

  // `n.lastDepVersions` was stamped by `get()` as each dependency was read.

  if (reads !== undefined && teardown.revoked(reads)) {
    // A dependency called `ctx.teardownPrevious()` while this task was computing, and this
    // result was built on the value that went away. It is torn down like the ones the release
    // found, and the task computes again.
    teardown.orphan(n, output, entries, reads, "released");
    if (!n.live) {
      n.state = "idle";
      state.dirtyTasks.add(taskId);
    }
  } else {
    // Nothing to do for a task that has no teardown, registered nothing on its scope and read
    // no value that has either.
    if (
      entries !== undefined ||
      reads !== undefined ||
      n.gen !== undefined ||
      n.reads !== undefined ||
      n.ref[TASK_DEF].options.teardown !== undefined
    ) {
      teardown.replace(n, output, entries, reads);
    }

    n.value = output;
    n.live = true;
    n.error = undefined;
    n.state = "ready";
    n.version += 1;
    n.lastComputedRunId = ctx.runId;
    state.dirtyTasks.delete(taskId);
  }
  ctx.taskCount += 1;

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
  onInvalidated: OnInvalidated,
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
    n.lastDepVersions.clear();
    const exec = createExecution();
    const get = createGetForDiscovery({
      deps,
      state,
      ctx,
      taskId,
      dependenciesSeen,
      versionsSeen: n.lastDepVersions,
      exec,
    });

    const sema = ctx.getSemaphore(lane);
    const release = sema ? await sema.acquire() : undefined;
    let releasedEarly = false;
    const taskStartedAt = ctx.nowMs();
    try {
      n.state = "running";
      if (state.shouldEmit("task:start"))
        state.emit({ type: "task:start", runId: ctx.runId, taskId, at: taskStartedAt, lane });

      const taskCtx = createTaskContext(state, ctx, n, lane, exec, onInvalidated);
      const work = createWork(n, exec);
      const output = await n.ref[TASK_DEF].compute(get as any, work as any, taskCtx);

      finalizeSuccess(state, ctx, taskId, n, output, dependenciesSeen, taskStartedAt, exec);
      return;
    } catch (error) {
      // The attempt produced no value: what it set up is undone and what it read is let go.
      if (exec.entries || exec.reads) {
        state.teardown.discard(taskId, exec.entries, exec.reads, error);
        exec.entries = undefined;
        exec.reads = undefined;
      }

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
      exec.sealed = true;
      if (release && !releasedEarly) release();
    }
  }
}

export async function executeTaskCompiled<L extends Lane, Res>(
  deps: RunDeps,
  state: RunState<L, Res>,
  ctx: RunContext<L, Res>,
  n: TaskNodeRuntime<L, Res>,
  onFinished: (taskId: string) => void,
  onInvalidated: OnInvalidated,
): Promise<void> {
  const taskId = n.ref.id;
  const lane = taskLane(n);

  const sema = ctx.getSemaphore(lane);
  const release = sema ? await sema.acquire() : undefined;
  const taskStartedAt = ctx.nowMs();
  const exec = createExecution();
  try {
    if (ctx.signal.aborted) throw ctx.signal.reason ?? new deps.CancelledError();

    const dependenciesSeen = n.deps;
    dependenciesSeen.clear();
    n.lastDepVersions.clear();
    const get = createGetForCompiled({
      deps,
      state,
      ctx,
      taskId,
      dependenciesSeen,
      versionsSeen: n.lastDepVersions,
      exec,
    });

    n.state = "running";
    if (state.shouldEmit("task:start"))
      state.emit({ type: "task:start", runId: ctx.runId, taskId, at: taskStartedAt, lane });

    const taskCtx = createTaskContext(state, ctx, n, lane, exec, onInvalidated);
    const work = createWork(n, exec);
    const output = await n.ref[TASK_DEF].compute(get as any, work as any, taskCtx);

    finalizeSuccess(state, ctx, taskId, n, output, dependenciesSeen, taskStartedAt, exec);
    onFinished(taskId);
  } catch (error) {
    if (exec.entries || exec.reads) {
      state.teardown.discard(taskId, exec.entries, exec.reads, error);
    }
    finalizeError(deps, state, ctx, taskId, n, error, taskStartedAt, true);
  } finally {
    exec.sealed = true;
    release?.();
  }
}
