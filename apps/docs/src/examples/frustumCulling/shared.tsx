"use client";

import { ExamplesCanvas } from "@/components/ExamplesCanvas";
import { FpsDebug } from "@/components/FpsDebug";
import { RunTimingBars } from "@/components/RunTimingBars";
import { TerrainTileDebug } from "@/components/TerrainTileDebug";
import { Terrain, useTerrain, type TerrainHandle, type TerrainOptions } from "@hello-terrain/react";
import {
  createCubeSphereTopology,
  createTorusTopology,
  quadtreeUpdate,
  type TerrainGraph,
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
const CUBE_SPHERE_RADIUS = 1000;
const TORUS_MAJOR_RADIUS = 1000;
const TORUS_MINOR_RADIUS = 360;

const CUBE_SPHERE_TOPOLOGY = createCubeSphereTopology({ radius: CUBE_SPHERE_RADIUS });
const TORUS_TOPOLOGY = createTorusTopology({
  majorRadius: TORUS_MAJOR_RADIUS,
  minorRadius: TORUS_MINOR_RADIUS,
});

export type FrustumCullingConfig = {
  showGrid: boolean;
  viewerCamera: {
    near: number;
    far: number;
    position: [number, number, number];
  };
  createCullingCamera: () => THREE.PerspectiveCamera;
  animateCullingCamera: (camera: THREE.PerspectiveCamera, elapsedTime: number) => void;
  buildTerrainOptions: (
    cullingCamera: THREE.PerspectiveCamera,
    elevation: TerrainOptions["elevation"],
  ) => TerrainOptions;
};

export const FLAT_FRUSTUM_CULLING_CONFIG: FrustumCullingConfig = {
  showGrid: true,
  viewerCamera: {
    near: 0.1,
    far: 500,
    position: [108, 76, 108],
  },
  createCullingCamera: () => {
    const camera = new THREE.PerspectiveCamera(30, 1.45, 12, 140);
    camera.position.set(62, 34, 62);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    return camera;
  },
  animateCullingCamera: (camera, elapsedTime) => {
    const angle = elapsedTime * 0.18;
    camera.position.set(Math.cos(angle) * 68, 34 + Math.sin(angle * 0.7) * 8, Math.sin(angle) * 68);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  },
  buildTerrainOptions: (cullingCamera, elevation) => ({
    rootSize: ROOT_SIZE,
    maxLevel: 10,
    maxNodes: MAX_NODES,
    innerTileSegments: INNER_TILE_SEGMENTS,
    skirtScale: 8,
    elevationScale: 1,
    terrainFieldFilter: "nearest",
    elevation,
    camera: cullingCamera,
  }),
};

export const CUBE_SPHERE_FRUSTUM_CULLING_CONFIG: FrustumCullingConfig = {
  showGrid: false,
  viewerCamera: {
    near: 1,
    far: 100000,
    position: [0, 1200, 2600],
  },
  createCullingCamera: () => {
    const camera = new THREE.PerspectiveCamera(30, 1.45, 10, 50000);
    camera.position.set(1200, 680, 1200);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    return camera;
  },
  animateCullingCamera: (camera, elapsedTime) => {
    const angle = elapsedTime * 0.18;
    const orbitRadius = 1200;
    camera.position.set(
      Math.cos(angle) * orbitRadius,
      680 + Math.sin(angle * 0.7) * 160,
      Math.sin(angle) * orbitRadius,
    );
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  },
  buildTerrainOptions: (cullingCamera, elevation) => ({
    topology: CUBE_SPHERE_TOPOLOGY,
    radius: CUBE_SPHERE_RADIUS,
    maxLevel: 10,
    maxNodes: MAX_NODES,
    skirtScale: 4,
    elevationScale: 1,
    elevation,
    camera: cullingCamera,
  }),
};

export const TORUS_FRUSTUM_CULLING_CONFIG: FrustumCullingConfig = {
  showGrid: false,
  viewerCamera: {
    near: 1,
    far: 100000,
    position: [0, 1800, 2600],
  },
  createCullingCamera: () => {
    const camera = new THREE.PerspectiveCamera(30, 1.45, 10, 50000);
    camera.position.set(1000, 820, 1000);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    return camera;
  },
  animateCullingCamera: (camera, elapsedTime) => {
    const angle = elapsedTime * 0.18;
    const orbitRadius = 1200;
    camera.position.set(
      Math.cos(angle) * orbitRadius,
      820 + Math.sin(angle * 0.7) * 200,
      Math.sin(angle) * orbitRadius,
    );
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  },
  buildTerrainOptions: (cullingCamera, elevation) => ({
    topology: TORUS_TOPOLOGY,
    maxLevel: 10,
    maxNodes: MAX_NODES,
    skirtScale: 4,
    elevationScale: 1,
    elevation,
    camera: cullingCamera,
  }),
};

function FrustumCullingTerrain({
  config,
  onTerrain,
}: {
  config: FrustumCullingConfig;
  onTerrain: (terrain: TerrainHandle) => void;
}) {
  const helperRef = useRef<THREE.CameraHelper | null>(null);
  const cullingCamera = useMemo(() => config.createCullingCamera(), [config]);
  const elevation = useMemo(() => () => float(0), []);
  const terrainOptions = useMemo(
    () => config.buildTerrainOptions(cullingCamera, elevation),
    [config, cullingCamera, elevation],
  );

  const terrain = useTerrain(terrainOptions);

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
    config.animateCullingCamera(cullingCamera, clock.elapsedTime);
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
            color="#9bd5ff"
            roughness={0.9}
            metalness={0.02}
          />
        )}
      </Terrain>
      {config.showGrid ? (
        <gridHelper args={[ROOT_SIZE, 18, "#7dd3fc", "#334155"]} position={[0, -0.04, 0]} />
      ) : null}
    </>
  );
}

export function FrustumCullingDemo({ config }: { config: FrustumCullingConfig }) {
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
      <div className="pointer-events-none absolute bottom-2 left-2 right-2 z-10 flex flex-col gap-1.5 md:bottom-4 md:left-auto md:right-4 md:max-w-xs">
        {graph ? <RunTimingBars graph={graph} /> : null}
        <div className="flex flex-row gap-1.5">
          {graph ? <TerrainTileDebug graph={graph} /> : null}
          <FpsDebug />
        </div>
      </div>
      <Canvas
        className="relative left-0 top-0 h-full w-full touch-none"
        gl={async (props) => {
          props.alpha = true;
          props.antialias = true;
          const renderer = new THREE.WebGPURenderer(props as WebGPURendererParameters);
          renderer.logarithmicDepthBuffer = true;
          await renderer.init();
          return renderer;
        }}
        camera={config.viewerCamera}
        dpr={[1, 1]}
      >
        <color attach="background" args={["#07111f"]} />
        <ambientLight intensity={0.45} />
        <directionalLight intensity={1.6} position={[70, 110, 50]} />
        <FrustumCullingTerrain config={config} onTerrain={handleTerrain} />
        <OrbitControls makeDefault target={[0, 0, 0]} />
      </Canvas>
    </ExamplesCanvas>
  );
}
