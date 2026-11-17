import { task } from "./tasks/task";
import type {
  Getter,
  Task,
  TaskCompute,
  TaskContext,
  TaskOptions,
  TeardownInfo,
} from "./tasks/task.types";
import type { Lane } from "./types";

/**
 * A value with a lifecycle: created from inputs, optionally updated in place when the inputs
 * change, and torn down when it is replaced or the graph is disposed.
 *
 * @template T - The value.
 * @template In - What `inputs` reads from the graph.
 */
export interface ManagedSpec<T, In, L extends Lane = Lane, Res = unknown> {
  /** Reads the dependencies. Runs first on every execution, so it also validates them. */
  inputs(get: Getter): In;
  /**
   * Called instead of `create` when a value already exists. Return `true` after bringing
   * `current` up to date with `next` to keep it; anything else replaces it. `prev` is the
   * inputs `current` was created or last updated with.
   */
  update?(current: T, next: In, prev: In): boolean | void | PromiseLike<boolean | void>;
  /** Creates the value. Only `create` gets `ctx.scope`, so updates cannot pile up cleanups. */
  create(inputs: In, ctx: TaskContext<L, Res>): T | PromiseLike<T>;
  /** Tears a value down. Same contract as `task().teardown(fn)`. */
  teardown(value: T, info: TeardownInfo): void | PromiseLike<void>;
  /**
   * The value cannot exist twice (a port, a lock): the previous one is torn down, and that is
   * awaited, before `create` runs. Off by default: the new value is created first and the old
   * one is torn down afterwards, without blocking.
   */
  exclusive?: boolean;
}

function isObject(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function isThenable<V>(value: unknown): value is PromiseLike<V> {
  return isObject(value) && typeof (value as { then?: unknown }).then === "function";
}

/**
 * A task for a value that is created, updated in place and torn down.
 *
 * Order inside one execution: `inputs` → `update` (returns `true`: keep the value, stop) →
 * `ctx.teardownPrevious()` if `exclusive` → `create`.
 *
 * Write `create` before `update` in the spec: TypeScript infers the value type from `create`,
 * and only for the properties that come after it.
 *
 * @example
 * ```ts
 * const server = managed({
 *   inputs: (get) => ({ port: get(port), routes: get(routes) }),
 *   create: ({ port, routes }) => listen(port, routes),
 *   update: (current, next, prev) =>
 *     next.port === prev.port && (current.setRoutes(next.routes), true),
 *   teardown: (server) => server.close(),
 *   exclusive: true,
 * });
 * ```
 */
export function managed<T, In, Res = unknown, L extends Lane = Lane>(
  spec: ManagedSpec<T, In, L, Res>,
  options?: TaskOptions<L>,
): Task<T, L, Res> {
  // The inputs each value was created or last updated with. Keyed by the value, not kept in
  // one variable, because the same task can be added to more than one graph.
  const inputsOf = new WeakMap<object, In>();

  const remember = (value: T, inputs: In): T => {
    if (isObject(value)) inputsOf.set(value, inputs);
    return value;
  };

  const compute: TaskCompute<T, L, Res> = (get, work, ctx) => {
    const next = spec.inputs(get);

    const create = (): T | Promise<T> => {
      const created = spec.create(next, ctx);
      if (isThenable<T>(created)) return Promise.resolve(created).then((v) => remember(v, next));
      return remember(created, next);
    };
    const recreate = (): T | Promise<T> =>
      spec.exclusive ? ctx.teardownPrevious().then(create) : create();

    return work<T | Promise<T>>((previous) => {
      const prev = previous as T | undefined;
      // A value this helper did not create (or a primitive) has no known inputs to compare to.
      if (spec.update === undefined || !isObject(prev) || !inputsOf.has(prev)) return recreate();
      const kept = spec.update(prev, next, inputsOf.get(prev) as In);
      if (isThenable<boolean | void>(kept)) {
        return Promise.resolve(kept).then((k) => (k === true ? remember(prev, next) : recreate()));
      }
      return kept === true ? remember(prev, next) : recreate();
    });
  };

  return task<Res, L, TaskCompute<T, L, Res>>(compute, {
    ...options,
    teardown: spec.teardown,
  }) as unknown as Task<T, L, Res>;
}
