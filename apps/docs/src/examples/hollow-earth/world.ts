import { EARTH_AUTHALIC_RADIUS } from "@/examples/terrain/earthTerrain";
import { Vector3 } from "three";

/**
 * Sea-level radius of the shell. The terrain is an inverted cube-sphere, so
 * land rises *inward* from this radius (towards the sun) and ocean floors sit
 * outside it.
 */
export const SHELL_RADIUS = EARTH_AUTHALIC_RADIUS;

/** Radius of the central sun, in metres (~1.08° of sky from the shell). */
export const SUN_RADIUS = 120_000;

export interface OrbitingBody {
  name: string;
  /** Body radius in metres. */
  radius: number;
  /** Orbit radius (distance from the central sun) in metres. */
  orbitRadius: number;
  /** Orbital period in days (1 day = one revolution of Nyx). */
  periodDays: number;
  inclinationDeg: number;
  /** Longitude of the ascending node at day 0. */
  ascendingNodeDeg: number;
  /** Orbital phase at day 0. */
  phaseDeg: number;
  /** Days for the ascending node to precess once around (0 = fixed plane). */
  precessionDays: number;
  /** Linear-space surface albedo. */
  albedo: [number, number, number];
}

/**
 * The occluders. `Nyx` hugs the sun and blocks a ~55° cone of light: its
 * shadow sweeping the shell once per day *is* the night. The outer moons are
 * small and far from the sun, so they cast travelling eclipse spots instead.
 */
export const ORBITING_BODIES: readonly OrbitingBody[] = [
  {
    name: "Nyx",
    radius: 820_000,
    orbitRadius: 1_000_000,
    periodDays: 1,
    inclinationDeg: 23.4,
    ascendingNodeDeg: 0,
    phaseDeg: 180,
    precessionDays: 24,
    albedo: [0.035, 0.032, 0.04],
  },
  {
    name: "Selene",
    radius: 350_000,
    orbitRadius: 3_200_000,
    periodDays: 2.7,
    inclinationDeg: 12,
    ascendingNodeDeg: 40,
    phaseDeg: 15,
    precessionDays: 0,
    albedo: [0.2, 0.19, 0.18],
  },
  {
    name: "Ember",
    radius: 180_000,
    orbitRadius: 2_100_000,
    periodDays: 1.6,
    inclinationDeg: 48,
    ascendingNodeDeg: 150,
    phaseDeg: 230,
    precessionDays: 0,
    albedo: [0.3, 0.14, 0.07],
  },
  {
    name: "Brume",
    radius: 260_000,
    orbitRadius: 4_300_000,
    periodDays: -5.2,
    inclinationDeg: 30,
    ascendingNodeDeg: 260,
    phaseDeg: 110,
    precessionDays: 0,
    albedo: [0.16, 0.2, 0.24],
  },
  {
    name: "Pebble",
    radius: 90_000,
    orbitRadius: 5_200_000,
    periodDays: 7.9,
    inclinationDeg: 70,
    ascendingNodeDeg: 310,
    phaseDeg: 300,
    precessionDays: 0,
    albedo: [0.26, 0.25, 0.22],
  },
];

export const NYX_INDEX = 0;
export const SELENE_INDEX = 1;

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

/** World-space centre of an orbiting body at `days` since the epoch. */
export function getBodyPosition(body: OrbitingBody, days: number, out: Vector3): Vector3 {
  const angle = TAU * (days / body.periodDays) + body.phaseDeg * DEG;
  const inclination = body.inclinationDeg * DEG;
  const node =
    body.ascendingNodeDeg * DEG + (body.precessionDays ? (TAU * days) / body.precessionDays : 0);

  // Circular orbit in the XZ plane, tilted about X, then swung about Y.
  const x = Math.cos(angle) * body.orbitRadius;
  const zFlat = Math.sin(angle) * body.orbitRadius;
  const y = zFlat * Math.sin(inclination);
  const z = zFlat * Math.cos(inclination);
  const cosNode = Math.cos(node);
  const sinNode = Math.sin(node);

  return out.set(x * cosNode + z * sinNode, y, -x * sinNode + z * cosNode);
}

/**
 * Bodies that can act as lamps, in light order. Light 0 is always the central
 * sun; light `i + 1` is the body at `LIGHT_BODY_INDICES[i]`.
 */
export const LIGHT_BODY_INDICES = [1, 2, 3, 4] as const;
export const LIGHT_COUNT = LIGHT_BODY_INDICES.length + 1;

/**
 * Three answers to "where does night come from in a world with a sun at its
 * centre?"
 *
 * - `eclipse` — the sun never changes. Nyx, a dark body hugging it, blocks a
 *   cone of light; night is wherever that shadow falls.
 * - `pulse` — there is no Nyx. The sun itself swells and gutters once a day,
 *   so day and night come to the whole world at once, and the starscape is
 *   what you see by at night.
 * - `relay` — the centre is a dead cinder. The orbiting bodies take turns
 *   igniting, each with its own colour and a very different brightness: one
 *   is daylight, one is a long orange evening, one is no more than a full
 *   moon.
 */
