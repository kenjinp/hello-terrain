import type { ParamRef } from "./param/param.types";
import type { TaskRef } from "./tasks/task.types";

/**
 * The type of a "lane" that a task may be grouped or scheduled under.
 * Used for logical partitioning, isolation, or concurrency grouping.
 * Typically a string or a string union.
 */
export type Lane = string;

/**
 * The strategy for caching task results.
 * - "memo": Cache the result using memoization.
 * - "none": Do not cache; always recompute.
 * - "once": Run the first time, never recompute.
 */
export type CacheStrategy = "memo" | "none" | "once";

/**
 * A type representing a reference to a node in the computation graph.
 * This can be either a parameter reference or a task reference.
 *
 * @template T - The type of the value produced by the referenced node.
 */
export type NodeRef<T> = ParamRef<T> | TaskRef<T>;
