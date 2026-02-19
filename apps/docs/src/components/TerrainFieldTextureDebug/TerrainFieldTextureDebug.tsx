"use client";

import { useExamplesCanvas } from "@/components/ExamplesCanvas";
import {
  createTerrainFieldTextureTask,
  leafGpuBufferTask,
  loadTerrainField,
} from "@hello-terrain/three";
import type { Graph, TaskRef } from "@hello-terrain/work";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Fn,
  float,
  floor,
  fract,
  int,
  max,
  select,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";
import type { WebGPURenderer } from "three/webgpu";

export type TerrainFieldTextureDebugProps = {
  graph: Graph;
  rendererTask?: TaskRef<WebGPURenderer | null>;
  onClose?: () => void;
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
};

const MONO_FONT =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

export function TerrainFieldTextureDebug({
  graph,
  rendererTask,
  onClose,
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
  });
  const [tab, setTab] = useState<ChannelTab>("all");
  const [hoverTileIndex, setHoverTileIndex] = useState<number | null>(null);
  const [selectedTileIndex, setSelectedTileIndex] = useState<number | null>(
    null,
  );
  const [panelPos, setPanelPos] = useState({ x: 18, y: 18 });
  const [canvasSize, setCanvasSize] = useState(360);
  const [modalPos, setModalPos] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [, forceRender] = useState(0);
  const modalCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewPassRef = useRef<{
    backendType: string;
    texture: unknown;
    scene: THREE.Scene;
    camera: THREE.OrthographicCamera;
    material: THREE.MeshBasicNodeMaterial;
    renderTarget: THREE.RenderTarget;
    uMode: any;
    uEdge: any;
    uGridCols: any;
    uGridRows: any;
    uTileCount: any;
    uActiveTiles: any;
    uViewMode: any;
    uFocusedTile: any;
  } | null>(null);
  const draggingRef = useRef<{
    active: boolean;
    target: "panel" | "modal" | "resize" | null;
    startMouseX: number;
    startMouseY: number;
    startX: number;
    startY: number;
    startSize: number;
  }>({
    active: false,
    target: null,
    startMouseX: 0,
    startMouseY: 0,
    startX: 0,
    startY: 0,
    startSize: 0,
  });

  const containerClass = useMemo(() => {
    const base =
      "fixed z-40 pointer-events-auto select-none bg-black/45 border border-white/10 backdrop-blur-sm rounded-md p-2";
    return `${base} ${className ?? ""}`;
  }, [className]);

  function ensurePreviewPass(storage: {
    backendType: string;
    texture: unknown;
  }) {
    const existing = previewPassRef.current;
    if (
      existing &&
      existing.backendType === storage.backendType &&
      existing.texture === storage.texture
    ) {
      return existing;
    }

    const uMode = uniform(0, "int");
    const uEdge = uniform(1);
    const uGridCols = uniform(1);
    const uGridRows = uniform(1);
    const uTileCount = uniform(1, "int");
    const uActiveTiles = uniform(1, "int");
    const uViewMode = uniform(0, "int");
    const uFocusedTile = uniform(0, "int");

    const colorNode = Fn(() => {
      const uv0 = uv();
      const localUV = vec2(uv0.x, float(1).sub(uv0.y));
      const viewMode = int(uViewMode);
      const grid = vec2(uGridCols, uGridRows);
      const gridPos = localUV.mul(grid);
      const gridTileX = floor(gridPos.x).toInt();
      const gridTileY = floor(gridPos.y).toInt();
      const gridTileIndex = gridTileY
        .mul(int(uGridCols))
        .add(gridTileX)
        .toInt();
      const tileIndex = select(
        viewMode.equal(int(1)),
        int(uFocusedTile),
        gridTileIndex,
      ).toInt();
      const tileUV = select(viewMode.equal(int(1)), localUV, fract(gridPos));
      const uvSafe = tileUV.mul(float(0.999999));
      const ix = floor(uvSafe.x.mul(uEdge)).toInt();
      const iy = floor(uvSafe.y.mul(uEdge)).toInt();

      const sample = loadTerrainField(storage as any, ix, iy, tileIndex);

      const hNorm = sample.r.mul(0.5).add(0.5).clamp();
      const nx = sample.g;
      const nz = sample.b;
      const ny = max(float(0), float(1).sub(nx.mul(nx)).sub(nz.mul(nz))).sqrt();

      const nxEnc = nx.mul(0.5).add(0.5).clamp();
      const nyEnc = ny.mul(0.5).add(0.5).clamp();
      const nzEnc = nz.mul(0.5).add(0.5).clamp();

      const colAll = vec3(hNorm, nxEnc, nzEnc);
      const colHeight = vec3(hNorm, hNorm, hNorm);
      const colNormal = vec3(nxEnc, nyEnc, nzEnc);
      const mode = int(uMode);
      const colored = select(
        mode.equal(int(2)),
        colNormal,
        select(mode.equal(int(1)), colHeight, colAll),
      );

      const pixelX = floor(localUV.x.mul(float(uGridCols).mul(uEdge)));
      const pixelY = floor(localUV.y.mul(float(uGridRows).mul(uEdge)));
      const checkerVal = pixelX.add(pixelY).mod(float(2));
      const emptyTile = vec3(
        select(checkerVal.lessThan(float(1)), float(0.08), float(0.12)),
      );
      const isActive = tileIndex
        .greaterThanEqual(int(0))
        .and(tileIndex.lessThan(uActiveTiles));
      return vec4(select(isActive, colored, emptyTile), float(1));
    })();

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = colorNode;
    material.transparent = false;

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    scene.add(quad);
    const renderTarget = new THREE.RenderTarget(1, 1, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
    });

    const pass = {
      backendType: storage.backendType,
      texture: storage.texture,
      scene,
      camera,
      material,
      renderTarget,
      uMode,
      uEdge,
      uGridCols,
      uGridRows,
      uTileCount,
      uActiveTiles,
      uViewMode,
      uFocusedTile,
    };
    previewPassRef.current = pass;
    return pass;
  }

  const gpuCtxMap = useRef(
    new WeakMap<
      HTMLCanvasElement,
      { ctx: GPUCanvasContext; w: number; h: number }
    >(),
  );
  const blitPipelineRef = useRef<{
    device: GPUDevice;
    pipeline: GPURenderPipeline;
  } | null>(null);

  function getBlitPipeline(device: GPUDevice): GPURenderPipeline {
    if (blitPipelineRef.current?.device === device) {
      return blitPipelineRef.current.pipeline;
    }
    const module = device.createShaderModule({
      code: `
@group(0) @binding(0) var src: texture_2d<f32>;

@vertex fn vs(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4f {
  let x = f32(i32(vid & 1u)) * 4.0 - 1.0;
  let y = f32(i32(vid >> 1u)) * 4.0 - 1.0;
  return vec4f(x, y, 0.0, 1.0);
}

@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  return textureLoad(src, vec2u(pos.xy), 0);
}`,
    });
    const format = navigator.gpu.getPreferredCanvasFormat();
    const pipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vs" },
      fragment: { module, entryPoint: "fs", targets: [{ format }] },
    });
    blitPipelineRef.current = { device, pipeline };
    return pipeline;
  }

  function blitToCanvas(
    renderer: WebGPURenderer,
    renderTarget: THREE.RenderTarget,
    canvas: HTMLCanvasElement,
    width: number,
    height: number,
  ): boolean {
    const backend = (renderer as any).backend as
      | { device?: GPUDevice; get?: (r: unknown) => { texture?: GPUTexture } }
      | undefined;
    const device = backend?.device;
    if (!device || !backend.get) return false;

    const texData = backend.get(renderTarget.texture);
    const srcTexture = texData?.texture;
    if (!srcTexture) return false;

    let entry = gpuCtxMap.current.get(canvas);
    if (!entry) {
      const ctx = (canvas as any).getContext(
        "webgpu",
      ) as GPUCanvasContext | null;
      if (!ctx) return false;
      entry = { ctx, w: 0, h: 0 };
      gpuCtxMap.current.set(canvas, entry);
    }

    if (entry.w !== width || entry.h !== height) {
      canvas.width = width;
      canvas.height = height;
      entry.ctx.configure({
        device,
        format: navigator.gpu.getPreferredCanvasFormat(),
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
      entry.w = width;
      entry.h = height;
    }

    const pipeline = getBlitPipeline(device);
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: srcTexture.createView() }],
    });
    const dstTexture = entry.ctx.getCurrentTexture();
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: dstTexture.createView(),
          loadOp: "clear" as GPULoadOp,
          storeOp: "store" as GPUStoreOp,
        },
      ],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    device.queue.submit([encoder.finish()]);
    return true;
  }

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
      } else if (draggingRef.current.target === "resize") {
        const delta = Math.max(dx, dy);
        const maxSize = Math.min(window.innerWidth * 0.8, window.innerHeight * 0.8);
        setCanvasSize(Math.max(120, Math.min(maxSize, draggingRef.current.startSize + delta)));
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
    let lastRedrawTime = 0;
    const THROTTLE_MS = 16;

    function updateInfo() {
      const storage = graph.peek(createTerrainFieldTextureTask);
      const leaves = graph.peek(leafGpuBufferTask);
      if (!storage || !leaves) return;
      const edge = storage.edgeVertexCount;
      const tileCount = storage.tileCount;
      const activeTiles = Math.min(leaves.count, tileCount);
      const atlasLike = storage.backendType === "atlas";
      const cols = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, tileCount))));
      const rows = Math.max(1, Math.ceil(Math.max(1, tileCount) / cols));
      const atlasCols = Math.max(
        1,
        Math.ceil(Math.sqrt(Math.max(1, tileCount))),
      );
      const gridCols = atlasLike ? atlasCols : cols;
      const gridRows = atlasLike ? atlasCols : rows;
      infoRef.current = {
        backend: storage.backendType,
        edge,
        activeTiles,
        tileCount,
        gridCols,
        gridRows,
        imageWidth: gridCols * Math.max(1, edge),
        imageHeight: gridRows * Math.max(1, edge),
      };
      forceRender((x) => (x + 1) | 0);
    }

    function redraw() {
      if (running) {
        queued = true;
        return;
      }
      running = true;

      updateInfo();

      const info = infoRef.current;
      const canvas = canvasRef.current;
      const storage = graph.peek(createTerrainFieldTextureTask);
      const renderer = rendererTask
        ? (graph.peek(rendererTask) as WebGPURenderer | undefined)
        : undefined;

      if (
        !canvas ||
        !storage ||
        !renderer ||
        info.edge <= 0 ||
        info.tileCount <= 0 ||
        info.activeTiles <= 0
      ) {
        running = false;
        return;
      }

      const {
        edge,
        gridCols,
        gridRows,
        tileCount,
        activeTiles,
        imageWidth,
        imageHeight,
      } = info;

      const preview = ensurePreviewPass(storage);
      preview.uMode.value = tab === "height" ? 1 : tab === "normal" ? 2 : 0;
      preview.uEdge.value = edge;
      preview.uGridCols.value = gridCols;
      preview.uGridRows.value = gridRows;
      preview.uTileCount.value = tileCount;
      preview.uActiveTiles.value = activeTiles;
      preview.uViewMode.value = 0;
      preview.uFocusedTile.value = 0;
      preview.renderTarget.setSize(imageWidth, imageHeight);
      renderer.setRenderTarget(preview.renderTarget);
      renderer.render(preview.scene, preview.camera);
      renderer.setRenderTarget(null);

      blitToCanvas(
        renderer,
        preview.renderTarget,
        canvas,
        imageWidth,
        imageHeight,
      );

      const modalCanvas = modalCanvasRef.current;
      if (selectedTileIndex != null && modalCanvas) {
        preview.uViewMode.value = 1;
        preview.uFocusedTile.value = selectedTileIndex;
        preview.renderTarget.setSize(edge, edge);
        renderer.setRenderTarget(preview.renderTarget);
        renderer.render(preview.scene, preview.camera);
        renderer.setRenderTarget(null);

        blitToCanvas(renderer, preview.renderTarget, modalCanvas, edge, edge);
      }

      running = false;
      if (queued) {
        queued = false;
        redraw();
      }
    }

    const unsub = graph.on("run:finish", () => {
      const now = performance.now();
      if (now - lastRedrawTime < THROTTLE_MS) {
        updateInfo();
        return;
      }
      lastRedrawTime = now;
      redraw();
    });
    redraw();
    return () => unsub();
  }, [graph, rendererTask, selectedTileIndex, tab]);

  function tileIndexFromPointer(
    clientX: number,
    clientY: number,
  ): number | null {
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
    <div
      className={containerClass}
      style={{ left: panelPos.x, top: panelPos.y }}
    >
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
        <div
          className="text-[10px] text-white/80"
          style={{ fontFamily: MONO_FONT }}
        >
          terrain field texture
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className="text-[10px] text-white/40"
            style={{ fontFamily: MONO_FONT }}
          >
            drag
          </div>
          {onClose && (
            <button
              type="button"
              className="flex items-center justify-center w-4 h-4 rounded hover:bg-white/15 text-white/50 hover:text-white/90 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              aria-label="Close"
            >
              <svg
                width="8"
                height="8"
                viewBox="0 0 8 8"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              >
                <line x1="1" y1="1" x2="7" y2="7" />
                <line x1="7" y1="1" x2="1" y2="7" />
              </svg>
            </button>
          )}
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

      <div
        className="relative border border-white/15 rounded overflow-hidden bg-black/30"
        style={{ width: canvasSize, height: canvasSize }}
      >
        <canvas
          ref={canvasRef}
          className="w-full h-full block cursor-crosshair"
          style={{ imageRendering: "pixelated" }}
          onMouseMove={(event) => {
            setHoverTileIndex(
              tileIndexFromPointer(event.clientX, event.clientY),
            );
          }}
          onMouseLeave={() => {
            setHoverTileIndex(null);
          }}
          onClick={(event) => {
            const tileIndex = tileIndexFromPointer(
              event.clientX,
              event.clientY,
            );
            if (tileIndex != null) {
              setSelectedTileIndex(tileIndex);
            }
          }}
        />
        <div
          className="absolute bottom-0 right-0 w-3.5 h-3.5 cursor-nwse-resize"
          onPointerDown={(event) => {
            event.stopPropagation();
            draggingRef.current.active = true;
            draggingRef.current.target = "resize";
            draggingRef.current.startMouseX = event.clientX;
            draggingRef.current.startMouseY = event.clientY;
            draggingRef.current.startSize = canvasSize;
          }}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            className="absolute bottom-0.5 right-0.5 text-white/30"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
          >
            <line x1="9" y1="1" x2="1" y2="9" />
            <line x1="9" y1="5" x2="5" y2="9" />
          </svg>
        </div>
      </div>

      <div
        className="mt-1.5 text-[10px] leading-4 text-white/75"
        style={{ fontFamily: MONO_FONT }}
      >
        <div>backend: {info.backend}</div>
        <div>
          tiles: {info.activeTiles}/{info.tileCount} | edge: {info.edge}
        </div>
        <div>hover: {hoverTileIndex ?? "—"}</div>
        <div>
          image: {info.imageWidth}x{info.imageHeight}
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
              tile {selectedTileIndex} (
              {selectedTileIndex < info.activeTiles ? "active" : "inactive"})
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
              style={{ imageRendering: "pixelated" }}
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
