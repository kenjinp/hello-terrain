import { isSkirtVertex } from "@hello-terrain/three";
import {
  cameraPosition,
  clamp,
  cos,
  dot,
  exp,
  float,
  Discard,
  Fn,
  If,
  length,
  max,
  mix,
  normalWorld,
  positionWorld,
  pow,
  reflect,
  select,
  smoothstep,
  varying,
  varyingProperty,
  vec3,
} from "three/tsl";
import { fbm, noise, periodicNoise } from "./noise";
import type { QualityPreset } from "./quality";
import type { HollowEarthShading, HollowEarthUniforms } from "./shading";
import { ORBITING_BODIES, SHELL_RADIUS } from "./world";

// oxlint-disable-next-line typescript/no-explicit-any
type TslNode = any;

const INV_PI = 1 / Math.PI;

/** sRGB triplet → linear vec3 node (materials below work in linear light). */
const srgb = (r: number, g: number, b: number) => vec3(r ** 2.2, g ** 2.2, b ** 2.2);

/**
 * Terrain surface colour: biome albedo, sunlight from the centre of the
 * world and analytic eclipse shadows. The air in front of it is added later,
 * per pixel, by the atmosphere pass.
 *
 * Climate is keyed on how much night a latitude receives. Nyx's shadow tracks
 * the equator, so the equatorial belt cools off every day and stays green,
 * while the poles sit under a permanent noon and bake into desert.
 */
export function createTerrainColorNode(
  u: HollowEarthUniforms,
  shading: HollowEarthShading,
  params: { skirtScale: number; quality: QualityPreset },
) {
  // Recovering elevation subtracts two ~6.37e6 m magnitudes, so it has to run
  // per vertex (see `skirtAwareElevation` in earthTerrain.ts). On an inverted
  // world skirts hang *outward*, which still reads as "below" the surface.
  const rawElevation = float(SHELL_RADIUS).sub(positionWorld.length());
  const elevation = varying(
    select(
      isSkirtVertex(params.quality.innerTileSegments),
      rawElevation.add(float(params.skirtScale)),
      rawElevation,
    ),
  );

  return Fn(() => {
    const outward = positionWorld.normalize().toVar();
    const up = outward.negate().toVar();
    const fieldNormal = normalWorld.normalize().toVar();
    const normal = select(dot(fieldNormal, up).lessThan(0), fieldNormal.negate(), fieldNormal);
    const facing = max(dot(normal, up), 0).toVar();
    const slope = float(1).sub(facing);
    const height = float(elevation).toVar();

    const lit = vec3(0).toVar();

    // Sea floor deeper than the water can show is never seen: skip the work.
    // (There is no early depth test to do it for us; see atmospherePass.ts.)
    If(height.lessThan(-120), () => {
      lit.assign(srgb(0.3, 0.36, 0.34).mul(0.05));
    }).Else(() => {
      // --- Biomes ---------------------------------------------------------
      const nightBand = float(1).sub(smoothstep(0.42, 0.85, outward.y.abs()));
      const moisture = fbm(outward.mul(3.1).add(vec3(11.3, 4.7, 8.1)), 2);
      const humidity = clamp(nightBand.mul(0.8).add(moisture.sub(0.5).mul(1.6)), 0, 1).toVar();

      // Close-range variation, in camera-relative coordinates. Octaves
      // smaller than a few pixels are faded out rather than left to shimmer.
      const relative = shading.cameraRelativePosition().toVar();
      const footprint = length(relative).mul(0.0018);
      const detailPosition = u.detailOrigin.add(relative).toVar();
      const grain = float(1).toVar();
      // Each cell size must divide DETAIL_PERIOD.
      for (const cell of params.quality.detailCells) {
        const resolved = float(1).sub(smoothstep(cell * 0.2, cell * 0.8, footprint));
        const sample = periodicNoise(detailPosition.div(cell), float(DETAIL_PERIOD / cell));
        grain.mulAssign(mix(float(1), sample.mul(0.7).add(0.65), resolved));
      }
      // Strata: banding by altitude, broken up so it is not ruler-straight.
      const strata = noise(vec3(height.mul(1 / 140), outward.x.mul(40), outward.z.mul(40)))
        .mul(0.3)
        .add(0.85);

      const desert = srgb(0.8, 0.66, 0.44);
      const steppe = srgb(0.56, 0.55, 0.3);
      const forest = srgb(0.16, 0.34, 0.13);
      const alpine = srgb(0.4, 0.44, 0.27);
      const rock = srgb(0.43, 0.39, 0.35).mul(strata);
      const snow = srgb(0.93, 0.95, 0.98);
      const sand = srgb(0.84, 0.77, 0.58);
      const silt = srgb(0.3, 0.36, 0.34);

      const lowland = mix(
        mix(desert, steppe, smoothstep(0.18, 0.42, humidity)),
        forest,
        smoothstep(0.4, 0.72, humidity),
      );
      // Tree line, then bare rock, then snow — all lower where nights are long.
      const treeLine = mix(float(3400), float(2100), nightBand);
      const meadow = mix(lowland, alpine, smoothstep(0, 500, height.sub(treeLine)));
      const highland = mix(meadow, rock, smoothstep(600, 1500, height.sub(treeLine)));
      const cliffs = mix(highland, rock, smoothstep(0.07, 0.2, slope));
      const snowLine = mix(float(5600), float(3700), nightBand);
      const snowy = mix(
        cliffs,
        snow,
        smoothstep(0, 700, height.sub(snowLine)).mul(float(1).sub(smoothstep(0.1, 0.22, slope))),
      );
      const shore = mix(sand, snowy, smoothstep(6, 45, height));
      const seabed = mix(silt, sand, smoothstep(-180, 0, height));
      const albedo = select(height.lessThan(0), seabed, shore).mul(grain);

      // --- Lighting -------------------------------------------------------
      const sun = shading.sunIrradiance(positionWorld, height).toVar();
      // Slopes see less of the sky and the far world than level ground does.
      const openness = facing.mul(facing);
      const skylight = vec3(0.32, 0.48, 0.85).mul(sun.g).mul(0.16).mul(openness);
      const fill = shading.worldshineRadiance().mul(Math.PI).mul(openness.mul(0.75).add(0.25));
      lit.assign(albedo.mul(INV_PI).mul(sun.mul(facing).add(skylight).add(fill)));
    });

    return lit;
  })();
}

