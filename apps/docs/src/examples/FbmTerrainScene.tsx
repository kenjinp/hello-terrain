"use client";

import { ExamplesCanvas } from "@/components/ExamplesCanvas";
import { FpsDebug } from "@/components/FpsDebug";
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
  TerrainMesh,
  type ElevationCallback,
  type UpdateParams,
} from "@hello-terrain/three";
import { Graph, task, type TaskRef } from "@hello-terrain/work";
import { OrbitControls } from "@react-three/drei";
import { Canvas, extend, useFrame } from "@react-three/fiber";
import { useControls } from "leva";
import { useEffect, useMemo, useRef } from "react";
import type { WebGPURendererParameters } from "three/src/renderers/webgpu/WebGPURenderer.js";
import {
  cos,
  dot,
  float,
  Fn,
  floor,
  fract,
  Loop,
  max,
  mix,
  normalWorld,
  normalize,
  sin,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";

extend(THREE as any);
extend({ TerrainGeometry, TerrainMesh });

// ── TSL noise helpers ──────────────────────────────────────

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

// ── Scene Implementation ───────────────────────────────────

type FbmTerrainSceneImplProps = {
  g: Graph;
  rendererTask: TaskRef<THREE.WebGPURenderer | null>;
};

const FbmTerrainSceneImpl = ({ g, rendererTask }: FbmTerrainSceneImplProps) => {
  const controls = useControls("FBM Terrain", {
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
      value: 512,
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
      value: 15,
      min: 1,
      max: 100,
      step: 1,
      label: "elevation scale",
    },
    innerTileSegments: {
      value: 13,
      min: 3,
      max: 64,
      step: 1,
      label: "inner tile segments",
    },
    noiseScale: {
      value: 0.05,
      min: 0.001,
      max: 0.5,
      step: 0.001,
      label: "noise scale",
    },
    wireframe: {
      value: false,
    },
  });

  const lastCameraRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const meshRef = useRef<THREE.InstancedMesh | null>(null);
  const materialRef = useRef<THREE.MeshBasicNodeMaterial | null>(null);
  const materialReadyRef = useRef(false);

  useEffect(() => {
    g.add(
      task((get, work) => {
        const leafSet = get(quadtreeUpdateTask);
        return work(() => {
          const mesh = meshRef.current;

          if (
            mesh &&
            leafSet?.count !== undefined &&
            leafSet.count !== mesh.count
          ) {
            mesh.count = leafSet.count;
            mesh.instanceMatrix.needsUpdate = true;
          }
        });
      }).displayName("applyCount"),
    );
    g.add(
      task((get, work) => {
        const positionNode = get(positionNodeTask);
        return work(() => {
          const material = materialRef.current;
          if (material && positionNode) {
            material.positionNode = positionNode;

            if (!materialReadyRef.current) {
              material.outputNode = Fn(() => {
                const baseColor = vec3(0.42, 0.55, 0.33);
                const lightDir = normalize(vec3(0.5, 0.8, 0.3));
                const ambient = float(0.3);
                const diff = max(dot(normalWorld, lightDir), float(0));
                return vec4(
                  baseColor.mul(ambient.add(diff.mul(float(0.7)))),
                  float(1),
                );
              })();
              materialReadyRef.current = true;
            }

            material.needsUpdate = true;
          }
        });
      }).displayName("applyPositionNodeTask"),
    );
  }, [g, rendererTask]);

  useEffect(() => {
    const noiseScaleValue = controls.noiseScale;
    const elevation: ElevationCallback = ({ worldPosition }) => {
      const p = vec2(worldPosition.x, worldPosition.z).mul(
        float(noiseScaleValue),
      );
      return fbm(p).sub(float(0.3));
    };
    g.set(elevationFn, () => elevation);
  }, [g, controls.noiseScale]);

  useEffect(() => {
    g.set(elevationScale, () => controls.elevationScale);
  }, [controls.elevationScale]);

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
    g.set(innerTileSegments, () => controls.innerTileSegments);
  }, [controls.innerTileSegments]);

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
      <terrainMesh
        ref={meshRef}
        innerTileSegments={controls.innerTileSegments}
        maxNodes={controls.maxNodes}
      >
        <meshBasicNodeMaterial
          ref={materialRef}
          wireframe={controls.wireframe}
        />
      </terrainMesh>
    </>
  );
};

const FbmTerrainScene = () => {
  const g = useMemo(() => terrainGraph(), []);
  const rendererTask = useMemo(
    () =>
      task<{ renderer: THREE.WebGPURenderer }>((_get, work, { resources }) =>
        work(() => resources?.renderer ?? null),
      ).displayName("debugRendererTask"),
    [],
  );

  useEffect(() => {
    g.add(rendererTask);
  }, [g, rendererTask]);

  return (
    <ExamplesCanvas>
      <div className="absolute z-30 bottom-2 right-2 md:bottom-4 md:right-4 flex flex-col gap-1.5">
        <RunTimingBars graph={g} />
        <div className="flex flex-row gap-1.5">
          <TerrainTileDebug graph={g} rendererTask={rendererTask} />
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
          position: [0, 30, 60],
        }}
        dpr={[1, 1]}
        performance={{ min: 0.5 }}
      >
        <ambientLight intensity={0.15} />
        <directionalLight intensity={1} position={[1, 1, 1]} />
        <FbmTerrainSceneImpl g={g} rendererTask={rendererTask} />
        <OrbitControls makeDefault />
      </Canvas>
    </ExamplesCanvas>
  );
};

export default FbmTerrainScene;
