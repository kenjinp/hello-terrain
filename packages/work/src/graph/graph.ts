import { dag } from "../dag/dag";
import { events } from "../events/events";
import type { ParamRef, ParamSetCallback, ParamSetInput, Unsubscribe } from "../param/param.types";
import { semaphore } from "../semaphore/semaphore";
import { TASK_DEF, type Task, type TaskRef, type TaskState } from "../tasks/task.types";
import type { CacheStrategy, Lane } from "../types";
import { createRunId, isParam, isTask, nowMs } from "../utils";
import {
  CancelledError,
  CyclicalGraphError,
  MissingTaskValueError,
  NoComputedValueError,
  UnknownNodeError,
  UnknownTaskError,
} from "./graph.errors";
import type {
  Graph,
  GraphOptions,
  InspectOptions,
  InspectResult,
  RunOptions,
  RunReport,
} from "./graph.types";
import { createRun } from "./run";
import { createTeardown, type Generation, type Teardown } from "./teardown";

type TaskNodeRuntime<L extends Lane, Res> = {
  ref: Task<any, L, Res>;
  state: TaskState;
  version: number;
  depsKnown: boolean;
  deps: Set<string>;
  lastDepVersions: Map<string, number>;
  /** Run id in which this task last computed successfully (for within-run dependency reads). */
  lastComputedRunId?: string;
  value?: unknown;
  error?: unknown;
  /** True while `value` is a value that still has to be torn down. */
  live: boolean;
  gen?: Generation;
  reads?: Generation[];
  disposed?: boolean;
};

type ParamNodeRuntime = {
  ref: ParamRef<any>;
  version: number;
  unsubscribe?: Unsubscribe;
  /** When present, the graph owns the param value locally (set via `graph.set()`). */
  bound?: { value: any; initial: any };
};

type GraphState<L extends Lane, Res> = {
  readonly tasksMap: Map<string, TaskNodeRuntime<L, Res>>;
  readonly paramsMap: Map<string, ParamNodeRuntime>;
  readonly allTaskRefNodes: readonly TaskRef<any>[];
  readonly dirtyTasks: Set<string>;
  readonly emit: ReturnType<typeof events>["emit"];
  readonly shouldEmit: ReturnType<typeof events>["hasListeners"];

  markStructureChanged(): void;
  compileTopologyIfNeeded(): void;
  getTopoOrder(): readonly string[];
  dagAddEdgeId(fromId: string, toId: string): void;
  dagRemoveEdgeId(fromId: string, toId: string): void;
  dagGetAdjacenciesIds(id: string): Set<string> | undefined;
  dagGetIncomingIds(id: string): Set<string> | undefined;

  ensureParamRegistered(param: ParamRef<any>): ParamNodeRuntime;
  ensureTaskRegistered<T>(task: Task<T, L, Res>): TaskRef<T>;
  currentVersion(nodeId: string): number;
  isTaskDirty(task: TaskNodeRuntime<L, Res>): boolean;

  readonly teardown: Teardown;
  epoch(): number;
  runStarted(run: ActiveRun): void;
  runFinished(run: ActiveRun): void;
};

type ActiveRun = { readonly controller: AbortController; pin: number };

