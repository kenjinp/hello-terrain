"use client";

import { useExamplesCanvas } from "@/components/ExamplesCanvas";
import { DEBUG_PANEL_INLINE, DebugStatRows } from "@/lib/debug-overlay";
import { useEffect, useMemo, useRef, useState } from "react";

export type FpsDebugProps = {
  className?: string;
  /** Number of recent samples to keep for the sparkline. @default 60 */
  historySize?: number;
};

function clamp(x: number, min: number, max: number) {
  return x < min ? min : x > max ? max : x;
}

export function FpsDebug({
  className,
  historySize = 60,
}: FpsDebugProps) {
  const { showUI, showControls } = useExamplesCanvas();
  const [, forceRender] = useState(0);

  const fpsRef = useRef(0);
  const minFpsRef = useRef(Infinity);
  const maxFpsRef = useRef(0);
  const historyRef = useRef<number[]>([]);

  // Accumulate frame times and update ~2× per second.
  const frameCountRef = useRef(0);
  const accumRef = useRef(0);
  const lastTimeRef = useRef(0);
  const rafRef = useRef(0);

  useEffect(() => {
    let mounted = true;

    const tick = (now: number) => {
      if (!mounted) return;

      if (lastTimeRef.current > 0) {
        const dt = now - lastTimeRef.current;
        accumRef.current += dt;
        frameCountRef.current += 1;

        // Flush every ~500 ms.
        if (accumRef.current >= 500) {
          const avgMs = accumRef.current / frameCountRef.current;
          const fps = 1000 / avgMs;

          fpsRef.current = fps;
          if (fps < minFpsRef.current) minFpsRef.current = fps;
          if (fps > maxFpsRef.current) maxFpsRef.current = fps;

          const history = historyRef.current;
          history.push(fps);
          if (history.length > historySize) {
            history.splice(0, history.length - historySize);
          }

          accumRef.current = 0;
          frameCountRef.current = 0;

          forceRender((x) => (x + 1) | 0);
        }
      }

      lastTimeRef.current = now;
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      mounted = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [historySize]);

  const visible = showUI && !showControls;

  const containerClass = useMemo(() => {
    return `${DEBUG_PANEL_INLINE} ${className ?? ""}`;
  }, [className]);

  const fps = fpsRef.current;
  const minFps = Number.isFinite(minFpsRef.current) ? minFpsRef.current : 0;
  const maxFps = maxFpsRef.current;

  // Color the current FPS value
  const fpsColor =
    fps >= 55 ? "#22c55e" : fps >= 30 ? "#f59e0b" : fps > 0 ? "#ef4444" : "rgba(255,255,255,0.85)";

  const rows = [
    { label: "fps", value: fps > 0 ? fps.toFixed(0) : "—", valueColor: fpsColor },
    { label: "min", value: minFps > 0 ? minFps.toFixed(0) : "—" },
    { label: "max", value: maxFps > 0 ? maxFps.toFixed(0) : "—" },
  ];

  const sparkH = 16;
  const svgW = 180;

  // Sparkline from history
  const history = historyRef.current;
  const sparkMax = Math.max(120, maxFps, ...history);

  return (
    <div className={`${containerClass} ${visible ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}>
      <DebugStatRows rows={rows} />

      {/* Sparkline (graphics only; stretches horizontally, fixed height) */}
      <svg
        viewBox={`0 0 ${svgW} ${sparkH}`}
        preserveAspectRatio="none"
        className="mt-1 w-full h-4"
        role="img"
        aria-label="FPS history"
      >
        <rect x={0} y={0} width={svgW} height={sparkH} rx={2} fill="rgba(255,255,255,0.06)" />

        {history.length > 1 && (() => {
          const barW = svgW / historySize;
          return history.map((val, idx) => {
            const h = clamp((val / sparkMax) * sparkH, 0.5, sparkH);
            const x = idx * barW;
            const ratio = val / 60;
            const color =
              ratio >= 0.92 ? "#22c55e" : ratio >= 0.5 ? "#f59e0b" : "#ef4444";
            return (
              <rect
                key={idx}
                x={x}
                y={sparkH - h}
                width={Math.max(0.5, barW - 0.5)}
                height={h}
                fill={color}
                opacity={0.8}
              />
            );
          });
        })()}

        {/* 60 FPS reference line */}
        <line
          x1={0}
          y1={sparkH - (60 / sparkMax) * sparkH}
          x2={svgW}
          y2={sparkH - (60 / sparkMax) * sparkH}
          stroke="rgba(255,255,255,0.2)"
          strokeWidth={0.5}
          strokeDasharray="2,2"
        />
      </svg>
    </div>
  );
}
