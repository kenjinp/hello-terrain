"use client";

import { ExamplesCanvas } from "@/components/ExamplesCanvas";
import { FpsDebug } from "@/components/FpsDebug";
import {
  createTorusColorNode,
  createTorusElevation,
} from "@/examples/terrain/torusNoise";
import { Terrain, useTerrain, type TerrainHandle } from "@hello-terrain/react";
import { createTorusTopology } from "@hello-terrain/three";
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
 * Demonstrates the generic closed-surface query API on a torus:
 * - A cone marker snapped to the surface above a moving world point
 *   (via `surfaceQuery.sampleTerrainByPosition`).
 * - Click on the donut to drop a sphere at the picked point. The `<Terrain>`
 *   component receives R3F pointer events directly (its mesh raycasts against
 *   the real surface), so `event.point` is the exact hit and clicks that miss
 *   the donut do nothing — no invisible pick proxy required.
 *
 * Note: the exact same runtime API powers the cube-sphere example — only the
 * injected topology/projection differs.
 */
function QueryDemo({
  terrain,
  majorRadius,
  minorRadius,
  angle,
  markerHeight,
}: {
  terrain: TerrainHandle;
  majorRadius: number;
  minorRadius: number;
  angle: number;
  markerHeight: number;
}) {
  const markerRef = useRef<THREE.Object3D>(null);
  const upAxis = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const probe = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    const marker = markerRef.current;
    const query = terrain.runtime.surfaceQuery;
    if (!marker || !query) return;
    // A point well outside the tube on the major circle at `angle`; the query
    // projects it onto the surface.
    const theta = (angle * Math.PI) / 180;
    const r = majorRadius + minorRadius * 2;
    probe.set(Math.sin(theta) * r, 0, Math.cos(theta) * r);
    const sample = query.sampleTerrainByPosition(probe);
    if (!sample.valid) {
      marker.visible = false;
      return;
    }
    marker.visible = true;
    marker.position
      .copy(sample.position)
      .addScaledVector(sample.normal, markerHeight * 0.5);
    marker.quaternion.setFromUnitVectors(upAxis, sample.normal);
  });

  return (
    <mesh ref={markerRef} visible={false}>
      <coneGeometry args={[markerHeight * 0.35, markerHeight, 16]} />
      <meshStandardNodeMaterial color="#ff3b30" />
    </mesh>
  );
}

function TorusTerrainSceneImpl({ store }: { store: LevaStore }) {
  const controls = useControls(
    "Torus Terrain",
    {
      majorRadius: {
        value: 1000,
        min: 200,
        max: 3000,
        step: 50,
        label: "major radius",
      },
      minorRadius: {
        value: 360,
        min: 60,
        max: 1200,
        step: 10,
        label: "minor radius",
      },
      maxLevel: {
        value: 16,
        min: 2,
        max: 24,
        step: 1,
        label: "max level",
      },
      maxNodes: {
        value: 4096,
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
        value: 40,
        min: 0,
        max: 300,
        step: 1,
        label: "elevation scale",
      },
      noiseFrequency: {
        value: 3,
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
      markerAngle: {
        value: 35,
        min: -180,
        max: 180,
        step: 1,
        label: "marker angle",
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
      createTorusTopology({
        majorRadius: controls.majorRadius,
        minorRadius: controls.minorRadius,
        invert: controls.invert,
      }),
    [controls.majorRadius, controls.minorRadius, controls.invert],
  );

  const elevation = useMemo(
    () =>
      createTorusElevation({
        noiseFrequency: controls.noiseFrequency,
        seaLevel: controls.seaLevel,
        majorRadius: controls.majorRadius,
      }),
    [controls.noiseFrequency, controls.seaLevel, controls.majorRadius],
  );

  const colorNode = useMemo(
    () =>
      createTorusColorNode({
        majorRadius: controls.majorRadius,
        minorRadius: controls.minorRadius,
        elevationScale: controls.elevationScale,
        invert: controls.invert,
      }),
    [
      controls.majorRadius,
      controls.minorRadius,
      controls.elevationScale,
      controls.invert,
    ],
  );

  const terrain = useTerrain({
    topology,
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
  const markerHeight = Math.max(8, controls.minorRadius * 0.12);

  // The terrain mesh raycasts against the real surface, so this only fires when
  // the click actually lands on the donut; `event.point` is the precise hit.
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
          majorRadius={controls.majorRadius}
          minorRadius={controls.minorRadius}
          angle={controls.markerAngle}
          markerHeight={markerHeight}
        />
      )}
    </>
  );
}

export default function TorusTerrainScene() {
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
          const renderer = new THREE.WebGPURenderer(
            props as WebGPURendererParameters,
          );
          renderer.logarithmicDepthBuffer = true;
          await renderer.init();
          return renderer;
        }}
        camera={{
          near: 1,
          far: 100000,
          position: [0, 1800, 2600],
        }}
        dpr={[1, 1]}
        performance={{ min: 0.5 }}
      >
        <Environment preset="sunset" />
        <ambientLight intensity={0.3} />
        <directionalLight intensity={1.5} position={[1, 0.6, 0.8]} />
        <TorusTerrainSceneImpl store={store} />
        <OrbitControls makeDefault target={[0, 0, 0]} />
      </Canvas>
    </ExamplesCanvas>
  );
}
