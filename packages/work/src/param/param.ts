import { createNodeId } from "../utils";
import type {
  ParamEquals,
  ParamOptions,
  ParamRef,
  ParamSetCallback,
  ParamSetInput,
  ParamSubscribeCallback,
} from "./param.types";

/**
 * Creates a new reactive parameter node.
 *
 * @template T The type of the parameter value.
 * @param initial - The initial value of the parameter.
 * @param options - Optional configuration, including a custom `equals` comparator.
 * @returns The parameter instance, providing getter, setter, and subscription APIs.
 *
 * @example
 * const foo = param(42);
 * console.log(foo.get()); // 42
 * foo.set(43);
 * foo.subscribe((next, prev) => console.log({ next, prev }));
 */
export function param<T>(initial: T, options?: ParamOptions<T>): ParamRef<T> {
  const initialValue = initial;
  let value = initial;
  let name: string | undefined = undefined;
  // Default to identity equality: re-setting an identical value must be a
  // no-op. Without this, every set() bumps subscribers/versions, which
  // cascades into full recreation of downstream resources (e.g. GPU buffers
  // and compiled pipelines) even when nothing actually changed.
  const equals: ParamEquals<T> = options?.equals ?? Object.is;
  const subscriptions = new Set<ParamSubscribeCallback<T>>();
  const id = createNodeId();

  const ref: ParamRef<T> = {
    kind: "param",
    id,
    get name() {
      return name;
    },
    get equals() {
      return equals;
    },

    /**
     * Returns the current value of the parameter.
     */
    get() {
      return value;
    },

    /**
     * Sets the parameter to a new value and notifies subscribers when the value
     * meaningfully changed (per `equals`, if provided).
     */
    set(valueOrCb: ParamSetInput<T>) {
      const prev = value;
      const next =
        typeof valueOrCb === "function"
          ? (valueOrCb as ParamSetCallback<T>)(value)
          : valueOrCb;
      if (equals?.(prev, next)) {
        return ref;
      }
      value = next;
      for (const sub of subscriptions) sub(next, prev);
      return ref;
    },

    /**
     * Resets the parameter back to its initial value and notifies subscribers
     * when the value meaningfully changed.
     */
    reset() {
      const prev = value;
      if (equals?.(prev, initialValue)) {
        return ref;
      }
      value = initialValue;
      for (const sub of subscriptions) sub(value, prev);
      return ref;
    },

    /**
     * Subscribes to value changes for this parameter.
     */
    subscribe(cb: ParamSubscribeCallback<T>) {
      subscriptions.add(cb);
      return () => subscriptions.delete(cb);
    },

    /**
     * Sets a display name for this parameter.
     */
    displayName(displayName: string) {
      name = displayName;
      return ref;
    },
  };

  return ref;
}
