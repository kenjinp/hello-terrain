import type { ParamRef } from "./param/param.types";
import type { TaskRef } from "./tasks/task.types";
import type { Lane, NodeRef } from "./types";

/**
 * Returns the current time in milliseconds using the high-resolution timer.
 * @returns {number} The current time in milliseconds.
 */
export function nowMs(): number {
  return performance.now();
}

/**
 * Generates a unique run ID string, combining a UUID and the current timestamp.
 * @returns {string} The generated run ID.
 */
export function createRunId(): string {
  const uuid = crypto.randomUUID();
  return `run_${uuid}_${Date.now().toString(16)}`;
}

/**
 * Generates a unique Node ID string
 * @returns {string} The generated node ID.
 */
export function createNodeId(): string {
  return crypto.randomUUID();
}

/**
 * Type guard to check if a NodeRef is a parameter reference.
 * @param ref - The NodeRef instance to check.
 * @returns {ref is Param<any>} True if the ref is a Param.
 */
export function isParam(ref: NodeRef<any>): ref is ParamRef<any> {
  return ref.kind === "param";
}

/**
 * Type guard to check if a NodeRef is a task reference.
 * @param ref - The NodeRef instance to check.
 * @returns {ref is TaskRef<any>} True if the ref is a TaskRef.
 */
export function isTask(ref: NodeRef<any>): ref is TaskRef<any> {
  return ref.kind === "task";
}

/**
 * Type guard to check if a NodeRef is a task reference.
 * @param ref - The NodeRef instance to check.
 * @returns {ref is TaskRef<any>} True if the ref is a TaskRef.
 */
export function isTaskRef(ref: NodeRef<any>): ref is TaskRef<any> {
  return ref.kind === "task";
}

/**
 * Coerces a value to a Lane type if it is a string, falling back to the given fallback lane otherwise.
 * @param lane - The candidate lane value.
 * @param fallback - The fallback lane value if `lane` is not a string.
 * @returns {L} The resolved lane.
 */
export function asLane<L extends Lane>(lane: unknown, fallback: L): L {
  return (typeof lane === "string" ? lane : fallback) as L;
}

/**
 * Determines whether a given error-like value is an "AbortError".
 * @param error - The error to inspect.
 * @returns {boolean} True if the error has a "name" property equal to "AbortError".
 */
export function isAbortLike(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}
