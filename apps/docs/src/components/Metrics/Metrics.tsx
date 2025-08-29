"use client";
import {
  createContext,
  createRef,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode, RefObject } from "react";

export type MetricId = string;

export type MetricSpec = {
  id: MetricId;
  label?: string;
};

type MetricSpanRef = RefObject<HTMLSpanElement | null>;

export type MetricsContextValue = {
  getRef: (id: MetricId, label?: string) => MetricSpanRef;
  getManyRefs: (metrics: MetricSpec[]) => Record<string, MetricSpanRef>;
  initialize: (metrics: MetricSpec[] | string[]) => void;
  entriesForRender: () => Array<{
    id: string;
    label: string;
    ref: MetricSpanRef;
  }>;
};

const MetricsContext = createContext<MetricsContextValue | null>(null);

const METRICS_RENDER_EVENT = "metrics:render";

export function requestMetricsRerender(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(METRICS_RENDER_EVENT));
  }
}

export function MetricsProvider({
  children,
  initial,
}: { children: ReactNode; initial?: MetricSpec[] }) {
  const registryRef = useRef<Map<string, MetricSpanRef>>(new Map());
  const labelRef = useRef<Map<string, string>>(new Map());
  const orderRef = useRef<string[]>([]);

  const ensureRegistered = useCallback((id: string, label?: string) => {
    if (!registryRef.current.has(id)) {
      const ref = createRef<HTMLSpanElement>() as MetricSpanRef;
      registryRef.current.set(id, ref);
      orderRef.current.push(id);
    }
    if (label && !labelRef.current.has(id)) {
      labelRef.current.set(id, label);
    }
  }, []);

  useMemo(() => {
    const toInit = initial ?? [];
    for (const m of toInit) ensureRegistered(m.id, m.label);
  }, [ensureRegistered, initial]);

  const getRef = useCallback(
    (id: string, label?: string) => {
      ensureRegistered(id, label);
      const existing = registryRef.current.get(id);
      if (existing) return existing;
      const ref = createRef<HTMLSpanElement>() as MetricSpanRef;
      registryRef.current.set(id, ref);
      return ref;
    },
    [ensureRegistered]
  );

  const getManyRefs = useCallback(
    (metrics: MetricSpec[]) => {
      const result: Record<string, MetricSpanRef> = {};
      for (const m of metrics) {
        result[m.id] = getRef(m.id, m.label);
      }
      return result;
    },
    [getRef]
  );

  const entriesForRender = useCallback(() => {
    return orderRef.current.map((id) => ({
      id,
      label: labelRef.current.get(id) ?? id,
      ref:
        registryRef.current.get(id) ??
        (createRef<HTMLSpanElement>() as MetricSpanRef),
    }));
  }, []);

  const initialize = useCallback(
    (metrics: MetricSpec[] | string[]) => {
      const specs: MetricSpec[] = metrics.map((m) =>
        typeof m === "string" ? { id: m } : m
      );
      for (const m of specs) ensureRegistered(m.id, m.label);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event(METRICS_RENDER_EVENT));
      }
    },
    [ensureRegistered]
  );

  const value = useMemo<MetricsContextValue>(
    () => ({ getRef, getManyRefs, entriesForRender, initialize }),
    [getRef, getManyRefs, entriesForRender, initialize]
  );

  return (
    <MetricsContext.Provider value={value}>{children}</MetricsContext.Provider>
  );
}

type ExtractId<T> = T extends { id: infer I extends string }
  ? I
  : T extends string
    ? T
    : never;

export function useMetrics<const T extends readonly (MetricSpec | string)[]>(
  metrics: T
) {
  const ctx = useContext(MetricsContext);
  if (!ctx) throw new Error("useMetrics must be used within a MetricsProvider");
  const specs: MetricSpec[] = metrics.map((m) =>
    typeof m === "string" ? { id: m } : m
  );
  // Ensure registration
  ctx.getManyRefs(specs);

  type Keys = ExtractId<T[number]>;
  const setMetric = useCallback(
    (key: Keys, value: string) => {
      const ref = ctx.getRef(key as string);
      if (ref.current) {
        ref.current.textContent = value;
        ref.current.title = value;
      }
    },
    [ctx]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
  useEffect(() => {
    ctx.initialize(specs);
  }, [specs]);

  return setMetric;
}

export function Metrics() {
  const ctx = useContext(MetricsContext);
  if (!ctx) return null;
  const [, bump] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const onRender = (_e: Event) => bump((v) => v + 1);
    if (typeof window !== "undefined") {
      window.addEventListener(METRICS_RENDER_EVENT, onRender);
    }
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener(METRICS_RENDER_EVENT, onRender);
      }
    };
  }, []);
  const entries = ctx.entriesForRender();
  if (entries.length === 0) return null;
  return (
    <div
      className="bg-black/70 border border-white/20 rounded-lg"
      style={{ fontFamily: "monospace", fontSize: "14px" }}
    >
      <div className="p-3 text-white">
        <div className="flex items-center justify-between mb-2">
          <span className="opacity-80 font-semibold">Metrics</span>
          <button
            type="button"
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((v) => !v)}
            className="px-2 py-0.5 rounded border border-white/20 text-white/90 hover:bg-white/10"
          >
            {collapsed ? "Show" : "Hide"}
          </button>
        </div>
        {!collapsed && (
          <div className="space-y-1">
            {entries.map(({ id, label, ref }) => (
              <div key={id} className="flex items-center gap-1 justify-between">
                <span
                  className="opacity-80 inline-block max-w-[50%] truncate"
                  title={label}
                >
                  {label}:
                </span>
                <span
                  ref={ref}
                  data-metric-id={id}
                  className="px-1 py-0.5 rounded bg-white/20 text-white text-sm inline-block max-w-[50%] truncate text-right"
                  title=""
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
