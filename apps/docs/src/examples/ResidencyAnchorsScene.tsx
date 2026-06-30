"use client";

import { ExamplesCanvas } from "@/components/ExamplesCanvas";
import { FpsDebug } from "@/components/FpsDebug";
import { RunTimingBars } from "@/components/RunTimingBars";
import { TerrainTileDebug } from "@/components/TerrainTileDebug";
import { Terrain, useTerrain, type TerrainHandle } from "@hello-terrain/react";
import {
  quadtreeUpdate,
  tileSlotUpdateTask,
  type TerrainGraph,
  type TileSlotTelemetry,
} from "@hello-terrain/three";
import { OrbitControls } from "@react-three/drei";
import { Canvas, extend, useFrame } from "@react-three/fiber";
import { useCreateStore } from "leva";
import { useEffect, useMemo, useRef, useState } from "react";
import type { WebGPURendererParameters } from "three/src/renderers/webgpu/WebGPURenderer.js";
import { float } from "three/tsl";
import * as THREE from "three/webgpu";

extend(THREE as any);

const ROOT_SIZE = 180;
const MAX_NODES = 4096;
const INNER_TILE_SEGMENTS = 17;
const ANCHOR_RADIUS = 24;

type ResidencyStats = Pick<
  TileSlotTelemetry,
  | "visibleSlotCount"
  | "residentSlotCount"
  | "supportSlotCount"
  | "dirtyResidentCount"
  | "anchorResidentCount"
>;

function tileCenter(level: number, x: number, y: number) {
  const size = ROOT_SIZE / 2 ** level;
  return {
    x: x * size - ROOT_SIZE * 0.5 + size * 0.5,
    z: y * size - ROOT_SIZE * 0.5 + size * 0.5,
    size,
  };
}

function ResidencyStatsPanel({ graph }: { graph: TerrainGraph }) {
  const [stats, setStats] = useState<ResidencyStats>({
    visibleSlotCount: 0,
    residentSlotCount: 0,
    supportSlotCount: 0,
    dirtyResidentCount: 0,
    anchorResidentCount: 0,
  });

  useEffect(() => {
    return graph.on("run:finish", () => {
      const telemetry = graph.peek(tileSlotUpdateTask)?.telemetry;
      if (!telemetry) return;
      setStats({
        visibleSlotCount: telemetry.visibleSlotCount,
        residentSlotCount: telemetry.residentSlotCount,
        supportSlotCount: telemetry.supportSlotCount,
        dirtyResidentCount: telemetry.dirtyResidentCount,
        anchorResidentCount: telemetry.anchorResidentCount,
      });
    });
  }, [graph]);

  return (
    <div className="pointer-events-none absolute left-2 top-14 z-10 rounded-md border border-white/10 bg-black/55 px-3 py-2 text-xs text-white backdrop-blur-sm md:left-4 md:top-16">
      <div className="font-medium">Residency Anchors</div>
      <div>visible slots: {stats.visibleSlotCount}</div>
      <div>resident slots: {stats.residentSlotCount}</div>
      <div>support slots: {stats.supportSlotCount}</div>
      <div>anchor leaves: {stats.anchorResidentCount}</div>
      <div>dirty resident: {stats.dirtyResidentCount}</div>
    </div>
  );
}

function ResidentSupportOverlay({ graph }: { graph: TerrainGraph }) {
  const meshRef = useRef<THREE.InstancedMesh | null>(null);
  const matrix = useMemo(() => new THREE.Matrix4(), []);
  const position = useMemo(() => new THREE.Vector3(), []);
  const quaternion = useMemo(() => new THREE.Quaternion(), []);
  const scale = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    return graph.on("run:finish", () => {
      const mesh = meshRef.current;
      const slotUpdate = graph.peek(tileSlotUpdateTask);
      if (!mesh || !slotUpdate) return;

      const slots = slotUpdate.slots;
      const telemetry = slots.telemetry;
      const visible = new Set<number>();
      for (let i = 0; i < telemetry.visibleSlotCount; i += 1) {
        visible.add(slots.visibleSlots[i] ?? -1);
      }

      let count = 0;
      for (let i = 0; i < telemetry.residentSlotCount; i += 1) {
        const slot = slots.residentSlots[i] ?? -1;
        if (slot < 0 || visible.has(slot)) continue;

        const level = slots.slotLevel[slot] ?? 0;
        const tile = tileCenter(level, slots.slotX[slot] ?? 0, slots.slotY[slot] ?? 0);
        position.set(tile.x, 0.18, tile.z);
        scale.set(tile.size, 0.45, tile.size);
        matrix.compose(position, quaternion, scale);
        mesh.setMatrixAt(count, matrix);
        count += 1;
      }

      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
    });
  }, [graph, matrix, position, quaternion, scale]);

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, MAX_NODES]} frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial color="#f59e0b" wireframe transparent opacity={0.95} />
    </instancedMesh>
  );
}

