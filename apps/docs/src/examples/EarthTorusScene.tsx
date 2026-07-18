"use client";

import { ExamplesCanvas } from "@/components/ExamplesCanvas";
import { FpsDebug } from "@/components/FpsDebug";
import { CameraModeToggle, type CameraMode } from "@/examples/terrain/CameraModeToggle";
import {
  createEarthElevation,
  createEarthTorusColorNode,
  EARTH_AREA_TORUS_BOUNDING_RADIUS,
  EARTH_AREA_TORUS_MAJOR_RADIUS,
  EARTH_AREA_TORUS_MINOR_RADIUS,
} from "@/examples/terrain/earthTerrain";
import { SurfaceFlyCamera } from "@/examples/terrain/SurfaceFlyCamera";
import { SurfaceOrbitCamera } from "@/examples/terrain/SurfaceOrbitCamera";
import { Terrain, useTerrain } from "@hello-terrain/react";
import {
  createTorusTopology,
  quadtreeUpdate,
  type LodCriteria,
  type UpdateParams,
} from "@hello-terrain/three";
import { Canvas, extend, useThree } from "@react-three/fiber";
import { folder, useControls, useCreateStore } from "leva";
import { useEffect, useMemo, useState } from "react";
import type { WebGPURendererParameters } from "three/src/renderers/webgpu/WebGPURenderer.js";
import * as THREE from "three/webgpu";

extend({ MeshStandardNodeMaterial: THREE.MeshStandardNodeMaterial });

type LevaStore = ReturnType<typeof useCreateStore>;

// Pinned so the material's skirt-vertex detection can't drift from the mesh.
const INNER_TILE_SEGMENTS = 61;

/**
 * Stress test: a torus world with the same surface area as Earth
 * (major radius ~6.2 Mm, minor radius ~2.1 Mm), zoomable from orbit down to
 * the surface with a single orbit gesture.
 */
