import type { TaskRef } from "../tasks/task.types";
import type { Lane } from "../types";

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
