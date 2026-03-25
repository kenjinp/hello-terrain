"use client";

import { ExamplesCanvas } from "@/components/ExamplesCanvas";
import { Terrain, useTerrain } from "@hello-terrain/react";
import { type ElevationCallback } from "@hello-terrain/three";
import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useControls, useCreateStore } from "leva";
import { useMemo } from "react";
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

function FbmTerrainSceneImpl({ store }: { store: LevaStore }) {
  const controls = useControls(
    "FBM Terrain",
    {
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
    },
    { store },
  );

  const elevation = useMemo<ElevationCallback>(() => {
    return ({ worldPosition }) => {
      const p = vec2(worldPosition.x, worldPosition.z).mul(
        float(controls.noiseScale),
      );
      return fbm(p).sub(float(0.3));
    };
  }, [controls.noiseScale]);

  const terrain = useTerrain({
    rootSize: controls.rootSize,
    maxLevel: controls.maxLevel,
    maxNodes: controls.maxNodes,
    innerTileSegments: controls.innerTileSegments,
    skirtScale: controls.skirtScale,
    elevationScale: controls.elevationScale,
    elevation,
  });

  return (
    <Terrain
      terrain={terrain}
      innerTileSegments={controls.innerTileSegments}
      maxNodes={controls.maxNodes}
    >
      {({ positionNode }) => (
        <meshBasicNodeMaterial
          positionNode={positionNode}
          wireframe={controls.wireframe}
          outputNode={Fn(() => {
            const baseColor = vec3(0.42, 0.55, 0.33);
            const lightDir = normalize(vec3(0.5, 0.8, 0.3));
            const ambient = float(0.3);
            const diff = max(dot(normalWorld, lightDir), float(0));
            return vec4(
              baseColor.mul(ambient.add(diff.mul(float(0.7)))),
              float(1),
            );
          })()}
        />
      )}
    </Terrain>
  );
}

export default function FbmTerrainScene() {
  const store = useCreateStore();

  return (
    <ExamplesCanvas store={store}>
      <Canvas
        className="touch-none relative left-0 top-0 h-full w-full"
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
        <FbmTerrainSceneImpl store={store} />
        <OrbitControls makeDefault />
      </Canvas>
    </ExamplesCanvas>
  );
}