function ResidencyAnchorTerrain({
  onTerrain,
}: {
  onTerrain: (terrain: TerrainHandle) => void;
}) {
  const helperRef = useRef<THREE.CameraHelper | null>(null);
  const anchorRef = useRef<THREE.Mesh | null>(null);
  const anchor = useMemo(() => new THREE.Vector3(), []);
  const cullingCamera = useMemo(() => {
    const camera = new THREE.PerspectiveCamera(24, 1.45, 18, 125);
    camera.position.set(72, 38, 72);
    camera.lookAt(26, 0, 26);
    camera.updateProjectionMatrix();
    return camera;
  }, []);
  const elevation = useMemo(() => () => float(0), []);

  const terrain = useTerrain({
    rootSize: ROOT_SIZE,
    maxLevel: 10,
    maxNodes: MAX_NODES,
    innerTileSegments: INNER_TILE_SEGMENTS,
    skirtScale: 8,
    elevationScale: 1,
    terrainFieldFilter: "nearest",
    elevation,
    camera: cullingCamera,
    getResidencyAnchors: () => [
      {
        position: { x: anchor.x, y: anchor.y, z: anchor.z },
        radius: ANCHOR_RADIUS,
      },
    ],
  });

  useEffect(() => {
    onTerrain(terrain);
  }, [onTerrain, terrain]);

  useEffect(() => {
    terrain.graph.set(quadtreeUpdate, (prev) => ({
      ...prev,
      mode: "distance" as const,
      distanceFactor: 1.4,
    }));
  }, [terrain.graph]);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime * 0.36;
    anchor.set(Math.cos(t) * 54, 0, Math.sin(t * 0.87) * 54);
    anchorRef.current?.position.copy(anchor);
    helperRef.current?.update();
  });

  return (
    <>
      <primitive object={cullingCamera} />
      <cameraHelper ref={helperRef} args={[cullingCamera]} />
      <Terrain terrain={terrain} frustumCulled={false}>
        {({ positionNode }) => (
          <meshStandardNodeMaterial
            positionNode={positionNode}
            wireframe
            color="#7dd3fc"
            roughness={0.9}
            metalness={0.02}
          />
        )}
      </Terrain>
      <ResidentSupportOverlay graph={terrain.graph} />
      <mesh ref={anchorRef} position={[54, 0, 0]}>
        <sphereGeometry args={[ANCHOR_RADIUS, 32, 12]} />
        <meshBasicMaterial color="#f97316" wireframe transparent opacity={0.75} />
      </mesh>
      <gridHelper args={[ROOT_SIZE, 18, "#7dd3fc", "#334155"]} position={[0, -0.04, 0]} />
    </>
  );
}

export default function ResidencyAnchorsScene() {
  const store = useCreateStore();
  const [graph, setGraph] = useState<TerrainGraph | null>(null);
  const handleTerrain = useMemo(
    () => (terrain: TerrainHandle) => {
      setGraph(terrain.graph);
    },
    [],
  );

  return (
    <ExamplesCanvas store={store}>
      {graph ? <ResidencyStatsPanel graph={graph} /> : null}
      <div className="pointer-events-none absolute bottom-2 left-2 right-2 z-10 flex flex-col gap-1.5 md:bottom-4 md:left-auto md:right-4 md:max-w-xs">
        {graph ? <RunTimingBars graph={graph} /> : null}
        <div className="flex flex-row gap-1.5">
          {graph ? <TerrainTileDebug graph={graph} /> : null}
          <FpsDebug />
        </div>
      </div>
      <Canvas
        className="touch-none relative left-0 top-0 h-full w-full"
        gl={async (props) => {
          props.alpha = true;
          props.antialias = true;
          const renderer = new THREE.WebGPURenderer(
            props as WebGPURendererParameters,
          );
          renderer.logarithmicDepthBuffer = true;
          await renderer.init();
          return renderer;
        }}
        camera={{
          near: 0.1,
          far: 500,
          position: [116, 82, 116],
        }}
        dpr={[1, 1]}
      >
        <color attach="background" args={["#07111f"]} />
        <ambientLight intensity={0.45} />
        <directionalLight intensity={1.6} position={[70, 110, 50]} />
        <ResidencyAnchorTerrain onTerrain={handleTerrain} />
        <OrbitControls makeDefault target={[0, 0, 0]} />
      </Canvas>
    </ExamplesCanvas>
  );
}
