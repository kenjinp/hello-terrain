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
  GraphEventOfSelector,
  GraphEventSelector,
  GraphEventType,
  InspectOptions,
  InspectResult,
  RunOptions,
  RunReport,
  RunStatus,
  Unsubscribe,
} from "./graph.types";

type TaskNodeRuntime<L extends Lane, Res> = {
  ref: Task<any, L, Res>;
  state: TaskState;
  version: number;
  depsKnown: boolean;
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
  // Legacy: receive all events.
  const listenersAll = new Set<GraphEventCallback>();
  // New: receive only a specific event type.
  const listenersByType = new Map<GraphEventType, Set<GraphEventCallback>>();
  // New: receive by wildcard prefix, e.g. "task:*" => "task:"
  const listenersByPrefix = new Map<string, Set<GraphEventCallback>>();

  const ensureSet = (m: Map<string, Set<GraphEventCallback>>, key: string) => {
    const existing = m.get(key);
    if (existing) return existing;
    const next = new Set<GraphEventCallback>();
    m.set(key, next);
    return next;
  };

  const emit = (e: GraphEvent) => {
    for (const cb of listenersAll) cb(e);

    const exact = listenersByType.get(e.type);
    if (exact) for (const cb of exact) cb(e);

    const prefix = e.type.slice(0, e.type.indexOf(":") + 1);
    const prefixed = listenersByPrefix.get(prefix);
    if (prefixed) for (const cb of prefixed) cb(e);
  };

  const tasksMap = new Map<string, TaskNodeRuntime<L, Res>>();
  const paramsMap = new Map<string, ParamNodeRuntime>();

  const everyTask: TaskRef<any>[] = [];

  // --- Compiled DAG state (rebuild only when structureVersion changes) ---
  let structureVersion = 0;
  let compiledVersion = -1;
  let compileCount = 0;
  let topoOrder: string[] = [];

  // Reverse edges for fast downstream propagation (includes param->task and task->task).
  const dependentsByNodeId = new Map<string, Set<string>>();

  // Tasks marked dirty by upstream changes (especially param changes).
  const dirtyTasks = new Set<string>();

  const ensureDependentSet = (nodeId: string) => {
    const existing = dependentsByNodeId.get(nodeId);
    if (existing) return existing;
    const next = new Set<string>();
    dependentsByNodeId.set(nodeId, next);
    return next;
  };

  const markStructureChanged = () => {
    structureVersion += 1;
  };

  const setEquals = (a: Set<string>, b: Set<string>) => {
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
  };

  const compileTopoIfNeeded = () => {
    if (compiledVersion === structureVersion) return;
    compileCount += 1;

    const indegree = new Map<string, number>();
    const adj = new Map<string, string[]>(); // task -> dependents (tasks only)

    for (const id of tasksMap.keys()) {
      indegree.set(id, 0);
      adj.set(id, []);
    }

    for (const [taskId, node] of tasksMap.entries()) {
      for (const depId of node.deps) {
        if (!tasksMap.has(depId)) continue; // ignore params
        indegree.set(taskId, (indegree.get(taskId) ?? 0) + 1);
        adj.get(depId)!.push(taskId);
      }
    }

    const q: string[] = [];
    for (const [id, deg] of indegree.entries()) if (deg === 0) q.push(id);

    const out: string[] = [];
    while (q.length) {
      const id = q.pop()!;
      out.push(id);
      for (const next of adj.get(id) ?? []) {
        const deg = (indegree.get(next) ?? 0) - 1;
        indegree.set(next, deg);
        if (deg === 0) q.push(next);
      }
    }

    if (out.length !== tasksMap.size) {
      // Cycle exists (or disconnected due to missing tasks, but we treat as cycle for now)
      throw new CyclicalGraphError("graph");
    }

    topoOrder = out;
    compiledVersion = structureVersion;
  };

  // TODO, should we also automatically register tasks??
  function ensureParamRegistered(param: ParamRef<any>) {
    const existing = paramsMap.get(param.id);
    if (existing) return existing;

    const node: ParamNodeRuntime = { ref: param, version: 0 };
    node.unsubscribe = param.subscribe(() => {
      node.version += 1;
      // Mark downstream tasks dirty without recursive scanning.
      const stack = [...(dependentsByNodeId.get(param.id) ?? [])];
      while (stack.length) {
        const tId = stack.pop()!;
        if (dirtyTasks.has(tId)) continue;
        dirtyTasks.add(tId);
        const next = dependentsByNodeId.get(tId);
        if (next) for (const dep of next) stack.push(dep);
      }
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

  function isDirtyDirect(task: TaskNodeRuntime<L, Res>): boolean {
    const cache: CacheStrategy | undefined = task.ref[TASK_DEF].options.cache;
    // no cache requested, mark as dirty
    if (cache === "none") return true;
    if (task.state !== "ready") return true;
    if (dirtyTasks.has(task.ref.id)) return true;

    // Direct dep version compare (no recursion).
    for (const depId of task.deps) {
      const previous = task.lastDepVersions.get(depId) ?? -1;
      const cur = currentVersion(depId);
      if (previous !== cur) return true;
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
      depsKnown: false,
      deps: new Set(),
      lastDepVersions: new Map(),
      dependents: new Set(),
      value: undefined,
      error: undefined,
    };

    tasksMap.set(task.id, node);
    everyTask.push(task);
    ensureDependentSet(task.id);
    markStructureChanged();
    return task;
  }

  function on(cb: GraphEventCallback): Unsubscribe;
  function on<S extends GraphEventSelector>(
    selector: S,
    cb: (e: GraphEventOfSelector<S>) => void,
  ): Unsubscribe;
  function on(a: any, b?: any): Unsubscribe {
    // Legacy overload: on((event) => ...)
    if (typeof a === "function") {
      const cb = a as GraphEventCallback;
      listenersAll.add(cb);
      return () => listenersAll.delete(cb);
    }

    const selector = a as GraphEventSelector;
    const cb = b as GraphEventCallback;
    if (typeof cb !== "function") {
      throw new Error(`graph.on("${String(selector)}", cb) requires a callback`);
    }

    // Wildcard: "task:*" (stored as "task:")
    if (selector.endsWith("*")) {
      const prefix = selector.slice(0, -1);
      const set = ensureSet(listenersByPrefix, prefix);
      set.add(cb);
      return () => set.delete(cb);
    }

    // Exact: "task:cacheHit"
    const set = ensureSet(
      listenersByType as unknown as Map<string, Set<GraphEventCallback>>,
      selector,
    );
    set.add(cb);
    return () => set.delete(cb);
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

    // If any target task hasn't discovered deps yet, skip compilation and use on-demand evaluation.
    const needsDiscovery = targets.some((t) => {
      const n = tasksMap.get(t.id);
      return n ? !n.depsKnown : false;
    });

    if (needsDiscovery) {
      const currentlyComputing = new Set<string>();

      const computeTask = async (taskId: string): Promise<void> => {
        const node = tasksMap.get(taskId);
        if (!node) throw new UnknownTaskError(taskId);

        const cache = node.ref[TASK_DEF].options.cache ?? ("memo" as CacheStrategy);
        const lane = (node.ref[TASK_DEF].options.lane ?? "cpu") as unknown as L;

        if (cache === "memo" && node.state === "ready" && !isDirtyDirect(node)) {
          cacheHits += 1;
          emit({ type: "task:cacheHit", runId, taskId, at: nowMs() });
          return;
        }

        if (currentlyComputing.has(taskId)) throw new CyclicalGraphError(taskId);
        currentlyComputing.add(taskId);

        try {
          let workCalled = false;

          while (true) {
            if (signal.aborted) throw signal.reason ?? new CancelledError();

            const dependenciesSeen = new Set<string>();
            const get = <T>(ref: any): T => {
              if (workCalled) {
                throw new Error(
                  `Task "${taskId}" called get() after work(). Read all dependencies before calling work().`,
                );
              }

              dependenciesSeen.add(ref.id);
              if (isParam(ref)) {
                ensureParamRegistered(ref);
                return ref.get() as T;
              }

              if (isTask(ref)) {
                const upstream = tasksMap.get(ref.id);
                if (!upstream) throw new UnknownTaskError(ref.id);
                if (upstream.state === "ready" && !isDirtyDirect(upstream))
                  return upstream.value as T;
                throw new MissingTaskValueError(ref.id);
              }

              throw new UnknownNodeError(ref.id);
            };

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
                if (workCalled) {
                  throw new Error(
                    `Task "${taskId}" called work() more than once. Only one work() call is allowed per task.`,
                  );
                }
                workCalled = true;
                return fn();
              }) as any;

              const output = await node.ref[TASK_DEF].compute(get as any, work as any, ctx);

              const prevDeps = node.deps;
              const nextDeps = dependenciesSeen;
              if (!setEquals(prevDeps, nextDeps)) {
                for (const depId of prevDeps) {
                  ensureDependentSet(depId).delete(taskId);
                  const upstreamTask = tasksMap.get(depId);
                  upstreamTask?.dependents.delete(taskId);
                }
                for (const depId of nextDeps) {
                  ensureDependentSet(depId).add(taskId);
                  const upstreamTask = tasksMap.get(depId);
                  upstreamTask?.dependents.add(taskId);
                }
                node.deps = nextDeps;
                markStructureChanged();
              }

              node.depsKnown = true;
              node.lastDepVersions.clear();
              for (const depId of node.deps) node.lastDepVersions.set(depId, currentVersion(depId));

              node.value = output;
              node.error = undefined;
              node.state = "ready";
              node.version += 1;
              taskCount += 1;
              dirtyTasks.delete(taskId);

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

              if (error instanceof MissingTaskValueError) {
                release();
                await computeTask(error.taskId);
                continue;
              }

              node.error = error;
              node.state = "error";
              status = signal.aborted ? "cancelled" : "error";
              controller.abort(error);
              throw error;
            } finally {
              release();
            }
          }
        } finally {
          currentlyComputing.delete(taskId);
        }
      };

      try {
        await Promise.all(targets.map((t) => computeTask(t.id)));
      } catch {
        if (signal.aborted && status === "ok") status = "cancelled";
      }

      compileTopoIfNeeded();

      const finishedAt = nowMs();
      emit({ type: "run:finish", runId, at: finishedAt, status });

      return {
        runId,
        status,
        startedAt,
        finishedAt,
        durationMs: Math.max(0, finishedAt - startedAt),
        taskCount,
        cacheHits,
      };
    }

    // Ensure we have a compiled topo order for known deps.
    compileTopoIfNeeded();

    // Required tasks = closure of targets over task->task deps.
    const requiredTaskIds = new Set<string>();
    const stack = targets.map((t) => t.id);
    while (stack.length) {
      const id = stack.pop()!;
      if (requiredTaskIds.has(id)) continue;
      requiredTaskIds.add(id);
      const node = tasksMap.get(id);
      if (!node) throw new UnknownTaskError(id);
      for (const depId of node.deps) {
        if (tasksMap.has(depId)) stack.push(depId);
      }
    }

    // Cache hits accounting (required only).
    for (const id of requiredTaskIds) {
      const n = tasksMap.get(id);
      if (!n) continue;
      const cache = n.ref[TASK_DEF].options.cache ?? ("memo" as CacheStrategy);
      if (cache === "memo" && n.state === "ready" && !isDirtyDirect(n)) {
        cacheHits += 1;
        emit({ type: "task:cacheHit", runId, taskId: id, at: nowMs() });
      }
    }

    // Determine which required tasks must run.
    const mustRun: TaskNodeRuntime<L, Res>[] = [];
    const mustRunSet = new Set<string>();
    for (const id of topoOrder) {
      if (!requiredTaskIds.has(id)) continue;
      const n = tasksMap.get(id)!;
      const cache = n.ref[TASK_DEF].options.cache ?? ("memo" as CacheStrategy);
      if (cache === "none" || isDirtyDirect(n)) {
        mustRun.push(n);
        mustRunSet.add(id);
      }
    }

    // By the time we get here, all targets have depsKnown and we can rely on the compiled DAG scheduler.

    const pendingDepsCount = new Map<string, number>();
    for (const n of mustRun) {
      let count = 0;
      for (const depId of n.deps) {
        if (tasksMap.has(depId) && mustRunSet.has(depId)) count += 1;
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
    let firstError: unknown = undefined;

    const execOne = async (n: TaskNodeRuntime<L, Res>) => {
      const taskId = n.ref.id;
      const lane = (n.ref[TASK_DEF].options.lane ?? "cpu") as unknown as L;

      const release = await getSemaphore(lane).acquire();
      const taskStartedAt = nowMs();
      try {
        if (signal.aborted) throw signal.reason ?? new CancelledError();

        let workCalled = false;
        const dependenciesSeen = new Set<string>();

        const get = <T>(ref: any): T => {
          if (workCalled) {
            throw new Error(
              `Task "${taskId}" called get() after work(). Read all dependencies before calling work().`,
            );
          }

          dependenciesSeen.add(ref.id);

          if (isParam(ref)) {
            ensureParamRegistered(ref);
            return ref.get() as T;
          }

          if (isTask(ref)) {
            const upstream = tasksMap.get(ref.id);
            if (!upstream) throw new UnknownTaskError(ref.id);
            if (upstream.state !== "ready") throw new NoComputedValueError(ref.id);
            return upstream.value as T;
          }

          throw new UnknownNodeError(ref.id);
        };

        const work = ((fn: () => unknown) => {
          if (workCalled) {
            throw new Error(
              `Task "${taskId}" called work() more than once. Only one work() call is allowed per task.`,
            );
          }
          workCalled = true;
          return fn();
        }) as any;

        n.state = "running";
        emit({ type: "task:start", runId, taskId, at: taskStartedAt, lane });

        const ctx: TaskContext<L, Res> = {
          lane,
          signal,
          now: nowMs,
          resources: options?.resources as Res | undefined,
        };

        const output = await n.ref[TASK_DEF].compute(get, work, ctx);

        // Commit deps (update reverse edges).
        const prevDeps = n.deps;
        const nextDeps = dependenciesSeen;

        if (!setEquals(prevDeps, nextDeps)) {
          // remove edges
          for (const depId of prevDeps) {
            ensureDependentSet(depId).delete(taskId);
            const upstreamTask = tasksMap.get(depId);
            upstreamTask?.dependents.delete(taskId);
          }

          // add edges
          for (const depId of nextDeps) {
            ensureDependentSet(depId).add(taskId);
            const upstreamTask = tasksMap.get(depId);
            upstreamTask?.dependents.add(taskId);
          }

          n.deps = nextDeps;
          markStructureChanged();
        }

        n.depsKnown = true;

        n.lastDepVersions.clear();
        for (const depId of n.deps) {
          n.lastDepVersions.set(depId, currentVersion(depId));
        }

        n.value = output;
        n.error = undefined;
        n.state = "ready";
        n.version += 1;
        taskCount += 1;
        dirtyTasks.delete(taskId);

        const taskFinishedAt = nowMs();
        emit({
          type: "task:finish",
          runId,
          taskId,
          at: taskFinishedAt,
          durationMs: Math.max(0, taskFinishedAt - taskStartedAt),
        });

        // Unblock dependents (only those we plan to run).
        for (const dependentId of n.dependents) {
          if (!mustRunSet.has(dependentId)) continue;
          const next = (pendingDepsCount.get(dependentId) ?? 0) - 1;
          pendingDepsCount.set(dependentId, next);
          if (next === 0) {
            const depNode = tasksMap.get(dependentId);
            if (depNode) pushReady(depNode);
          }
        }
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
        firstError = firstError ?? error;
        n.error = error;
        n.state = "error";
        status = signal.aborted ? "cancelled" : "error";
        controller.abort(error);
      } finally {
        release();
      }
    };

    const launch = (n: TaskNodeRuntime<L, Res>) => {
      const p = execOne(n);
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
      if (signal.aborted && status !== "ok") break;
    }

    await Promise.allSettled(inFlight);
    void firstError;

    // If deps changed mid-run, compile now so next run doesn't need to.
    compileTopoIfNeeded();

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

  function inspect(options?: InspectOptions): InspectResult {
    const nodes: InspectResult["nodes"] = [];
    const edges: InspectResult["edges"] = [];

    for (const p of paramsMap.values()) {
      nodes.push({
        id: p.ref.id,
        kind: "param",
        name: p.ref.name,
        version: options?.includeRuntime ? p.version : undefined,
      });
    }

    for (const t of tasksMap.values()) {
      const opts = t.ref[TASK_DEF].options;
      nodes.push({
        id: t.ref.id,
        kind: "task",
        name: t.ref.name,
        lane: opts.lane,
        cache: opts.cache,
        tags: opts.tags,
        state: options?.includeRuntime ? t.state : undefined,
        dirty: options?.includeRuntime ? isDirtyDirect(t) : undefined,
        version: options?.includeRuntime ? t.version : undefined,
      });

      for (const depId of t.deps) {
        edges.push({
          from: depId,
          to: t.ref.id,
          kind: tasksMap.has(depId) ? "task" : "param",
        });
      }
    }

    return {
      nodes,
      edges,
      meta: options?.includeRuntime
        ? {
            structureVersion,
            compiledVersion,
            compileCount,
            topoOrder,
          }
        : undefined,
    };
  }

  // expose methods
  return {
    on,
    add,
    run,
    inspect,
    get: getTaskValue,
    peek: peekTaskValue,
  };
}