export function graph<Res = unknown, L extends Lane = Lane>(
  options?: GraphOptions,
): Graph<L, Res> {
  const { on, emit, hasListeners } = events();
  const tasksMap = new Map<string, TaskNodeRuntime<L, Res>>();
  const paramsMap = new Map<string, ParamNodeRuntime>();
  const allTaskRefNodes: TaskRef<any>[] = [];

  let structureVersion = 0;
  let compiledVersion = -1;
  let compileCount = 0;
  let topoOrder: string[] = [];
  let d = dag<ParamRef<any> | TaskRef<any>>();

  function markStructureChanged() {
    structureVersion += 1;
  }

  // Tasks marked dirty by upstream changes.
  const dirtyTasks = new Set<string>();

  const compileTopologyIfNeeded = () => {
    if (compiledVersion === structureVersion) return;
    compileCount += 1;
    topoOrder = d.topologicalSortIds().filter((id) => tasksMap.has(id));
    compiledVersion = structureVersion;
  };

  // Dependency depth per task: 0 for tasks that read no other task. Tasks at the same depth
  // cannot depend on each other, which is what lets their teardowns overlap.
  let depthByTask = new Map<string, number>();
  let depthVersion = -1;
  function depths() {
    compileTopologyIfNeeded();
    if (depthVersion === compiledVersion) return depthByTask;
    depthByTask = new Map();
    for (const id of topoOrder) {
      let depth = 0;
      const incoming = d.getIncomingIds(id);
      if (incoming) {
        for (const depId of incoming) {
          const upstream = depthByTask.get(depId);
          if (upstream !== undefined && upstream >= depth) depth = upstream + 1;
        }
      }
      depthByTask.set(id, depth);
    }
    depthVersion = compiledVersion;
    return depthByTask;
  }

  // Runs in flight. A value retired while a run is active is not torn down before that run
  // ends, so a run that overlaps the one that retired it can still finish reading it.
  // `ctx.teardownPrevious()` is the exception: it does not wait for anyone.
  const activeRuns = new Set<ActiveRun>();
  // Leases in flight. They hold exactly what they read; `dispose()` aborts them.
  const leases = new Set<AbortController>();

  function oldestPin(): number {
    let oldest = Number.POSITIVE_INFINITY;
    for (const run of activeRuns) if (run.pin < oldest) oldest = run.pin;
    return oldest;
  }

  /** Every task downstream of `taskId`, dependents before the tasks they depend on. */
  function dependentsOf(taskId: string): TaskNodeRuntime<L, Res>[] {
    const seen = new Set<string>();
    const stack = [...(d.getAdjacenciesId(taskId) ?? [])];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id) || !tasksMap.has(id)) continue;
      seen.add(id);
      const next = d.getAdjacenciesId(id);
      if (next) for (const nextId of next) stack.push(nextId);
    }
    if (seen.size === 0) return [];
    const depth = depths();
    return [...seen]
      .sort((x, y) => (depth.get(y) ?? 0) - (depth.get(x) ?? 0))
      .map((id) => tasksMap.get(id)!);
  }

  /** A task lost the value it was built on: it has to recompute before it is read again. */
  function invalidate(node: { ref: { readonly id: string } }) {
    const t = tasksMap.get(node.ref.id);
    if (!t) return;
    if (t.state !== "running") t.state = "idle";
    dirtyTasks.add(t.ref.id);
  }

  const teardown = createTeardown({
    options: options?.teardown,
    emit,
    shouldEmit: hasListeners,
    nowMs,
    oldestPin,
    dependentsOf,
    invalidate,
  });
  let idleWaiters: VoidFunction[] = [];
  let epoch = 0;

  function runFinished(run: ActiveRun) {
    activeRuns.delete(run);
    // Every run that ends can unpin something, not only the last one.
    teardown.pump();
    if (activeRuns.size === 0 && idleWaiters.length) {
      const waiters = idleWaiters;
      idleWaiters = [];
      for (const resolve of waiters) resolve();
    }
  }

  async function settled(): Promise<void> {
    do {
      if (activeRuns.size > 0) await new Promise<void>((resolve) => idleWaiters.push(resolve));
      await teardown.settled();
    } while (activeRuns.size > 0);
  }

  /** Mark all downstream tasks dirty starting from `nodeId`. */
  function propagateDirty(nodeId: string) {
    const stack = [...(d.getAdjacenciesId(nodeId) ?? [])];
    while (stack.length) {
      const id = stack.pop()!;
      const taskNode = tasksMap.get(id);
      if (taskNode) {
        const cache = taskNode.ref[TASK_DEF].options.cache;
        if (cache === "once" && taskNode.state === "ready") continue;
      }
      if (dirtyTasks.has(id)) continue;
      dirtyTasks.add(id);
      const next = d.getAdjacenciesId(id);
      if (next) for (const depId of next) stack.push(depId);
    }
  }

  function ensureParamRegistered(param: ParamRef<any>) {
    const existing = paramsMap.get(param.id);
    if (existing) return existing;

    const node: ParamNodeRuntime = { ref: param, version: 0 };
    node.unsubscribe = param.subscribe(() => {
      node.version += 1;
      propagateDirty(param.id);
    });
    paramsMap.set(param.id, node);
    d.addNode(param);
    markStructureChanged();
    return node;
  }

  function currentVersion(nodeId: string): number {
    const t = tasksMap.get(nodeId);
    if (t) return t.version;
    const p = paramsMap.get(nodeId);
    if (p) return p.version;
    throw new UnknownNodeError(nodeId);
  }

  function isTaskDirty(task: TaskNodeRuntime<L, Res>): boolean {
    const cache: CacheStrategy | undefined = task.ref[TASK_DEF].options.cache;
    // no cache requested, mark as dirty
    if (cache === "none") return true;
    if (cache === "once") return task.state !== "ready";
    if (task.state !== "ready") return true;
    if (dirtyTasks.has(task.ref.id)) return true;

    // Direct dep version compare (no recursion).
    const deps = d.getIncomingIds(task.ref.id);
    if (!deps) return false;
    for (const depId of deps) {
      // If we depend on a cache:none task, we must re-run because the upstream value is not stable across runs.
      const upstreamTask = tasksMap.get(depId);
      if (upstreamTask && upstreamTask.ref[TASK_DEF].options.cache === "none") return true;

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

  function ensureTaskRegistered<T>(task: Task<T, L, Res>): TaskRef<T> {
    if (tasksMap.has(task.id)) return task;

    const node: TaskNodeRuntime<L, Res> = {
      ref: task as Task<T, L, Res>,
      state: "idle",
      version: 0,
      depsKnown: false,
      deps: new Set(),
      lastDepVersions: new Map(),
      value: undefined,
      error: undefined,
      live: false,
      gen: undefined,
      reads: undefined,
    };

    tasksMap.set(task.id, node);
    allTaskRefNodes.push(task);
    d.addNode(task);
    markStructureChanged();
    return task;
  }

  let api: Graph<L, Res>;

  function addTask<T>(task: Task<T, L, Res>): Graph<L, Res> {
    ensureTaskRegistered(task);
    return api;
  }

  function setParam<T>(paramRef: ParamRef<T>, valueOrCb: ParamSetInput<T>): Graph<L, Res> {
    let node = paramsMap.get(paramRef.id);

    if (!node) {
      // Auto-register with graph-local ownership (no external subscription).
      const initial = paramRef.get();
      node = { ref: paramRef, version: 0, bound: { value: initial, initial } };
      paramsMap.set(paramRef.id, node);
      d.addNode(paramRef);
      markStructureChanged();
    }

    if (!node.bound) {
      // Previously auto-registered by a task's get() with external subscription.
      // Detach and switch to graph-local ownership.
      node.unsubscribe?.();
      node.unsubscribe = undefined;
      const initial = paramRef.get();
      node.bound = { value: initial, initial };
    }

    // Apply the update.
    node.bound.value =
      typeof valueOrCb === "function"
        ? (valueOrCb as ParamSetCallback<T>)(node.bound.value)
        : valueOrCb;
    node.version += 1;
    propagateDirty(paramRef.id);

    if (hasListeners("param:set")) {
      emit({ type: "param:set", paramId: paramRef.id, at: nowMs() });
    }

    return api;
  }

  function resetBoundParam(node: ParamNodeRuntime) {
    if (!node.bound) return;
    node.bound.value = node.bound.initial;
    node.version += 1;
    propagateDirty(node.ref.id);
    if (hasListeners("param:set")) {
      emit({ type: "param:set", paramId: node.ref.id, at: nowMs() });
    }
  }

  function resetParam<T>(paramRef?: ParamRef<T>): Graph<L, Res> {
    if (paramRef) {
      const node = paramsMap.get(paramRef.id);
      if (!node) throw new UnknownNodeError(paramRef.id);
      resetBoundParam(node);
      return api;
    }

    for (const node of paramsMap.values()) resetBoundParam(node);
    return api;
  }

  const state: GraphState<L, Res> = {
    tasksMap,
    paramsMap,
    allTaskRefNodes,
    dirtyTasks,
    emit,
    shouldEmit: hasListeners,
    markStructureChanged,
    compileTopologyIfNeeded,
    getTopoOrder: () => topoOrder,
    dagAddEdgeId: (fromId, toId) => d.addEdgeId(fromId, toId),
    dagRemoveEdgeId: (fromId, toId) => d.removeEdgeId(fromId, toId),
    dagGetAdjacenciesIds: (id) => d.getAdjacenciesId(id),
    dagGetIncomingIds: (id) => d.getIncomingIds(id),
    ensureParamRegistered,
    ensureTaskRegistered,
    currentVersion,
    isTaskDirty,
    teardown,
    epoch: () => epoch,
    runStarted: (run) => {
      run.pin = teardown.mark();
      activeRuns.add(run);
    },
    runFinished,
  };

  const runImpl = createRun({
    semaphore,
    nowMs,
    createRunId,
    isParam,
    isTask,
    CancelledError,
    CyclicalGraphError,
    MissingTaskValueError,
    NoComputedValueError,
    UnknownNodeError,
    UnknownTaskError,
  });

  async function run(options?: RunOptions<L, Res>): Promise<RunReport> {
    return runImpl(state as any, options);
  }

  function dispose(): Promise<void> {
    // Runs still in flight belong to the old epoch: whatever they produce is torn down.
    epoch += 1;
    for (const run of activeRuns) run.controller.abort(new CancelledError());
    for (const lease of leases) lease.abort(new CancelledError());
    teardown.disposeAll(tasksMap.values());
    teardown.pump();

    for (const p of paramsMap.values()) {
      try {
        p.unsubscribe?.();
      } catch {
        // ignore
      }
    }
    paramsMap.clear();
    tasksMap.clear();
    dirtyTasks.clear();
    allTaskRefNodes.length = 0;
    topoOrder.length = 0;
    d = dag<ParamRef<any> | TaskRef<any>>();
    structureVersion += 1;
    compiledVersion = -1;
    compileCount = 0;
    depthVersion = -2;
    return disposed();
  }

  /** Every teardown runs to the end before the failures are reported, all of them at once. */
  async function disposed(): Promise<void> {
    await settled();
    await teardown.drained();
    const errors = teardown.takeDisposeErrors();
    if (errors.length > 0)
      throw new AggregateError(
        errors,
        errors.length + " teardown(s) failed while the graph was disposed",
      );
  }

  /**
   * A lease: the value, and everything it was built on, stays alive until `fn` settles, even
   * if the task is recomputed in the meantime.
   */
  async function use<T, R>(
    taskRef: TaskRef<T>,
    fn: (value: T, signal: AbortSignal) => R | PromiseLike<R>,
  ): Promise<R> {
    const node = tasksMap.get(taskRef.id);
    if (!node) throw new UnknownNodeError(taskRef.id);
    if (node.state !== "ready") throw new NoComputedValueError(taskRef.id);
    const controller = new AbortController();
    const held = teardown.hold(node);
    leases.add(controller);
    try {
      return await fn(node.value as T, controller.signal);
    } finally {
      leases.delete(controller);
      if (held) teardown.release(held);
    }
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
        dirty: options?.includeRuntime ? isTaskDirty(t) : undefined,
        version: options?.includeRuntime ? t.version : undefined,
        live: options?.includeRuntime ? t.live : undefined,
      });

      for (const depId of d.getIncomingIds(t.ref.id) ?? []) {
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
            teardown: teardown.counts(),
          }
        : undefined,
    };
  }

  // expose methods
  api = {
    on,
    run,
    dispose,
    [Symbol.asyncDispose]: dispose,
    settled,
    use,
    inspect,
    get: getTaskValue,
    peek: peekTaskValue,
    add: addTask,
    set: setParam,
    reset: resetParam,
  };
  return api;
}
