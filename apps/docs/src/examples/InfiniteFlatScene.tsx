"use client";

import { ExamplesCanvas } from "@/components/ExamplesCanvas";
import { FpsDebug } from "@/components/FpsDebug";
import { RunTimingBars } from "@/components/RunTimingBars";
import { TerrainTileDebug } from "@/components/TerrainTileDebug";
import {
  createInfiniteFlatTopology,
  elevationFn,
  elevationScale,
  innerTileSegments,
  maxLevel,
  maxNodes,
  positionNodeTask,
  quadtreeUpdate,
  quadtreeUpdateTask,
  skirtScale,
  TerrainGeometry,
  terrainGraph,
  TerrainMesh,
  topology,
  voronoiCells,
  type ElevationParams,
  type UpdateParams,
} from "@hello-terrain/three";
import { Graph, task } from "@hello-terrain/work";
import { Environment, OrbitControls } from "@react-three/drei";
import { Canvas, extend, useFrame } from "@react-three/fiber";
import { useControls, useCreateStore } from "leva";

type LevaStore = ReturnType<typeof useCreateStore>;
import { useEffect, useMemo, useRef } from "react";
import {
  resolveTerrainMaterialAppearance,
  tileColorsLevaControl,
} from "@/examples/terrain/tileInstanceColor";
import type { WebGPURendererParameters } from "three/src/renderers/webgpu/WebGPURenderer.js";
import {
  float,
  Fn,
  positionWorld,
  vec2,
  vec3,
} from "three/tsl";
import * as THREE from "three/webgpu";

extend(THREE as any);
extend({ TerrainGeometry, TerrainMesh });

type InfiniteFlatSceneImplProps = {
  g: Graph;
  store: LevaStore;
};

const terrainPatternColorNode = Fn(() => {
  const worldUv = vec2(positionWorld.x, positionWorld.z);
  const tint = vec3(0.45, 0.55, 0.3);
  const pattern = worldUv.mul(0.1).sin().mul(0.5).add(0.5);
  return tint.mul(pattern.x.add(pattern.y).mul(0.5).add(0.5));
})();

