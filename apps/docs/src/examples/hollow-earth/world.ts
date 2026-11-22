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
 * Shared simulation state, owned by the scene and mutated once per frame.
 * Cameras and meshes read it; nothing here is module-scoped.
 */
export interface HollowEarthState {
  /** Days since the epoch (fractional). */
  days: number;
  /** Body centres, index-aligned with {@link ORBITING_BODIES}. */
  bodyPositions: Vector3[];
}

export function createHollowEarthState(): HollowEarthState {
  const state: HollowEarthState = {
    days: 0.31,
    bodyPositions: ORBITING_BODIES.map(() => new Vector3()),
  };
  updateHollowEarthState(state, state.days);
  return state;
}

export function updateHollowEarthState(state: HollowEarthState, days: number) {
  state.days = days;
  for (let i = 0; i < ORBITING_BODIES.length; i++) {
    getBodyPosition(ORBITING_BODIES[i], days, state.bodyPositions[i]);
  }
}
