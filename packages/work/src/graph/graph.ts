import type { ParamRef } from "../param/param.types";
import { semaphore } from "../semaphore/semaphore";
import {
  TASK_DEF,
  TaskContext,
  type Task,
  type TaskRef,
  type TaskState,
} from "../tasks/task.types";
import type { CacheStrategy, Lane } from "../types";
import { createRunId, isParam, isTask, nowMs } from "../utils";
import type {
  GraphEvent,
  GraphEventCallback,
  RunOptions,
  RunReport,
  RunStatus,
  Unsubscribe,
} from "./graph.types";

type TaskNodeRuntime<L extends Lane, Res> = {
  ref: Task<any, L, Res>;
  state: TaskState;
  version: number;
  deps: Set<string>;
  lastDepVersions: Map<string, number>;
  dependents: Set<string>;
  value?: unknown;
  error?: unknown;
};

type ParamNodeRuntime = {
  ref: ParamRef<any>;
  version: number;
  unsubscribe?: Unsubscribe;
};

export class UnknownNodeError extends Error {
  readonly id: string;
  constructor(id: string) {
    super(`Requested Unknown Node Id: ${id}`);
    this.id = id;
  }
}

export class NoComputedValueError extends Error {
  readonly id: string;
  constructor(id: string) {
    super(`Requested node with no computed value: ${id}`);
    this.id = id;
  }
}

export class CyclicalGraphError extends Error {
  readonly id: string;
  constructor(id: string) {
    super(`Cycle detected while computing ${id}`);
    this.id = id;
  }
}

export class CancelledError extends Error {
  constructor() {
    super("Run cancelled");
  }
}

export class UnknownTaskError extends Error {
  readonly id: string;
  constructor(id: string) {
    super(`Requested unknown Task Id: ${id}`);
    this.id = id;
  }
}

class MissingTaskValueError extends Error {
  readonly taskId: string;
  constructor(taskId: string) {
    super(`Missing task value: ${taskId}`);
    this.taskId = taskId;
  }
}