/**
 * Period (m) after which waves and ground detail repeat exactly. A power of
 * two so every noise cell size below divides it.
 */
export const DETAIL_PERIOD = 8192;
/** Period (s) after which the wave animation repeats exactly. */
export const WAVE_TIME_PERIOD = 1024;

/** How far (m) the water's skirt ring hangs below the surface. */
const WATER_SKIRT_DEPTH = 400;

interface Wave {
  /** Spatial wave vector (rad/m); an integer multiple of 2π / DETAIL_PERIOD. */
  k: [number, number, number];
  /** Angular frequency (rad/s); an integer multiple of 2π / WAVE_TIME_PERIOD. */
  omega: number;
  wavelength: number;
  steepness: number;
}

/**
 * A fixed spectrum of 3D plane waves. Every wave vector is snapped to the
 * period lattice, so the field tiles seamlessly and can be evaluated in
 * camera-relative coordinates (camera position modulo the period) — world
 * coordinates at 6.37e6 m do not have the float32 precision for metre waves.
 */
function createWaves(count: number): Wave[] {
  let seed = 0x9e3779b9;
  const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return ((seed >>> 0) % 1_000_000) / 1_000_000;
  };

  const waves: Wave[] = [];
  for (let i = 0; i < count; i++) {
    const wavelength = 640 * (6 / 640) ** (i / (count - 1));
    const z = random() * 2 - 1;
    const azimuth = random() * Math.PI * 2;
    const ring = Math.sqrt(1 - z * z);
    const cycles = DETAIL_PERIOD / wavelength;
    const lattice = [
      Math.round(ring * Math.cos(azimuth) * cycles),
      Math.round(z * cycles),
      Math.round(ring * Math.sin(azimuth) * cycles),
    ];
    const scale = (Math.PI * 2) / DETAIL_PERIOD;
    const k: [number, number, number] = [
      lattice[0] * scale,
      lattice[1] * scale,
      lattice[2] * scale,
    ];
    const magnitude = Math.hypot(...k);
    // Deep-water dispersion, snapped so the animation loops.
    const timeStep = (Math.PI * 2) / WAVE_TIME_PERIOD;
    const omega = Math.max(1, Math.round(Math.sqrt(9.81 * magnitude) / timeStep)) * timeStep;
    // Long swells are gentle; short chop carries most of the slope.
    const steepness = (0.035 + 0.075 * (i / (count - 1))) * (0.8 + 0.4 * random());
    waves.push({ k, omega, wavelength, steepness });
  }
  return waves;
}

