"use client";

import { ExamplesCanvas } from "@/components/ExamplesCanvas";
import { FpsDebug } from "@/components/FpsDebug";
import { RunTimingBars } from "@/components/RunTimingBars";
import { TerrainTileDebug } from "@/components/TerrainTileDebug";
import {
  cubeSphereProjection,
  createCubeSphereSurface,
  elevationFn,
  elevationScale,
  innerTileSegments,
  maxLevel,
  maxNodes,
  positionNodeTask,
  quadtreeUpdate,
  quadtreeUpdateTask,
  rootSize,
  skirtScale,
  surface,
  surfaceProjection,
  TerrainGeometry,
  terrainGraph,
  TerrainMesh,
  voronoiCells,
  type UpdateParams,
} from "@hello-terrain/three";
import { Graph, task } from "@hello-terrain/work";
import { Environment, OrbitControls } from "@react-three/drei";
import { Canvas, extend, useFrame } from "@react-three/fiber";
import { useControls } from "leva";
import { useEffect, useMemo, useRef } from "react";
import Node from "three/src/nodes/core/Node.js";
import type { WebGPURendererParameters } from "three/src/renderers/webgpu/WebGPURenderer.js";
import { float, Fn, instanceIndex, int, vec2, vec3 } from "three/tsl";
import * as THREE from "three/webgpu";

extend(THREE as any);
extend({ TerrainGeometry, TerrainMesh });

function u32ToColor(indexNode: Node) {
  const i = float(indexNode);
  const p = vec3(i, i.add(1.0), i.add(2.0));
  const r = p.dot(vec3(127.1, 311.7, 74.7));
  const g = p.dot(vec3(269.5, 183.3, 246.1));
  const b = p.dot(vec3(113.5, 271.9, 124.6));
  return vec3(r, g, b).sin().mul(43758.5453123).fract();
}

type CubeSphereSceneImplProps = {
  g: Graph;
};

const CubeSphereSceneImpl = ({ g }: CubeSphereSceneImplProps) => {
  const controls = useControls("Cube Sphere Terrain", {
    radius: {
      value: 100,
      min: 10,
      max: 1000,
      step: 10,
      label: "radius",
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
      value: 2,
      min: 0,
      max: 100,
      step: 0.5,
      label: "skirt scale",
    },
    elevationScale: {
      value: 5,
      min: 0,
      max: 50,
      step: 0.5,
      label: "elevation scale",
    },
    wireframe: {
      value: false,
      label: "wireframe",
    },
  });

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
    g.set(surfaceProjection, () => cubeSphereProjection);
  }, [g]);

  useEffect(() => {
    g.set(surface, () =>
      createCubeSphereSurface({
        radius: controls.radius,
      }),
    );
  }, [controls.radius]);

  useEffect(() => {
    g.set(rootSize, () => controls.radius);
  }, [controls.radius]);

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
    g.set(elevationFn, () => ({ worldPosition }) => {
      const noiseScale = float(0.02);
      const uv = vec2(worldPosition.x, worldPosition.z).mul(noiseScale);
      const noise = voronoiCells({
        scale: float(1),
        facet: 0,
        seed: 0,
        uv,
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
          wireframe={controls.wireframe}
          metalness={0.1}
          colorNode={
            controls.wireframe
              ? Fn(() => u32ToColor(int(instanceIndex)))()
              : Fn(() => {
                  const tint = vec3(0.35, 0.55, 0.7);
                  return tint;
                })()
          }
        />
      </terrainMesh>
    </>
  );
};

const CubeSphereScene = () => {
  const g = useMemo(() => terrainGraph(), []);

  return (
    <ExamplesCanvas>
      <div className="absolute z-30 bottom-2 right-2 md:bottom-4 md:right-4 flex flex-col gap-1.5">
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
          near: 0.01,
          far: Number.MAX_SAFE_INTEGER,
          position: [0, 0, 250],
        }}
        dpr={[1, 1]}
        performance={{ min: 0.5 }}
      >
        <ambientLight intensity={0.15} />
        <directionalLight intensity={1} position={[1, 1, 1]} />
        <CubeSphereSceneImpl g={g} />
        <OrbitControls makeDefault />
      </Canvas>
    </ExamplesCanvas>
  );
};

export default CubeSphereScene;
