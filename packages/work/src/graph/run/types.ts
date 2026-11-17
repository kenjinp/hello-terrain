import type { ParamRef } from "../../param/param.types";
import type { Task, TaskRef, TaskState } from "../../tasks/task.types";
import type { Lane } from "../../types";
import type { GraphEventType, RunOptions, RunReport, RunStatus } from "../graph.types";
import type { Generation, ScopeEntry, Teardown } from "../teardown";

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
  /** True while `value` is a value that still has to be torn down. */
  live: boolean;
  /** The generation of `value`, when it has a teardown or scope entries. */
  gen?: Generation;
  /** The generations `value` was built on, when it has no generation of its own. */
  reads?: Generation[];
  /** `dispose()` already queued `value` for teardown. */
  disposed?: boolean;
};

export type ParamNodeRuntime = {
  ref: ParamRef<any>;
  version: number;
  /** When present, the graph owns the param value locally (set via `graph.set()`). */
  bound?: { value: any };
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

  /** Teardown of retired values. */
  readonly teardown: Teardown;
  /** Bumped by `dispose()`, so a run can tell its graph was disposed underneath it. */
  epoch(): number;
  runStarted(ctx: RunContext<L, Res>): void;
  runFinished(ctx: RunContext<L, Res>): void;
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

/** Scratch state of one execution of a task. */
export type Execution = {
  /** `work()` was called. `get()` is refused from here on. */
  workCalled: boolean;
  /** The generations the execution read through `get()`. It holds them. */
  reads: Generation[] | undefined;
  /** What the execution registered on `ctx.scope`. */
  entries: ScopeEntry[] | undefined;
  /** The execution ended. A ctx kept past that point must not reach the next value. */
  sealed: boolean;
  /** The result of `ctx.teardownPrevious()`, so calling it twice does the work once. */
  released: Promise<void> | undefined;
};

export type RunContext<L extends Lane, Res> = {
  readonly runId: string;
  readonly startedAt: number;
  /** The graph epoch this run started in. */
  readonly epoch: number;
  readonly controller: AbortController;
  /** Position in the retirement order when the run started. Later retirements wait for it. */
  pin: number;
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

  /** Removes the listener on the caller's abort signal. Called when the run ends. */
  detach?: VoidFunction;
};

/**
 * Provided by the scheduler. Called when `ctx.teardownPrevious()` in `taskId` took the values of
 * its dependents away: the ones the run has already served or skipped have to run again.
 *
 * Handed to each execution as an argument and not kept on the run context: a per-run closure
 * reachable from the context makes every run's scheduler state survive into old space.
 */
export type OnInvalidated = (taskId: string) => void;

export type RunFn = <L extends Lane, Res>(
  state: RunState<L, Res>,
  options?: RunOptions<L, Res>,
) => Promise<RunReport>;

