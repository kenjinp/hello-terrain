"use client";

import { ExamplesCanvas } from "@/components/ExamplesCanvas";
import { RunTimingBars } from "@/components/RunTimingBars";
import { TerrainTileDebug } from "@/components/TerrainTileDebug";
import {
  innerTileSegments,
  maxLevel,
  maxNodes,
  positionNodeTask,
  quadtreeUpdate,
  quadtreeUpdateTask,
  rootSize,
  skirtScale,
  TerrainGeometry,
  terrainGraph,
  TerrainMesh,
  type UpdateParams,
} from "@hello-terrain/three";
import { Graph } from "@hello-terrain/work";
import { Bounds, OrbitControls } from "@react-three/drei";
import { Canvas, extend, useFrame } from "@react-three/fiber";
import { useControls } from "leva";
import { useEffect, useMemo, useRef } from "react";
import Node from "three/src/nodes/core/Node.js";
import type { WebGPURendererParameters } from "three/src/renderers/webgpu/WebGPURenderer.js";
import { float, Fn, instanceIndex, int, vec3 } from "three/tsl";
import * as THREE from "three/webgpu";

extend(THREE as any);
extend({ TerrainGeometry, TerrainMesh });

type TerrainMeshSceneImplProps = {
  g: Graph;
};

function u32ToColor(indexNode: Node) {
  const i = float(indexNode);
  const p = vec3(i, i.add(1.0), i.add(2.0));
  const r = p.dot(vec3(127.1, 311.7, 74.7));
  const g = p.dot(vec3(269.5, 183.3, 246.1));
  const b = p.dot(vec3(113.5, 271.9, 124.6));

  return vec3(r, g, b).sin().mul(43758.5453123).fract();
}

const TerrainMeshSceneImpl = ({ g }: TerrainMeshSceneImplProps) => {
  const controls = useControls("TerrainGeometry", {
    rootSize: {
      value: 128,
      min: 2,
      max: 4092 * 2,
      step: 2,
      label: "root size",
    },
    maxLevel: {
      value: 12,
      min: 2,
      max: 24,
      step: 2,
      label: "max level",
    },
    innerTileSegments: {
      value: 14,
      min: 2,
      max: 64,
      step: 2,
      label: "inner segments",
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
  });

  const lastCameraRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const meshRef = useRef<THREE.InstancedMesh | null>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const postionNodeRef = useRef<THREE.TSL.ShaderCallNodeInternal | null>(null);

  useEffect(() => {
    g.set(innerTileSegments, () => controls.innerTileSegments);
    if (materialRef.current) materialRef.current.needsUpdate = true;
  }, [controls.innerTileSegments]);

  useEffect(() => {
    g.set(maxNodes, () => controls.maxNodes);
  }, [controls.maxNodes]);

  useEffect(() => {
    g.set(rootSize, () => controls.rootSize);
  }, [controls.rootSize]);

  useEffect(() => {
    g.set(maxLevel, () => controls.maxLevel);
  }, [controls.maxLevel]);

  useEffect(() => {
    g.set(skirtScale, () => controls.skirtScale);
  }, [controls.skirtScale]);

  useEffect(() => {
    return g.on("run:finish", () => {
      const leafSet = g.peek(quadtreeUpdateTask);
      const lastCount = meshRef.current?.count || 0;
      if (leafSet?.count && leafSet?.count !== lastCount && meshRef.current) {
        meshRef.current.count = leafSet.count;
        meshRef.current.instanceMatrix.needsUpdate = true;
      }
      const positionNode = g.peek(positionNodeTask);
      if (materialRef.current && positionNode && positionNode !== postionNodeRef.current) {
        materialRef.current.positionNode = positionNode;
        materialRef.current.needsUpdate = true;
        postionNodeRef.current = positionNode;
      }
    });
  }, [g]);

  useFrame(async ({ camera }) => {
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

    // Where the magic happens :)
    await g.run();
  });

  return (
    <>
      <terrainMesh
        ref={meshRef}
        innerTileSegments={controls.innerTileSegments}
        maxNodes={controls.maxNodes}
      >
        <meshStandardNodeMaterial
          ref={materialRef}
          wireframe
          colorNode={Fn(() => {
            const nodeIndex = int(instanceIndex);
            return u32ToColor(nodeIndex);
          })()}
        />
      </terrainMesh>
    </>
  );
};

const TerrainMeshScene = () => {
  const g = useMemo(() => terrainGraph(), []);

  return (
    <ExamplesCanvas>
      {/* HUD overlays */}
      <div className="absolute z-30 bottom-2 right-2 md:bottom-4 md:right-4 flex flex-col gap-1.5">
        <RunTimingBars graph={g} />
        <TerrainTileDebug graph={g} />
      </div>
      <Canvas
        className="touch-none relative w-full h-full top-0 left-0"
        shadows
        gl={async (props) => {
          props.alpha = true;
          props.antialias = true;
          // soft shadows
          const renderer = new THREE.WebGPURenderer(props as WebGPURendererParameters);

          renderer.logarithmicDepthBuffer = true;
          renderer.shadowMap.type = THREE.PCFSoftShadowMap;
          renderer.shadowMap.enabled = true;

          await renderer.init();
          return renderer;
        }}
        camera={{
          near: 0.001,
          far: Number.MAX_SAFE_INTEGER,
          position: [0, 3, 1],
        }}
        dpr={[1, 1]}
        performance={{ min: 0.5 }}
      >
        <ambientLight intensity={0.15} />
        <directionalLight intensity={1} position={[1, 1, 1]} />
        <Bounds fit observe>
          <TerrainMeshSceneImpl g={g} />
        </Bounds>
        <OrbitControls makeDefault />
      </Canvas>
    </ExamplesCanvas>
  );
};

export default TerrainMeshScene;
