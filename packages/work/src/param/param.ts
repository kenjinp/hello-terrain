import { createNodeId } from "../utils";
import type { ParamRef, ParamSetCallback, ParamSubscribeCallback } from "./param.types";

/**
 * Creates a new reactive parameter node.
 *
 * @template T The type of the parameter value.
 * @param {string} name - The name of the parameter.
 * @param {T} initial - The initial value of the parameter.
 * @returns {Param<T>} The parameter instance, providing getter, setter, and subscription APIs.
 *
 * @example
 * const foo = param('foo', 42);
 * console.log(foo.get()); // 42
 * foo.set(43);
 * foo.subscribe((next, prev) => console.log({ next, prev }));
 */
export function param<T>(initial: T): ParamRef<T> {
  let value = initial;
  let name: string | undefined = undefined;
  const subscriptions = new Set<ParamSubscribeCallback<T>>();
  const id = createNodeId();

  const ref: ParamRef<T> = {
    kind: "param",
    id,
    get name() {
      return name;
    },

    /**
     * Returns the current value of the parameter.
     * @returns {T} The current value of the parameter.
     */
    get() {
      return value;
    },

    /**
     * Sets the parameter to a new value and notifies subscribers.
     * @param {T} next - The new value to set.
     */
    set(cb: ParamSetCallback<T>) {
      const prev = value;
      const next = cb(value);
      value = next;
      for (const sub of subscriptions) sub(next, prev);
      return ref;
    },

    /**
     * Subscribes to value changes for this parameter.
     * @param {(next: T, prev: T) => void} cb - Callback invoked with new and previous values on change.
     * @returns {() => void} Unsubscribe function to remove the listener.
     */
    subscribe(cb: ParamSubscribeCallback<T>) {
      subscriptions.add(cb);
      return () => subscriptions.delete(cb);
    },

    /**
     * Sets a display name for this parameter.
     * @param {string} displayName - The human-readable display name to assign.
     */
    displayName(displayName: string) {
      name = displayName;
      return ref;
    },
  };

  return ref;
}
