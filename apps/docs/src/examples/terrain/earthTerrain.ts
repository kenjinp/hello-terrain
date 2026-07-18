import { isSkirtVertex, type ElevationCallback } from "@hello-terrain/three";
import {
  clamp,
  float,
  Fn,
  If,
  Loop,
  mix,
  positionWorld,
  select,
  smoothstep,
  sqrt,
  varying,
  vec3,
  vec4,
} from "three/tsl";
import type { Node } from "three/webgpu";
import { perlinNoise } from "./planetNoise";

/** Authalic ("equal-area") Earth radius in metres. */
export const EARTH_AUTHALIC_RADIUS = 6_371_007.2;

/** Torus with the same surface area as Earth, with major = 3 × minor. */
export const EARTH_AREA_TORUS_MAJOR_MINOR_RATIO = 3;
export const EARTH_AREA_TORUS_MINOR_RADIUS =
  EARTH_AUTHALIC_RADIUS / Math.sqrt(Math.PI * EARTH_AREA_TORUS_MAJOR_MINOR_RATIO);
export const EARTH_AREA_TORUS_MAJOR_RADIUS =
  EARTH_AREA_TORUS_MINOR_RADIUS * EARTH_AREA_TORUS_MAJOR_MINOR_RATIO;
export const EARTH_AREA_TORUS_BOUNDING_RADIUS =
  EARTH_AREA_TORUS_MAJOR_RADIUS + EARTH_AREA_TORUS_MINOR_RADIUS;

/**
 * Deeper fbm than the shared six-octave helper in `planetNoise`. At planetary
 * scale the extra octaves are what keep relief visible from orbit all the way
 * down to ~1 km surface features.
 */
const fbm = Fn(([pos]: [any]) => {
  const p = vec3(pos).toVar();
  const total = float(0).toVar();
  const amp = float(0.5).toVar();
  const freq = float(1).toVar();

  Loop(13, () => {
    total.addAssign(perlinNoise(p.mul(freq)).mul(amp));
    freq.mulAssign(2.03);
    amp.mulAssign(0.5);
  });

  return total;
});

export interface EarthElevationParams {
  /**
   * World-space radius the sample position is divided by before feeding the
   * noise, so noise frequencies stay independent of the world's size.
   */
  sampleRadius: number;
  continentFrequency: number;
  seaLevel: number;
  coastWidth: number;
  continentWarp: number;
  warpFrequency: number;
  landHeight: number;
  oceanDepth: number;
  mountainFrequency: number;
  ruggedness: number;
}

/**
 * Earth-like continent elevation shared by the large-scale planet and torus
 * examples: domain-warped low-frequency continents split land from ocean, and
 * ridged multifractal noise adds mountain relief on land. Returns a normalized
 * height in roughly -0.85..1 that the library multiplies by `elevationScale`,
 * which also maps cleanly onto the NOAA colour ramp below.
 */
export function createEarthElevation(params: EarthElevationParams): ElevationCallback {
  return ({ worldPosition }) => {
    const p = worldPosition.mul(float(1 / params.sampleRadius));

    // Domain-warp the sample position so coastlines meander instead of
    // looking like smooth, uniform blobs.
    const warp = vec3(
      fbm(p.mul(float(params.warpFrequency))),
      fbm(p.mul(float(params.warpFrequency)).add(vec3(19.3, 7.1, 33.7))),
      fbm(p.mul(float(params.warpFrequency)).add(vec3(41.2, 17.9, 5.3))),
    )
      .sub(0.5)
      .mul(float(params.continentWarp));
    const warpedPosition = p.add(warp);

    // Low-frequency fbm (~0..1) decides where land sits relative to the sea.
    const continents = fbm(warpedPosition.mul(float(params.continentFrequency)));
    const relative = continents.sub(float(params.seaLevel));
    const land = smoothstep(float(0), float(params.coastWidth), relative);

    // Ridged multifractal: sharp mountain crests, concentrated on land.
    const ridgeNoise = fbm(p.mul(float(params.mountainFrequency)));
    const ridges = float(1).sub(ridgeNoise.mul(2).sub(1).abs());
    const mountains = ridges.mul(ridges).mul(float(params.ruggedness));

    const landElevation = relative.mul(float(params.landHeight)).add(mountains.mul(land));
    const oceanElevation = relative.mul(float(params.oceanDepth));
    const height = mix(oceanElevation, landElevation, land);

    return clamp(height, float(-0.85), float(1));
  };
}

/** NOAA-style hypsometric tint stops, in metres of elevation. */
const NOAA_ELEVATIONS = [
  8000, 4000, 2000, 1000, 500, 250, 50, 10, 0.1, 0, -2, -10, -50, -250, -1000, -2000, -4000, -8000,
] as const;

