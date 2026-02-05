"use client";

import { ExamplesCanvas } from "@/components/ExamplesCanvas";
import { RunTimingBars } from "@/components/RunTimingBars";
import {
  createGraph,
  maxLevelParam,
  maxNodesParam,
  quadtreeUpdateParams,
  quadtreeUpdateTask,
  rootSizeParam,
  TerrainGeometry,
  TerrainMesh,
  updateTerrainUniformsTask,
  terrainVertextPositionNodeTask,
} from "@hello-terrain/three";
import { graph, param } from "@hello-terrain/work";
import { OrbitControls, useTexture } from "@react-three/drei";
import { Canvas, extend, useFrame } from "@react-three/fiber";
import { useControls } from "leva";
import { useEffect, useMemo, useRef } from "react";
import Node from "three/src/nodes/core/Node.js";
import type { WebGPURendererParameters } from "three/src/renderers/webgpu/WebGPURenderer.js";
import { float, Fn, instanceIndex, int, vec3 } from "three/tsl";
import * as THREE from "three/webgpu";

extend(THREE as any);
extend({ TerrainGeometry, TerrainMesh });

const innerTileSegmentsParam = param(14);

type TerrainMeshSceneImplProps = {
  g: ReturnType<typeof graph>;
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
      // onChange(value: number) {
      //   rootSizeParam.set(() => value);
      // },
    },
    maxLevel: {
      value: 12,
      min: 2,
      max: 24,
      step: 2,
      label: "max level",
      // onChange(value: number) {
      //   maxLevelParam.set(() => value);
      // },
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
  });

  const lastCameraRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const meshRef = useRef<THREE.InstancedMesh | null>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const postionNodeRef = useRef<THREE.TSL.ShaderCallNodeInternal | null>(null);

  const uvMap = useTexture("/assets/uv-12x12.png");
  uvMap.wrapS = THREE.RepeatWrapping;
  uvMap.wrapT = THREE.RepeatWrapping;

  useEffect(() => {
    innerTileSegmentsParam.set(() => controls.innerTileSegments);
    if (materialRef.current) materialRef.current.needsUpdate = true;
  }, [controls.innerTileSegments]);

  useEffect(() => {
    maxNodesParam.set(() => controls.maxNodes);
  }, [controls.maxNodes]);

  useEffect(() => {
    rootSizeParam.set(() => controls.rootSize);
  }, [controls.rootSize]);

  useEffect(() => {
    maxLevelParam.set(() => controls.maxLevel);
  }, [controls.maxLevel]);

  useEffect(() => {
    return g.on("run:finish", () => {
      const leafSet = g.peek(quadtreeUpdateTask);
      const lastCount = meshRef.current?.count || 0;
      if (leafSet?.count && leafSet?.count !== lastCount && meshRef.current) {
        meshRef.current.count = leafSet.count;
        meshRef.current.instanceMatrix.needsUpdate = true;
      }
      const positionNode = g.peek(terrainVertextPositionNodeTask);
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
      quadtreeUpdateParams.set((prev) => {
        prev.cameraOrigin.x = camera.position.x;
        prev.cameraOrigin.y = camera.position.y;
        prev.cameraOrigin.z = camera.position.z;
        return prev;
      });
      lastCameraRef.current.copy(camera.position);
    }

    const report = await g.run();

    if (report) {
      const cameraOrigin = quadtreeUpdateParams.get().cameraOrigin;
      const leafSet = g.peek(quadtreeUpdateTask);
      const terrainUniforms = g.peek(updateTerrainUniformsTask);
      const uniformRootSize = terrainUniforms?.uRootSize.value;
      const uniformRootSizeLabel =
        typeof uniformRootSize === "number"
          ? uniformRootSize.toFixed(2)
          : `${uniformRootSize ?? "—"}`;
      const paramRootSize = rootSizeParam.get();
      const html = `
        <div>
          <div class="text-white/70">run</div>
          <div>${report.status ?? "—"}${typeof report.durationMs === "number" ? ` (${report.durationMs.toFixed(1)}ms)` : ""}</div>
        </div>
        <div>
          <div class="text-white/70">tasks</div>
          <div>${report.taskCount ?? "—"} executed / ${report.cacheHits ?? "—"} cached</div>
        </div>
        <div>
          <div class="text-white/70">camera</div>
          <div>${cameraOrigin.x.toFixed(2)}, ${cameraOrigin.y.toFixed(2)}, ${cameraOrigin.z.toFixed(2)}</div>
        </div>
        <div>
          <div class="text-white/70">leaf count</div>
          <div>${leafSet?.count ?? "—"}</div>
        </div>
        <div>
          <div class="text-white/70">root size</div>
          <div>param ${paramRootSize ?? "—"} / uniform ${uniformRootSizeLabel}</div>
        </div>
      `;
      document.getElementById("report")!.innerHTML = html;
    }
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
  const g = useMemo(createGraph, []);

  return (
    <ExamplesCanvas>
      {/* Stats */}
      <div className="absolute bottom-2 left-2 right-2 md:bottom-4 md:left-4 md:right-auto z-20 bg-black/45 border border-white/10 backdrop-blur-sm rounded-md px-2.5 py-2 text-white font-mono text-[10px] md:text-xs pointer-events-none">
        <div className="flex flex-wrap gap-x-4 gap-y-2" id="report"></div>
      </div>

      {/* Timing HUD */}
      <RunTimingBars graph={g} />
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
        {/* <Bounds fit observe> */}
        <TerrainMeshSceneImpl g={g} />
        {/* </Bounds> */}
        <OrbitControls makeDefault />
      </Canvas>
    </ExamplesCanvas>
  );
};

export default TerrainMeshScene;
