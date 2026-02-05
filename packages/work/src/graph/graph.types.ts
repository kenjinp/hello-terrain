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
 */
export type GraphEvent =
  | { type: "run:start"; runId: string; at: number }
  | { type: "run:finish"; runId: string; at: number; status: RunStatus }
  | { type: "task:cacheHit"; runId: string; taskId: string; at: number }
  | { type: "task:start"; runId: string; taskId: string; at: number; lane: Lane }
  | { type: "task:finish"; runId: string; taskId: string; at: number; durationMs: number }
  | {
      type: "task:error";
      runId: string;
      taskId: string;
      at: number;
      durationMs: number;
      error: unknown;
    };

export type GraphEventType = GraphEvent["type"];

export type GraphEventPrefix = GraphEventType extends `${infer P}:${string}` ? P : never;

/** Wildcard subscription like `"task:*"` */
export type GraphEventPattern = `${GraphEventPrefix}:*`;

/** Exact event type or wildcard subscription like `"task:*"` */
export type GraphEventSelector = GraphEventType | GraphEventPattern;

export type GraphEventOfType<T extends GraphEventType> = Extract<GraphEvent, { type: T }>;

export type GraphEventOfSelector<S extends GraphEventSelector> = S extends GraphEventType
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

export interface RunOptions<L extends string, Res> {
  targets?: readonly TaskRef<any>[];
  laneConcurrency?: Partial<Record<L, number>>;
  signal?: AbortSignal;
  resources?: Res;
}

export interface Graph<L extends Lane = Lane, Res = unknown> {
  on(cb: GraphEventCallback): Unsubscribe;
  on<S extends GraphEventSelector>(
    selector: S,
    cb: (e: GraphEventOfSelector<S>) => void,
  ): Unsubscribe;
  run(options?: RunOptions<L, Res>): Promise<RunReport>;
  dispose(): void;
  inspect(options?: InspectOptions): InspectResult;
  get<T>(taskRef: TaskRef<T>): T;
  peek<T>(taskRef: TaskRef<T>): T | undefined;
  add<T>(task: Task<T, L, Res>): Graph<L, Res>;
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
