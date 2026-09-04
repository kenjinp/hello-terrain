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

function isPlainObject(value: unknown): value is Record<PropertyKey, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Copies a param's default value so a graph-local binding never aliases the
 * module-scope object shared by every graph.
 *
 * Only *plain* data is copied: arrays (`Array.prototype`) and plain objects
 * (`Object.prototype` / `null` prototype) are deep-copied. Everything else —
 * functions, class instances, typed arrays, `Map`/`Set`, TSL nodes, etc. — is
 * returned by reference, since copying those would break identity or be
 * impossible to do generically.
 * @param value - The param default to copy.
 * @returns {T} A structurally equal value with fresh plain containers.
 */
export function cloneParamInitial<T>(value: T, seen?: WeakMap<object, unknown>): T {
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) return value;
    const visited = seen ?? new WeakMap<object, unknown>();
    const cached = visited.get(value);
    if (cached) return cached as T;
    const out: unknown[] = [];
    visited.set(value, out);
    for (const item of value) out.push(cloneParamInitial(item, visited));
    return out as T;
  }
  if (!isPlainObject(value)) return value;

  const visited = seen ?? new WeakMap<object, unknown>();
  const cached = visited.get(value);
  if (cached) return cached as T;

  const out: Record<PropertyKey, unknown> =
    Object.getPrototypeOf(value) === null ? Object.create(null) : {};
  // Register before recursing so self-referencing defaults terminate.
  visited.set(value, out);
  for (const key of Reflect.ownKeys(value)) {
    const desc = Object.getOwnPropertyDescriptor(value, key);
    if (!desc?.enumerable) continue;
    out[key] = cloneParamInitial(value[key], visited);
  }
  return out as T;
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
