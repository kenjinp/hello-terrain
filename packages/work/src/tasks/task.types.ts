import type { ParamRef } from "../param/param.types";
import { CacheStrategy, Lane, NodeRef } from "../types";

/**
 * Represents the current state of a Task node within the graph.
 *
 * - "idle":    The task has not started or is waiting to be scheduled.
 * - "running": The task is currently being executed.
 * - "ready":   The task has completed execution and its result is up-to-date (cached if memoized).
 * - "error":   The task encountered an error during execution.
 */
export type TaskState = "idle" | "running" | "ready" | "error";

/**
 * Configuration options for a Task node.
 *
 * @template L - The lane type, usually a string or string union.
 */
export interface TaskOptions<L extends Lane = Lane> {
  /** The lane this task belongs to (used for scheduling, grouping, isolation, etc). */
  lane?: L;
  /** The cache strategy for this task ("memo", "none", or "once"). */
  cache?: CacheStrategy;
  /** Tags for this task (useful for filtering, debugging, etc). */
  tags?: readonly string[];
}

/**
 * Context provided to each task execution containing metadata and utilities.
 *
 * @template L - The lane type.
 * @template Resources - Optional additional resources injected at run time.
 */
export interface TaskContext<L extends Lane = Lane, Resources = unknown> {
  /** The lane this task is currently executing in. */
  readonly lane: L;
  /** The abort signal for cancellation support. */
  readonly signal: AbortSignal;
  /** Returns the current high-precision time in milliseconds. */
  now(): number;
  /** User-supplied resources for this execution, if any. */
  resources?: Resources;
}

/**
 * Reference to a Task node in the graph, with fluent API for configuration.
 *
 * @template _T - The resolved output type of the task.
 */
export interface TaskRef<_T> {
  /** Always "task". Used for type discrimination. */
  readonly kind: "task";
  /** Unique identifier of the task node. */
  readonly id: string;
  /** Optional human-friendly name for this task. */
  readonly name?: string;
  /** Phantom type marker for task output. Used for strong typing, never instantiated. */
  readonly _type?: _T;

  /**
   * Set a human-friendly display name for this task (useful for visualization/debugging).
   * @param name - The display name.
   * @returns The current task ref (for chaining).
   */
  displayName(name: string): this;

  /**
   * Set the lane for this task.
   * @param lane - The lane name or value.
   * @returns The current task ref (for chaining).
   */
  lane(lane: Lane): this;

  /**
   * Set the cache strategy for this task.
   * @param cache - The cache strategy ("memo", "none", or "once").
   * @returns The current task ref (for chaining).
   */
  cache(cache: CacheStrategy): this;

  /**
   * Set tags for this task.
   * @param tags - Tags to associate with this task.
   * @returns The current task ref (for chaining).
   */
  tags(tags: readonly string[]): this;
}

/**
 * Resolves the output type of a ParamRef or TaskRef.
 *
 * @template N - A ParamRef or TaskRef.
 */
export type ResolveNode<N> =
  N extends ParamRef<infer T> ? T : N extends TaskRef<infer T> ? T : never;

/**
 * Retrieves the value of a parameter or task node by reference.
 *
 * @template T - The output type of the referenced node.
 * @param ref - The node ref to get the value for.
 * @returns The value/output of the node.
 */
export type Getter = <T>(ref: NodeRef<T>) => T;

/**
 * Runs a function inside a logical "work" unit, used for isolation or purity distinctions.
 *
 * @template R - The value returned by the function.
 * @param fn - The function to execute in the work unit.
 * @returns The result of the function call.
 */
export type Work = <R>(fn: () => R) => R;

/**
 * The compute function type for a task that discovers dependencies dynamically.
 *
 * Dependencies are registered when calling `get(ref)`, letting the runtime build dependency graphs on the fly.
 *
 * @template Out - The resolved output of the compute function.
 * @template L - The lane type.
 * @template Res - The resources type.
 * @param get - Function to access the values of referenced nodes.
 * @param work - Function to execute code in a logical work unit.
 * @param ctx - The task context object.
 * @returns The computed result (value or Promise).
 */
export type TaskCompute<Out, L extends Lane = Lane, Res = unknown> = (
  get: Getter,
  work: Work,
  ctx: TaskContext<L, Res>,
) => Out | Promise<Out>;

/**
 * Internal definition for a task node, stored on the TaskRef.
 * Used by the graph for registration and execution.
 *
 * @template Out - Output type of the compute function.
 * @template L - Lane type.
 * @template Res - Resources type.
 */
export type TaskDef<Out, L extends Lane = Lane, Res = unknown> = {
  /** The actual compute implementation for the task node. */
  compute: TaskCompute<Out, L, Res>;
  /** Static options associated with this task node. */
  options: TaskOptions<L>;
};

/**
 * The symbol used as a private key to access a TaskRef's internal definition.
 * (Not intended for use by library consumers.)
 */
export const TASK_DEF: unique symbol = Symbol("TASK_DEF");

/**
 * The full object type for a Task node, including its reference interface
 * and the internal symbolic definition.
 *
 * @template Out - The output/resolved type for this task.
 * @template L - Lane type.
 * @template Res - Resources type.
 */
export type Task<Out, L extends Lane = Lane, Res = unknown> = TaskRef<Out> & {
  /** Internal task definition, not part of the public API. */
  readonly [TASK_DEF]: TaskDef<Out, L, Res>;
};
