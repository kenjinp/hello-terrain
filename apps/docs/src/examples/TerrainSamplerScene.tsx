"use client";

import { ExamplesCanvas } from "@/components/ExamplesCanvas";
import { FpsDebug } from "@/components/FpsDebug";
import { RunTimingBars } from "@/components/RunTimingBars";
import { TerrainTileDebug } from "@/components/TerrainTileDebug";
import {
  elevationFn,
  elevationScale,
  maxLevel,
  maxNodes,
  positionNodeTask,
  quadtreeUpdate,
  quadtreeUpdateTask,
  rootSize,
  TerrainGeometry,
  terrainGraph,
  TerrainMesh,
  terrainTasks,
  voronoiCells,
  type ElevationParams,
  type UpdateParams,
} from "@hello-terrain/three";
import { Graph, param, task } from "@hello-terrain/work";
import { OrbitControls } from "@react-three/drei";
import { Canvas, extend, useFrame } from "@react-three/fiber";
import { useControls, useCreateStore } from "leva";
import { useEffect, useMemo, useRef } from "react";
import type { WebGPURendererParameters } from "three/src/renderers/webgpu/WebGPURenderer.js";
import {
  color,
  float,
  Fn,
  mix,
  positionWorld,
  step,
  vec2,
  vec3,
} from "three/tsl";
import * as THREE from "three/webgpu";

extend(THREE as any);
extend({ TerrainGeometry, TerrainMesh });

type LevaStore = ReturnType<typeof useCreateStore>;

type TerrainSamplerSceneImplProps = {
  g: Graph;
  store: LevaStore;
};

const samplerWaterLine = param(6).displayName("samplerWaterLine");
const samplerSnowLine = param(22).displayName("samplerSnowLine");
const samplerContourFrequency = param(1.8).displayName(
  "samplerContourFrequency",
);
const samplerUseEvaluateForBaseColor = param(false).displayName(
  "samplerUseEvaluateForBaseColor",
);

type MaterialNodes = {
  positionNode: any;
  colorNode: any;
  _spatialIndex: unknown;
  _positionNode: unknown;
  _waterLine: number;
  _snowLine: number;
  _contourFrequency: number;
  _useEvaluateForBaseColor: boolean;
  _elevationScale: number;
};

let _prevMaterialNodes: MaterialNodes | undefined;

const terrainSamplerSceneMaterialNodesTask = task((get, work) => {
  const positionNode = get(positionNodeTask);
  const sampler = get((terrainTasks as any).createTerrainSampler) as any;
  const spatialIndex = get((terrainTasks as any).gpuSpatialIndex);
  const waterLineValue = get(samplerWaterLine);
  const snowLineValue = get(samplerSnowLine);
  const contourFrequencyValue = get(samplerContourFrequency);
  const useEvaluateForBaseColorValue = get(samplerUseEvaluateForBaseColor);
  const elevationScaleValue = get(elevationScale);

  return work((): MaterialNodes => {
    const prev = _prevMaterialNodes;
    if (
      prev &&
      prev._spatialIndex === spatialIndex &&
      prev._positionNode === positionNode &&
      prev._waterLine === waterLineValue &&
      prev._snowLine === snowLineValue &&
      prev._contourFrequency === contourFrequencyValue &&
      prev._useEvaluateForBaseColor === useEvaluateForBaseColorValue &&
      prev._elevationScale === elevationScaleValue
    ) {
      return prev;
    }

    const nodes: MaterialNodes = {
      positionNode,
      colorNode: Fn(() => {
        const wx = positionWorld.x;
        const wz = positionWorld.z;
        const sampledTerrain = sampler.sampleTerrain(wx, wz);
        const sampledElevation = sampledTerrain.x.mul(
          float(elevationScaleValue),
        );
        const exactElevation = sampler
          .evaluateElevation(wx, wz)
          .mul(float(elevationScaleValue));
        const baseElevation = useEvaluateForBaseColorValue
          ? exactElevation
          : sampledElevation;

        const sampledNormal = vec3(
          sampledTerrain.y,
          sampledTerrain.z,
          sampledTerrain.w,
        );
        const validity = sampledNormal.x
          .abs()
          .add(sampledNormal.y.abs())
          .add(sampledNormal.z.abs())
          .greaterThan(float(0))
          .select(float(1), float(0));

        const water = color("#17406c");
        const grass = color("#4a7c2f");
        const rock = color("#656565");
        const snow = color("#ffffff");
        const deep = step(float(waterLineValue), baseElevation);
        const high = step(float(snowLineValue), baseElevation);

        const up = vec3(0, 1, 0);
        const slope = float(1).sub(sampledNormal.dot(up));
        const slopeMix = slope.mul(2).clamp(0, 1);
        const terrain = mix(mix(grass, rock, slopeMix), snow, high);
        const withWater = mix(water, terrain, deep);

        const contour = exactElevation
          .mul(float(contourFrequencyValue))
          .sin()
          .abs();
        const contourMask = step(float(0.9), contour);
        const contourLit = sampledNormal
          .dot(vec3(0.4, 0.9, 0.2))
          .max(float(0.2));
        const contourColor = vec3(0.1, 0.1, 0.1).mul(contourLit);
        const withContours = mix(
          withWater,
          contourColor,
          contourMask.mul(0.25),
        );

        const validityWeight = validity.mul(float(0.5)).add(float(0.5));
        return withContours.mul(validityWeight);
      })(),
      _spatialIndex: spatialIndex,
      _positionNode: positionNode,
      _waterLine: waterLineValue,
      _snowLine: snowLineValue,
      _contourFrequency: contourFrequencyValue,
      _useEvaluateForBaseColor: useEvaluateForBaseColorValue,
      _elevationScale: elevationScaleValue,
    };
    _prevMaterialNodes = nodes;
    return nodes;
  });
}).displayName("terrainSamplerSceneMaterialNodes");

