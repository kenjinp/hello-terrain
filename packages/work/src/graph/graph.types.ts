import type { ParamRef, ParamSetInput } from "../param/param.types";
import type { ScopeTeardownReason, Task, TaskRef, TaskState } from "../tasks/task.types";
import type { CacheStrategy, Lane } from "../types";

/**
 * Callback type for handling graph events.
 *
 * @param e - The GraphEvent object representing the event that occurred.
 */
export type GraphEventCallback = (e: GraphEvent) => void;

/**
 * A function that unsubscribes a listener or watcher when called.
 */
export type Unsubscribe = () => void;

/**
 * The possible statuses resulting from running the graph.
 *  - "ok": Run completed successfully.
 *  - "error": The run terminated due to an error in one or more tasks.
 *  - "cancelled": The run was cancelled (e.g. by an abort signal).
 */
export type RunStatus = "ok" | "error" | "cancelled";

/**
 * Event union describing different occurrences during the execution of a graph.
 *
 * - "run:start": A run begins.
 * - "run:finish": A run completes.
 * - "task:cacheHit": A task yields its cached value.
 * - "task:start": A task begins execution.
 * - "task:finish": A task completes successfully.
 * - "task:error": A task throws or rejects with an error.
 * - "param:set": A param value was set via `graph.set()`.
 * - "teardown:finish": A teardown function finished: a task's `.teardown(fn)` or a `ctx.scope` entry.
 * - "teardown:error": A teardown function threw, rejected or timed out. The others still run.
 */
export type GraphEvent =
  | { type: "run:start"; runId: string; at: number }
  | { type: "run:finish"; runId: string; at: number; status: RunStatus }
  | { type: "task:cacheHit"; runId: string; taskId: string; at: number }
  | {
      type: "task:start";
      runId: string;
      taskId: string;
      at: number;
      lane: Lane;
    }
  | {
      type: "task:finish";
      runId: string;
      taskId: string;
      at: number;
      durationMs: number;
    }
  | {
      type: "task:error";
      runId: string;
      taskId: string;
      at: number;
      durationMs: number;
      error: unknown;
    }
  | { type: "param:set"; paramId: string; at: number }
  | {
      type: "teardown:finish";
      taskId: string;
      at: number;
      durationMs: number;
      reason: ScopeTeardownReason;
    }
  | {
      type: "teardown:error";
      taskId: string;
      at: number;
      reason: ScopeTeardownReason;
      error: unknown;
    };

export type GraphEventType = GraphEvent["type"];

export type GraphEventPrefix = GraphEventType extends `${infer P}:${string}`
  ? P
  : never;

/** Wildcard subscription like `"task:*"` */
export type GraphEventPattern = `${GraphEventPrefix}:*`;

/** Exact event type or wildcard subscription like `"task:*"` */
export type GraphEventSelector = GraphEventType | GraphEventPattern;

export type GraphEventOfType<T extends GraphEventType> = Extract<
  GraphEvent,
  { type: T }
>;

export type GraphEventOfSelector<S extends GraphEventSelector> =
  S extends GraphEventType
    ? GraphEventOfType<S>
    : S extends `${infer P}:*`
      ? Extract<GraphEvent, { type: `${P}:${string}` }>
      : GraphEvent;

/**
 * Report summarizing the outcome of a graph run.
 */
export interface RunReport {
  /** Unique identifier for this run instance. */
  runId: string;
  /** Final status of the run ("ok", "error", or "cancelled"). */
  status: RunStatus;
  /** High-precision timestamp when the run started. */
  startedAt: number;
  /** High-precision timestamp when the run finished. */
  finishedAt: number;
  /** Total duration in milliseconds for the run. */
  durationMs: number;
  /** Number of tasks executed (not including cache hits). */
  taskCount: number;
  /** Number of tasks that were served from cache. */
  cacheHits: number;
}

export type RunOptions<L extends string, Res> = {
  targets?: readonly TaskRef<any>[];
  laneConcurrency?: Partial<Record<L, number>>;
  signal?: AbortSignal;
} & (unknown extends Res ? { resources?: Res } : { resources: Res });

