import type {
  GraphEvent,
  GraphEventCallback,
  GraphEventOfSelector,
  GraphEventPrefix,
  GraphEventSelector,
  GraphEventType,
  Unsubscribe,
} from "./events.types";

export function events() {
  const listenersAll = new Set<GraphEventCallback>();
  const listenersByType = new Map<GraphEventType, Set<GraphEventCallback>>();
  const listenersByPrefix = new Map<GraphEventPrefix, Set<GraphEventCallback>>();

  const ensureSet = <K>(m: Map<K, Set<GraphEventCallback>>, key: K) => {
    const existing = m.get(key);
    if (existing) return existing;
    const next = new Set<GraphEventCallback>();
    m.set(key, next);
    return next;
  };

  const eventPrefix = (type: GraphEventType): GraphEventPrefix =>
    type.split(":", 1)[0] as GraphEventPrefix;

  const hasListeners = (type?: GraphEventType): boolean => {
    if (listenersAll.size > 0) return true;
    if (!type) return listenersByType.size > 0 || listenersByPrefix.size > 0;
    const exact = listenersByType.get(type);
    if (exact && exact.size > 0) return true;
    const prefixed = listenersByPrefix.get(eventPrefix(type));
    if (prefixed && prefixed.size > 0) return true;
    return false;
  };

  const emit = (e: GraphEvent) => {
    for (const cb of listenersAll) cb(e);

    const exact = listenersByType.get(e.type);
    if (exact) for (const cb of exact) cb(e);

    const prefixed = listenersByPrefix.get(eventPrefix(e.type));
    if (prefixed) for (const cb of prefixed) cb(e);
  };

  function on(cb: GraphEventCallback): Unsubscribe;
  function on<S extends GraphEventSelector>(
    selector: S,
    cb: (e: GraphEventOfSelector<S>) => void,
  ): Unsubscribe;
  function on(
    selectorOrCb: GraphEventSelector | GraphEventCallback,
    cbMaybe?: GraphEventCallback,
  ): Unsubscribe {
    if (typeof selectorOrCb === "function") {
      const cb = selectorOrCb;
      listenersAll.add(cb);
      return () => listenersAll.delete(cb);
    }

    const selector = selectorOrCb;
    const cb = cbMaybe;
    if (typeof cb !== "function") {
      throw new Error(`graph.on("${String(selector)}", cb) requires a callback`);
    }

    // Wildcard: "task:*" (stored by prefix "task")
    if (selector.endsWith("*")) {
      const prefix = selector.slice(0, -2) as GraphEventPrefix;
      const set = ensureSet(listenersByPrefix, prefix);
      set.add(cb);
      return () => set.delete(cb);
    }

    // Exact: "task:cacheHit"
    const set = ensureSet(listenersByType, selector);
    set.add(cb);
    return () => set.delete(cb);
  }

  return {
    on,
    emit,
    hasListeners,
  };
}
