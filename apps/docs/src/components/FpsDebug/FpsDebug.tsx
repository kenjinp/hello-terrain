"use client";

import { useExamplesCanvas } from "@/components/ExamplesCanvas";
import { useEffect, useMemo, useRef, useState } from "react";

export type FpsDebugProps = {
  className?: string;
  /** Number of recent samples to keep for the sparkline. @default 60 */
  historySize?: number;
};

const MONO_FONT =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

function clamp(x: number, min: number, max: number) {
  return x < min ? min : x > max ? max : x;
}

export function FpsDebug({
  className,
  historySize = 60,
}: FpsDebugProps) {
  const { showUI } = useExamplesCanvas();
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

  const containerClass = useMemo(() => {
    const base =
      "w-full pointer-events-auto select-none bg-black/45 border border-white/10 backdrop-blur-sm rounded-md px-2 py-1.5";
    return `${base} ${className ?? ""}`;
  }, [className]);

  if (!showUI) return null;

  const fps = fpsRef.current;
  const minFps = Number.isFinite(minFpsRef.current) ? minFpsRef.current : 0;
  const maxFps = maxFpsRef.current;

  const rows: Array<{ label: string; value: string }> = [
    { label: "fps", value: fps > 0 ? fps.toFixed(0) : "—" },
    { label: "min", value: minFps > 0 ? minFps.toFixed(0) : "—" },
    { label: "max", value: maxFps > 0 ? maxFps.toFixed(0) : "—" },
  ];

  const rowH = 14;
  const sparkH = 16;
  const sparkGap = 4;
  const svgW = 180;
  const labelW = 32;
  const svgH = rows.length * rowH + sparkGap + sparkH;

  // Sparkline from history
  const history = historyRef.current;
  const sparkMax = Math.max(120, maxFps, ...history);

  // Color the current FPS value
  const fpsColor =
    fps >= 55 ? "#22c55e" : fps >= 30 ? "#f59e0b" : fps > 0 ? "#ef4444" : "rgba(255,255,255,0.85)";

  return (
    <div className={containerClass}>
      <svg width={svgW} height={svgH} role="img" aria-label="FPS debug">
        {rows.map(({ label, value }, i) => {
          const y = i * rowH;
          const valueFill = label === "fps" ? fpsColor : "rgba(255,255,255,0.85)";
          return (
            <g key={label} transform={`translate(0, ${y})`}>
              <text
                x={0}
                y={rowH - 3}
                fontSize="9"
                fill="rgba(255,255,255,0.5)"
                fontFamily={MONO_FONT}
              >
                {label}
              </text>
              <text
                x={labelW}
                y={rowH - 3}
                fontSize="9"
                fill={valueFill}
                fontFamily={MONO_FONT}
              >
                {value}
              </text>
            </g>
          );
        })}

        {/* Sparkline */}
        <g transform={`translate(0, ${rows.length * rowH + sparkGap})`}>
          {/* Background */}
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
        </g>
      </svg>
    </div>
  );
}
