export type Unsubscribe = () => void;

export type ParamSetCallback<T> = (prev: T) => T;
export type ParamSetInput<T> = T | ParamSetCallback<T>;
export type ParamSubscribeCallback<T> = (next: T, prev: T) => void;

/**
 * Equality comparator used to decide whether a new value is a meaningful change.
 * When it returns `true`, the value is treated as unchanged: subscribers are not
 * notified and (inside a graph) downstream tasks are not invalidated.
 */
export type ParamEquals<T> = (a: T, b: T) => boolean;

export interface ParamOptions<T> {
  /**
   * Custom change-detection. When omitted, every `set()` is treated as a change
   * (matching the historical behavior). Provide an `equals` to gate updates, e.g.
   * to apply hysteresis so per-frame pushes that don't meaningfully change the
   * value stay cheap (no version bump, no downstream invalidation).
   */
  equals?: ParamEquals<T>;
}

export interface ParamRef<T> {
  readonly kind: "param";
  readonly id: string;
  readonly name?: string;
  /** Change-detection comparator, if one was provided at creation time. */
  readonly equals?: ParamEquals<T>;
  get(): T;
  set(valueOrCb: ParamSetInput<T>): ParamRef<T>;
  reset(): ParamRef<T>;
  subscribe(cb: ParamSubscribeCallback<T>): Unsubscribe;
  displayName(name: string): ParamRef<T>;
}