/**
 * Water for the inverted shell, drawn by rendering the terrain a second time.
 *
 * `positionNode` wraps the terrain's own position node and pulls every vertex
 * onto the sea-level sphere, remembering how far the seabed was below it. The
 * result shares the terrain's LOD, so it is tessellated exactly where the
 * camera needs it, and the depth test against the terrain draws the coastline
 * per pixel.
 */
export function createWaterNodes(
  u: HollowEarthUniforms,
  shading: HollowEarthShading,
  params: { skirtScale: number; quality: QualityPreset },
) {
  const seabedDepth = varyingProperty("float", "vHollowEarthSeabedDepth");
  const waves = createWaves(params.quality.waveCount);

  // Neighbouring tiles compute their shared edge through different float32
  // arithmetic, so the edges do not always meet. The terrain hides that with
  // skirts; flattening everything onto one sphere would collapse them, so the
  // skirt ring is tucked just under the surface to keep the seams covered.
  const positionNode = (terrainPositionNode: TslNode) =>
    Fn(() => {
      const displaced = vec3(terrainPositionNode).toVar();
      const radius = length(displaced).toVar();
      const skirt = isSkirtVertex(params.quality.innerTileSegments);
      // A skirt vertex must carry its edge vertex's depth, not its own: the
      // wall is a sub-pixel sliver, and a depth gradient across it gets
      // extrapolated into garbage (and then into foam) by multisampling.
      seabedDepth.assign(
        radius.sub(SHELL_RADIUS).sub(select(skirt, float(params.skirtScale), float(0))),
      );
      const surfaceRadius = select(
        skirt,
        float(SHELL_RADIUS + WATER_SKIRT_DEPTH),
        float(SHELL_RADIUS),
      );
      return displaced.div(radius).mul(surfaceRadius);
    })();

  const colorNode = Fn(() => {
    const color = vec3(0).toVar();

    // The water sphere runs under every continent. Without an early depth
    // test those fragments would be shaded in full and then thrown away, so
    // drop them before doing any work.
    If(float(seabedDepth).lessThan(-4), () => {
      Discard();
    }).Else(() => {
      const relative = shading.cameraRelativePosition().toVar();
      const distance = length(relative).max(1e-3).toVar();
      const view = relative.div(distance).negate().toVar();
      const up = positionWorld.normalize().negate().toVar();
      const depth = max(float(seabedDepth), 0).toVar();
      const viewCos = max(dot(up, view), 0).toVar();

      // --- Waves ------------------------------------------------------------
      // Approximate size of a pixel on the water; waves shorter than a few
      // pixels fade out of the normal and into the glint's roughness instead.
      const footprint = distance.mul(0.0018).div(viewCos.max(0.12).sqrt());
      const wavePosition = u.detailOrigin.add(relative).toVar();
      const gradient = vec3(0).toVar();
      const hiddenSlope = float(0).toVar();
      for (const wave of waves) {
        const magnitude = Math.hypot(...wave.k);
        const direction = vec3(wave.k[0] / magnitude, wave.k[1] / magnitude, wave.k[2] / magnitude);
        const resolved = float(1).sub(
          smoothstep(wave.wavelength * 0.08, wave.wavelength * 0.3, footprint),
        );
        const phase = dot(wavePosition, vec3(...wave.k)).sub(u.waveTime.mul(wave.omega));
        gradient.addAssign(direction.mul(cos(phase).mul(resolved).mul(wave.steepness)));
        hiddenSlope.addAssign(
          float(1)
            .sub(resolved)
            .mul(0.5 * wave.steepness * wave.steepness),
        );
      }
      gradient.mulAssign(u.waveHeight);
      const tangentGradient = gradient.sub(up.mul(dot(gradient, up)));
      const normal = up.sub(tangentGradient).normalize().toVar();

      // --- Below the surface ---------------------------------------------------
      const surfaceLight = shading
        .sunIrradiance(positionWorld, float(0))
        .add(shading.worldshineRadiance().mul(Math.PI))
        .toVar();
      const path = depth.mul(float(1).add(float(1).div(viewCos.max(0.25))));
      const absorption = vec3(0.34, 0.052, 0.024).div(u.waterClarity);
      const waterTransmittance = exp(absorption.mul(path).negate());
      const seabed = mix(srgb(0.84, 0.77, 0.58), srgb(0.3, 0.36, 0.34), smoothstep(0, 180, depth));
      const floor = seabed.mul(INV_PI).mul(surfaceLight).mul(waterTransmittance);
      const turbidity = float(1).sub(exp(path.mul(-0.035).div(u.waterClarity)));
      const body = vec3(0.004, 0.02, 0.042).mul(surfaceLight).mul(turbidity);
      const refracted = floor.add(body);

      // --- Above the surface ---------------------------------------------------
      const fresnel = float(0.02).add(
        float(0.98).mul(pow(float(1).sub(max(dot(normal, view), 0)), float(5))),
      );
      const mirrored = reflect(view.negate(), normal).toVar();
      // Keep the reflection ray off the water; grazing waves can tip it under.
      const skyward = mirrored.add(up.mul(max(float(0.03).sub(dot(mirrored, up)), 0))).normalize();
      const skyCos = max(dot(skyward, up), 0.03).toVar();
      // The sky of a hollow world is the far side of the shell: a chord away.
      const chord = skyCos.mul(2 * SHELL_RADIUS);
      const farPoint = positionWorld.add(skyward.mul(chord));
      const sky = shading.marchAtmosphere(
        positionWorld,
        skyward,
        chord,
        params.quality.reflectionSteps,
      );
      const farLand = vec3(0.09, 0.12, 0.15)
        .mul(INV_PI)
        .mul(shading.sunLight(farPoint))
        .mul(u.sunIntensity);
      const reflected = farLand.mul(sky.transmittance).add(sky.inscatter);

      // The sun is always at the zenith, so its glitter sits under the viewer.
      // A Gaussian lobe whose variance is the sun's disc plus unresolved waves.
      const sunAngleSq = float(2)
        .mul(float(1).sub(dot(mirrored, up)))
        .max(0);
      const variance = hiddenSlope.mul(u.waveHeight).mul(u.waveHeight).mul(4).add(4.5e-4);
      const sunDirect = shading.sunIrradiance(positionWorld, float(0));
      const glint = sunDirect.mul(
        exp(sunAngleSq.div(variance.mul(2)).negate())
          .div(variance.mul(2 * Math.PI))
          .mul(0.02),
      );

      const foam = float(1)
        .sub(smoothstep(0.2, 2.4, float(seabedDepth)))
        .mul(0.55);
      const water = mix(refracted, reflected, fresnel).add(glint);
      const surface = mix(water, vec3(0.82).mul(INV_PI).mul(surfaceLight), foam);

      color.assign(surface);
    });

    return color;
  })();

  return { positionNode, colorNode };
}

