"use client";

import { ExamplesCanvas } from "@/components/ExamplesCanvas";
import { FpsDebug } from "@/components/FpsDebug";
import { RunTimingBars } from "@/components/RunTimingBars";
import { TerrainTileDebug } from "@/components/TerrainTileDebug";
import {
  deriveNormalZ,
  ElevationCallback,
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
  TerrainGeometry,
  terrainGraph,
  TerrainMesh,
  textureSpaceToVectorSpace,
  vectorSpaceToTextureSpace,
  voronoiCells,
  type UpdateParams,
} from "@hello-terrain/three";
import { Graph, task } from "@hello-terrain/work";
import { Bounds, Environment, OrbitControls } from "@react-three/drei";
import {
  Canvas,
  extend,
  useFrame,
  useLoader,
  useThree,
} from "@react-three/fiber";
import { useControls } from "leva";
import { useEffect, useMemo, useRef } from "react";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import Node from "three/src/nodes/core/Node.js";
import type { WebGPURendererParameters } from "three/src/renderers/webgpu/WebGPURenderer.js";
import {
  float,
  Fn,
  normalMap,
  positionWorld,
  texture,
  vec2,
  vec3,
} from "three/tsl";
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
      min: 1,
      max: 1000,
      step: 1,
      label: "elevation scale",
    },
    wireframe: {
      value: false,
    },
  });

  const { gl } = useThree();

  const [albedo, normal, aorh] = useLoader(
    KTX2Loader,
    [
      "/assets/materials/sand-bright/sand_bright_albedo.ktx2",
      "/assets/materials/sand-bright/sand_bright_normal.ktx2",
      "/assets/materials/sand-bright/sand_bright_aorh.ktx2",
    ],
    async (loader) => {
      loader.setTranscoderPath(
        "https://cdn.jsdelivr.net/npm/three@0.174.0/examples/jsm/libs/basis/",
      );
      loader.detectSupport(gl);
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) {
        const hasBCCompression = adapter.features.has("texture-compression-bc");
        if (!hasBCCompression) {
          alert("Your device is not supported (no BCn compression)");
        }
      }
    },
  );
  normal.colorSpace = THREE.LinearSRGBColorSpace;

  albedo.wrapS = albedo.wrapT = THREE.RepeatWrapping;
  normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
  aorh.wrapS = aorh.wrapT = THREE.RepeatWrapping;

  const lastCameraRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const meshRef = useRef<THREE.InstancedMesh | null>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial | null>(null);

  useEffect(() => {
    const bboxMin = new THREE.Vector3();
    const bboxMax = new THREE.Vector3();

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

          if (mesh) {
            const halfRoot = controls.rootSize * 0.5;
            if (!mesh.geometry.boundingBox) {
              mesh.geometry.boundingBox = new THREE.Box3();
            }
            if (!mesh.geometry.boundingSphere) {
              mesh.geometry.boundingSphere = new THREE.Sphere();
            }

            bboxMin.set(-halfRoot, 0, -halfRoot);
            bboxMax.set(halfRoot, controls.elevationScale, halfRoot);
            mesh.geometry.boundingBox.set(bboxMin, bboxMax);
            mesh.geometry.boundingBox.getBoundingSphere(
              mesh.geometry.boundingSphere,
            );
          }

          if (material && positionNode) {
            material.positionNode = positionNode;
            material.needsUpdate = true;
          }
        });
      }).displayName("materialPositionNodeApplyTask"),
    );

    g.add(
      task((_get, work) => {
        return work(() => {
          // Set all fragment material nodes together with positionNode so the
          // shader compiles with everything in place (positionWorld depends on
          // positionNode being set first).
          if (materialRef.current && !materialNodesRef.current) {
            const worldUv = vec2(positionWorld.x, positionWorld.z);

            materialRef.current.normalNode = Fn(() => {
              const normalSample = texture(normal, worldUv);
              const rg = normalSample.rg;
              const xy = textureSpaceToVectorSpace(rg);
              const reconstructedNormal = deriveNormalZ(xy);
              return normalMap(
                vectorSpaceToTextureSpace(reconstructedNormal),
                vec2(1, 1),
              );
            })();

            materialRef.current.colorNode = Fn(() => {
              const tint = vec3(221, 145, 73).div(255);
              return texture(albedo, worldUv).mul(tint);
            })();

            materialRef.current.aoNode = Fn(() => {
              const aorhSample = texture(aorh, worldUv);
              return textureSpaceToVectorSpace(aorhSample.r).negate();
            })();

            materialRef.current.roughnessNode = Fn(() => {
              const aorhSample = texture(aorh, worldUv);
              return textureSpaceToVectorSpace(aorhSample.g).negate();
            })();

            materialRef.current.needsUpdate = true;
            materialNodesRef.current = true;
          }
        });
      }).displayName("materialTextureNodesApplyTask"),
    );
  }, [g]);

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
    g.set(elevationScale, () => controls.elevationScale);
  }, [controls.elevationScale]);

  const materialNodesRef = useRef(false);

  useEffect(() => {
    const elevation: ElevationCallback = ({ worldPosition }) => {
      const noiseScale = float(0.5);
      const noise = voronoiCells({
        scale: float(1),
        facet: 0,
        seed: 0,
        uv: vec2(worldPosition.x, worldPosition.z).mul(noiseScale),
      }).mul(float(0.5));
      return noise;
    };
    g.set(elevationFn, () => elevation);
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

    // Where the magic happens :)
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
      >
        <meshStandardNodeMaterial
          wireframe={controls.wireframe}
          ref={materialRef}
          metalness={0.1}
          // color={"#000000"}
          color={controls.wireframe ? "red" : undefined}
        />
      </terrainMesh>
    </>
  );
};

const TerrainElevationScene = () => {
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
export default TerrainElevationScene;
