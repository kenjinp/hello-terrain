"use client";

import { useExamplesCanvas } from "@/components/ExamplesCanvas";
import { TerrainFieldTextureDebug } from "@/components/TerrainFieldTextureDebug";
import {
  leafGpuBufferTask,
  leafStorageTask,
  quadtreeConfigTask,
  quadtreeUpdateTask,
} from "@hello-terrain/three";
import type { Graph, TaskRef } from "@hello-terrain/work";
import { useEffect, useMemo, useRef, useState } from "react";
import type { WebGPURenderer } from "three/webgpu";

export type TerrainTileDebugProps = {
  graph: Graph;
  rendererTask?: TaskRef<WebGPURenderer | null>;
  className?: string;
};

type TileStats = {
  /** Number of tiles currently being rendered (clamped to buffer) */
  tilesRendered: number;
  /** Maximum number of tiles rendered in any frame so far */
  maxTilesRendered: number;
  /** Deepest subdivision level in the current leaf set */
  currentLevel: number;
  /** Configured maximum subdivision level */
  maxLevel: number;
  /** Number of tiles the GPU buffer can hold */
  bufferCapacity: number;
};

const MONO_FONT =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

export function TerrainTileDebug({
  graph,
  rendererTask,
  className,
}: TerrainTileDebugProps) {
  const { showUI, showControls } = useExamplesCanvas();
  const [, forceRender] = useState(0);
  const [textureDebugOpen, setTextureDebugOpen] = useState(false);
  const [texturePanelPos, setTexturePanelPos] = useState({ x: 18, y: 18 });

  const statsRef = useRef<TileStats>({
    tilesRendered: 0,
    maxTilesRendered: 0,
    currentLevel: 0,
    maxLevel: 0,
    bufferCapacity: 0,
  });

  useEffect(() => {
    const unsub = graph.on("run:finish", () => {
      const stats = statsRef.current;

      // Tiles rendered (GPU-side count, clamped to buffer capacity)
      const gpuBuffer = graph.peek(leafGpuBufferTask);
      if (gpuBuffer) {
        stats.tilesRendered = gpuBuffer.count;
        if (gpuBuffer.count > stats.maxTilesRendered) {
          stats.maxTilesRendered = gpuBuffer.count;
        }
      }

      // Current deepest level from the raw quadtree leaf set
      const leafSet = graph.peek(quadtreeUpdateTask);
      if (leafSet && leafSet.count > 0) {
        let deepest = 0;
        for (let i = 0; i < leafSet.count; i++) {
          if (leafSet.level[i]! > deepest) deepest = leafSet.level[i]!;
        }
        stats.currentLevel = deepest;
      } else {
        stats.currentLevel = 0;
      }

      // Configured max level
      const config = graph.peek(quadtreeConfigTask);
      if (config) {
        stats.maxLevel = config.state.cfg.maxLevel;
      }

      // Buffer capacity
      const storage = graph.peek(leafStorageTask);
      if (storage) {
        stats.bufferCapacity = storage.data.length / 4;
      }

      forceRender((x) => (x + 1) | 0);
    });

    return () => unsub();
  }, [graph]);

  const visible = showUI && !showControls;

  const containerClass = useMemo(() => {
    const base =
      "w-full select-none bg-black/45 border border-white/10 backdrop-blur-sm rounded-md px-2 py-1.5 transition-opacity duration-200";
    return `${base} ${className ?? ""}`;
  }, [className]);

  const { tilesRendered, maxTilesRendered, currentLevel, maxLevel, bufferCapacity } =
    statsRef.current;

  const fillRatio = bufferCapacity > 0 ? tilesRendered / bufferCapacity : 0;
  const fillPct = (fillRatio * 100).toFixed(1);

  const rows: Array<{ label: string; value: string | number }> = [
    { label: "tiles", value: tilesRendered },
    { label: "max seen", value: maxTilesRendered },
    { label: "level", value: `${currentLevel} / ${maxLevel}` },
    { label: "buffer", value: `${tilesRendered} / ${bufferCapacity}` },
    { label: "fill", value: `${fillPct}%` },
  ];

  const rowH = 14;
  const barH = 4;
  const svgW = 180;
  const labelW = 58;
  const svgH = rows.length * rowH + barH + 6;

  // Color the fill bar based on how full the buffer is
  const barColor =
    fillRatio > 0.9 ? "#ef4444" : fillRatio > 0.7 ? "#f59e0b" : "#22c55e";

  return (
    <>
      <div className={`${containerClass} ${visible ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}>
        <div className="flex items-start gap-1">
          <svg viewBox={`0 0 ${svgW} ${svgH}`} role="img" aria-label="Terrain tile debug" className="w-full h-auto flex-1 min-w-0">
            {rows.map(({ label, value }, i) => {
              const y = i * rowH;
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
                    fill="rgba(255,255,255,0.85)"
                    fontFamily={MONO_FONT}
                  >
                    {value}
                  </text>
                </g>
              );
            })}

            {/* Buffer fill bar */}
            <g transform={`translate(0, ${rows.length * rowH + 2})`}>
              <rect x={0} y={0} width={svgW} height={barH} rx={2} fill="rgba(255,255,255,0.06)" />
              <rect
                x={0}
                y={0}
                width={Math.max(0, fillRatio * svgW)}
                height={barH}
                rx={2}
                fill={barColor}
                opacity={0.85}
              />
            </g>
          </svg>

          {rendererTask && (
            <button
              type="button"
              className="cursor-pointer hidden md:flex items-center justify-center w-5 h-5 rounded hover:bg-white/15 text-white/40 hover:text-white/80 transition-colors shrink-0 mt-0.5"
              onClick={() => setTextureDebugOpen(true)}
              aria-label="Open terrain field texture debug"
              title="Terrain field texture"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6,1 9,1 9,4" />
                <line x1="9" y1="1" x2="5" y2="5" />
                <path d="M8 6v2.5a.5.5 0 01-.5.5h-6a.5.5 0 01-.5-.5v-6a.5.5 0 01.5-.5H4" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {textureDebugOpen && rendererTask && (
        <TerrainFieldTextureDebug
          graph={graph}
          rendererTask={rendererTask}
          onClose={() => setTextureDebugOpen(false)}
          panelPos={texturePanelPos}
          onPanelPosChange={setTexturePanelPos}
        />
      )}
    </>
  );
}
