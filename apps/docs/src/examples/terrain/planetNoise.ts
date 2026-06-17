import type { ElevationCallback } from "@hello-terrain/three";
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

/** Six-octave fractal Brownian motion over a 3D position node. */
export const fbm = Fn(([pos]: [any]) => {
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
 * Continent-style elevation for a cube-sphere planet. Sampling the unit
 * direction keeps the noise frequency independent of the planet radius, and
 * everything below `seaLevel` is flattened into oceans.
 *
 * `ruggedness` (0 by default) layers ridged, higher-frequency noise on top of
 * the broad continents to produce steeper, noisier mountain relief.
 */
export function createPlanetElevation(params: {
  noiseFrequency: number;
  seaLevel: number;
  ruggedness?: number;
}): ElevationCallback {
  const ruggedness = params.ruggedness ?? 0;
  return ({ worldPosition }) => {
    const dir = worldPosition.normalize();
    const continents = fbm(dir.mul(float(params.noiseFrequency)));
    const sea = float(params.seaLevel);
    const land = smoothstep(sea, sea.add(0.05), continents);
    const base = clamp(continents.sub(sea), float(0), float(1));

    // Ridged multifractal detail: sharp crests, deep valleys on land.
    const ridgeNoise = fbm(dir.mul(float(params.noiseFrequency * 4)));
    const ridges = float(1).sub(ridgeNoise.mul(2).sub(1).abs());
    const detail = ridges.mul(ridges).mul(float(ruggedness));

    return clamp(base.add(detail), float(0), float(1)).mul(land);
  };
}

/**
 * Hypsometric color ramp keyed on the normalized radial elevation recovered
 * from the displaced world position.
 */
export function createPlanetColorNode(params: {
  radius: number;
  elevationScale: number;
  /** When true, elevation displaces inward — flip the recovered height sign. */
  invert?: boolean;
}) {
  const radiusNode = float(params.radius);
  const elevScaleNode = float(params.elevationScale);
  const invert = params.invert ?? false;
  return Fn(() => {
    const rawHeight = positionWorld.length().sub(radiusNode).div(elevScaleNode);
    const height = invert ? radiusNode.sub(positionWorld.length()).div(elevScaleNode) : rawHeight;
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