export const LIGHT_SYSTEMS = {
  eclipse: "Eclipse — a moon blocks the sun",
  pulse: "Pulse — the sun dims and brightens",
  relay: "Relay — the moons take turns",
} as const;

export type LightSystem = keyof typeof LIGHT_SYSTEMS;

export function isLightSystem(value: unknown): value is LightSystem {
  return typeof value === "string" && value in LIGHT_SYSTEMS;
}

interface Lamp {
  /** Index into {@link ORBITING_BODIES}. */
  body: number;
  /** Portion of the day it burns, as fractions of a day. */
  from: number;
  to: number;
  /** Brightness relative to the central sun at the same distance. */
  brightness: number;
  color: [number, number, number];
}

/** Who shines when in the `relay` system. */
const RELAY_LAMPS: readonly Lamp[] = [
  { body: 1, from: 0.0, to: 0.4, brightness: 0.36, color: [1.0, 0.96, 0.88] },
  { body: 2, from: 0.4, to: 0.6, brightness: 0.16, color: [1.0, 0.5, 0.2] },
  { body: 3, from: 0.6, to: 0.86, brightness: 0.02, color: [0.6, 0.75, 1.0] },
  { body: 4, from: 0.86, to: 1.0, brightness: 0.05, color: [0.72, 1.0, 0.8] },
];
/** How long one lamp takes to fade as the next catches, in days. */
const RELAY_CROSSFADE = 0.035;

const smooth = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** 1 inside `[from, to]` of a cyclic day, easing over `fade` at both ends. */
function window(from: number, to: number, fade: number, dayFraction: number) {
  let best = 0;
  // Evaluate the neighbouring days too, so a slot can straddle midnight.
  for (const shift of [-1, 0, 1]) {
    const x = dayFraction + shift;
    const value = smooth(from - fade, from + fade, x) * (1 - smooth(to - fade, to + fade, x));
    if (value > best) best = value;
  }
  return best;
}

/**
 * Shared simulation state, owned by the scene and mutated once per frame.
 * Cameras and meshes read it; nothing here is module-scoped.
 */
export interface HollowEarthState {
  /** Days since the epoch (fractional). */
  days: number;
  /** Body centres, index-aligned with {@link ORBITING_BODIES}. */
  bodyPositions: Vector3[];
  lightSystem: LightSystem;
  /**
   * Colour × brightness of each light (0 = the sun, then
   * {@link LIGHT_BODY_INDICES}); all zero when it is off.
   */
  lightColors: Vector3[];
  /** Whether Nyx exists in the current light system. */
  nyxPresent: boolean;
  /**
   * Total brightness of everything shining, 1 = the full central sun. The
   * scene uses it the way an eye would, opening up as the light goes.
   */
  brightness: number;
}

export function createHollowEarthState(): HollowEarthState {
  const state: HollowEarthState = {
    days: 0.31,
    bodyPositions: ORBITING_BODIES.map(() => new Vector3()),
    lightSystem: "eclipse",
    lightColors: Array.from({ length: LIGHT_COUNT }, () => new Vector3()),
    nyxPresent: true,
    brightness: 1,
  };
  updateHollowEarthState(state, state.days);
  return state;
}

function updateLights(state: HollowEarthState) {
  const dayFraction = state.days - Math.floor(state.days);
  for (const color of state.lightColors) color.set(0, 0, 0);
  state.nyxPresent = state.lightSystem === "eclipse";

  if (state.lightSystem === "eclipse") {
    state.lightColors[0].set(1, 1, 1);
  } else if (state.lightSystem === "pulse") {
    // Bright for half the day; the fade down is slower than the flare up.
    const level = smooth(0.0, 0.07, dayFraction) * (1 - smooth(0.5, 0.62, dayFraction));
    // A cooling star dims *and* reddens.
    const heat = Math.sqrt(level);
    state.lightColors[0]
      .set(1, 0.3 + 0.7 * heat, 0.08 + 0.92 * heat * heat)
      .multiplyScalar(level * level);
  } else {
    for (const lamp of RELAY_LAMPS) {
      const level = window(lamp.from, lamp.to, RELAY_CROSSFADE, dayFraction);
      state.lightColors[LIGHT_BODY_INDICES.indexOf(lamp.body as 1 | 2 | 3 | 4) + 1]
        .set(...lamp.color)
        .multiplyScalar(lamp.brightness * level);
    }
  }
}

function luminance(color: Vector3) {
  return 0.2126 * color.x + 0.7152 * color.y + 0.0722 * color.z;
}

export function updateHollowEarthState(state: HollowEarthState, days: number) {
  state.days = days;
  for (let i = 0; i < ORBITING_BODIES.length; i++) {
    getBodyPosition(ORBITING_BODIES[i], days, state.bodyPositions[i]);
  }
  updateLights(state);
  state.brightness = state.lightColors.reduce((total, color) => total + luminance(color), 0);
}