export function graph<L extends Lane = Lane, Res = unknown>() {
  const listeners = new Set<GraphEventCallback>();
  const emit = (e: GraphEvent) => {
    for (const cb of listeners) cb(e);
  };

  const tasksMap = new Map<string, TaskNodeRuntime<L, Res>>();
  const paramsMap = new Map<string, ParamNodeRuntime>();

  const everyTask: TaskRef<any>[] = [];

  // TODO, should we also automatically register tasks??
  function ensureParamRegistered(param: ParamRef<any>) {
    const existing = paramsMap.get(param.id);
    if (existing) return existing;

    const node: ParamNodeRuntime = { ref: param, version: 0 };
    node.unsubscribe = param.subscribe(() => {
      node.version += 1;
    });
    paramsMap.set(param.id, node);
    return node;
  }

  function currentVersion(id: string): number {
    const t = tasksMap.get(id);
    if (t) return t.version;
    const p = paramsMap.get(id);
    if (p) return p.version;
    throw new UnknownNodeError(id);
  }

  function computeDirtyNodes(
    task: TaskNodeRuntime<L, Res>,
    seen: Set<string> = new Set(),
  ): boolean {
    // if there is a cyclical hit we treat the node as dirty
    if (seen.has(task.ref.id)) return true;
    seen.add(task.ref.id);

    const cache: CacheStrategy | undefined = task.ref[TASK_DEF].options.cache;
    // no cache requested, mark as dirty
    if (cache === "none") return true;
    // ready means we already calculated the state, so this must be waiting to be fired
    if (task.state !== "ready") return true;

    for (const depId of task.deps) {
      const upstreamTask = tasksMap.get(depId);
      // if we have any upstream tasks and any of those tasks are dirty, mark dirty
      if (upstreamTask && computeDirtyNodes(upstreamTask, seen)) return true;

      // compare dependency versions (is it necessary?)
      const previousDepVersions = task.lastDepVersions.get(depId) ?? -1;
      const currentDepVersion = currentVersion(depId);

      if (previousDepVersions !== currentDepVersion) return true;
    }
    return false;
  }

  function getTaskValue<T>(taskRef: TaskRef<T>): T {
    const node = tasksMap.get(taskRef.id);
    if (!node) throw new UnknownNodeError(taskRef.id);
    if (node.state !== "ready") throw new NoComputedValueError(taskRef.id);
    return node.value as T;
  }

  function peekTaskValue<T>(taskRef: TaskRef<T>): T | undefined {
    const node = tasksMap.get(taskRef.id);
    if (!node) return undefined;
    return node.state === "ready" ? (node.value as T) : undefined;
  }

  function add<T>(task: Task<T, L, Res>): TaskRef<T> {
    if (tasksMap.has(task.id)) return task;

    const node: TaskNodeRuntime<L, Res> = {
      ref: task as Task<T, L, Res>,
      state: "idle",
      version: 0,
      deps: new Set(),
      lastDepVersions: new Map(),
      dependents: new Set(),
      value: undefined,
      error: undefined,
    };

    tasksMap.set(task.id, node);
    everyTask.push(task);
    return task;
  }

  function on(cb: GraphEventCallback): Unsubscribe {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }

  async function run(options?: RunOptions<L, Res>): Promise<RunReport> {
    // new run, woohoo!
    const runId = createRunId();
    const startedAt = nowMs();
    emit({ type: "run:start", runId, at: startedAt });

    // abort behavior
    const controller = new AbortController();
    if (options?.signal) {
      if (options.signal.aborted) controller.abort(options.signal.reason);
      else {
        options.signal.addEventListener("abort", () => controller.abort(options.signal!.reason), {
          once: true,
        });
      }
    }
    const signal = controller.signal;

    const laneConcurrency = (options?.laneConcurrency ?? {}) as Partial<Record<L, number>>;
    const semaphoreByLane = new Map<L, ReturnType<typeof semaphore>>();
    function getSemaphore(lane: L) {
      const existing = semaphoreByLane.get(lane);
      if (existing) return existing;
      const permits = laneConcurrency[lane] ?? 1;
      const sema = semaphore(permits);
      semaphoreByLane.set(lane, sema);
      return sema;
    }

    const targets =
      options?.targets && options.targets.length > 0
        ? options.targets
        : (everyTask as readonly TaskRef<any>[]);

    let status: RunStatus = "ok";
    let taskCount = 0;
    let cacheHits = 0;

    const currentlyComputing = new Set<string>();

    async function computeTask(taskId: string): Promise<void> {
      const node = tasksMap.get(taskId);
      if (!node) throw UnknownNodeError;

      const cache = node.ref[TASK_DEF].options.cache ?? ("memo" as CacheStrategy);
      const lane = (node.ref[TASK_DEF].options.lane ?? ("cpu" as L)) as L;

      if (cache === "memo" && node.state === "ready" && !computeDirtyNodes(node)) {
        cacheHits += 1;
        emit({ type: "task:cacheHit", runId, taskId, at: nowMs() });
        return;
      }

      if (currentlyComputing.has(taskId)) throw new CyclicalGraphError(taskId);

      currentlyComputing.add(taskId);

      try {
        // `work()` is guaranteed to execute at most once per task per `computeTask()` call
        // TODO: add test to ensure this
        let workCalled = false;
        let workReturn: unknown = undefined;
        let workPromise: Promise<unknown> | undefined = undefined;

        while (true) {
          if (signal.aborted) throw signal.reason ?? new CancelledError();

          const dependenciesSeen = new Set<string>();
          // handle dependencies
          function get<T>(ref: any): T {
            if (workCalled)
              throw new Error(
                `Task "${taskId}" called get() after work(). Read all dependencies before calling work().`,
              );
            dependenciesSeen.add(ref.id);
            // Handle Params
            if (isParam(ref)) {
              ensureParamRegistered(ref);
              return ref.get() as T;
            }
            // Handle Tasks
            if (isTask(ref)) {
              const upstream = tasksMap.get(ref.id);
              // this task wasn't registered.  (Should we automatically register them?)
              if (!upstream) throw new UnknownTaskError(ref.id);
              if (upstream.state === "ready" && !computeDirtyNodes(upstream))
                return upstream.value as T;
              throw new MissingTaskValueError(ref.id);
            }
            throw new UnknownNodeError(ref.id);
          }

          // Kick off Task compute work
          const release = await getSemaphore(lane).acquire();
          const taskStartedAt = nowMs();
          try {
            node.state = "running";
            emit({ type: "task:start", runId, taskId, at: taskStartedAt, lane });

            const ctx: TaskContext<L, Res> = {
              lane,
              signal,
              now: nowMs,
              resources: options?.resources as Res | undefined,
            };

            const work = ((fn: () => unknown) => {
              // Memo tasks can safely return the previously computed value if clean.
              if (cache === "memo" && node.state === "ready" && !computeDirtyNodes(node)) {
                return node.value;
              }

              if (workPromise) return workReturn;

              workCalled = true;
              const returnValue = fn();
              workReturn = returnValue;
              workPromise = Promise.resolve(returnValue);
              return returnValue;
            }) as any;

            const output = await node.ref[TASK_DEF].compute(get, work, ctx);

            // Commit deps (update reverse edges)
            // delete stale dependency relationships
            for (const oldDepId of node.deps) {
              if (dependenciesSeen.has(oldDepId)) continue;
              const upstream = tasksMap.get(oldDepId);
              upstream?.dependents.delete(taskId);
            }
            // update with fresh dependency relationships
            for (const depId of dependenciesSeen) {
              const upstream = tasksMap.get(depId);
              if (upstream) upstream.dependents.add(taskId);
            }

            node.deps = dependenciesSeen;

            node.lastDepVersions.clear();
            for (const depId of node.deps) {
              node.lastDepVersions.set(depId, currentVersion(depId));
            }

            node.value = output;
            node.error = undefined;
            node.state = "ready";
            node.version += 1;
            taskCount += 1;

            const taskFinishedAt = nowMs();
            emit({
              type: "task:finish",
              runId,
              taskId,
              at: taskFinishedAt,
              durationMs: Math.max(0, taskFinishedAt - taskStartedAt),
            });
            return;
          } catch (error) {
            const erroredAt = nowMs();
            emit({
              type: "task:error",
              runId,
              taskId,
              at: erroredAt,
              durationMs: Math.max(0, erroredAt - taskStartedAt),
              error,
            });

            // if we are missing value deps, let's run those tasks
            if (error instanceof MissingTaskValueError) {
              release();
              const missingId = error.taskId;
              await computeTask(missingId);
              continue;
            }

            node.error = error;
            node.state = "error";
            status = signal.aborted ? "cancelled" : "error";
            controller.abort(error);
            throw error;
          } finally {
            // be kind and let the next task through the door!
            release();
          }
        }
      } finally {
        currentlyComputing.delete(taskId);
      }
    }

    try {
      await Promise.all(targets.map((t) => computeTask(t.id)));
    } catch {
      if (signal.aborted && status === "ok") status = "cancelled";
    }

    // we made it to the end!!
    const finishedAt = nowMs();
    emit({ type: "run:finish", runId, at: finishedAt, status });

    const report: RunReport = {
      runId,
      status,
      startedAt,
      finishedAt,
      durationMs: Math.max(0, finishedAt - startedAt),
      taskCount,
      cacheHits,
    };
    return report;
  }

  // expose methods
  return {
    on,
    add,
    run,
    get: getTaskValue,
    peek: peekTaskValue,
  };
}
