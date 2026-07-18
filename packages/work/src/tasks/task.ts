import { CacheStrategy, Lane } from "../types";
import { createNodeId } from "../utils";
import type { Task, TaskCompute, TaskOptions } from "./task.types";
import { TASK_DEF } from "./task.types";

/**
 * Creates a task node.
 *
 * @param compute - The function that computes the task output. Receives:
 *   - `get`: A function to retrieve the values of dependent nodes (params or other tasks).
 *   - `work`: A function to run code in an isolated work unit (helps the runtime distinguish pure computations).
 *   - `ctx`: The task context containing lane info, abort signal, etc.
 * @param initialOptions - (Optional) Task configuration such as lane, cache strategy, and tags.
 *
 * @returns A TaskRef that represents this task node and can be configured via fluent methods and registered to a work graph.
 *
 * @example
 * ```ts
 * const a = task((get) => 1).displayName("a");
 * const b = task((get) => get(a) + 2).displayName("b").cache("none");
 * ```
 *
 * The returned object is a `TaskRef<Out>` for user code, but it also carries an internal
 * definition under a private symbol so `graph.add(task)` can register and execute it.
 */
export function task<
  Res = unknown,
  L extends Lane = Lane,
  Compute extends TaskCompute<any, L, Res> = TaskCompute<any, L, Res>,
>(
  /**
   * The compute function for the task.
   */
  compute: Compute,
  /**
   * Task options such as lane, cache strategy, and tags (optional).
   */
  initialOptions?: TaskOptions<L>,
): Task<Awaited<ReturnType<Compute>>, L, Res> {
  type Out = Awaited<ReturnType<Compute>>;
  const id = createNodeId();
  let name: string | undefined = undefined;

  // Mutated by the fluent configuration methods; read by the graph when registered/executed.
  const options: TaskOptions<L> = { ...initialOptions };

  /**
   * The TaskRef object for this task node.
   */
  const ref: Task<Out, L, Res> = {
    kind: "task",
    id,
    /** Optional human-friendly name. */
    get name() {
      return name;
    },

    /**
     * Sets a human-friendly name for this task.
     * @param nextName - The display name for the task.
     * @returns The same task ref (fluent API).
     */
    displayName(nextName: string) {
      name = nextName;
      return ref;
    },

    /**
     * Specifies the lane for this task. This helps organize or schedule tasks in logical groups.
     * @param lane - The lane name.
     * @returns The same task ref (fluent API).
     */
    lane(lane: L) {
      options.lane = lane;
      return ref;
    },

    /**
     * Specifies the cache strategy for this task (`memo`, `none`, or `once`).
     * @param cache - The cache strategy.
     * @returns The same task ref (fluent API).
     */
    cache(cache: CacheStrategy) {
      options.cache = cache;
      return ref;
    },

    /**
     * Specifies tags for this task.
     * @param tags - Tags to associate with this task.
     * @returns The same task ref (fluent API).
     */
    tags(tags: readonly string[]) {
      options.tags = tags;
      return ref;
    },

    /**
     * Registers a disposer invoked with the cached value on graph disposal.
     * @param dispose - Cleanup callback receiving the cached value.
     * @returns The same task ref (fluent API).
     */
    disposer(dispose: (value: Out) => void) {
      options.disposer = dispose as (value: unknown) => void;
      return ref;
    },

    /**
     * Internal task definition for graph registration & execution.
     * @internal
     */
    [TASK_DEF]: {
      compute,
      options,
    },
  };

  return ref;
}
