"use client";

import { ExamplesCanvas } from "@/components/ExamplesCanvas";
import { FpsDebug } from "@/components/FpsDebug";
import { RunTimingBars } from "@/components/RunTimingBars";
import { TerrainTileDebug } from "@/components/TerrainTileDebug";
import {
  CharacterController,
  type CharacterControllerSnapshot,
} from "@/examples/character/CharacterController";
import {
  createStampedFbmElevation,
  type TerrainStamp,
  useTerrainStampFieldSuspense,
} from "@/examples/terrain/terrainStamps";
import {
  resolveTerrainMaterialAppearance,
  tileColorsLevaControl,
} from "@/examples/terrain/tileInstanceColor";
import {
  Terrain,
  TerrainProvider,
  useTerrain,
  type TerrainHandle,
} from "@hello-terrain/react";
import {
  createGpuProfiler,
  type GpuFrameTimings,
  type TerrainGraph,
} from "@hello-terrain/three";
import { Environment } from "@react-three/drei";
import { Canvas, extend, useFrame, useThree } from "@react-three/fiber";
import { useControls, useCreateStore } from "leva";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { WebGPURendererParameters } from "three/src/renderers/webgpu/WebGPURenderer.js";
import * as THREE from "three/webgpu";

type LevaStore = ReturnType<typeof useCreateStore>;

extend(THREE as any);

const QUADTREE_ORIGIN_HYSTERESIS = 0.35;
const QUADTREE_ORIGIN_SNAP = 0.25;
const CHARACTER_RESIDENCY_RADIUS = 96;

type GpuDiagnosticsSnapshot = {
  supported: boolean;
  renderMs: number | null;
  computeMs: number | null;
  totalMs: number | null;
  renderQueryCount: number;
  computeQueryCount: number;
  computePasses: GpuFrameTimings["computePasses"];
  visibleSlotCount: number;
  residentSlotCount: number;
  supportSlotCount: number;
  dirtyResidentCount: number;
  allocatedCount: number;
  reusedCount: number;
  evictedCount: number;
  drawTerrain: boolean;
  runCompute: boolean;
  runReadback: boolean;
};

function snapToStep(value: number, step: number) {
  return Math.round(value / step) * step;
}

function formatMs(value: number | null) {
  return value === null ? "-" : `${value.toFixed(2)}ms`;
}

function formatDispatchSize(
  dispatchSize: GpuFrameTimings["computePasses"][number]["dispatchSize"],
) {
  if (Array.isArray(dispatchSize)) return dispatchSize.join("x");
  return dispatchSize ?? "-";
}

function CharacterHud({
  snapshot,
}: {
  snapshot: CharacterControllerSnapshot | null;
}) {
  return (
    <>
      <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/80">
        <div className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
      </div>
      <div className="pointer-events-none absolute left-2 top-14 z-10 rounded-md border border-white/10 bg-black/55 px-3 py-2 text-xs text-white backdrop-blur-sm md:left-4 md:top-16">
        <div className="font-medium">Character Controller</div>
        <div>state: {snapshot?.state ?? "booting"}</div>
        <div>grounded: {snapshot?.isGrounded ? "yes" : "no"}</div>
        <div>
          pointer lock: {snapshot?.isPointerLocked ? "locked" : "click canvas"}
        </div>
        <div>
          speed:{" "}
          {snapshot
            ? Math.hypot(snapshot.velocity.x, snapshot.velocity.z).toFixed(2)
            : "0.00"}
        </div>
        <div>
          position:{" "}
          {snapshot
            ? `${snapshot.position.x.toFixed(1)}, ${snapshot.position.y.toFixed(1)}, ${snapshot.position.z.toFixed(1)}`
            : "0.0, 0.0, 0.0"}
        </div>
        <div className="mt-1 text-white/70">
          WASD move, Shift sprint, Space jump
        </div>
        <div className="text-white/70">Fullscreen + wheel zooms camera</div>
      </div>
    </>
  );
}