const NOAA_COLORS: [number, number, number][] = [
  [1, 1, 1],
  [0.878, 0.843, 0.816],
  [0.804, 0.725, 0.612],
  [0.729, 0.58, 0.408],
  [0.608, 0.494, 0.263],
  [0.459, 0.459, 0.176],
  [0.271, 0.424, 0.094],
  [0.09, 0.333, 0.082],
  [0, 0.251, 0.137],
  [0.878, 0.988, 0.894],
  [0.671, 0.886, 0.843],
  [0.475, 0.776, 0.804],
  [0.361, 0.675, 0.792],
  [0.247, 0.569, 0.78],
  [0.176, 0.459, 0.69],
  [0.133, 0.333, 0.502],
  [0.114, 0.251, 0.322],
  [0.102, 0.204, 0.204],
];

/**
 * Wrap a raw metres-of-elevation node so it is safe to feed the colour ramp:
 *
 * - The recovery subtracts two huge, nearly equal float32 magnitudes
 *   (~6.37e6 m), so it MUST run in the vertex stage (wrapped in `varying`);
 *   done per fragment, the cancellation error changes with camera distance and
 *   the terrain colours flicker by altitude.
 * - Skirt vertices hang `skirtScale` metres below the edge vertex they extend
 *   from; add the drop back so the skirt wall is painted with the same colour
 *   as the surface above it, whatever its depth.
 */
function skirtAwareElevation(rawElevation: Node, skirtScale: number, innerTileSegments: number) {
  return varying(
    select(isSkirtVertex(innerTileSegments), rawElevation.add(float(skirtScale)), rawElevation),
  );
}

/**
 * NOAA colour node for a cube-sphere planet. The displaced vertex sits at
 * `radius + elevationMetres` from the planet centre, so the elevation is
 * recovered by subtracting the radius from the world-position length.
 */
export function createEarthPlanetColorNode(params: {
  radius: number;
  skirtScale: number;
  innerTileSegments: number;
}) {
  const rawElevation = positionWorld.length().sub(float(params.radius));
  const elevationMetres = skirtAwareElevation(
    rawElevation,
    params.skirtScale,
    params.innerTileSegments,
  );
  return getColorForElevation(float(elevationMetres)).rgb;
}

/**
 * NOAA colour node for a torus world. Elevation is recovered as the distance
 * from the tube's centre circle minus the minor radius.
 */
export function createEarthTorusColorNode(params: {
  majorRadius: number;
  minorRadius: number;
  skirtScale: number;
  innerTileSegments: number;
}) {
  const rho = sqrt(positionWorld.x.mul(positionWorld.x).add(positionWorld.z.mul(positionWorld.z)));
  const tubeX = rho.sub(float(params.majorRadius));
  const tubeDistance = sqrt(tubeX.mul(tubeX).add(positionWorld.y.mul(positionWorld.y)));
  const rawElevation = tubeDistance.sub(float(params.minorRadius));
  const elevationMetres = skirtAwareElevation(
    rawElevation,
    params.skirtScale,
    params.innerTileSegments,
  );
  return getColorForElevation(float(elevationMetres)).rgb;
}

/** Piecewise-linear NOAA elevation colour ramp over metres of elevation. */
export const getColorForElevation = Fn(([elevation]: [ReturnType<typeof float>]) => {
  const result = vec4(NOAA_COLORS[0][0], NOAA_COLORS[0][1], NOAA_COLORS[0][2], 1.0).toVar();

  If(elevation.greaterThanEqual(float(NOAA_ELEVATIONS[0])), () => {
    result.assign(vec4(NOAA_COLORS[0][0], NOAA_COLORS[0][1], NOAA_COLORS[0][2], 1.0));
  })
    .ElseIf(elevation.lessThanEqual(float(NOAA_ELEVATIONS[NOAA_ELEVATIONS.length - 1])), () => {
      const last = NOAA_COLORS[NOAA_COLORS.length - 1];
      result.assign(vec4(last[0], last[1], last[2], 1.0));
    })
    .Else(() => {
      for (let i = 0; i < NOAA_ELEVATIONS.length - 1; i++) {
        const hi = NOAA_ELEVATIONS[i];
        const lo = NOAA_ELEVATIONS[i + 1];
        const cHi = NOAA_COLORS[i];
        const cLo = NOAA_COLORS[i + 1];
        If(elevation.lessThanEqual(float(hi)).and(elevation.greaterThan(float(lo))), () => {
          const t = elevation.sub(float(lo)).div(float(hi - lo));
          result.assign(
            vec4(
              mix(float(cLo[0]), float(cHi[0]), t),
              mix(float(cLo[1]), float(cHi[1]), t),
              mix(float(cLo[2]), float(cHi[2]), t),
              1.0,
            ),
          );
        });
      }
    });

  return result;
});
