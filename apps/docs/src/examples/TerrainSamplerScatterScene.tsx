"use client";

import { ExamplesCanvas } from "@/components/ExamplesCanvas";
import { FpsDebug } from "@/components/FpsDebug";
import {
  resolveTerrainMaterialAppearance,
  tileColorsLevaControl,
} from "@/examples/terrain/tileInstanceColor";
import { RunTimingBars } from "@/components/RunTimingBars";
import { TerrainTileDebug } from "@/components/TerrainTileDebug";
import {
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
  terrainTasks,
  TerrainMesh,
  type ElevationCallback,
  type TerrainSampler,
  type TerrainGraph,
  type UpdateParams,
} from "@hello-terrain/three";
import { param, task } from "@hello-terrain/work";
import { OrbitControls } from "@react-three/drei";
import { Canvas, extend, useFrame } from "@react-three/fiber";
import { useControls, useCreateStore } from "leva";
import { useEffect, useMemo, useRef } from "react";
import type { WebGPURendererParameters } from "three/src/renderers/webgpu/WebGPURenderer.js";
import {
  cos,
  dot,
  Fn,
  floor,
  fract,
  float,
  instanceIndex,
  Loop,
  mix,
  positionLocal,
  sin,
  vec2,
  vec3,
} from "three/tsl";
import * as THREE from "three/webgpu";

extend(THREE as any);
extend({ TerrainGeometry, TerrainMesh });

type LevaStore = ReturnType<typeof useCreateStore>;

const randomGradient = Fn(([p]: [any]) => {
  const angle = fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)).mul(
    Math.PI * 2,
  );
  return vec2(cos(angle), sin(angle));
});

const perlinNoise = Fn(([p]: [any]) => {
  const i = floor(p).toVar();
  const f = fract(p).toVar();
  const u = f.mul(f).mul(float(3).sub(f.mul(2)));

  const g00 = randomGradient(i);
  const g10 = randomGradient(i.add(vec2(1, 0)));
  const g01 = randomGradient(i.add(vec2(0, 1)));
  const g11 = randomGradient(i.add(vec2(1, 1)));

  const d00 = dot(g00, f);
  const d10 = dot(g10, f.sub(vec2(1, 0)));
  const d01 = dot(g01, f.sub(vec2(0, 1)));
  const d11 = dot(g11, f.sub(vec2(1, 1)));

  return mix(mix(d00, d10, u.x), mix(d01, d11, u.x), u.y).add(0.5);
});

const fbm = Fn(([pos_immutable]: [any]) => {
  const p = vec2(pos_immutable).toVar();
  const total = float(0).toVar();
  const amp = float(0.5).toVar();
  const freq = float(1).toVar();

  Loop(6, () => {
    total.addAssign(perlinNoise(p.mul(freq)).mul(amp));
    freq.mulAssign(2.03);
    amp.mulAssign(0.5);
  });

  return total;
});

function createScatterPositionNode(
  sampler: TerrainSampler,
  scatterCount: number,
  scatterScale: number,
  rootSize: number,
  elevationScaleValue: number,
) {
  const gridWidth = Math.max(1, Math.ceil(Math.sqrt(scatterCount)));
  const gridNode = float(gridWidth);
  const scaleNode = float(scatterScale);
  const elevationScaleNode = float(elevationScaleValue);
  const rootExtent = float(rootSize).mul(0.9);
  const up = vec3(0, 1, 0);

  return Fn(() => {
    const idx = float(instanceIndex).toVar();
    const gx = idx.mod(gridNode);
    const gz = idx.div(gridNode).floor();
    const cellSize = rootExtent.div(gridNode);

    const jx = idx
      .mul(12.9898)
      .sin()
      .mul(43758.5453123)
      .fract()
      .sub(0.5)
      .mul(cellSize.mul(0.8));
    const jz = idx
      .mul(78.233)
      .sin()
      .mul(12345.6789)
      .fract()
      .sub(0.5)
      .mul(cellSize.mul(0.8));

    const worldX = gx.mul(cellSize).sub(rootExtent.mul(0.5)).add(jx);
    const worldZ = gz.mul(cellSize).sub(rootExtent.mul(0.5)).add(jz);
    const sample = sampler.sampleTerrain(worldX, worldZ).toVar();
    const normal = vec3(sample.y, sample.z, sample.w).normalize();
    const valid = sampler.sampleValidity(worldX, worldZ);

    const tangentRaw = normal.cross(up);
    const tangent = tangentRaw
      .dot(tangentRaw)
      .greaterThan(float(1e-6))
      .select(tangentRaw.normalize(), vec3(1, 0, 0));
    const bitangent = tangent.cross(normal).normalize();

    const local = positionLocal.mul(scaleNode).toVar();
    const oriented = tangent
      .mul(local.x)
      .add(normal.mul(local.y))
      .add(bitangent.mul(local.z));
    const invalidSinkY = valid.select(float(0), float(-10000));
    const baseY = sample.x.mul(elevationScaleNode).add(invalidSinkY);
    return vec3(worldX, baseY, worldZ).add(oriented);
  })();
}

