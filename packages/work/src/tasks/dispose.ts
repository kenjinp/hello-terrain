/** The value's `Symbol.asyncDispose` method, or failing that its `Symbol.dispose` method. */
function disposerOf(value: unknown): ((this: unknown) => unknown) | undefined {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) {
    return undefined;
  }
  const v = value as Record<symbol, unknown>;
  const fn = v[Symbol.asyncDispose] ?? v[Symbol.dispose];
  return typeof fn === "function" ? (fn as (this: unknown) => unknown) : undefined;
}

/** Whether `value` implements the disposable protocol. */
export function isDisposable(value: unknown): value is Disposable | AsyncDisposable {
  return disposerOf(value) !== undefined;
}

/**
 * Calls `value[Symbol.asyncDispose]()`, or failing that `value[Symbol.dispose]()`. `null` and
 * `undefined` are skipped, as with `using`.
 *
 * Made to be passed to `.teardown()` for values that implement the disposable protocol.
 *
 * @example
 * ```ts
 * const connection = task((get, work) => {
 *   const url = get(databaseUrl);
 *   return work(() => connect(url));
 * }).teardown(dispose);
 * ```
 */
export function dispose(
  value: Disposable | AsyncDisposable | null | undefined,
): void | PromiseLike<void> {
  if (value === null || value === undefined) return;
  const fn = disposerOf(value);
  if (fn === undefined) {
    throw new TypeError("dispose(value): the value has no Symbol.dispose or Symbol.asyncDispose");
  }
  return fn.call(value) as void | PromiseLike<void>;
}