/** How a graph tears down the values its tasks retire. */
export interface GraphTeardownOptions {
  /**
   * Decides when a batch of ready teardowns starts: call `flush` when it should. The default
   * is a microtask. Use it to move teardown off the critical path (idle callback, next frame)
   * or to wait for something outside the graph that still uses the retired values.
   */
  schedule?: (flush: () => void) => void;
  /**
   * How long one async teardown function may take before the graph gives up on it: its
   * `signal` is aborted, a `TeardownTimeoutError` is reported and whatever waited behind it
   * proceeds. Default 30 000. `Infinity` waits forever.
   */
  timeoutMs?: number;
}

export interface GraphOptions {
  teardown?: GraphTeardownOptions;
}

export interface Graph<L extends Lane = Lane, Res = unknown> {
  on(cb: GraphEventCallback): Unsubscribe;
  on<S extends GraphEventSelector>(
    selector: S,
    cb: (e: GraphEventOfSelector<S>) => void,
  ): Unsubscribe;
  run(
    ...args: unknown extends Res
      ? [options?: RunOptions<L, Res>]
      : [options: RunOptions<L, Res>]
  ): Promise<RunReport>;
  /**
   * Tears down every live value, dependents before their dependencies, and clears the graph.
   * In-flight runs and leases are aborted first. Resolves when all teardowns have finished;
   * rejects with an `AggregateError` afterwards if any of them failed. The graph is empty
   * afterwards and can be used again.
   */
  dispose(): Promise<void>;
  /** Same as `dispose()`, so that `await using g = graph()` works. */
  [Symbol.asyncDispose](): Promise<void>;
  /**
   * Resolves once no run is active and every teardown that could start has finished. Never
   * rejects: failures go to `teardown:error`. Values still held by a lease or a dependent are
   * not waited for.
   */
  settled(): Promise<void>;
  /**
   * Leases a task's value: it, and everything it was built on, is not torn down until `fn`
   * settles, even if the task is recomputed meanwhile. `signal` aborts when the graph is
   * disposed. `ctx.teardownPrevious()` does not wait for leases.
   */
  use<T, R>(
    taskRef: TaskRef<T>,
    fn: (value: T, signal: AbortSignal) => R | PromiseLike<R>,
  ): Promise<R>;
  inspect(options?: InspectOptions): InspectResult;
  get<T>(taskRef: TaskRef<T>): T;
  peek<T>(taskRef: TaskRef<T>): T | undefined;
  add<T>(task: Task<T, L, Res>): Graph<L, Res>;
  /**
   * Takes graph-local ownership of a param's value. After calling `set()`,
   * the graph stores its own copy of the value and detaches from the
   * external `param.subscribe()` flow. This enables multiple graphs to
   * share the same module-scope `param()` token with isolated runtime values.
   */
  set<T>(param: ParamRef<T>, valueOrCb: ParamSetInput<T>): Graph<L, Res>;
  /** Resets graph-owned params to the value captured when ownership was taken. */
  reset(): Graph<L, Res>;
  /** Resets one graph-owned param; throws if the param is unknown to this graph. */
  reset<T>(param: ParamRef<T>): Graph<L, Res>;
}

export type InspectNode =
  | {
      id: string;
      kind: "param";
      name?: string;
      version?: number;
    }
  | {
      id: string;
      kind: "task";
      name?: string;
      lane?: Lane;
      cache?: CacheStrategy;
      tags?: readonly string[];
      state?: TaskState;
      dirty?: boolean;
      version?: number;
      /** True while the task holds a value that has not been torn down. */
      live?: boolean;
    };

export type InspectEdge = {
  from: string;
  to: string;
  kind: "task" | "param";
};

export type InspectMeta = {
  structureVersion: number;
  compiledVersion: number;
  compileCount: number;
  topoOrder?: readonly string[];
  /**
   * Teardown counters, in teardown functions (a task's `.teardown(fn)` or one `ctx.scope` entry).
   * - `pending`: of retired values, not finished yet.
   * - `held`: the part of `pending` that has not started, because a run, a lease or a value
   *   built on it still holds the retired value. A number that only grows is a leak.
   * - `completed` / `failed`: totals since the graph was created.
   */
  teardown?: { pending: number; held: number; completed: number; failed: number };
};

export type InspectOptions = {
  /** Include runtime state (dirty/state/version) and meta fields. */
  includeRuntime?: boolean;
};

export type InspectResult = {
  nodes: InspectNode[];
  edges: InspectEdge[];
  meta?: InspectMeta;
};
