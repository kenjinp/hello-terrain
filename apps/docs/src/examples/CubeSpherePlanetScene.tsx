"use client";

import { ExamplesCanvas } from "@/components/ExamplesCanvas";
import { FpsDebug } from "@/components/FpsDebug";
import { createPlanetColorNode, createPlanetElevation } from "@/examples/terrain/planetNoise";
import { Terrain, useTerrain, type TerrainHandle } from "@hello-terrain/react";
import { createCubeSphereTopology } from "@hello-terrain/three";
import { Environment, OrbitControls } from "@react-three/drei";
import { Canvas, extend, useFrame, type ThreeEvent } from "@react-three/fiber";
import { useControls, useCreateStore } from "leva";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  resolveTerrainMaterialAppearance,
  tileColorsLevaControl,
} from "@/examples/terrain/tileInstanceColor";
import type { WebGPURendererParameters } from "three/src/renderers/webgpu/WebGPURenderer.js";
import * as THREE from "three/webgpu";

extend({ MeshStandardNodeMaterial: THREE.MeshStandardNodeMaterial });

type LevaStore = ReturnType<typeof useCreateStore>;

/**
 * Demonstrates the cube-sphere terrain query API:
 * - A cone marker snapped to the surface at a lat/long, oriented to the normal
 *   (via `query.sampleTerrainByLatLong`).
 * - Click on the planet to drop a sphere at the picked point. The `<Terrain>`
 *   component receives R3F pointer events directly (its mesh raycasts against
 *   the real surface), so `event.point` is the exact hit and clicks that miss
 *   the planet do nothing — no invisible pick proxy required.
 */
function QueryDemo({
  terrain,
  latitude,
  longitude,
  markerHeight,
}: {
  terrain: TerrainHandle;
  latitude: number;
  longitude: number;
  markerHeight: number;
}) {
  const markerRef = useRef<THREE.Object3D>(null);
  const upAxis = useMemo(() => new THREE.Vector3(0, 1, 0), []);

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
    marker.position.copy(sample.position).addScaledVector(sample.normal, markerHeight * 0.5);
    marker.quaternion.setFromUnitVectors(upAxis, sample.normal);
  });

  return (
    <mesh ref={markerRef} visible={false}>
      <coneGeometry args={[markerHeight * 0.35, markerHeight, 16]} />
      <meshStandardNodeMaterial color="#ff3b30" />
    </mesh>
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
      invert: {
        value: false,
        label: "invert",
      },
      tileColors: tileColorsLevaControl,
    },
    { store },
  );

  const topology = useMemo(
    () =>
      createCubeSphereTopology({
        radius: controls.radius,
        invert: controls.invert,
      }),
    [controls.radius, controls.elevationScale, controls.invert],
  );

  const elevation = useMemo(
    () =>
      createPlanetElevation({
        noiseFrequency: controls.noiseFrequency,
        seaLevel: controls.seaLevel,
      }),
    [controls.noiseFrequency, controls.seaLevel],
  );

  const colorNode = useMemo(
    () =>
      createPlanetColorNode({
        radius: controls.radius,
        elevationScale: controls.elevationScale,
        invert: controls.invert,
      }),
    [controls.radius, controls.elevationScale, controls.invert],
  );

  const terrain = useTerrain({
    topology,
    radius: controls.radius,
    maxLevel: controls.maxLevel,
    maxNodes: controls.maxNodes,
    skirtScale: controls.skirtScale,
    elevationScale: controls.elevationScale,
    elevation,
  });

  const materialAppearance = resolveTerrainMaterialAppearance({
    tileColors: controls.tileColors,
    wireframe: controls.wireframe,
    colorNode,
  });

  const [pick, setPick] = useState<[number, number, number] | null>(null);
  // Marker height scales with the planet so it stays visible.
  const markerHeight = Math.max(8, controls.radius * 0.04);

  // The terrain mesh raycasts against the real surface, so this only fires when
  // the click actually lands on the planet; `event.point` is the precise hit.
  const handlePointerDown = useCallback((event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    setPick([event.point.x, event.point.y, event.point.z]);
  }, []);

  return (
    <>
      <Terrain
        terrain={terrain}
        maxNodes={controls.maxNodes}
        frustumCulled={false}
        onPointerDown={handlePointerDown}
      >
        {({ positionNode }) => (
          <meshStandardNodeMaterial
            positionNode={positionNode}
            colorNode={materialAppearance.colorNode}
            color={materialAppearance.color}
            wireframe={materialAppearance.wireframe}
            metalness={0.05}
            roughness={0.95}
          />
        )}
      </Terrain>
      {pick && (
        <mesh position={pick}>
          <sphereGeometry args={[markerHeight * 0.45, 16, 16]} />
          <meshStandardNodeMaterial color="#34c759" />
        </mesh>
      )}
      {controls.showQuery && (
        <QueryDemo
          terrain={terrain}
          latitude={controls.latitude}
          longitude={controls.longitude}
          markerHeight={markerHeight}
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