const TerrainSamplerSceneImpl = ({
  g,
  store,
}: TerrainSamplerSceneImplProps) => {
  const controls = useControls(
    "Terrain Sampler Scene",
    {
      rootSize: { value: 256, min: 64, max: 4096, step: 64 },
      maxLevel: { value: 12, min: 2, max: 24, step: 1 },
      maxNodes: { value: 1024, min: 256, max: 8192, step: 64 },
      elevationScale: { value: 24, min: 1, max: 200, step: 1 },
      waterLine: { value: 6, min: -20, max: 80, step: 1 },
      snowLine: { value: 22, min: 0, max: 150, step: 1 },
      contourFrequency: { value: 1.8, min: 0.1, max: 8.0, step: 0.1 },
      evaluateNormalEpsilon: { value: 0.1, min: 0.02, max: 0.5, step: 0.01 },
      useEvaluateForBaseColor: { value: false },
      wireframe: { value: false },
    },
    { store },
  );

  const terrainMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const materialRef = useRef<THREE.MeshStandardNodeMaterial | null>(null);
  const lastCameraRef = useRef(new THREE.Vector3());
  const pendingRunRef = useRef<Promise<unknown> | null>(null);

  useEffect(() => {
    g.add(terrainSamplerSceneMaterialNodesTask);
  }, [g]);

  useEffect(() => {
    g.add(
      task((get, work) => {
        const leafSet = get(quadtreeUpdateTask);
        const nodes = get(terrainSamplerSceneMaterialNodesTask);

        return work(() => {
          if (
            terrainMeshRef.current &&
            leafSet.count !== terrainMeshRef.current.count
          ) {
            terrainMeshRef.current.count = leafSet.count;
            terrainMeshRef.current.instanceMatrix.needsUpdate = true;
          }

          const material = materialRef.current;
          if (!material) return;

          if (material.positionNode !== nodes.positionNode) {
            material.positionNode = nodes.positionNode;
            material.needsUpdate = true;
          }
          if (material.colorNode !== nodes.colorNode) {
            material.colorNode = nodes.colorNode;
            material.needsUpdate = true;
          }
        });
      }).displayName("applyTerrainSamplerScene"),
    );
  }, [g]);

  useEffect(() => {
    g.set(rootSize, () => controls.rootSize);
    g.set(maxLevel, () => controls.maxLevel);
    g.set(maxNodes, () => controls.maxNodes);
    g.set(elevationScale, () => controls.elevationScale);
    g.set(samplerWaterLine, () => controls.waterLine);
    g.set(samplerSnowLine, () => controls.snowLine);
    g.set(samplerContourFrequency, () => controls.contourFrequency);
    g.set(
      samplerUseEvaluateForBaseColor,
      () => controls.useEvaluateForBaseColor,
    );
  }, [
    controls.contourFrequency,
    controls.elevationScale,
    controls.maxLevel,
    controls.maxNodes,
    controls.rootSize,
    controls.snowLine,
    controls.useEvaluateForBaseColor,
    controls.waterLine,
    g,
  ]);

  useEffect(() => {
    g.set(elevationFn, () => ({ worldPosition }: ElevationParams) => {
      const uv = vec2(worldPosition.x, worldPosition.z).mul(float(0.02));
      return voronoiCells({ uv, scale: float(2.5), seed: 2, facet: 0.35 }).mul(
        float(0.8),
      );
    });
  }, [g]);

  useFrame(({ camera, gl }) => {
    const hysteresis = 0.05;
    if (
      lastCameraRef.current.distanceToSquared(camera.position) >
      hysteresis * hysteresis
    ) {
      g.set(quadtreeUpdate, (prev: UpdateParams) => {
        prev.cameraOrigin.x = camera.position.x;
        prev.cameraOrigin.y = camera.position.y;
        prev.cameraOrigin.z = camera.position.z;
        return prev;
      });
      lastCameraRef.current.copy(camera.position);
    }

    if (!pendingRunRef.current) {
      pendingRunRef.current = g
        .run({ resources: { renderer: gl } })
        .finally(() => {
          pendingRunRef.current = null;
        });
    }
  });

  return (
    <>
      <terrainMesh
        ref={terrainMeshRef}
        innerTileSegments={13}
        maxNodes={controls.maxNodes}
        frustumCulled={false}
      >
        <meshStandardNodeMaterial
          ref={materialRef}
          wireframe={controls.wireframe}
          metalness={0.08}
          roughness={0.9}
        />
      </terrainMesh>
    </>
  );
};

const TerrainSamplerScene = () => {
  const store = useCreateStore();
  const g = useMemo(() => terrainGraph(), []);

  return (
    <ExamplesCanvas store={store}>
      <div className="pointer-events-none absolute z-30 bottom-2 left-2 right-2 md:left-auto md:bottom-4 md:right-4 md:max-w-xs flex flex-col gap-1.5">
        <RunTimingBars graph={g} />
        <div className="flex flex-row gap-1.5">
          <TerrainTileDebug graph={g} />
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
          await renderer.init();
          return renderer;
        }}
        camera={{
          near: 0.001,
          far: Number.MAX_SAFE_INTEGER,
          position: [0, 54, 90],
        }}
        dpr={[1, 1]}
        performance={{ min: 0.5 }}
      >
        <ambientLight intensity={0.25} />
        <directionalLight intensity={1.1} position={[0.6, 1, 0.4]} />
        <TerrainSamplerSceneImpl g={g} store={store} />
        <OrbitControls makeDefault />
      </Canvas>
    </ExamplesCanvas>
  );
};

export default TerrainSamplerScene;
