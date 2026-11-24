"use client";

import { ExamplesCanvas, useExamplesCanvas } from "@/components/ExamplesCanvas";
import { FpsDebug } from "@/components/FpsDebug";
import { CelestialBodies } from "@/examples/hollow-earth/CelestialBodies";
import { createAtmospherePipeline } from "@/examples/hollow-earth/atmospherePass";
import {
  createCosmos,
  createCosmosNoiseTexture,
  createCosmosUniforms,
} from "@/examples/hollow-earth/cosmos";
import { CinematicCamera, SHOTS, WalkerCamera } from "@/examples/hollow-earth/cameras";
import { createHollowEarthElevation } from "@/examples/hollow-earth/elevation";
import {
  createTerrainColorNode,
  createWaterNodes,
  DETAIL_PERIOD,
  WAVE_TIME_PERIOD,
} from "@/examples/hollow-earth/materials";
import {
  isQualityId,
  QUALITY_PRESETS,
  type QualityId,
  type QualityPreset,
} from "@/examples/hollow-earth/quality";
import {
  createHollowEarthShading,
  createHollowEarthUniforms,
  type HollowEarthUniforms,
} from "@/examples/hollow-earth/shading";
import {
  createHollowEarthState,
  type HollowEarthState,
  isLightSystem,
  LIGHT_BODY_INDICES,
  LIGHT_SYSTEMS,
  type LightSystem,
  NYX_INDEX,
  ORBITING_BODIES,
  SHELL_RADIUS,
  updateHollowEarthState,
} from "@/examples/hollow-earth/world";
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

const SHOT_SECONDS = 18;
/** Metres per unit of normalised elevation. The elevation function works in metres. */
const ELEVATION_SCALE = 10_000;

function getInitialQuality(): QualityId {
  if (typeof window === "undefined") return "standard";
  const requested = new URLSearchParams(window.location.search).get("quality");
  return isQualityId(requested) ? requested : "standard";
}