function TerrainGpuDiagnosticsProbe({
  terrain,
  enabled,
  drawTerrain,
  runCompute,
  runReadback,
  onUpdate,
}: {
  terrain: TerrainHandle;
  enabled: boolean;
  drawTerrain: boolean;
  runCompute: boolean;
  runReadback: boolean;
  onUpdate: (snapshot: GpuDiagnosticsSnapshot) => void;
}) {
  const { gl } = useThree();
  const profilerRef = useRef<ReturnType<typeof createGpuProfiler> | null>(null);
  const rendererRef = useRef<THREE.WebGPURenderer | null>(null);
  const supportedRef = useRef(false);
  const resolvingRef = useRef(false);
  const lastEmitAtRef = useRef(0);

  useEffect(() => {
    return () => {
      profilerRef.current?.dispose();
      profilerRef.current = null;
      rendererRef.current = null;
      supportedRef.current = false;
    };
  }, []);

  useFrame(() => {
    if (!enabled) return;
    const renderer = gl as unknown as THREE.WebGPURenderer;
    if (rendererRef.current !== renderer) {
      profilerRef.current?.dispose();
      profilerRef.current = createGpuProfiler(renderer);
      rendererRef.current = renderer;
      supportedRef.current = profilerRef.current.enable();
    }

    const now = performance.now();
    if (resolvingRef.current || now - lastEmitAtRef.current < 250) return;
    lastEmitAtRef.current = now;
    resolvingRef.current = true;

    const slotTelemetry = terrain.graph.peek(terrain.tasks.tileSlotUpdate)?.telemetry;
    void profilerRef.current
      ?.sample()
      .then((timing) => {
        onUpdate({
          supported: supportedRef.current,
          renderMs: timing?.renderMs ?? null,
          computeMs: timing?.computeMs ?? null,
          totalMs: timing?.totalMs ?? null,
          renderQueryCount: timing?.renderQueryCount ?? 0,
          computeQueryCount: timing?.computeQueryCount ?? 0,
          computePasses: timing?.computePasses ?? [],
          visibleSlotCount: slotTelemetry?.visibleSlotCount ?? 0,
          residentSlotCount: slotTelemetry?.residentSlotCount ?? 0,
          supportSlotCount: slotTelemetry?.supportSlotCount ?? 0,
          dirtyResidentCount: slotTelemetry?.dirtyResidentCount ?? 0,
          allocatedCount: slotTelemetry?.allocatedCount ?? 0,
          reusedCount: slotTelemetry?.reusedCount ?? 0,
          evictedCount: slotTelemetry?.evictedCount ?? 0,
          drawTerrain,
          runCompute,
          runReadback,
        });
      })
      .finally(() => {
        resolvingRef.current = false;
      });
  });

  return null;
}

