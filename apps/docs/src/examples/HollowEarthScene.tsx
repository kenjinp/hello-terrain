"use client";

import { ExamplesCanvas, useExamplesCanvas } from "@/components/ExamplesCanvas";
import { FpsDebug } from "@/components/FpsDebug";
import { CelestialBodies } from "@/examples/hollow-earth/CelestialBodies";
import { CinematicCamera, SHOTS, WalkerCamera } from "@/examples/hollow-earth/cameras";
import {
  createTerrainColorNode,
  createWaterNodes,
  DETAIL_PERIOD,
  WAVE_TIME_PERIOD,
} from "@/examples/hollow-earth/materials";
import {
  createHollowEarthShading,
  createHollowEarthUniforms,
  type HollowEarthUniforms,
} from "@/examples/hollow-earth/shading";
import {
  createHollowEarthState,
  type HollowEarthState,
  ORBITING_BODIES,
  SHELL_RADIUS,
  updateHollowEarthState,
} from "@/examples/hollow-earth/world";
import { createEarthElevation } from "@/examples/terrain/earthTerrain";
import { SurfaceFlyCamera } from "@/examples/terrain/SurfaceFlyCamera";
import { Terrain, useTerrain, type TerrainNodes } from "@hello-terrain/react";
import {
  createCubeSphereTopology,
  quadtreeUpdate,
  type LodCriteria,
  type UpdateParams,
} from "@hello-terrain/three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { folder, useControls, useCreateStore } from "leva";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three/webgpu";

type LevaStore = ReturnType<typeof useCreateStore>;
type CameraMode = string;

// Pinned so the material's skirt-vertex detection can't drift from the mesh.
const INNER_TILE_SEGMENTS = 61;
const SHOT_SECONDS = 18;

function wrap(value: number, period: number) {
  return ((value % period) + period) % period;
}

/**
 * The water's material. `<Terrain>` clones its child to add `attach`, so this
 * forwards it; the wrapped position node is memoised per terrain position node.
 */
function WaterMaterial({
  positionNode,
  water,
  attach,
}: {
  positionNode: TerrainNodes["positionNode"];
  water: ReturnType<typeof createWaterNodes>;
  attach?: string;
}) {
  const waterPosition = useMemo(
    () => (positionNode ? water.positionNode(positionNode) : null),
    [positionNode, water],
  );
  if (!waterPosition) return null;
  return (
    <meshBasicNodeMaterial
      attach={attach}
      positionNode={waterPosition}
      colorNode={water.colorNode}
    />
  );
}

function useUniformControls(
  uniforms: HollowEarthUniforms,
  controls: {
    sunIntensity: number;
    airDensity: number;
    haze: number;
    ozone: number;
    scaleHeight: number;
    mieAnisotropy: number;
    terminatorWarmth: number;
    worldshine: number;
    waveHeight: number;
    waterClarity: number;
  },
) {
  useEffect(() => {
    uniforms.sunIntensity.value = controls.sunIntensity;
    uniforms.rayleighDensity.value = controls.airDensity;
    uniforms.mieDensity.value = controls.airDensity * controls.haze;
    uniforms.ozoneDensity.value = controls.airDensity * controls.ozone;
    uniforms.scaleHeight.value = controls.scaleHeight;
    uniforms.mieAnisotropy.value = controls.mieAnisotropy;
    uniforms.terminatorWarmth.value = controls.terminatorWarmth;
    uniforms.worldshine.value = controls.worldshine;
    uniforms.waveHeight.value = controls.waveHeight;
    uniforms.waterClarity.value = controls.waterClarity;
  }, [
    uniforms,
    controls.sunIntensity,
    controls.airDensity,
    controls.haze,
    controls.ozone,
    controls.scaleHeight,
    controls.mieAnisotropy,
    controls.terminatorWarmth,
    controls.worldshine,
    controls.waveHeight,
    controls.waterClarity,
  ]);
}

/**
 * An Earth-sized world turned inside out: the terrain is an inverted
 * cube-sphere, the sun sits at the centre, and orbiting bodies cast the
 * shadows that make night.
 */
