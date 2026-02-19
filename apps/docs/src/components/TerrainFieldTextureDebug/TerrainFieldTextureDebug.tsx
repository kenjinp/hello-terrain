"use client";

import { useExamplesCanvas } from "@/components/ExamplesCanvas";
import {
  createElevationFieldContextTask,
  createTerrainFieldTextureTask,
  leafGpuBufferTask,
} from "@hello-terrain/three";
import type { Graph } from "@hello-terrain/work";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { createPortal } from "react-dom";
import type { WebGPURenderer } from "three/webgpu";

export type TerrainFieldTextureDebugProps = {
  graph: Graph;
  rendererRef?: RefObject<WebGPURenderer | null>;
  rootSizeValue?: number;
  elevationScaleValue?: number;
  className?: string;
};

type ChannelTab = "all" | "height" | "normal";

type DebugInfo = {
  backend: string;
  edge: number;
  activeTiles: number;
  tileCount: number;
  gridCols: number;
  gridRows: number;
  imageWidth: number;
  imageHeight: number;
  minHeight: number;
  maxHeight: number;
};

const MONO_FONT =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function encodeSigned(v: number) {
  return clamp01(v * 0.5 + 0.5);
}

function isFiniteNumber(v: number) {
  return Number.isFinite(v);
}