function EarthTorusSceneImpl({ store, cameraMode }: { store: LevaStore; cameraMode: CameraMode }) {
  const controls = useControls(
    "Earth-Area Torus",
    {
      continents: folder({
        continentFrequency: { value: 2, min: 0.2, max: 8, step: 0.1 },
        seaLevel: { value: 0.5, min: 0, max: 1, step: 0.01 },
        coastWidth: { value: 0.04, min: 0.001, max: 0.3, step: 0.001 },
        continentWarp: { value: 0.15, min: 0, max: 1, step: 0.01 },
        warpFrequency: { value: 1.5, min: 0.2, max: 6, step: 0.1 },
      }),
      relief: folder({
        landHeight: { value: 0.6, min: 0, max: 2, step: 0.01 },
        oceanDepth: { value: 1, min: 0, max: 2, step: 0.01 },
        mountainFrequency: { value: 8, min: 1, max: 24, step: 0.5 },
        ruggedness: { value: 0.5, min: 0, max: 1.5, step: 0.01 },
      }),
      elevationScale: { value: 10_000, min: 1_000, max: 20_000, step: 500 },
      // Same reasoning as the Earth planet example: skirts hide sub-pixel
      // cracks between tile instances, and the material adds the drop back for
      // skirt vertices before the colour lookup, so the wall always wears the
      // colour of the edge it extends from. Slide to 0 to see the raw cracks.
      skirtScale: { value: 2_000, min: 0, max: 20_000, step: 100 },
      // Same float32 precision floor as the Earth planet example: world
      // positions are ~6e6 m, so past level ~15 vertex positions quantise to
      // ~1 ULP apart and the surface dissolves into shard noise.
      maxLevel: { value: 14, min: 6, max: 18, step: 1 },
      maxNodes: { value: 1024, min: 128, max: 4096, step: 1 },
      lod: folder({
        lodMode: { value: "distance", options: ["distance", "screen"] },
        distanceFactor: { value: 4, min: 0.5, max: 4, step: 0.1 },
        targetPixels: { value: 16, min: 4, max: 128, step: 1 },
      }),
      wireframe: { value: false },
    },
    { store },
  );

  const topology = useMemo(
    () =>
      createTorusTopology({
        majorRadius: EARTH_AREA_TORUS_MAJOR_RADIUS,
        minorRadius: EARTH_AREA_TORUS_MINOR_RADIUS,
        invert: false,
      }),
    [],
  );

  const elevation = useMemo(
    () =>
      createEarthElevation({
        sampleRadius: EARTH_AREA_TORUS_MAJOR_RADIUS,
        continentFrequency: controls.continentFrequency,
        seaLevel: controls.seaLevel,
        coastWidth: controls.coastWidth,
        continentWarp: controls.continentWarp,
        warpFrequency: controls.warpFrequency,
        landHeight: controls.landHeight,
        oceanDepth: controls.oceanDepth,
        mountainFrequency: controls.mountainFrequency,
        ruggedness: controls.ruggedness,
      }),
    [
      controls.continentFrequency,
      controls.seaLevel,
      controls.coastWidth,
      controls.continentWarp,
      controls.warpFrequency,
      controls.landHeight,
      controls.oceanDepth,
      controls.mountainFrequency,
      controls.ruggedness,
    ],
  );

  const colorNode = useMemo(
    () =>
      createEarthTorusColorNode({
        majorRadius: EARTH_AREA_TORUS_MAJOR_RADIUS,
        minorRadius: EARTH_AREA_TORUS_MINOR_RADIUS,
        skirtScale: controls.skirtScale,
        innerTileSegments: INNER_TILE_SEGMENTS,
      }),
    [controls.skirtScale],
  );

  const terrain = useTerrain({
    topology,
    maxLevel: controls.maxLevel,
    maxNodes: controls.maxNodes,
    innerTileSegments: INNER_TILE_SEGMENTS,
    skirtScale: controls.skirtScale,
    elevationScale: controls.elevationScale,
    elevation,
  });

  const viewportHeight = useThree((state) => state.size.height);
  const camera = useThree((state) => state.camera);

  const lod = useMemo<LodCriteria>(() => {
    if (controls.lodMode === "screen") {
      const fovRadians = ((camera as THREE.PerspectiveCamera).fov * Math.PI) / 180;
      return {
        mode: "screen",
        projectionFactor: viewportHeight / (2 * Math.tan(fovRadians / 2)),
        targetPixels: controls.targetPixels,
      };
    }
    return { mode: "distance", distanceFactor: controls.distanceFactor };
  }, [controls.lodMode, controls.targetPixels, controls.distanceFactor, viewportHeight, camera]);

  // The runner only writes `cameraOrigin` into this param each frame, so the
  // LOD criteria merged here persist until the controls change them again.
  useEffect(() => {
    terrain.graph.set(quadtreeUpdate, (prev: UpdateParams) => ({
      ...prev,
      ...lod,
    }));
  }, [terrain.graph, lod]);

  return (
    <>
      <Terrain terrain={terrain} maxNodes={controls.maxNodes} frustumCulled={false}>
        {({ positionNode }) => (
          <meshStandardNodeMaterial
            positionNode={positionNode}
            colorNode={colorNode}
            wireframe={controls.wireframe}
            metalness={0.0}
            roughness={1.0}
          />
        )}
      </Terrain>
      {cameraMode === "orbit" ? (
        <SurfaceOrbitCamera terrain={terrain} worldRadius={EARTH_AREA_TORUS_BOUNDING_RADIUS} />
      ) : (
        <SurfaceFlyCamera terrain={terrain} worldRadius={EARTH_AREA_TORUS_BOUNDING_RADIUS} />
      )}
    </>
  );
}

export default function EarthTorusScene() {
  const store = useCreateStore();
  const [cameraMode, setCameraMode] = useState<CameraMode>("orbit");

  return (
    <ExamplesCanvas store={store}>
      <div className="absolute z-10 top-12 left-2 md:top-16 md:left-4">
        <CameraModeToggle mode={cameraMode} onChange={setCameraMode} />
      </div>
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
          near: 0.1,
          far: Number.MAX_SAFE_INTEGER,
        }}
        dpr={[1, 1]}
        performance={{ min: 0.5 }}
      >
        <ambientLight intensity={0.3} />
        <directionalLight intensity={Math.PI} position={[1, 0.35, 0.6]} />
        <EarthTorusSceneImpl store={store} cameraMode={cameraMode} />
      </Canvas>
    </ExamplesCanvas>
  );
}