const InfiniteFlatSceneImpl = ({ g, store }: InfiniteFlatSceneImplProps) => {
  const controls = useControls("Infinite Flat Terrain", {
    rootSize: {
      value: 128,
      min: 16,
      max: 4096,
      step: 16,
      label: "root size",
    },
    maxLevel: {
      value: 12,
      min: 2,
      max: 24,
      step: 2,
      label: "max level",
    },
    maxNodes: {
      value: 1028,
      min: 128,
      max: 2048,
      step: 1,
      label: "max nodes",
    },
    skirtScale: {
      value: 10,
      min: 0,
      max: 1000,
      step: 1,
      label: "skirt scale",
    },
    elevationScale: {
      value: 1,
      min: 0,
      max: 1000,
      step: 1,
      label: "elevation scale",
    },
    rootGridRadius: {
      value: 1,
      min: 1,
      max: 4,
      step: 1,
      label: "root grid radius",
    },
    wireframe: {
      value: false,
      label: "wireframe",
    },
    tileColors: tileColorsLevaControl,
  }, { store });

  const lastCameraRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const meshRef = useRef<THREE.InstancedMesh | null>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial | null>(null);

  useEffect(() => {
    g.add(
      task((get, work) => {
        const leafSet = get(quadtreeUpdateTask);
        const positionNode = get(positionNodeTask);
        return work(() => {
          const mesh = meshRef.current;
          const material = materialRef.current;

          if (
            mesh &&
            leafSet?.count !== undefined &&
            leafSet.count !== mesh.count
          ) {
            mesh.count = leafSet.count;
            mesh.instanceMatrix.needsUpdate = true;
          }

          if (material && positionNode) {
            material.positionNode = positionNode;
            material.needsUpdate = true;
          }
        });
      }).displayName("materialPositionNodeApplyTask"),
    );
  }, [g]);

  useEffect(() => {
    g.set(topology, () =>
      createInfiniteFlatTopology({
        rootSize: controls.rootSize,
        origin: { x: 0, y: 0, z: 0 },
        rootGridRadius: controls.rootGridRadius,
      }),
    );
  }, [controls.rootSize, controls.rootGridRadius]);

  useEffect(() => {
    g.set(maxNodes, () => controls.maxNodes);
  }, [controls.maxNodes]);

  useEffect(() => {
    g.set(maxLevel, () => controls.maxLevel);
  }, [controls.maxLevel]);

  useEffect(() => {
    g.set(skirtScale, () => controls.skirtScale);
  }, [controls.skirtScale]);

  useEffect(() => {
    g.set(elevationScale, () => controls.elevationScale);
  }, [controls.elevationScale]);

  useEffect(() => {
    g.set(elevationFn, () => ({ worldPosition }: ElevationParams) => {
      const noiseScale = float(0.5);
      const noise = voronoiCells({
        scale: float(1),
        facet: 0,
        seed: 0,
        uv: vec2(worldPosition.x, worldPosition.z).mul(noiseScale),
      }).mul(float(0.5));
      return noise;
    });
  }, []);

  useFrame(async ({ camera, gl }) => {
    const cameraHysteresis = 0.05;
    if (
      lastCameraRef.current.distanceToSquared(camera.position) >=
      cameraHysteresis * cameraHysteresis
    ) {
      g.set(quadtreeUpdate, (prev: UpdateParams) => {
        prev.cameraOrigin.x = camera.position.x;
        prev.cameraOrigin.y = camera.position.y;
        prev.cameraOrigin.z = camera.position.z;
        return prev;
      });
      lastCameraRef.current.copy(camera.position);
    }

    await g.run({
      resources: {
        renderer: gl,
      },
    });
  });

  const materialAppearance = resolveTerrainMaterialAppearance({
    tileColors: controls.tileColors,
    wireframe: controls.wireframe,
    colorNode: terrainPatternColorNode,
  });

  return (
    <>
      <Environment preset="sunset" />
      <terrainMesh
        ref={meshRef}
        innerTileSegments={innerTileSegments.get()}
        maxNodes={controls.maxNodes}
        frustumCulled={false}
      >
        <meshStandardNodeMaterial
          ref={materialRef}
          wireframe={materialAppearance.wireframe}
          metalness={0.1}
          colorNode={materialAppearance.colorNode}
          color={materialAppearance.color}
        />
      </terrainMesh>
    </>
  );
};

const InfiniteFlatScene = () => {
  const store = useCreateStore();
  const g = useMemo(() => terrainGraph(), []);

  return (
    <ExamplesCanvas store={store}>
      <div className="pointer-events-none absolute z-10 bottom-2 left-2 right-2 md:left-auto md:bottom-4 md:right-4 md:max-w-xs flex flex-col gap-1.5">
        <RunTimingBars graph={g} />
        <div className="flex flex-row gap-1.5">
          <TerrainTileDebug graph={g} />
          <FpsDebug />
        </div>
      </div>
      <Canvas
        className="touch-none relative w-full h-full top-0 left-0"
        shadows
        gl={async (props) => {
          props.alpha = true;
          props.antialias = true;
          const renderer = new THREE.WebGPURenderer(
            props as WebGPURendererParameters,
          );
          renderer.logarithmicDepthBuffer = true;
          renderer.shadowMap.type = THREE.PCFSoftShadowMap;
          renderer.shadowMap.enabled = true;
          await renderer.init();
          return renderer;
        }}
        camera={{
          near: 0.001,
          far: Number.MAX_SAFE_INTEGER,
          position: [0, 50, 80],
        }}
        dpr={[1, 1]}
        performance={{ min: 0.5 }}
      >
        <ambientLight intensity={0.15} />
        <directionalLight intensity={1} position={[1, 1, 1]} />
        <InfiniteFlatSceneImpl g={g} store={store} />
        <OrbitControls makeDefault />
      </Canvas>
    </ExamplesCanvas>
  );
};

export default InfiniteFlatScene;
