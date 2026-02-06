import type { RunStatus } from "../graph/graph.types";
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
  | { type: "task:start"; runId: string; taskId: string; at: number; lane: Lane }
  | { type: "task:finish"; runId: string; taskId: string; at: number; durationMs: number }
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