function SceneImpl({ g, store }: { g: TerrainGraph; store: LevaStore }) {
  const controls = useControls(
    "Terrain Sampler Scatter",
    {
      rootSize: {
        value: 4096,
        min: 64,
        max: 4096,
        step: 32,
        label: "root size",
      },
      maxLevel: { value: 12, min: 2, max: 20, step: 1, label: "max level" },
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
        value: 10,
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
        label: "inner tile segments",
      },
      scatterCount: {
        value: 10_000,
        min: 64,
        max: 1_000_000,
        step: 64,
        label: "scatter count",
      },
      scatterScale: {
        value: 10,
        min: 0.25,
        max: 50,
        step: 0.05,
        label: "scatter scale",
      },
      terrainWireframe: { value: false, label: "terrain wireframe" },
      tileColors: tileColorsLevaControl,
    },
    { store },
  );

  const lastCameraRef = useRef(new THREE.Vector3());
  const terrainMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const terrainMaterialRef = useRef<THREE.MeshStandardNodeMaterial | null>(
    null,
  );
  const scatterMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const scatterMaterialRef = useRef<THREE.MeshBasicNodeMaterial | null>(null);

  const scatterCountParam = useMemo(
    () => param(1024).displayName("scatterCount"),
    [],
  );
  const scatterScaleParam = useMemo(
    () => param(0.85).displayName("scatterScale"),
    [],
  );

  useEffect(() => {
    g.set(rootSize, () => controls.rootSize);
  }, [g, controls.rootSize]);

  useEffect(() => {
    g.set(maxLevel, () => controls.maxLevel);
  }, [g, controls.maxLevel]);

  useEffect(() => {
    g.set(maxNodes, () => controls.maxNodes);
  }, [g, controls.maxNodes]);

  useEffect(() => {
    g.set(elevationScale, () => controls.elevationScale);
  }, [g, controls.elevationScale]);

  useEffect(() => {
    g.set(skirtScale, () => controls.skirtScale);
  }, [g, controls.skirtScale]);

  useEffect(() => {
    g.set(innerTileSegments, () => controls.innerTileSegments);
  }, [g, controls.innerTileSegments]);

  useEffect(() => {
    const noiseScaleValue = 0.05;
    const elevation: ElevationCallback = ({ worldPosition }) => {
      const p = vec2(worldPosition.x, worldPosition.z).mul(
        float(noiseScaleValue),
      );
      return fbm(p).sub(float(0.3));
    };
    g.set(elevationFn, () => elevation);
  }, [g]);

  const scatterNodesTask = useMemo(
    () =>
      task((get, work) => {
        const sampler = get(terrainTasks.createTerrainSampler);
        const scatterCount = get(scatterCountParam);
        const scatterScale = get(scatterScaleParam);
        const elevationScaleValue = get(elevationScale);
        const rootSizeParam = get(rootSize);

        return work(() => ({
          scatterCount,
          scatterPositionNode: createScatterPositionNode(
            sampler,
            scatterCount,
            scatterScale,
            rootSizeParam,
            elevationScaleValue,
          ),
        }));
      }).displayName("scatterNodesTask"),
    [scatterCountParam, scatterScaleParam],
  );

  const renderStateTask = useMemo(
    () =>
      task((get, work) => {
        const leaves = get(quadtreeUpdateTask);
        const terrainPositionNode = get(positionNodeTask);
        const scatter = get(scatterNodesTask);

        return work(() => ({
          terrainCount: leaves.count,
          terrainPositionNode,
          scatterCount: scatter.scatterCount,
          scatterPositionNode: scatter.scatterPositionNode,
        }));
      }).displayName("terrainSamplerScatterRenderStateTask"),
    [scatterNodesTask],
  );

  const applyRenderStateTask = useMemo(
    () =>
      task((get, work) => {
        const next = get(renderStateTask);
        return work(() => {
          const terrainMesh = terrainMeshRef.current;
          if (terrainMesh && terrainMesh.count !== next.terrainCount) {
            terrainMesh.count = next.terrainCount;
            terrainMesh.instanceMatrix.needsUpdate = true;
          }

          const terrainMaterial = terrainMaterialRef.current;
          if (
            terrainMaterial &&
            next.terrainPositionNode &&
            terrainMaterial.positionNode !== next.terrainPositionNode
          ) {
            terrainMaterial.positionNode = next.terrainPositionNode;
            terrainMaterial.needsUpdate = true;
          }

          const scatterMesh = scatterMeshRef.current;
          if (scatterMesh && scatterMesh.count !== next.scatterCount) {
            scatterMesh.count = next.scatterCount;
            scatterMesh.instanceMatrix.needsUpdate = true;
          }

          const scatterMaterial = scatterMaterialRef.current;
          if (
            scatterMaterial &&
            next.scatterPositionNode &&
            scatterMaterial.positionNode !== next.scatterPositionNode
          ) {
            scatterMaterial.positionNode = next.scatterPositionNode;
            scatterMaterial.needsUpdate = true;
          }
        });
      }).displayName("applyTerrainSamplerScatterRenderStateTask"),
    [renderStateTask],
  );

  useEffect(() => {
    g.add(scatterNodesTask);
  }, [g, scatterNodesTask]);

  useEffect(() => {
    g.add(renderStateTask);
  }, [g, renderStateTask]);

  useEffect(() => {
    g.add(applyRenderStateTask);
  }, [g, applyRenderStateTask]);

  useEffect(() => {
    g.set(scatterCountParam, () => controls.scatterCount);
  }, [g, controls.scatterCount, scatterCountParam]);

  useEffect(() => {
    g.set(scatterScaleParam, () => controls.scatterScale);
  }, [g, controls.scatterScale, scatterScaleParam]);

  useFrame(async ({ camera, gl }) => {
    if (
      lastCameraRef.current.distanceToSquared(camera.position) >
      0.05 * 0.05
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
      resources: { renderer: gl as unknown as THREE.WebGPURenderer },
    });
  });

  const materialAppearance = resolveTerrainMaterialAppearance({
    tileColors: controls.tileColors,
    wireframe: controls.terrainWireframe,
  });

  return (
    <>
      <terrainMesh
        ref={terrainMeshRef}
        innerTileSegments={controls.innerTileSegments}
        maxNodes={controls.maxNodes}
      >
        <meshStandardNodeMaterial
          ref={terrainMaterialRef}
          wireframe={materialAppearance.wireframe}
          colorNode={materialAppearance.colorNode}
          color={materialAppearance.color ?? "#6d7a66"}
          metalness={0.02}
          roughness={0.95}
        />
      </terrainMesh>

      <instancedMesh
        ref={scatterMeshRef}
        args={[undefined, undefined, controls.scatterCount]}
        count={controls.scatterCount}
        frustumCulled={false}
      >
        <coneGeometry args={[0.18, 1.2, 6]} />
        <meshBasicNodeMaterial ref={scatterMaterialRef} color="red" />
      </instancedMesh>
    </>
  );
}

export default function TerrainSamplerScatterScene() {
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
          renderer.shadowMap.enabled = true;
          renderer.shadowMap.type = THREE.PCFSoftShadowMap;
          await renderer.init();
          return renderer;
        }}
        camera={{
          near: 0.001,
          far: Number.MAX_SAFE_INTEGER,
          position: [0, 90, 110],
        }}
        dpr={[1, 1]}
        performance={{ min: 0.5 }}
      >
        <ambientLight intensity={0.45} />
        <hemisphereLight intensity={0.45} groundColor="#334433" />
        <directionalLight
          intensity={2.4}
          position={[40, 120, 30]}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
        />
        <SceneImpl g={g} store={store} />
        <OrbitControls makeDefault target={[0, 6, 0]} />
      </Canvas>
    </ExamplesCanvas>
  );
}
