import { dag } from "../dag/dag";
import { events } from "../events/events";
import type { ParamRef, ParamSetCallback, Unsubscribe } from "../param/param.types";
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
import type { Graph, InspectOptions, InspectResult, RunOptions, RunReport } from "./graph.types";
import { createRun } from "./run";

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
};

type ParamNodeRuntime = {
  ref: ParamRef<any>;
  version: number;
  unsubscribe?: Unsubscribe;
  /** When present, the graph owns the param value locally (set via `graph.set()`). */
  bound?: { value: any };
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
};

export function graph<L extends Lane = Lane, Res = unknown>(): Graph<L, Res> {
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

  function setParam<T>(paramRef: ParamRef<T>, cb: ParamSetCallback<T>): Graph<L, Res> {
    let node = paramsMap.get(paramRef.id);

    if (!node) {
      // Auto-register with graph-local ownership (no external subscription).
      node = { ref: paramRef, version: 0, bound: { value: paramRef.get() } };
      paramsMap.set(paramRef.id, node);
      d.addNode(paramRef);
      markStructureChanged();
    }

    if (!node.bound) {
      // Previously auto-registered by a task's get() with external subscription.
      // Detach and switch to graph-local ownership.
      node.unsubscribe?.();
      node.unsubscribe = undefined;
      node.bound = { value: paramRef.get() };
    }

    // Apply the update.
    node.bound.value = cb(node.bound.value);
    node.version += 1;
    propagateDirty(paramRef.id);

    if (hasListeners("param:set")) {
      emit({ type: "param:set", paramId: paramRef.id, at: nowMs() });
    }

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

  function dispose() {
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
          }
        : undefined,
    };
  }

  // expose methods
  api = {
    on,
    run,
    dispose,
    inspect,
    get: getTaskValue,
    peek: peekTaskValue,
    add: addTask,
    set: setParam,
  };
  return api;
}
