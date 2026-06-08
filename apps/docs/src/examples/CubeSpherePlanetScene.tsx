"use client";

import { ExamplesCanvas } from "@/components/ExamplesCanvas";
import { FpsDebug } from "@/components/FpsDebug";
import { Terrain, useTerrain, type TerrainHandle } from "@hello-terrain/react";
import { createCubeSphereSurface, type ElevationCallback } from "@hello-terrain/three";
import { Environment, OrbitControls } from "@react-three/drei";
import { Canvas, extend, useFrame, type ThreeEvent } from "@react-three/fiber";
import { useControls, useCreateStore } from "leva";
import { useCallback, useMemo, useRef, useState } from "react";
import type { WebGPURendererParameters } from "three/src/renderers/webgpu/WebGPURenderer.js";
import {
  clamp,
  dot,
  float,
  floor,
  Fn,
  fract,
  Loop,
  mix,
  normalize,
  positionWorld,
  sin,
  smoothstep,
  vec3,
} from "three/tsl";
import * as THREE from "three/webgpu";

extend({ MeshStandardNodeMaterial: THREE.MeshStandardNodeMaterial });

type LevaStore = ReturnType<typeof useCreateStore>;

const randomGradient = Fn(([p]: [any]) => {
  const x = dot(p, vec3(127.1, 311.7, 74.7));
  const y = dot(p, vec3(269.5, 183.3, 246.1));
  const z = dot(p, vec3(113.5, 271.9, 124.6));
  return normalize(
    fract(sin(vec3(x, y, z)).mul(43758.5453))
      .mul(2)
      .sub(1),
  );
});

const perlinNoise = Fn(([p]: [any]) => {
  const i = floor(p).toVar();
  const f = fract(p).toVar();
  const u = f.mul(f).mul(float(3).sub(f.mul(2)));

  const g000 = randomGradient(i.add(vec3(0, 0, 0)));
  const g100 = randomGradient(i.add(vec3(1, 0, 0)));
  const g010 = randomGradient(i.add(vec3(0, 1, 0)));
  const g110 = randomGradient(i.add(vec3(1, 1, 0)));
  const g001 = randomGradient(i.add(vec3(0, 0, 1)));
  const g101 = randomGradient(i.add(vec3(1, 0, 1)));
  const g011 = randomGradient(i.add(vec3(0, 1, 1)));
  const g111 = randomGradient(i.add(vec3(1, 1, 1)));

  const d000 = dot(g000, f.sub(vec3(0, 0, 0)));
  const d100 = dot(g100, f.sub(vec3(1, 0, 0)));
  const d010 = dot(g010, f.sub(vec3(0, 1, 0)));
  const d110 = dot(g110, f.sub(vec3(1, 1, 0)));
  const d001 = dot(g001, f.sub(vec3(0, 0, 1)));
  const d101 = dot(g101, f.sub(vec3(1, 0, 1)));
  const d011 = dot(g011, f.sub(vec3(0, 1, 1)));
  const d111 = dot(g111, f.sub(vec3(1, 1, 1)));

  const x00 = mix(d000, d100, u.x);
  const x10 = mix(d010, d110, u.x);
  const x01 = mix(d001, d101, u.x);
  const x11 = mix(d011, d111, u.x);

  const y0 = mix(x00, x10, u.y);
  const y1 = mix(x01, x11, u.y);

  return mix(y0, y1, u.z).add(0.5);
});

const fbm = Fn(([pos]: [any]) => {
  const p = vec3(pos).toVar();
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

/**
 * Demonstrates the cube-sphere terrain query API:
 * - A cone marker snapped to the surface at a lat/long, oriented to the normal
 *   (via `query.sampleTerrainByLatLong`).
 * - Click anywhere on the planet to drop a sphere at the picked point
 *   (via `raycast.pick`).
 */
function QueryDemo({
  terrain,
  latitude,
  longitude,
  radius,
}: {
  terrain: TerrainHandle;
  latitude: number;
  longitude: number;
  radius: number;
}) {
  const markerRef = useRef<THREE.Object3D>(null);
  const upAxis = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const [pick, setPick] = useState<{
    position: [number, number, number];
    normal: [number, number, number];
  } | null>(null);

  // Marker height scales with the planet so it stays visible.
  const markerHeight = Math.max(8, radius * 0.04);

  useFrame(() => {
    const marker = markerRef.current;
    const query = terrain.runtime.sphereQuery;
    if (!marker || !query) return;
    const sample = query.sampleTerrainByLatLong(latitude, longitude);
    if (!sample.valid) {
      marker.visible = false;
      return;
    }
    marker.visible = true;
    // Sit the cone's base on the surface, pointing along the normal.
    marker.position
      .copy(sample.position)
      .addScaledVector(sample.normal, markerHeight * 0.5);
    marker.quaternion.setFromUnitVectors(upAxis, sample.normal);
  });

  const handlePointerDown = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      const raycast = terrain.runtime.raycast;
      if (!raycast) return;
      event.stopPropagation();
      const hit = raycast.pick(event.ray);
      if (hit) {
        setPick({
          position: [hit.position.x, hit.position.y, hit.position.z],
          normal: [hit.normal.x, hit.normal.y, hit.normal.z],
        });
      }
    },
    [terrain],
  );

  return (
    <group>
      {/* Invisible pick target: a sphere enclosing the terrain shell so R3F
          pointer events fire, then we resolve the precise hit ourselves. */}
      <mesh onPointerDown={handlePointerDown}>
        <sphereGeometry args={[radius * 1.2, 32, 32]} />
        <meshStandardNodeMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      <mesh ref={markerRef} visible={false}>
        <coneGeometry args={[markerHeight * 0.35, markerHeight, 16]} />
        <meshStandardNodeMaterial color="#ff3b30" />
      </mesh>

      {pick && (
        <mesh position={pick.position}>
          <sphereGeometry args={[markerHeight * 0.45, 16, 16]} />
          <meshStandardNodeMaterial color="#34c759" />
        </mesh>
      )}
    </group>
  );
}