function HollowEarthSceneImpl({
  store,
  mode,
  state,
}: {
  store: LevaStore;
  mode: CameraMode;
  state: HollowEarthState;
}) {
  const controls = useControls(
    "Hollow Earth",
    {
      time: folder({
        dayLength: { value: 150, min: 10, max: 1800, step: 10, label: "day (s)" },
        paused: { value: false },
      }),
      atmosphere: folder(
        {
          airDensity: { value: 1, min: 0, max: 6, step: 0.05 },
          haze: { value: 1, min: 0, max: 10, step: 0.1 },
          ozone: { value: 1, min: 0, max: 4, step: 0.1 },
          scaleHeight: { value: 1, min: 0.5, max: 4, step: 0.1 },
          mieAnisotropy: { value: 0.76, min: 0, max: 0.95, step: 0.01 },
        },
        { collapsed: true },
      ),
      light: folder(
        {
          sunIntensity: { value: 20, min: 1, max: 60, step: 1 },
          exposure: { value: 0.22, min: 0.02, max: 2, step: 0.01 },
          terminatorWarmth: { value: 0.7, min: 0, max: 1, step: 0.05 },
          worldshine: { value: 0.045, min: 0, max: 0.4, step: 0.005 },
        },
        { collapsed: true },
      ),
      water: folder(
        {
          showWater: { value: true, label: "enabled" },
          waveHeight: { value: 1, min: 0, max: 2.5, step: 0.05 },
          waterClarity: { value: 1, min: 0.2, max: 4, step: 0.1 },
        },
        { collapsed: true },
      ),
      player: folder(
        {
          eyeHeight: { value: 12, min: 2, max: 200, step: 1 },
          walkSpeed: { value: 60, min: 2, max: 500, step: 1 },
        },
        { collapsed: true },
      ),
      terrain: folder(
        {
          elevationScale: { value: 10_000, min: 1_000, max: 20_000, step: 500 },
          skirtScale: { value: 2_000, min: 0, max: 20_000, step: 100 },
          // See the Earth-Scale Planet example: level 14 keeps vertices ~10 m
          // apart, above the float32 precision floor at this radius.
          maxLevel: { value: 14, min: 6, max: 18, step: 1 },
          maxNodes: { value: 1536, min: 128, max: 4096, step: 1 },
          distanceFactor: { value: 4, min: 0.5, max: 4, step: 0.1 },
        },
        { collapsed: true },
      ),
    },
    { store },
  );

  const uniforms = useMemo(createHollowEarthUniforms, []);
  const shading = useMemo(() => createHollowEarthShading(uniforms), [uniforms]);
  useUniformControls(uniforms, controls);

  // `invert: true` displaces elevation towards the centre and flips the
  // winding, so the same Earth-like elevation function builds its continents
  // on the inside of the sphere.
  const topology = useMemo(
    () => createCubeSphereTopology({ radius: SHELL_RADIUS, invert: true }),
    [],
  );

  const elevation = useMemo(
    () =>
      createEarthElevation({
        sampleRadius: SHELL_RADIUS,
        continentFrequency: 2,
        seaLevel: 0.5,
        coastWidth: 0.04,
        continentWarp: 0.15,
        warpFrequency: 1.5,
        landHeight: 0.6,
        oceanDepth: 1,
        mountainFrequency: 8,
        ruggedness: 0.5,
      }),
    [],
  );

  const terrain = useTerrain({
    topology,
    radius: SHELL_RADIUS,
    maxLevel: controls.maxLevel,
    maxNodes: controls.maxNodes,
    innerTileSegments: INNER_TILE_SEGMENTS,
    skirtScale: controls.skirtScale,
    elevationScale: controls.elevationScale,
    elevation,
  });

  useEffect(() => {
    const lod: LodCriteria = { mode: "distance", distanceFactor: controls.distanceFactor };
    terrain.graph.set(quadtreeUpdate, (prev: UpdateParams) => ({ ...prev, ...lod }));
  }, [terrain.graph, controls.distanceFactor]);

  const terrainColor = useMemo(
    () =>
      createTerrainColorNode(uniforms, shading, {
        skirtScale: controls.skirtScale,
        innerTileSegments: INNER_TILE_SEGMENTS,
      }),
    [uniforms, shading, controls.skirtScale],
  );
  const water = useMemo(
    () =>
      createWaterNodes(uniforms, shading, {
        skirtScale: controls.skirtScale,
        innerTileSegments: INNER_TILE_SEGMENTS,
      }),
    [uniforms, shading, controls.skirtScale],
  );

  const renderer = useThree((three) => three.renderer) as unknown as THREE.WebGPURenderer;
  useEffect(() => {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
  }, [renderer]);
  useEffect(() => {
    renderer.toneMappingExposure = controls.exposure;
  }, [renderer, controls.exposure]);

  // `[` and `]` step the clock by an hour, so any moment of the day (or any
  // eclipse) can be dialled in without waiting for it.
  useEffect(() => {
    const canvas = renderer.domElement as HTMLCanvasElement;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "BracketLeft" && event.code !== "BracketRight") return;
      const container = canvas.closest<HTMLElement>('[tabindex="0"]');
      const focused = container?.contains(document.activeElement) ?? false;
      if (!focused && !document.fullscreenElement) return;
      const hours = (event.code === "BracketRight" ? 1 : -1) * (event.shiftKey ? 6 : 1);
      updateHollowEarthState(state, state.days + hours / 24);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [renderer, state]);

  const seconds = useRef(0);
  useFrame((_, delta) => {
    if (!controls.paused) {
      const step = Math.min(delta, 0.25);
      seconds.current += step;
      updateHollowEarthState(state, state.days + step / controls.dayLength);
    }
    for (let i = 0; i < ORBITING_BODIES.length; i++) {
      const centre = state.bodyPositions[i];
      uniforms.bodies[i].value.set(centre.x, centre.y, centre.z, ORBITING_BODIES[i].radius);
    }
    uniforms.waveTime.value = wrap(seconds.current, WAVE_TIME_PERIOD);
  });

  // Waves and ground detail are evaluated relative to the camera; hand them
  // the camera's position modulo the detail period, computed here in float64,
  // right before each terrain draw so it can never lag the camera by a frame.
  const syncDetailOrigin = useCallback(
    (_renderer: unknown, _scene: unknown, camera: THREE.Camera) => {
      uniforms.detailOrigin.value.set(
        wrap(camera.position.x, DETAIL_PERIOD),
        wrap(camera.position.y, DETAIL_PERIOD),
        wrap(camera.position.z, DETAIL_PERIOD),
      );
    },
    [uniforms],
  );

  return (
    <>
      <color attach="background" args={["#000000"]} />
      <Terrain
        terrain={terrain}
        maxNodes={controls.maxNodes}
        frustumCulled={false}
        onBeforeRender={syncDetailOrigin}
      >
        {({ positionNode }) => (
          <meshBasicNodeMaterial positionNode={positionNode} colorNode={terrainColor} />
        )}
      </Terrain>
      {controls.showWater && (
        <Terrain
          terrain={terrain}
          maxNodes={controls.maxNodes}
          frustumCulled={false}
          onBeforeRender={syncDetailOrigin}
        >
          {({ positionNode }) => <WaterMaterial positionNode={positionNode} water={water} />}
        </Terrain>
      )}
      <CelestialBodies uniforms={uniforms} shading={shading} state={state} />
      {mode === "walk" ? (
        <WalkerCamera
          terrain={terrain}
          eyeHeight={controls.eyeHeight}
          walkSpeed={controls.walkSpeed}
        />
      ) : mode === "fly" ? (
        <SurfaceFlyCamera terrain={terrain} worldRadius={SHELL_RADIUS} surfaceClearance={3} />
      ) : (
        <CinematicCamera shotId={mode} state={state} terrain={terrain} />
      )}
    </>
  );
}