/** Lit, shadowed surface of one orbiting body (index into the body list). */
export function createBodyColorNode(
  u: HollowEarthUniforms,
  shading: HollowEarthShading,
  index: number,
) {
  const body = ORBITING_BODIES[index];
  return Fn(() => {
    const centre = u.bodies[index].xyz;
    const normal = positionWorld.sub(centre).normalize().toVar();
    const sunDistance = length(positionWorld).max(1).toVar();
    const toSun = positionWorld.negate().div(sunDistance);

    const mottling = noise(normal.mul(4.2).add(vec3(index * 13.7)))
      .mul(0.6)
      .add(noise(normal.mul(17).add(vec3(index * 5.1))).mul(0.4));
    const albedo = vec3(...body.albedo).mul(mottling.mul(1.1).add(0.45));

    // Inverse-square falloff, normalised to the irradiance at the shell.
    const falloff = float(SHELL_RADIUS).div(sunDistance);
    const sun = shading.sunLight(positionWorld).mul(u.sunIntensity).mul(falloff).mul(falloff);
    const lit = albedo
      .mul(INV_PI)
      .mul(sun.mul(max(dot(normal, toSun), 0)).add(shading.worldshineRadiance().mul(Math.PI)));

    return lit;
  })();
}

/** The sun's photosphere: limb-darkened and far brighter than anything it lights. */
export function createSunColorNode(u: HollowEarthUniforms) {
  return Fn(() => {
    const normal = positionWorld.normalize();
    const view = cameraPosition.sub(positionWorld).normalize();
    const mu = max(dot(normal, view), 0);
    const limb = pow(mu, float(0.55)).mul(0.65).add(0.35);
    const surface = vec3(1.0, 0.93, 0.8).mul(u.sunIntensity).mul(45).mul(limb);
    return surface;
  })();
}

/** Additive glow on a larger sphere around the sun; fades to nothing at its rim. */
export function createCoronaColorNode(u: HollowEarthUniforms) {
  return Fn(() => {
    const normal = positionWorld.normalize();
    const view = cameraPosition.sub(positionWorld).normalize();
    const mu = max(dot(normal, view), 0);
    return vec3(1.0, 0.78, 0.5)
      .mul(u.sunIntensity)
      .mul(pow(mu, float(7)).mul(1.4));
  })();
}
