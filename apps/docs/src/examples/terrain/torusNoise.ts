import type { ElevationCallback } from "@hello-terrain/three";
import { clamp, float, Fn, mix, positionWorld, smoothstep, sqrt, vec3 } from "three/tsl";
import { fbm } from "./planetNoise";

/**
 * Continent-style elevation for a torus. The noise is sampled in world space
 * (scaled by the major radius so the frequency is size-independent), which keeps
 * it seamless across both periodic axes — the torus surface point is itself
 * continuous, so no UV-seam handling is needed.
 */
export function createTorusElevation(params: {
  noiseFrequency: number;
  seaLevel: number;
  majorRadius: number;
  ruggedness?: number;
}): ElevationCallback {
  const ruggedness = params.ruggedness ?? 0;
  const invScale = params.noiseFrequency / params.majorRadius;
  return ({ worldPosition }) => {
    const p = worldPosition.mul(float(invScale));
    const continents = fbm(p);
    const sea = float(params.seaLevel);
    const land = smoothstep(sea, sea.add(0.05), continents);
    const base = clamp(continents.sub(sea), float(0), float(1));

    const ridgeNoise = fbm(p.mul(float(4)));
    const ridges = float(1).sub(ridgeNoise.mul(2).sub(1).abs());
    const detail = ridges.mul(ridges).mul(float(ruggedness));

    return clamp(base.add(detail), float(0), float(1)).mul(land);
  };
}

/**
 * Hypsometric color ramp keyed on the radial displacement above the base tube,
 * recovered analytically from the displaced world position.
 */
export function createTorusColorNode(params: {
  majorRadius: number;
  minorRadius: number;
  elevationScale: number;
  center?: { x: number; y: number; z: number };
  /** When true, elevation displaces inward — flip the recovered height sign. */
  invert?: boolean;
}) {
  const major = float(params.majorRadius);
  const minor = float(params.minorRadius);
  const elevScale = float(params.elevationScale);
  const invert = params.invert ?? false;
  const center = params.center ?? { x: 0, y: 0, z: 0 };
  const centerNode = vec3(center.x, center.y, center.z);
  return Fn(() => {
    const q = positionWorld.sub(centerNode);
    const rho = sqrt(q.x.mul(q.x).add(q.z.mul(q.z)));
    const a = rho.sub(major);
    const tube = sqrt(a.mul(a).add(q.y.mul(q.y)));
    const rawHeight = tube.sub(minor).div(elevScale);
    const height = invert ? minor.sub(tube).div(elevScale) : rawHeight;

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
}
