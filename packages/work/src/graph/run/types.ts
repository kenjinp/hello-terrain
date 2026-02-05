import type { ParamRef } from "../../param/param.types";
import type { Task, TaskRef, TaskState } from "../../tasks/task.types";
import type { Lane } from "../../types";
import type { GraphEventType, RunOptions, RunReport, RunStatus } from "../graph.types";

export type TaskNodeRuntime<L extends Lane, Res> = {
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

export type ParamNodeRuntime = {
  ref: ParamRef<any>;
  version: number;
};

export type RunState<L extends Lane, Res> = {
  readonly tasksMap: Map<string, TaskNodeRuntime<L, Res>>;
  readonly paramsMap: Map<string, ParamNodeRuntime>;
  readonly allTaskRefNodes: readonly TaskRef<any>[];

  /** Tasks marked dirty by upstream changes. */
  readonly dirtyTasks: Set<string>;

  /** Emit graph events. */
  emit(e: any): void;
  shouldEmit(type: GraphEventType): boolean;

  /** Topology hooks. */
  dagAddEdgeId(fromId: string, toId: string): void;
  dagRemoveEdgeId(fromId: string, toId: string): void;
  dagGetAdjacenciesIds(id: string): Set<string> | undefined;
  dagGetIncomingIds(id: string): Set<string> | undefined;
  compileTopologyIfNeeded(): void;
  getTopoOrder(): readonly string[];

  /** Runtime utilities. */
  ensureParamRegistered(param: ParamRef<any>): ParamNodeRuntime;
  ensureTaskRegistered<T>(task: Task<T, L, Res>): TaskRef<T>;
  currentVersion(nodeId: string): number;
  isTaskDirty(task: TaskNodeRuntime<L, Res>): boolean;
  markStructureChanged(): void;
};

export type RunDeps = {
  semaphore(permits: number): { acquire(): Promise<VoidFunction> };
  nowMs(): number;
  createRunId(): string;
  isParam(ref: any): ref is ParamRef<any>;
  isTask(ref: any): ref is TaskRef<any>;

  CancelledError: new () => Error;
  CyclicalGraphError: new (id: string) => Error;
  MissingTaskValueError: new (taskId: string) => Error & { taskId: string };
  NoComputedValueError: new (id: string) => Error;
  UnknownNodeError: new (id: string) => Error;
  UnknownTaskError: new (id: string) => Error;
};

export type RunContext<L extends Lane, Res> = {
  readonly runId: string;
  readonly startedAt: number;
  readonly controller: AbortController;
  readonly signal: AbortSignal;
  readonly options?: RunOptions<L, Res>;
  readonly nowMs: () => number;
  /**
   * Returns the semaphore for a lane if lane-based concurrency is enabled for this run.
   * If laneConcurrency is omitted/empty, this returns undefined and tasks will not be throttled.
   */
  readonly getSemaphore: (lane: L) => { acquire(): Promise<VoidFunction> } | undefined;

  status: RunStatus;
  taskCount: number;
  cacheHits: number;
};

export type RunFn = <L extends Lane, Res>(
  state: RunState<L, Res>,
  options?: RunOptions<L, Res>,
) => Promise<RunReport>;