function CubeSpherePlanetSceneImpl({ store }: { store: LevaStore }) {
  const controls = useControls(
    "Cube-Sphere Planet",
    {
      radius: {
        value: 1000,
        min: 100,
        max: 4000,
        step: 50,
        label: "radius",
      },
      maxLevel: {
        value: 16,
        min: 2,
        max: 24,
        step: 1,
        label: "max level",
      },
      maxNodes: {
        value: 2048,
        min: 128,
        max: 4096,
        step: 1,
        label: "max nodes",
      },
      skirtScale: {
        value: 4,
        min: 0,
        max: 200,
        step: 1,
        label: "skirt scale",
      },
      elevationScale: {
        value: 60,
        min: 0,
        max: 400,
        step: 1,
        label: "elevation scale",
      },
      noiseFrequency: {
        value: 2.5,
        min: 0.2,
        max: 12,
        step: 0.1,
        label: "noise frequency",
      },
      seaLevel: {
        value: 0.35,
        min: 0,
        max: 1,
        step: 0.01,
        label: "sea level",
      },
      wireframe: {
        value: false,
      },
      showQuery: {
        value: true,
        label: "query demo",
      },
      latitude: {
        value: 20,
        min: -90,
        max: 90,
        step: 1,
        label: "marker latitude",
      },
      longitude: {
        value: 40,
        min: -180,
        max: 180,
        step: 1,
        label: "marker longitude",
      },
    },
    { store },
  );

  const surface = useMemo(
    () =>
      createCubeSphereSurface({
        radius: controls.radius,
        maxHeight: controls.elevationScale,
      }),
    [controls.radius, controls.elevationScale],
  );

  const elevation = useMemo<ElevationCallback>(() => {
    return ({ worldPosition }) => {
      // worldPosition is a point on the sphere; sampling its unit direction
      // keeps noise frequency independent of the planet radius.
      const dir = worldPosition.normalize();
      const n = fbm(dir.mul(float(controls.noiseFrequency)));
      // Flatten oceans below the sea level, keep land above it.
      const sea = float(controls.seaLevel);
      const land = smoothstep(sea, sea.add(0.05), n);
      return clamp(n.sub(sea), float(0), float(1)).mul(land);
    };
  }, [controls.noiseFrequency, controls.seaLevel]);

  const colorNode = useMemo(() => {
    const radiusNode = float(controls.radius);
    const elevScaleNode = float(controls.elevationScale);
    return Fn(() => {
      // Recover normalized elevation from the displaced world position.
      const height = positionWorld.length().sub(radiusNode).div(elevScaleNode);
      const ocean = vec3(0.05, 0.2, 0.45);
      const beach = vec3(0.8, 0.73, 0.5);
      const grass = vec3(0.2, 0.45, 0.18);
      const rock = vec3(0.42, 0.38, 0.34);
      const snow = vec3(0.95, 0.96, 0.98);

      const c1 = mix(ocean, beach, smoothstep(float(0), float(0.02), height));
      const c2 = mix(c1, grass, smoothstep(float(0.02), float(0.15), height));
      const c3 = mix(c2, rock, smoothstep(float(0.35), float(0.6), height));
      return mix(c3, snow, smoothstep(float(0.7), float(0.9), height));
    })();
  }, [controls.radius, controls.elevationScale]);

  const terrain = useTerrain({
    surface,
    radius: controls.radius,
    maxLevel: controls.maxLevel,
    maxNodes: controls.maxNodes,
    skirtScale: controls.skirtScale,
    elevationScale: controls.elevationScale,
    elevation,
  });

  return (
    <>
      <Terrain terrain={terrain} maxNodes={controls.maxNodes} frustumCulled={false}>
        {({ positionNode }) => (
          <meshStandardNodeMaterial
            positionNode={positionNode}
            colorNode={controls.wireframe ? undefined : colorNode}
            color={controls.wireframe ? "white" : undefined}
            wireframe={controls.wireframe}
            metalness={0.05}
            roughness={0.95}
          />
        )}
      </Terrain>
      {controls.showQuery && (
        <QueryDemo
          terrain={terrain}
          latitude={controls.latitude}
          longitude={controls.longitude}
          radius={controls.radius}
        />
      )}
    </>
  );
}

export default function CubeSpherePlanetScene() {
  const store = useCreateStore();

  return (
    <ExamplesCanvas store={store}>
      <div className="pointer-events-none absolute z-10 bottom-2 left-2 right-2 md:left-auto md:bottom-4 md:right-4 md:max-w-xs flex flex-col gap-1.5">
        <FpsDebug />
      </div>
      <Canvas
        className="touch-none relative left-0 top-0 h-full w-full"
        gl={async (props) => {
          props.alpha = true;
          props.antialias = true;
          const renderer = new THREE.WebGPURenderer(props as WebGPURendererParameters);
          renderer.logarithmicDepthBuffer = true;
          await renderer.init();
          return renderer;
        }}
        camera={{
          near: 1,
          far: 100000,
          position: [0, 1200, 2600],
        }}
        dpr={[1, 1]}
        performance={{ min: 0.5 }}
      >
        <Environment preset="sunset" />
        <ambientLight intensity={0.3} />
        <directionalLight intensity={1.5} position={[1, 0.6, 0.8]} />
        <CubeSpherePlanetSceneImpl store={store} />
        <OrbitControls makeDefault target={[0, 0, 0]} />
      </Canvas>
    </ExamplesCanvas>
  );
}