export function TerrainFieldTextureDebug({
  graph,
  rendererRef,
  rootSizeValue = 1,
  elevationScaleValue = 1,
  className,
}: TerrainFieldTextureDebugProps) {
  const { showUI } = useExamplesCanvas();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const infoRef = useRef<DebugInfo>({
    backend: "n/a",
    edge: 0,
    activeTiles: 0,
    tileCount: 0,
    gridCols: 0,
    gridRows: 0,
    imageWidth: 0,
    imageHeight: 0,
    minHeight: 0,
    maxHeight: 0,
  });
  const imagePixelsRef = useRef<Uint8ClampedArray | null>(null);
  const [tab, setTab] = useState<ChannelTab>("all");
  const [hoverTileIndex, setHoverTileIndex] = useState<number | null>(null);
  const [selectedTileIndex, setSelectedTileIndex] = useState<number | null>(null);
  const [panelPos, setPanelPos] = useState({ x: 18, y: 18 });
  const [modalPos, setModalPos] = useState<{ x: number; y: number } | null>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [, forceRender] = useState(0);
  const modalCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const draggingRef = useRef<{
    active: boolean;
    target: "panel" | "modal" | null;
    startMouseX: number;
    startMouseY: number;
    startX: number;
    startY: number;
  }>({
    active: false,
    target: null,
    startMouseX: 0,
    startMouseY: 0,
    startX: 0,
    startY: 0,
  });

  const containerClass = useMemo(() => {
    const base =
      "fixed z-40 pointer-events-auto select-none bg-black/45 border border-white/10 backdrop-blur-sm rounded-md p-2";
    return `${base} ${className ?? ""}`;
  }, [className]);

  useEffect(() => {
    function onPointerMove(event: PointerEvent) {
      if (!draggingRef.current.active) return;
      const dx = event.clientX - draggingRef.current.startMouseX;
      const dy = event.clientY - draggingRef.current.startMouseY;
      if (draggingRef.current.target === "panel") {
        const maxX = Math.max(0, window.innerWidth - 120);
        const maxY = Math.max(0, window.innerHeight - 120);
        setPanelPos({
          x: Math.max(0, Math.min(maxX, draggingRef.current.startX + dx)),
          y: Math.max(0, Math.min(maxY, draggingRef.current.startY + dy)),
        });
      } else if (draggingRef.current.target === "modal") {
        const maxX = Math.max(0, window.innerWidth - 180);
        const maxY = Math.max(0, window.innerHeight - 120);
        setModalPos({
          x: Math.max(0, Math.min(maxX, draggingRef.current.startX + dx)),
          y: Math.max(0, Math.min(maxY, draggingRef.current.startY + dy)),
        });
      }
    }

    function onPointerUp() {
      draggingRef.current.active = false;
      draggingRef.current.target = null;
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, []);

  useEffect(() => {
    const appRoot =
      document.getElementById("__next") ??
      document.getElementById("root") ??
      document.body;
    setPortalTarget(appRoot);
  }, []);

  useEffect(() => {
    if (selectedTileIndex == null) {
      setModalPos(null);
      return;
    }
    if (modalPos != null) return;
    const defaultWidth = Math.min(window.innerWidth * 0.92, 620);
    const defaultHeight = Math.min(window.innerHeight * 0.86, 680);
    setModalPos({
      x: Math.max(0, (window.innerWidth - defaultWidth) * 0.5),
      y: Math.max(0, (window.innerHeight - defaultHeight) * 0.5),
    });
  }, [modalPos, selectedTileIndex]);

  useEffect(() => {
    let running = false;
    let queued = false;

    async function redraw() {
      if (running) {
        queued = true;
        return;
      }
      running = true;
      const storage = graph.peek(createTerrainFieldTextureTask);
      const elevationField = graph.peek(createElevationFieldContextTask);
      const leaves = graph.peek(leafGpuBufferTask);

      if (!storage || !elevationField || !leaves) {
        running = false;
        return;
      }

      const edge = storage.edgeVertexCount;
      const tileCount = storage.tileCount;
      const activeTiles = Math.min(leaves.count, tileCount);
      if (edge <= 0 || tileCount <= 0 || activeTiles <= 0) {
        running = false;
        return;
      }

      const innerSegments = Math.max(1, edge - 3);
      const verticesPerTile = edge * edge;
      const data = new Float32Array(elevationField.data);
      const renderer = rendererRef?.current as
        | (WebGPURenderer & {
            getArrayBufferAsync?: (target: unknown) => Promise<ArrayBuffer>;
          })
        | undefined;
      if (renderer?.getArrayBufferAsync) {
        try {
          const attributeAny = elevationField.attribute as unknown as {
            value?: unknown;
            buffer?: unknown;
          };
          const readbackTarget =
            attributeAny.value ?? attributeAny.buffer ?? elevationField.attribute;
          const gpuBytes = await renderer.getArrayBufferAsync(readbackTarget);
          const gpuData = new Float32Array(gpuBytes);
          if (gpuData.length >= data.length) {
            data.set(gpuData.subarray(0, data.length));
          }
        } catch {
          // Keep rendering using the best available local snapshot.
        }
      }
      const nodeData = leaves.data;

      const atlasLike = storage.backendType === "atlas";
      const cols = Math.max(1, Math.ceil(Math.sqrt(tileCount)));
      const rows = Math.max(1, Math.ceil(tileCount / cols));
      const atlasCols = Math.max(1, Math.ceil(Math.sqrt(tileCount)));
      const gridCols = atlasLike ? atlasCols : cols;
      const gridRows = atlasLike ? atlasCols : rows;
      const imageWidth = gridCols * edge;
      const imageHeight = gridRows * edge;

      let minH = Number.POSITIVE_INFINITY;
      let maxH = Number.NEGATIVE_INFINITY;
      for (let tileIndex = 0; tileIndex < activeTiles; tileIndex++) {
        const base = tileIndex * verticesPerTile;
        for (let i = 0; i < verticesPerTile; i++) {
          const h = data[base + i];
          if (!isFiniteNumber(h)) continue;
          if (h < minH) minH = h;
          if (h > maxH) maxH = h;
        }
      }
      if (!isFiniteNumber(minH) || !isFiniteNumber(maxH)) {
        minH = 0;
        maxH = 1;
      }
      const denom = Math.max(1e-6, maxH - minH);

      const pixels = new Uint8ClampedArray(imageWidth * imageHeight * 4);

      for (let y = 0; y < imageHeight; y++) {
        for (let x = 0; x < imageWidth; x++) {
          const p = (y * imageWidth + x) * 4;
          pixels[p] = 8;
          pixels[p + 1] = 10;
          pixels[p + 2] = 14;
          pixels[p + 3] = 255;
        }
      }

      for (let tileIndex = 0; tileIndex < tileCount; tileIndex++) {
        const tileCol = atlasLike ? tileIndex % atlasCols : tileIndex % cols;
        const tileRow = atlasLike
          ? Math.floor(tileIndex / atlasCols)
          : Math.floor(tileIndex / cols);
        const x0 = tileCol * edge;
        const y0 = tileRow * edge;
        const isActive = tileIndex < activeTiles;

        if (!isActive) {
          for (let iy = 0; iy < edge; iy++) {
            for (let ix = 0; ix < edge; ix++) {
              const gx = x0 + ix;
              const gy = y0 + iy;
              const p = (gy * imageWidth + gx) * 4;
              const checker = ((ix >> 2) ^ (iy >> 2)) & 1;
              const v = checker ? 18 : 10;
              pixels[p] = v;
              pixels[p + 1] = v;
              pixels[p + 2] = v;
              pixels[p + 3] = 255;
            }
          }
          continue;
        }

        const nodeOffset = tileIndex * 4;
        const level = nodeData[nodeOffset] ?? 0;
        const tileSize = rootSizeValue / Math.pow(2, level);
        const stepWorld = tileSize / innerSegments;
        const inv2Step = 0.5 / Math.max(1e-6, stepWorld);
        const base = tileIndex * verticesPerTile;

        for (let iy = 0; iy < edge; iy++) {
          const yUp = iy > 0 ? iy - 1 : iy;
          const yDown = iy < edge - 1 ? iy + 1 : iy;
          for (let ix = 0; ix < edge; ix++) {
            const xLeft = ix > 0 ? ix - 1 : ix;
            const xRight = ix < edge - 1 ? ix + 1 : ix;
            const idx = base + iy * edge + ix;
            const h = data[idx] ?? 0;
            const hNorm = clamp01((h - minH) / denom);

            const hLeft = (data[base + iy * edge + xLeft] ?? 0) * elevationScaleValue;
            const hRight = (data[base + iy * edge + xRight] ?? 0) * elevationScaleValue;
            const hUp = (data[base + yUp * edge + ix] ?? 0) * elevationScaleValue;
            const hDown = (data[base + yDown * edge + ix] ?? 0) * elevationScaleValue;
            const dhdx = (hRight - hLeft) * inv2Step;
            const dhdz = (hDown - hUp) * inv2Step;

            let nx = -dhdx;
            let ny = 1;
            let nz = -dhdz;
            const nLen = Math.hypot(nx, ny, nz);
            if (nLen > 1e-6) {
              nx /= nLen;
              ny /= nLen;
              nz /= nLen;
            } else {
              nx = 0;
              ny = 1;
              nz = 0;
            }

            const nxEnc = encodeSigned(nx);
            const nyEnc = encodeSigned(ny);
            const nzEnc = encodeSigned(nz);

            const gx = x0 + ix;
            const gy = y0 + iy;
            const p = (gy * imageWidth + gx) * 4;
            if (tab === "height") {
              const v = Math.round(hNorm * 255);
              pixels[p] = v;
              pixels[p + 1] = v;
              pixels[p + 2] = v;
            } else if (tab === "normal") {
              pixels[p] = Math.round(nxEnc * 255);
              pixels[p + 1] = Math.round(nyEnc * 255);
              pixels[p + 2] = Math.round(nzEnc * 255);
            } else {
              pixels[p] = Math.round(hNorm * 255);
              pixels[p + 1] = Math.round(nxEnc * 255);
              pixels[p + 2] = Math.round(nzEnc * 255);
            }
            pixels[p + 3] = 255;
          }
        }
      }

      const canvas = canvasRef.current;
      if (!canvas) {
        running = false;
        return;
      }
      canvas.width = imageWidth;
      canvas.height = imageHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        running = false;
        return;
      }
      ctx.putImageData(new ImageData(pixels, imageWidth, imageHeight), 0, 0);
      ctx.imageSmoothingEnabled = false;
      imagePixelsRef.current = pixels;

      infoRef.current = {
        backend: storage.backendType,
        edge,
        activeTiles,
        tileCount,
        gridCols,
        gridRows,
        imageWidth,
        imageHeight,
        minHeight: minH,
        maxHeight: maxH,
      };
      forceRender((x) => (x + 1) | 0);

      running = false;
      if (queued) {
        queued = false;
        void redraw();
      }
    }

    const unsub = graph.on("run:finish", () => {
      void redraw();
    });
    void redraw();
    return () => unsub();
  }, [elevationScaleValue, graph, rendererRef, rootSizeValue, tab]);

  useEffect(() => {
    const selected = selectedTileIndex;
    const modalCanvas = modalCanvasRef.current;
    const pixels = imagePixelsRef.current;
    const info = infoRef.current;
    if (
      selected == null ||
      !modalCanvas ||
      !pixels ||
      info.edge <= 0 ||
      info.imageWidth <= 0 ||
      info.imageHeight <= 0 ||
      info.gridCols <= 0 ||
      selected < 0 ||
      selected >= info.tileCount
    ) {
      return;
    }

    const edge = info.edge;
    const tileCol = selected % info.gridCols;
    const tileRow = Math.floor(selected / info.gridCols);
    const x0 = tileCol * edge;
    const y0 = tileRow * edge;

    const tilePixels = new Uint8ClampedArray(edge * edge * 4);
    for (let iy = 0; iy < edge; iy++) {
      for (let ix = 0; ix < edge; ix++) {
        const src = ((y0 + iy) * info.imageWidth + (x0 + ix)) * 4;
        const dst = (iy * edge + ix) * 4;
        tilePixels[dst] = pixels[src] ?? 0;
        tilePixels[dst + 1] = pixels[src + 1] ?? 0;
        tilePixels[dst + 2] = pixels[src + 2] ?? 0;
        tilePixels[dst + 3] = pixels[src + 3] ?? 255;
      }
    }

    modalCanvas.width = edge;
    modalCanvas.height = edge;
    const ctx = modalCanvas.getContext("2d");
    if (!ctx) return;
    ctx.putImageData(new ImageData(tilePixels, edge, edge), 0, 0);
    ctx.imageSmoothingEnabled = false;
  }, [selectedTileIndex, tab]);

  function tileIndexFromPointer(clientX: number, clientY: number): number | null {
    const canvas = canvasRef.current;
    const info = infoRef.current;
    if (
      !canvas ||
      info.edge <= 0 ||
      info.gridCols <= 0 ||
      info.gridRows <= 0 ||
      info.imageWidth <= 0 ||
      info.imageHeight <= 0
    ) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const nx = (clientX - rect.left) / rect.width;
    const ny = (clientY - rect.top) / rect.height;
    if (nx < 0 || ny < 0 || nx >= 1 || ny >= 1) return null;

    const px = Math.floor(nx * info.imageWidth);
    const py = Math.floor(ny * info.imageHeight);
    const tileX = Math.floor(px / info.edge);
    const tileY = Math.floor(py / info.edge);
    const tileIndex = tileY * info.gridCols + tileX;
    if (tileIndex < 0 || tileIndex >= info.tileCount) return null;
    return tileIndex;
  }

  if (!showUI) return null;

  const info = infoRef.current;

  const panel = (
    <div className={containerClass} style={{ left: panelPos.x, top: panelPos.y }}>
      <div
        className="flex items-center justify-between mb-1.5 px-1 py-0.5 rounded bg-white/5 border border-white/10 cursor-move"
        onPointerDown={(event) => {
          draggingRef.current.active = true;
          draggingRef.current.target = "panel";
          draggingRef.current.startMouseX = event.clientX;
          draggingRef.current.startMouseY = event.clientY;
          draggingRef.current.startX = panelPos.x;
          draggingRef.current.startY = panelPos.y;
        }}
      >
        <div className="text-[10px] text-white/80" style={{ fontFamily: MONO_FONT }}>
          terrain field texture
        </div>
        <div className="text-[10px] text-white/50" style={{ fontFamily: MONO_FONT }}>
          drag
        </div>
      </div>

      <div className="flex items-center gap-1.5 mb-1.5">
        <button
          type="button"
          onClick={() => setTab("all")}
          className={`px-2 py-0.5 text-[10px] rounded border ${
            tab === "all"
              ? "bg-white/20 border-white/25 text-white"
              : "bg-white/5 border-white/15 text-white/70 hover:bg-white/10"
          }`}
        >
          all
        </button>
        <button
          type="button"
          onClick={() => setTab("height")}
          className={`px-2 py-0.5 text-[10px] rounded border ${
            tab === "height"
              ? "bg-white/20 border-white/25 text-white"
              : "bg-white/5 border-white/15 text-white/70 hover:bg-white/10"
          }`}
        >
          height
        </button>
        <button
          type="button"
          onClick={() => setTab("normal")}
          className={`px-2 py-0.5 text-[10px] rounded border ${
            tab === "normal"
              ? "bg-white/20 border-white/25 text-white"
              : "bg-white/5 border-white/15 text-white/70 hover:bg-white/10"
          }`}
        >
          normal
        </button>
      </div>

      <div className="w-[360px] max-w-[38vw] aspect-square border border-white/15 rounded overflow-hidden bg-black/30">
        <canvas
          ref={canvasRef}
          className="w-full h-full block cursor-crosshair"
          onMouseMove={(event) => {
            setHoverTileIndex(tileIndexFromPointer(event.clientX, event.clientY));
          }}
          onMouseLeave={() => {
            setHoverTileIndex(null);
          }}
          onClick={(event) => {
            const tileIndex = tileIndexFromPointer(event.clientX, event.clientY);
            if (tileIndex != null) {
              setSelectedTileIndex(tileIndex);
            }
          }}
        />
      </div>

      <div className="mt-1.5 text-[10px] leading-4 text-white/75" style={{ fontFamily: MONO_FONT }}>
        <div>backend: {info.backend}</div>
        <div>
          tiles: {info.activeTiles}/{info.tileCount} | edge: {info.edge}
        </div>
        <div>hover: {hoverTileIndex ?? "—"}</div>
        <div>
          image: {info.imageWidth}x{info.imageHeight}
        </div>
        <div>
          hRange: {info.minHeight.toFixed(3)}..{info.maxHeight.toFixed(3)}
        </div>
      </div>

    </div>
  );
  const modal =
    selectedTileIndex != null ? (
      <div
        className="fixed inset-0 z-50 bg-black/70"
        onClick={() => setSelectedTileIndex(null)}
      >
        <div
          className="absolute bg-zinc-900 border border-white/15 rounded-md p-3 w-[min(92vw,620px)]"
          style={{
            left: (modalPos?.x ?? 24) + "px",
            top: (modalPos?.y ?? 24) + "px",
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <div
            className="flex items-center justify-between gap-2 mb-2 px-1 py-0.5 rounded bg-white/5 border border-white/10 cursor-move"
            onPointerDown={(event) => {
              draggingRef.current.active = true;
              draggingRef.current.target = "modal";
              draggingRef.current.startMouseX = event.clientX;
              draggingRef.current.startMouseY = event.clientY;
              draggingRef.current.startX = modalPos?.x ?? 24;
              draggingRef.current.startY = modalPos?.y ?? 24;
            }}
          >
            <div
              className="text-[11px] text-white/80"
              style={{ fontFamily: MONO_FONT }}
            >
              tile {selectedTileIndex} ({selectedTileIndex < info.activeTiles ? "active" : "inactive"})
            </div>
            <button
              type="button"
              className="px-2 py-0.5 text-[10px] rounded border bg-white/5 border-white/15 text-white/75 hover:bg-white/10"
              onClick={() => setSelectedTileIndex(null)}
            >
              close
            </button>
          </div>

          <div className="w-full flex items-center justify-center border border-white/10 rounded bg-black/40 p-2">
            <canvas
              ref={modalCanvasRef}
              className="block w-[min(72vw,520px)] h-auto aspect-square"
            />
          </div>

          <div className="flex items-center justify-between mt-2">
            <button
              type="button"
              className="px-2 py-1 text-[10px] rounded border bg-white/5 border-white/15 text-white/75 hover:bg-white/10"
              onClick={() => {
                const total = Math.max(1, info.tileCount);
                setSelectedTileIndex((prev) =>
                  prev == null ? 0 : (prev - 1 + total) % total,
                );
              }}
            >
              prev
            </button>
            <div
              className="text-[10px] text-white/70"
              style={{ fontFamily: MONO_FONT }}
            >
              {selectedTileIndex + 1} / {Math.max(1, info.tileCount)}
            </div>
            <button
              type="button"
              className="px-2 py-1 text-[10px] rounded border bg-white/5 border-white/15 text-white/75 hover:bg-white/10"
              onClick={() => {
                const total = Math.max(1, info.tileCount);
                setSelectedTileIndex((prev) =>
                  prev == null ? 0 : (prev + 1) % total,
                );
              }}
            >
              next
            </button>
          </div>
        </div>
      </div>
    ) : null;

  const content = (
    <>
      {panel}
      {modal}
    </>
  );
  return portalTarget ? createPortal(content, portalTarget) : content;
}