function TerrainGpuDiagnosticsPanel({
  snapshot,
}: {
  snapshot: GpuDiagnosticsSnapshot | null;
}) {
  const passes = snapshot?.computePasses.slice(0, 4) ?? [];
  return (
    <div className="pointer-events-auto rounded-md border border-white/10 bg-black/55 px-2 py-1.5 text-[10px] leading-4 text-white/80 backdrop-blur-sm">
      <div className="flex justify-between gap-3 font-medium text-white">
        <span>GPU</span>
        <span>{snapshot?.supported ? "timestamps" : "no timestamps"}</span>
      </div>
      <div className="grid grid-cols-2 gap-x-3">
        <span>total</span>
        <span className="text-right tabular-nums">{formatMs(snapshot?.totalMs ?? null)}</span>
        <span>compute</span>
        <span className="text-right tabular-nums">{formatMs(snapshot?.computeMs ?? null)}</span>
        <span>render</span>
        <span className="text-right tabular-nums">{formatMs(snapshot?.renderMs ?? null)}</span>
        <span>queries</span>
        <span className="text-right tabular-nums">
          {snapshot ? `${snapshot.computeQueryCount}c/${snapshot.renderQueryCount}r` : "-"}
        </span>
        <span>slots</span>
        <span className="text-right tabular-nums">
          {snapshot
            ? `${snapshot.visibleSlotCount}v/${snapshot.residentSlotCount}r`
            : "-"}
        </span>
        <span>dirty</span>
        <span className="text-right tabular-nums">
          {snapshot
            ? `${snapshot.dirtyResidentCount}d/${snapshot.supportSlotCount}s`
            : "-"}
        </span>
        <span>alloc</span>
        <span className="text-right tabular-nums">
          {snapshot
            ? `${snapshot.allocatedCount}a/${snapshot.reusedCount}u`
            : "-"}
        </span>
      </div>
      <div className="mt-1 border-t border-white/10 pt-1">
        <div className="flex justify-between gap-2 text-white/60">
          <span>{snapshot?.drawTerrain ? "draw on" : "draw off"}</span>
          <span>{snapshot?.runCompute ? "compute on" : "compute off"}</span>
          <span>{snapshot?.runReadback ? "readback on" : "readback off"}</span>
        </div>
        {passes.length > 0 ? (
          <div className="mt-1 space-y-0.5">
            {passes.map((pass, index) => (
              <div key={`${pass.name}-${index}`} className="flex justify-between gap-2">
                <span className="max-w-[9rem] truncate">{pass.name}</span>
                <span className="shrink-0 tabular-nums text-white/65">
                  {formatDispatchSize(pass.dispatchSize)} {formatMs(pass.durationMs)}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RaycastCharacterControllerSceneImpl({
  store,
  onCharacterUpdate,
  onGraphReady,
  onGpuDiagnosticsUpdate,
}: {
  store: LevaStore;
  onCharacterUpdate: (snapshot: CharacterControllerSnapshot) => void;
  onGraphReady: (graph: TerrainGraph) => void;
  onGpuDiagnosticsUpdate: (snapshot: GpuDiagnosticsSnapshot) => void;
}) {
  const characterSnapshotRef = useRef<CharacterControllerSnapshot | null>(null);

  const controls = useControls(
    "Raycast Character Controller",
    {
      rootSize: {
        value: 4096,
        min: 128,
        max: 4096,
        step: 32,
        label: "root size",
      },
      maxLevel: {
        value: 6,
        min: 2,
        max: 20,
        step: 1,
        label: "max level",
      },
      maxNodes: {
        value: 1024,
        min: 128,
        max: 4096,
        step: 1,
        label: "max nodes",
      },
      skirtScale: {
        value: 100,
        min: 0,
        max: 1000,
        step: 1,
        label: "skirt scale",
      },
      elevationScale: {
        value: 200,
        min: 1,
        max: 128,
        step: 1,
        label: "elevation scale",
      },
      innerTileSegments: {
        value: 64,
        min: 3,
        max: 64,
        step: 1,
        label: "tile segments",
      },
      noiseScale: {
        value: 0.001,
        min: 0.001,
        max: 0.5,
        step: 0.001,
        label: "noise scale",
      },
      cameraRadius: {
        value: 4.8,
        min: 2,
        max: 12,
        step: 0.1,
        label: "camera radius",
      },
      cameraMinRadius: {
        value: 1.75,
        min: 0.75,
        max: 4,
        step: 0.05,
        label: "camera min radius",
      },
      sensitivityX: {
        value: 0.16,
        min: 0.01,
        max: 0.5,
        step: 0.01,
        label: "mouse sensitivity x",
      },
      sensitivityY: {
        value: 0.12,
        min: 0.01,
        max: 0.5,
        step: 0.01,
        label: "mouse sensitivity y",
      },
      wireframe: {
        value: false,
      },
      drawTerrain: {
        value: true,
        label: "draw terrain",
      },
      runCompute: {
        value: true,
        label: "run compute",
      },
      runReadback: {
        value: true,
        label: "run readback",
      },
      runGpuSpatialIndex: {
        value: true,
        label: "gpu spatial index",
      },
      profileGpu: {
        value: true,
        label: "profile gpu",
      },
      tileColors: tileColorsLevaControl,
    },
    { store },
  );

  const terrainStamps = useMemo<TerrainStamp[]>(
    () => [
      {
        assetId: "hills003",
        center: [0, 0],
        radius: 760,
        height: 0.06,
        falloff: 0.3,
        stretch: [1.16, 1.08],
        rotation: Math.PI * 0.06,
      },
      {
        assetId: "plateausTalus013",
        center: [280, 160],
        radius: 356,
        height: 1,
        falloff: 0.12,
        stretch: [1.2, 0.98],
        rotation: Math.PI * 0.1,
      },
      {
        assetId: "plateausTalus014",
        center: [-336, 220],
        radius: 332,
        height: 0.8,
        falloff: 0.12,
        stretch: [1.14, 0.94],
        rotation: -Math.PI * 0.14,
      },
      {
        assetId: "plateausTalus015",
        center: [228, -332],
        radius: 344,
        height: 0.4,
        falloff: 0.11,
        stretch: [1.14, 1.04],
        rotation: Math.PI * 0.22,
      },
      {
        assetId: "plateausTalus016",
        center: [-500, -500],
        radius: 368,
        height: 1.5,
        falloff: 0.11,
        stretch: [2, 2],
        rotation: -Math.PI * 0.18,
      },
      {
        assetId: "ridged006",
        center: [1000, 1000],
        radius: 484,
        height: 2,
        falloff: 0.08,
        stretch: [5, 5],
        rotation: Math.PI * 0.3,
      },
      {
        assetId: "ridged008",
        center: [-2000, -2000],
        radius: 512,
        height: 1.5,
        falloff: 0.08,
        stretch: [2.58, 1],
        rotation: -Math.PI * 0.24,
      },
      {
        assetId: "terrace018",
        center: [548, -88],
        radius: 348,
        height: 0.2,
        falloff: 0.1,
        stretch: [1.08, 1.18],
        rotation: Math.PI * 0.18,
      },
      {
        assetId: "terrace019",
        center: [-604, 48],
        radius: 364,
        height: 0.18,
        falloff: 0.1,
        stretch: [1.22, 0.98],
        rotation: -Math.PI * 0.08,
      },
    ],
    [],
  );
  const terrainStampField = useTerrainStampFieldSuspense(terrainStamps, {
    worldSpan: Math.max(controls.rootSize, 2048),
    resolution: 1024,
  });
  const stampFieldTexture = terrainStampField.texture;
  const stampFieldScale = terrainStampField.scale;
  const stampFieldWorldSpan = terrainStampField.worldSpan;

  const elevation = useMemo(
    () =>
      createStampedFbmElevation({
        noiseScale: controls.noiseScale,
        noiseFloor: 0.3,
        stampFieldTexture,
        stampFieldScale,
        stampFieldWorldSpan,
      }),
    [
      controls.noiseScale,
      stampFieldScale,
      stampFieldTexture,
      stampFieldWorldSpan,
    ],
  );

  const getCameraOrigin = useCallback(() => {
    const playerPosition = characterSnapshotRef.current?.position;
    const nextOriginX = snapToStep(
      playerPosition?.x ?? 0,
      QUADTREE_ORIGIN_SNAP,
    );
    const nextOriginY = snapToStep(
      playerPosition?.y ?? 12,
      QUADTREE_ORIGIN_SNAP,
    );
    const nextOriginZ = snapToStep(
      playerPosition?.z ?? 0,
      QUADTREE_ORIGIN_SNAP,
    );
    return { x: nextOriginX, y: nextOriginY, z: nextOriginZ };
  }, []);

  const getResidencyAnchors = useCallback(() => {
    const playerPosition = characterSnapshotRef.current?.position;
    return [
      {
        position: {
          x: playerPosition?.x ?? 0,
          y: playerPosition?.y ?? 12,
          z: playerPosition?.z ?? 0,
        },
        radius: CHARACTER_RESIDENCY_RADIUS,
      },
    ];
  }, []);

  const terrain = useTerrain({
    rootSize: controls.rootSize,
    maxLevel: controls.maxLevel,
    maxNodes: controls.maxNodes,
    innerTileSegments: controls.innerTileSegments,
    skirtScale: controls.skirtScale,
    elevationScale: controls.elevationScale,
    elevation,
    culling: {
      getCameraOrigin,
      originHysteresis: QUADTREE_ORIGIN_HYSTERESIS,
    },
    residency: {
      getAnchors: getResidencyAnchors,
      hysteresis: QUADTREE_ORIGIN_HYSTERESIS,
    },
    pipeline: {
      compute: controls.runCompute,
      readback: controls.runReadback,
      gpuSpatialIndex: controls.runGpuSpatialIndex,
    },
  });

  useEffect(() => {
    onGraphReady(terrain.graph);
  }, [onGraphReady, terrain.graph]);

  const materialAppearance = resolveTerrainMaterialAppearance({
    tileColors: controls.tileColors,
    wireframe: controls.wireframe,
  });

  return (
    <TerrainProvider value={terrain}>
      <CharacterController
        initialPosition={[0, 12, 0]}
        cameraRadius={controls.cameraRadius}
        cameraMinRadius={Math.min(
          controls.cameraMinRadius,
          controls.cameraRadius - 0.1,
        )}
        cameraSensitivityX={controls.sensitivityX}
        cameraSensitivityY={controls.sensitivityY}
        onUpdate={(snapshot) => {
          characterSnapshotRef.current = snapshot;
          onCharacterUpdate(snapshot);
        }}
      />

      <Terrain
        terrain={terrain}
        visible={controls.drawTerrain}
        castShadow
        receiveShadow
        innerTileSegments={controls.innerTileSegments}
        maxNodes={controls.maxNodes}
      >
        {({ positionNode }) => (
          <meshStandardNodeMaterial
            positionNode={positionNode}
            colorNode={materialAppearance.colorNode}
            wireframe={materialAppearance.wireframe}
            color={materialAppearance.color ?? "#5f7655"}
            metalness={0.03}
            roughness={0.94}
          />
        )}
      </Terrain>
      <TerrainGpuDiagnosticsProbe
        terrain={terrain}
        enabled={controls.profileGpu}
        drawTerrain={controls.drawTerrain}
        runCompute={controls.runCompute}
        runReadback={controls.runReadback}
        onUpdate={onGpuDiagnosticsUpdate}
      />
    </TerrainProvider>
  );
}

export default function RaycastCharacterControllerScene() {
  const store = useCreateStore();
  const [debugGraph, setDebugGraph] = useState<TerrainGraph | null>(null);
  const [snapshot, setSnapshot] = useState<CharacterControllerSnapshot | null>(
    null,
  );
  const [gpuDiagnostics, setGpuDiagnostics] =
    useState<GpuDiagnosticsSnapshot | null>(null);
  const pendingSnapshotRef = useRef<CharacterControllerSnapshot | null>(null);
  const lastSnapshotRenderAtRef = useRef(0);
  const snapshotRenderTimerRef = useRef<number | null>(null);

  const scheduleSnapshotRender = useCallback(() => {
    if (snapshotRenderTimerRef.current !== null) return;
    const now = performance.now();
    const delay = Math.max(0, 250 - (now - lastSnapshotRenderAtRef.current));
    snapshotRenderTimerRef.current = window.setTimeout(() => {
      snapshotRenderTimerRef.current = null;
      lastSnapshotRenderAtRef.current = performance.now();
      setSnapshot(pendingSnapshotRef.current);
    }, delay);
  }, []);

  const handleCharacterUpdate = useCallback(
    (nextSnapshot: CharacterControllerSnapshot) => {
      pendingSnapshotRef.current = nextSnapshot;
      scheduleSnapshotRender();
    },
    [scheduleSnapshotRender],
  );

  useEffect(() => {
    return () => {
      if (snapshotRenderTimerRef.current !== null) {
        window.clearTimeout(snapshotRenderTimerRef.current);
        snapshotRenderTimerRef.current = null;
      }
    };
  }, []);

  return (
    <ExamplesCanvas store={store}>
      <CharacterHud snapshot={snapshot} />
      {debugGraph ? (
        <div className="pointer-events-none absolute bottom-2 left-2 right-2 z-10 flex flex-col gap-1.5 md:bottom-4 md:left-auto md:right-4 md:max-w-xs">
          <RunTimingBars graph={debugGraph} />
          <div className="flex flex-row gap-1.5">
            <TerrainTileDebug graph={debugGraph} />
            <FpsDebug />
          </div>
          <TerrainGpuDiagnosticsPanel
            snapshot={gpuDiagnostics}
          />
        </div>
      ) : null}
      <Canvas
        className="touch-none relative left-0 top-0 h-full w-full"
        shadows
        gl={async (props) => {
          props.alpha = true;
          props.antialias = true;
          const renderer = new THREE.WebGPURenderer(
            props as WebGPURendererParameters,
          );
          renderer.shadowMap.enabled = true;
          renderer.shadowMap.type = THREE.PCFSoftShadowMap;
          await renderer.init();
          return renderer;
        }}
        camera={{ position: [0, 10, 10], fov: 60, near: 0.01, far: 4000 }}
        // dpr={[1.5, 1.5]}
        performance={{ min: 0.5 }}
      >
        <color attach="background" args={["#34A8CD"]} />
        <fog attach="fog" args={["#34A8CD", 90, 4000]} />
        <ambientLight intensity={0.45} />
        <hemisphereLight intensity={0.45} groundColor="#334433" />
        {/* <directionalLight
          castShadow
          intensity={2.5}
          position={[40, 110, 24]}
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
        /> */}
        <Environment preset="park" />
        <Suspense fallback={null}>
          <RaycastCharacterControllerSceneImpl
            store={store}
            onCharacterUpdate={handleCharacterUpdate}
            onGraphReady={setDebugGraph}
            onGpuDiagnosticsUpdate={setGpuDiagnostics}
          />
        </Suspense>
      </Canvas>
    </ExamplesCanvas>
  );
}
