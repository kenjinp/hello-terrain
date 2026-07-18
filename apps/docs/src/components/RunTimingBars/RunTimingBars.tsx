"use client";

import { useExamplesCanvas } from "@/components/ExamplesCanvas";
import {
  DEBUG_MONO_FONT,
  DEBUG_PANEL_INLINE,
  DEBUG_TEXT_SIZE,
  DEBUG_TEXT_SIZE_SM,
} from "@/lib/debug-overlay";
import type { GraphEvent } from "@hello-terrain/work";
import { useEffect, useMemo, useRef, useState } from "react";

type MinimalGraph = {
  on(cb: (e: GraphEvent) => void): () => void;
  inspect?: (options?: any) => { nodes?: Array<{ id: string; kind: string; name?: string }> } | null;
};

type Segment = {
  taskId: string;
  name?: string;
  durationMs: number;
  color: string;
  kind: "ok" | "error";
};

type Bar = {
  totalMs: number;
  segments: Segment[];
};

function clamp(x: number, min: number, max: number) {
  return x < min ? min : x > max ? max : x;
}

function fnv1a32(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    // h *= 16777619 (with overflow)
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function hslToHex(h: number, s: number, l: number) {
  // h: 0..360, s/l: 0..100
  const hh = ((h % 360) + 360) % 360;
  const ss = clamp(s, 0, 100) / 100;
  const ll = clamp(l, 0, 100) / 100;

  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = ll - c / 2;

  let r = 0,
    g = 0,
    b = 0;
  if (hh < 60) [r, g, b] = [c, x, 0];
  else if (hh < 120) [r, g, b] = [x, c, 0];
  else if (hh < 180) [r, g, b] = [0, c, x];
  else if (hh < 240) [r, g, b] = [0, x, c];
  else if (hh < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  const toHex = (v: number) => {
    const n = Math.round((v + m) * 255);
    return n.toString(16).padStart(2, "0");
  };

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function colorForKey(key: string) {
  const h0 = fnv1a32(key);
  // Spread hue using golden ratio for better separation.
  const hue = (h0 * 0.61803398875 * 360) % 360;
  // Vary saturation/lightness slightly to avoid clustering.
  const sat = 70 + (h0 % 20);
  const light = 48 + ((h0 >>> 5) % 16);
  return hslToHex(hue, sat, light);
}

function buildBar(
  durations: Map<string, { ms: number; kind: "ok" | "error" }>,
  nameById: Map<string, string>,
  colorById: Map<string, string>,
  maxTasks: number,
): Bar {
  const segments: Segment[] = [];
  let totalMs = 0;

  for (const [taskId, { ms, kind }] of durations) {
    if (!Number.isFinite(ms) || ms <= 0) continue;
    totalMs += ms;

    let color = colorById.get(taskId);
    if (!color) {
      const name = nameById.get(taskId);
      color = colorForKey(name ?? taskId);
      colorById.set(taskId, color);
    }

    segments.push({
      taskId,
      name: nameById.get(taskId),
      durationMs: ms,
      color,
      kind,
    });
  }

  segments.sort((a, b) => b.durationMs - a.durationMs);

  // Truncate to keep the HUD tiny. Fold remaining into an "other" segment.
  if (segments.length > maxTasks) {
    const keep = segments.slice(0, maxTasks - 1);
    const rest = segments.slice(maxTasks - 1);
    const otherMs = rest.reduce((sum, s) => sum + s.durationMs, 0);
    keep.push({
      taskId: "__other__",
      name: "Other",
      durationMs: otherMs,
      color: "#6b7280", // slate-500
      kind: "ok",
    });
    return { totalMs, segments: keep };
  }

  return { totalMs, segments };
}

export type RunTimingBarsProps = {
  graph: MinimalGraph;
  className?: string;
  /** Pixel height of each timing bar. @default 8 */
  barHeight?: number;
  maxTasks?: number;
  /** Maximum HUD refresh rate. @default 250 ms */
  refreshIntervalMs?: number;
};

export function RunTimingBars({
  graph,
  className,
  barHeight = 8,
  maxTasks = 10,
  refreshIntervalMs = 250,
}: RunTimingBarsProps) {
  const { showUI, showControls } = useExamplesCanvas();
  const [, forceRender] = useState(0);

  const nameByIdRef = useRef<Map<string, string>>(new Map());
  const colorByIdRef = useRef<Map<string, string>>(new Map());

  const curDurationsRef = useRef<Map<string, { ms: number; kind: "ok" | "error" }>>(new Map());
  const prevBarRef = useRef<Bar>({ totalMs: 0, segments: [] });
  const curBarRef = useRef<Bar>({ totalMs: 0, segments: [] });
  const maxByIdRef = useRef<Map<string, { ms: number; kind: "ok" | "error" }>>(new Map());
  const maxBarRef = useRef<Bar>({ totalMs: 0, segments: [] });

  const runStartedAtRef = useRef<number | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const staleNowRef = useRef<boolean>(false);
  const lastInspectAtRef = useRef(0);
  const lastRenderAtRef = useRef(0);
  const renderTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const refreshNames = (now: number, force = false) => {
      if (!force && now - lastInspectAtRef.current < 1000) return;
      lastInspectAtRef.current = now;
      try {
        const inspect = graph.inspect?.({ includeRuntime: false }) as any;
        if (inspect?.nodes) {
          for (const n of inspect.nodes) {
            if (n?.kind === "task" && typeof n.id === "string" && typeof n.name === "string") {
              nameByIdRef.current.set(n.id, n.name);
            }
          }
        }
      } catch {
        // ignore
      }
    };

    const scheduleRender = () => {
      if (renderTimerRef.current !== null) return;
      const now = performance.now();
      const delay = Math.max(
        0,
        refreshIntervalMs - (now - lastRenderAtRef.current),
      );
      renderTimerRef.current = window.setTimeout(() => {
        renderTimerRef.current = null;
        lastRenderAtRef.current = performance.now();
        forceRender((x) => (x + 1) | 0);
      }, delay);
    };

    // Seed names if inspect exists.
    refreshNames(performance.now(), true);

    const unsub = graph.on((e) => {
      if (e.type === "run:start") {
        activeRunIdRef.current = e.runId;
        runStartedAtRef.current = e.at;
        curDurationsRef.current.clear();
        staleNowRef.current = true;
        return;
      }

      // If we ever see events from a previous run interleaved, ignore them.
      if (activeRunIdRef.current && "runId" in e && e.runId !== activeRunIdRef.current) {
        return;
      }

      if (e.type === "task:finish") {
        curDurationsRef.current.set(e.taskId, { ms: e.durationMs, kind: "ok" });
        return;
      }

      if (e.type === "task:error") {
        curDurationsRef.current.set(e.taskId, { ms: e.durationMs, kind: "error" });
        return;
      }

      if (e.type === "run:finish") {
        // Refresh names if available (tasks can be added lazily).
        refreshNames(performance.now());

        const nameById = nameByIdRef.current;
        const colorById = colorByIdRef.current;

        const nextBar = buildBar(curDurationsRef.current, nameById, colorById, maxTasks);
        const hasDurations = nextBar.totalMs > 0 && nextBar.segments.length > 0;

        if (hasDurations) {
          // Shift bars: current -> previous, new -> current.
          prevBarRef.current = curBarRef.current;
          curBarRef.current = nextBar;

          // Update per-task maxes for "max" bar.
          for (const [taskId, v] of curDurationsRef.current) {
            const prev = maxByIdRef.current.get(taskId);
            if (!prev || v.ms > prev.ms) maxByIdRef.current.set(taskId, v);
          }
          maxBarRef.current = buildBar(maxByIdRef.current, nameById, colorById, maxTasks);
          staleNowRef.current = false;
        } else {
          // Keep the last values visible (greyed) when this run had no durations.
          staleNowRef.current = true;
        }

        scheduleRender();

        activeRunIdRef.current = null;
        runStartedAtRef.current = null;
      }
    });

    return () => {
      unsub();
      if (renderTimerRef.current !== null) {
        window.clearTimeout(renderTimerRef.current);
        renderTimerRef.current = null;
      }
    };
  }, [graph, maxTasks, refreshIntervalMs]);

  const visible = showUI && !showControls;

  const containerClass = useMemo(() => {
    return `${DEBUG_PANEL_INLINE} ${className ?? ""}`;
  }, [className]);

  const bars: Array<{ label: string; bar: Bar }> = [
    { label: "now", bar: curBarRef.current },
    { label: "n-1", bar: prevBarRef.current },
    { label: "max", bar: maxBarRef.current },
  ];
  const staleNow = staleNowRef.current;

  return (
    <div className={`${containerClass} ${visible ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}>
      <div
        className={`${DEBUG_TEXT_SIZE} leading-4 flex flex-col`}
        style={{ fontFamily: DEBUG_MONO_FONT }}
        role="img"
        aria-label="Task timings"
      >
        {bars.map(({ label, bar }) => {
          const total = Math.max(1e-6, bar.totalMs);
          const isStale = staleNow && label === "now";
          const labelClass = isStale ? "text-white/35" : "text-white/70";
          const valueClass = isStale ? "text-white/30" : "text-white/60";
          const segmentOpacity = isStale ? 0.45 : 0.95;

          return (
            <div key={label} className="flex h-4 items-center gap-1.5">
              <span className={`w-6 shrink-0 ${labelClass}`}>{label}</span>

              {/* Bar (HTML/CSS so segment labels render at a consistent size) */}
              <div
                className="relative flex flex-1 min-w-0 overflow-hidden rounded-sm bg-white/[0.06]"
                style={{ height: barHeight }}
              >
                {bar.segments.map((s, idx) => {
                  const pct = (s.durationMs / total) * 100;
                  if (pct <= 0.1) return null;

                  const name =
                    s.name ?? (s.taskId === "__other__" ? "Other" : s.taskId);
                  const inline = `${name} ${s.durationMs.toFixed(2)}ms (${pct.toFixed(1)}%)${
                    s.kind === "error" ? " (error)" : ""
                  }`;
                  const title = `${name}\n${s.durationMs.toFixed(2)}ms (${pct.toFixed(1)}%)${
                    s.kind === "error" ? "\n(error)" : ""
                  }`;

                  return (
                    <div
                      key={`${s.taskId}-${idx}`}
                      className="flex shrink-0 items-center overflow-hidden whitespace-nowrap"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: s.kind === "error" ? "#ef4444" : s.color,
                        opacity: segmentOpacity,
                      }}
                      title={title}
                    >
                      <span
                        className={`${DEBUG_TEXT_SIZE_SM} truncate px-1 leading-none text-black/75`}
                      >
                        {inline}
                      </span>
                    </div>
                  );
                })}
              </div>

              <span
                className={`w-12 shrink-0 text-right tabular-nums whitespace-nowrap ${valueClass}`}
              >
                {bar.totalMs > 0 ? `${bar.totalMs.toFixed(1)}ms` : "—"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