function getInitialLightSystem(): LightSystem {
  if (typeof window === "undefined") return "eclipse";
  const requested = new URLSearchParams(window.location.search).get("light");
  return isLightSystem(requested) ? requested : "eclipse";
}

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
  quality,
}: {
  store: LevaStore;
  mode: CameraMode;
  state: HollowEarthState;
  quality: QualityPreset;
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
      cosmos: folder(
        {
          showCosmos: { value: true, label: "enabled" },
          starBrightness: { value: 1, min: 0, max: 4, step: 0.05, label: "stars" },
          nebulaBrightness: { value: 1, min: 0, max: 4, step: 0.05, label: "nebula glow" },
          nebulaDensity: { value: 1, min: 0, max: 2.5, step: 0.05, label: "nebula density" },
        },
        { collapsed: true },
      ),
      light: folder(
        {
          sunIntensity: { value: 20, min: 1, max: 60, step: 1 },
          exposure: { value: 0.22, min: 0.02, max: 2, step: 0.01 },
          adaptExposure: { value: true, label: "eye adaptation" },
          terminatorWarmth: { value: 0.7, min: 0, max: 1, step: 0.05 },
          worldshine: { value: 0.045, min: 0, max: 0.4, step: 0.005 },
          starlight: { value: 0.035, min: 0, max: 0.2, step: 0.001 },
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
          skirtScale: { value: 2_000, min: 0, max: 20_000, step: 100 },
          // See the Earth-Scale Planet example: level 14 keeps vertices ~10 m
          // apart, above the float32 precision floor at this radius.
          maxLevel: { value: 14, min: 6, max: 18, step: 1 },
        },
        { collapsed: true },
      ),
    },
    { store },
  );

  const uniforms = useMemo(createHollowEarthUniforms, []);
  const shading = useMemo(() => createHollowEarthShading(uniforms), [uniforms]);

  // The starscape inside the world. Its noise volume is generated once.
  const cosmosUniforms = useMemo(createCosmosUniforms, []);
  const cosmosNoise = useMemo(createCosmosNoiseTexture, []);
  useEffect(() => () => cosmosNoise.dispose(), [cosmosNoise]);
  const cosmos = useMemo(
    () =>
      controls.showCosmos ? createCosmos(uniforms, cosmosUniforms, shading, cosmosNoise) : null,
    [controls.showCosmos, uniforms, cosmosUniforms, shading, cosmosNoise],
  );
  useEffect(() => {
    cosmosUniforms.starBrightness.value = controls.starBrightness;
    cosmosUniforms.nebulaBrightness.value = controls.nebulaBrightness;
    cosmosUniforms.nebulaDensity.value = controls.nebulaDensity;
  }, [cosmosUniforms, controls.starBrightness, controls.nebulaBrightness, controls.nebulaDensity]);
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
      createHollowEarthElevation({
        elevationScale: ELEVATION_SCALE,
        innerTileSegments: quality.innerTileSegments,
      }),
    [quality.innerTileSegments],
  );

  const terrain = useTerrain({
    topology,
    radius: SHELL_RADIUS,
    maxLevel: controls.maxLevel,
    maxNodes: quality.maxNodes,
    // From the same preset the materials use, so skirt detection can't drift.
    innerTileSegments: quality.innerTileSegments,
    skirtScale: controls.skirtScale,
    elevationScale: ELEVATION_SCALE,
    elevation,
  });

  useEffect(() => {
    const lod: LodCriteria = { mode: "distance", distanceFactor: quality.lodDistanceFactor };
    terrain.graph.set(quadtreeUpdate, (prev: UpdateParams) => ({ ...prev, ...lod }));
  }, [terrain.graph, quality.lodDistanceFactor]);

  const terrainColor = useMemo(
    () =>
      createTerrainColorNode(uniforms, shading, {
        skirtScale: controls.skirtScale,
        quality,
      }),
    [uniforms, shading, controls.skirtScale, quality],
  );
  const water = useMemo(
    () =>
      createWaterNodes(uniforms, shading, {
        skirtScale: controls.skirtScale,
        quality,
      }),
    [uniforms, shading, controls.skirtScale, quality],
  );

  const renderer = useThree((three) => three.renderer) as unknown as THREE.WebGPURenderer;
  useEffect(() => {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
  }, [renderer]);

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

  // Take over the render phase: scene first, then the atmosphere over it.
  const scene = useThree((three) => three.scene) as unknown as THREE.Scene;
  const camera = useThree((three) => three.camera) as unknown as THREE.PerspectiveCamera;
  const atmosphere = useMemo(
    () => createAtmospherePipeline(renderer, scene, camera, shading, cosmos, quality),
    [renderer, scene, camera, shading, cosmos, quality],
  );
  useEffect(() => () => atmosphere.dispose(), [atmosphere]);
  useFrame(() => atmosphere.render(), { phase: "render" });

  const seconds = useRef(0);
  const adaptation = useRef(1);
  const ambientScratch = useMemo(() => new THREE.Vector3(), []);
  const starlightScratch = useMemo(() => new THREE.Vector3(), []);
  useFrame((root, delta) => {
    if (!controls.paused) {
      const step = Math.min(delta, 0.25);
      seconds.current += step;
      updateHollowEarthState(state, state.days + step / controls.dayLength);
    }
    for (let i = 0; i < ORBITING_BODIES.length; i++) {
      const centre = state.bodyPositions[i];
      // A body that does not exist in this light system casts no shadow.
      const radius = i === NYX_INDEX && !state.nyxPresent ? 0 : ORBITING_BODIES[i].radius;
      uniforms.bodies[i].value.set(centre.x, centre.y, centre.z, radius);
    }

    // Lights: the sun stays at the origin; each lamp rides its body.
    ambientScratch.set(0, 0, 0);
    uniforms.lights.forEach((light, index) => {
      const color = state.lightColors[index];
      light.color.value.copy(color);
      if (index > 0) {
        const centre = state.bodyPositions[LIGHT_BODY_INDICES[index - 1]];
        light.position.value.set(centre.x, centre.y, centre.z, light.position.value.w);
      }
      ambientScratch.add(color);
    });
    // Fill light: what is shining, bounced off the rest of the shell and
    // tinted by the sky, plus the starscape — which is all there is at night.
    uniforms.ambient.value
      .set(0.62, 0.78, 1.0)
      .multiply(ambientScratch)
      .multiplyScalar(controls.worldshine)
      .add(
        starlightScratch
          .set(0.55, 0.62, 1.0)
          .multiplyScalar(controls.showCosmos ? controls.starlight * controls.starBrightness : 0),
      );
    // Eye adaptation: open up as the light goes, the way dusk does not look
    // a hundred times darker than noon. Eased, so a lamp catching does not
    // snap the exposure.
    const gain = controls.adaptExposure
      ? Math.min(7, Math.max(state.brightness, 0.015) ** -0.45)
      : 1;
    adaptation.current += (gain - adaptation.current) * Math.min(1, delta * 2.5);
    renderer.toneMappingExposure = controls.exposure * adaptation.current;
    atmosphere.setAdaptation(1 / adaptation.current);
    // A sun that has merely dimmed still shows embers; a dead one does not.
    uniforms.sunEmbers.value = state.lightSystem === "pulse" ? 1 : 0;
    cosmosUniforms.pixelAngle.value =
      THREE.MathUtils.degToRad(camera.fov) / Math.max(1, renderer.domElement.height);
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
        maxNodes={quality.maxNodes}
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
          maxNodes={quality.maxNodes}
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
  // `?quality=high` or `?quality=ultra` picks the starting preset.
  const { quality: qualityId } = useControls(
    {
      quality: {
        value: getInitialQuality(),
        options: Object.fromEntries(
          Object.entries(QUALITY_PRESETS).map(([id, preset]) => [preset.label, id]),
        ) as Record<string, QualityId>,
      },
    },
    { store },
  );
  const quality: QualityPreset = QUALITY_PRESETS[qualityId];

  // `?light=pulse` or `?light=relay` picks the starting light system.
  const { lighting } = useControls(
    {
      lighting: {
        value: getInitialLightSystem(),
        options: Object.fromEntries(
          Object.entries(LIGHT_SYSTEMS).map(([id, label]) => [label, id]),
        ) as Record<string, LightSystem>,
      },
    },
    { store },
  );
  useEffect(() => {
    state.lightSystem = lighting;
    updateHollowEarthState(state, state.days);
  }, [state, lighting]);
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
        renderer={{ antialias: false, logarithmicDepthBuffer: true }}
        camera={{
          near: 0.5,
          far: SHELL_RADIUS * 4,
          fov: 55,
          position: [2.2e6, 0.9e6, 1.3e6],
        }}
        dpr={[1, quality.maxDpr]}
        performance={{ min: 0.5 }}
      >
        {/* Keyed: a preset changes shader loop counts and the terrain allocation. */}
        <HollowEarthSceneImpl
          key={qualityId}
          store={store}
          mode={mode}
          state={state}
          quality={quality}
        />
      </Canvas>
    </ExamplesCanvas>
  );
}