const MODE_HINTS: Record<string, string> = {
  walk: "Click to look · WASD move · Space jump · Shift sprint · Esc release",
  fly: "Click to look · WASD move · Space/C up/down · Q/E roll · Shift boost",
};

/** Day counter, refreshed a few times a second from the simulation state. */
function Clock({ state }: { state: HollowEarthState }) {
  const label = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const write = () => {
      if (!label.current) return;
      const day = Math.floor(state.days);
      const hours = (state.days - day) * 24;
      const hh = String(Math.floor(hours)).padStart(2, "0");
      const mm = String(Math.floor((hours % 1) * 60)).padStart(2, "0");
      label.current.textContent = `Day ${day + 1} · ${hh}:${mm}`;
    };
    write();
    const timer = window.setInterval(write, 250);
    return () => window.clearInterval(timer);
  }, [state]);

  return (
    <p className="rounded-md bg-black/50 px-2 py-1 text-[11px] text-white/80 backdrop-blur-sm tabular-nums">
      <span ref={label} /> · <kbd>[</kbd> <kbd>]</kbd> scrub
    </p>
  );
}

/** Shot picker, tour toggle and player-camera buttons, overlaid on the canvas. */
function CameraBar({
  mode,
  touring,
  state,
  onSelect,
  onToggleTour,
}: {
  mode: CameraMode;
  touring: boolean;
  state: HollowEarthState;
  onSelect: (mode: CameraMode) => void;
  onToggleTour: () => void;
}) {
  const { showUI } = useExamplesCanvas();
  const base =
    "cursor-pointer rounded-md px-2 py-1 text-xs backdrop-blur-sm border transition-colors";
  const idle = "bg-black/50 hover:bg-black/70 text-white border-white/10";
  const active = "bg-white/90 text-black border-black/10";

  return (
    <div
      className={`absolute z-10 top-12 left-2 right-14 md:top-16 md:left-4 flex flex-col items-start gap-1.5 transition-opacity ${
        showUI ? "opacity-100" : "opacity-0 pointer-events-none"
      }`}
    >
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          onClick={onToggleTour}
          aria-pressed={touring}
          className={`${base} ${touring ? active : idle}`}
          title="Cut between the cinematic shots automatically"
        >
          {touring ? "■ Tour" : "▶ Tour"}
        </button>
        {SHOTS.map((shot) => (
          <button
            key={shot.id}
            type="button"
            onClick={() => onSelect(shot.id)}
            aria-pressed={mode === shot.id}
            className={`${base} ${mode === shot.id ? active : idle}`}
          >
            {shot.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          onClick={() => onSelect("walk")}
          aria-pressed={mode === "walk"}
          className={`${base} ${mode === "walk" ? active : idle}`}
        >
          Walk
        </button>
        <button
          type="button"
          onClick={() => onSelect("fly")}
          aria-pressed={mode === "fly"}
          className={`${base} ${mode === "fly" ? active : idle}`}
        >
          Fly
        </button>
      </div>
      <Clock state={state} />
      {MODE_HINTS[mode] && (
        <p className="rounded-md bg-black/50 px-2 py-1 text-[11px] text-white/80 backdrop-blur-sm">
          {MODE_HINTS[mode]}
        </p>
      )}
    </div>
  );
}

export default function HollowEarthScene() {
  const store = useCreateStore();
  const state = useMemo(createHollowEarthState, []);
  const [mode, setMode] = useState<CameraMode>(SHOTS[0].id);
  const [touring, setTouring] = useState(true);

  useEffect(() => {
    if (!touring) return;
    const timer = window.setInterval(() => {
      setMode((current) => {
        const index = SHOTS.findIndex((shot) => shot.id === current);
        return SHOTS[(index + 1) % SHOTS.length].id;
      });
    }, SHOT_SECONDS * 1000);
    return () => window.clearInterval(timer);
  }, [touring]);

  const selectMode = useCallback((next: CameraMode) => {
    setTouring(false);
    setMode(next);
  }, []);

  const toggleTour = useCallback(() => {
    // Resuming the tour from a player camera starts it at the first shot.
    if (!touring && !SHOTS.some((shot) => shot.id === mode)) setMode(SHOTS[0].id);
    setTouring(!touring);
  }, [mode, touring]);

  return (
    <ExamplesCanvas store={store}>
      <CameraBar
        mode={mode}
        touring={touring}
        state={state}
        onSelect={selectMode}
        onToggleTour={toggleTour}
      />
      <div className="pointer-events-none absolute z-10 bottom-2 left-2 right-2 md:left-auto md:bottom-4 md:right-4 md:max-w-xs flex flex-col gap-1.5">
        <FpsDebug />
      </div>
      <Canvas
        className="touch-none relative left-0 top-0 h-full w-full"
        renderer={{ antialias: true, logarithmicDepthBuffer: true }}
        camera={{
          near: 0.5,
          far: SHELL_RADIUS * 4,
          fov: 55,
          position: [2.2e6, 0.9e6, 1.3e6],
        }}
        dpr={[1, 1]}
        performance={{ min: 0.5 }}
      >
        <HollowEarthSceneImpl store={store} mode={mode} state={state} />
      </Canvas>
    </ExamplesCanvas>
  );
}
