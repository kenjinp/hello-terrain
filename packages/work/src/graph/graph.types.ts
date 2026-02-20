import type { ParamRef, ParamSetInput } from "../param/param.types";
import type { Task, TaskRef, TaskState } from "../tasks/task.types";
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
  | { type: "param:set"; paramId: string; at: number };

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
  dispose(): void;
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
