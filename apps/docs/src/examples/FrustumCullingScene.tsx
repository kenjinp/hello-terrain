"use client";

import { ExamplesCanvas } from "@/components/ExamplesCanvas";
import { FpsDebug } from "@/components/FpsDebug";
import { RunTimingBars } from "@/components/RunTimingBars";
import { TerrainTileDebug } from "@/components/TerrainTileDebug";
import {
  elevationFn,
  elevationScale,
  innerTileSegments,
  leafGpuBufferTask,
  maxLevel,
  maxNodes,
  positionNodeTask,
  quadtreeUpdate,
  rootSize,
  skirtScale,
  TerrainGeometry,
  terrainGraph,
  TerrainMesh,
  terrainFieldFilter,
  updateUniformsTask,
  writeUpdateParamsFromCamera,
  type UpdateParams,
} from "@hello-terrain/three";
import { task } from "@hello-terrain/work";
import { OrbitControls } from "@react-three/drei";
import { Canvas, extend, useFrame } from "@react-three/fiber";
import { useCreateStore } from "leva";
import { useEffect, useMemo, useRef } from "react";
import type { WebGPURendererParameters } from "three/src/renderers/webgpu/WebGPURenderer.js";
import * as THREE from "three/webgpu";
import { float } from "three/tsl";

extend(THREE as any);
extend({ TerrainGeometry, TerrainMesh });

const ROOT_SIZE = 180;
const MAX_NODES = 4096;
const INNER_TILE_SEGMENTS = 17;

function FrustumCullingTerrain({ graph }: { graph: ReturnType<typeof terrainGraph> }) {
  const meshRef = useRef<THREE.InstancedMesh | null>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const helperRef = useRef<THREE.CameraHelper | null>(null);
  const cullingCamera = useMemo(() => {
    const camera = new THREE.PerspectiveCamera(30, 1.45, 12, 140);
    camera.position.set(62, 34, 62);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    return camera;
  }, []);

  useEffect(() => {
    graph
      .set(rootSize, ROOT_SIZE)
      .set(maxLevel, 10)
      .set(maxNodes, MAX_NODES)
      .set(innerTileSegments, INNER_TILE_SEGMENTS)
      .set(skirtScale, 8)
      .set(elevationScale, 1)
      .set(terrainFieldFilter, "nearest")
      .set(elevationFn as never, (() => float(0)) as never);

    graph.add(
      task<{ renderer: THREE.WebGPURenderer }>((get, work) => {
        const leafBuffer = get(leafGpuBufferTask);
        const positionNode = get(positionNodeTask);
        const uniforms = get(updateUniformsTask);

        return work(() => {
          const mesh = meshRef.current;
          if (mesh && mesh.count !== leafBuffer.count) {
            mesh.count = leafBuffer.count;
            mesh.instanceMatrix.needsUpdate = true;
          }
          if (
            mesh &&
            typeof uniforms.uInnerTileSegments.value === "number" &&
            "innerTileSegments" in mesh
          ) {
            (mesh as TerrainMesh).innerTileSegments = uniforms.uInnerTileSegments.value;
          }

          const material = materialRef.current;
          if (material && positionNode && material.positionNode !== positionNode) {
            material.positionNode = positionNode;
            material.needsUpdate = true;
          }
        });
      }).displayName("frustumCullingSceneApplyTask"),
    );

  }, [graph]);

  useFrame(async ({ clock, gl }) => {
    const angle = clock.elapsedTime * 0.18;
    cullingCamera.position.set(
      Math.cos(angle) * 68,
      34 + Math.sin(angle * 0.7) * 8,
      Math.sin(angle) * 68,
    );
    cullingCamera.lookAt(0, 0, 0);
    cullingCamera.updateProjectionMatrix();
    helperRef.current?.update();

    graph.set(quadtreeUpdate, (prev: UpdateParams) => {
      return writeUpdateParamsFromCamera(
        {
          ...prev,
          cameraOrigin: prev.cameraOrigin,
          mode: "distance",
          distanceFactor: 1.4,
        },
        cullingCamera,
      );
    });

    await graph.run({
      resources: { renderer: gl as unknown as THREE.WebGPURenderer },
    });
  });

  return (
    <>
      <primitive object={cullingCamera} />
      <cameraHelper ref={helperRef} args={[cullingCamera]} />
      <terrainMesh
        ref={meshRef}
        innerTileSegments={INNER_TILE_SEGMENTS}
        maxNodes={MAX_NODES}
        frustumCulled={false}
      >
        <meshStandardNodeMaterial
          ref={materialRef}
          wireframe
          color="#9bd5ff"
          roughness={0.9}
          metalness={0.02}
        />
      </terrainMesh>
      <gridHelper args={[ROOT_SIZE, 18, "#7dd3fc", "#334155"]} position={[0, -0.04, 0]} />
    </>
  );
}

export default function FrustumCullingScene() {
  const store = useCreateStore();
  const graph = useMemo(() => terrainGraph(), []);

  return (
    <ExamplesCanvas store={store}>
      <div className="pointer-events-none absolute z-10 bottom-2 left-2 right-2 md:left-auto md:bottom-4 md:right-4 md:max-w-xs flex flex-col gap-1.5">
        <RunTimingBars graph={graph} />
        <div className="flex flex-row gap-1.5">
          <TerrainTileDebug graph={graph} />
          <FpsDebug />
        </div>
      </div>
      <Canvas
        className="touch-none relative w-full h-full top-0 left-0"
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
          position: [108, 76, 108],
        }}
        dpr={[1, 1]}
      >
        <color attach="background" args={["#07111f"]} />
        <ambientLight intensity={0.45} />
        <directionalLight intensity={1.6} position={[70, 110, 50]} />
        <FrustumCullingTerrain graph={graph} />
        <OrbitControls makeDefault target={[0, 0, 0]} />
      </Canvas>
    </ExamplesCanvas>
  );
}
