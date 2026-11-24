import { isSkirtVertex } from "@hello-terrain/three";
import {
  cameraPosition,
  clamp,
  cos,
  dot,
  exp,
  float,
  dFdx,
  dFdy,
  Discard,
  Fn,
  If,
  length,
  max,
  min,
  mix,
  normalWorld,
  positionWorld,
  pow,
  reflect,
  select,
  smoothstep,
  uv,
  varying,
  varyingProperty,
  vec3,
} from "three/tsl";
import {
  RANGE_FREQUENCY,
  RANGE_HEIGHT,
  RANGE_OCTAVES,
  RANGE_STRETCH,
  rangePosition,
  rangeProfile,
  rangeProfileSlope,
  stretchAcross,
  tectonics,
} from "./elevation";
import { fbm, noise, periodicNoise, ridgedBands, ridgedComplete } from "./noise";
import type { QualityPreset } from "./quality";
import type { HollowEarthShading, HollowEarthUniforms } from "./shading";
import { LIGHT_BODY_INDICES, ORBITING_BODIES, SHELL_RADIUS } from "./world";

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
    const normal = select(
      dot(fieldNormal, up).lessThan(0),
      fieldNormal.negate(),
      fieldNormal,
    ).toVar();
    const height = float(elevation).toVar();

    const lit = vec3(0).toVar();

    // Sea floor deeper than the water can show is never seen: skip the work.
    // (There is no early depth test to do it for us; see atmospherePass.ts.)
    If(height.lessThan(-120), () => {
      lit.assign(srgb(0.3, 0.36, 0.34).mul(0.05));
    }).Else(() => {
      const relative = shading.cameraRelativePosition().toVar();

      // --- Relief the mesh is too coarse to carry ----------------------------
      // From across the world a tile's vertices are tens of kilometres apart,
      // so a mountain range arrives as a smooth swell. Re-evaluate the ridge
      // function per pixel and add back, as shading, exactly the octaves the
      // mesh dropped: the height they would add (for snow and tree lines) and
      // their slope (for the normal).
      const reliefHeight = float(0).toVar();
      const reliefSlope = vec3(0).toVar();
      const relief = float(1).toVar();
      If(height.greaterThan(120), () => {
        // Size of this tile and of this pixel, from screen-space derivatives:
        // tile UVs run 0..1 across a tile, so metres-per-UV is the tile size.
        const tileUv = uv();
        const stepX = length(dFdx(relative)).toVar();
        const stepY = length(dFdy(relative)).toVar();
        const tileSize = min(
          stepX.div(length(dFdx(tileUv)).max(1e-7)),
          stepY.div(length(dFdy(tileUv)).max(1e-7)),
        );
        const toNoise = RANGE_FREQUENCY / SHELL_RADIUS;
        // Spacings are judged along the squeezed axis, where detail is finest.
        const squeezed = toNoise * RANGE_STRETCH;
        const meshSpacing = tileSize.mul(squeezed / params.quality.innerTileSegments).toVar();
        const pixelSpacing = max(stepX, stepY).mul(squeezed).toVar();

        If(ridgedComplete(RANGE_OCTAVES, meshSpacing).lessThan(0.999), () => {
          const world = tectonics(outward);
          const belt = world.belt.toVar();
          If(belt.greaterThan(0.02), () => {
            const bands = ridgedBands(
              RANGE_OCTAVES,
              rangePosition(world),
              meshSpacing,
              pixelSpacing,
            );
            const fine = bands.fine.toVar();
            const coarse = bands.coarse.toVar();
            reliefHeight.assign(
              belt.mul(RANGE_HEIGHT).mul(rangeProfile(fine).sub(rangeProfile(coarse))),
            );
            // Chain rule back through the stretch (a symmetric matrix).
            reliefSlope.assign(
              stretchAcross(
                bands.fineGradient
                  .mul(rangeProfileSlope(fine))
                  .sub(bands.coarseGradient.mul(rangeProfileSlope(coarse))),
                world.across,
              )
                .mul(belt)
                .mul(RANGE_HEIGHT * toNoise),
            );
            // The sun is always overhead, so slopes alone barely shade.
            // Darken valley floors a little, as if the ridges shaded them.
            relief.assign(mix(float(1), smoothstep(0.05, 0.7, fine).mul(0.45).add(0.6), belt));
          });
        });
      });
      const trueHeight = height.add(reliefHeight).toVar();
      const shadedNormal = normal
        .sub(reliefSlope.sub(up.mul(dot(reliefSlope, up))))
        .normalize()
        .toVar();
      const shadedFacing = max(dot(shadedNormal, up), 0).toVar();
      const shadedSlope = float(1).sub(shadedFacing);

      // --- Biomes ---------------------------------------------------------
      const nightBand = float(1).sub(smoothstep(0.42, 0.85, outward.y.abs()));
      const moisture = fbm(outward.mul(3.1).add(vec3(11.3, 4.7, 8.1)), 2);
      const humidity = clamp(nightBand.mul(0.8).add(moisture.sub(0.5).mul(1.6)), 0, 1).toVar();

      // Close-range variation, in camera-relative coordinates. Octaves
      // smaller than a few pixels are faded out rather than left to shimmer.
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
      const strata = noise(vec3(trueHeight.mul(1 / 140), outward.x.mul(40), outward.z.mul(40)))
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
      const meadow = mix(lowland, alpine, smoothstep(0, 500, trueHeight.sub(treeLine)));
      const highland = mix(meadow, rock, smoothstep(600, 1500, trueHeight.sub(treeLine)));
      const cliffs = mix(highland, rock, smoothstep(0.07, 0.2, shadedSlope));
      const snowLine = mix(float(6000), float(4300), nightBand);
      const snowy = mix(
        cliffs,
        snow,
        smoothstep(0, 700, trueHeight.sub(snowLine)).mul(
          float(1).sub(smoothstep(0.1, 0.22, shadedSlope)),
        ),
      );
      const shore = mix(sand, snowy, smoothstep(6, 45, trueHeight));
      const seabed = mix(silt, sand, smoothstep(-180, 0, trueHeight));
      const albedo = select(trueHeight.lessThan(0), seabed, shore).mul(grain);

      // --- Lighting -------------------------------------------------------
      // Every light that is on, each from its own direction: under the
      // central sun that is straight down, but a lamp on an orbit rakes
      // across the land and picks the relief out.
      const light = shading.irradiance(positionWorld, trueHeight, shadedNormal);
      // Slopes see less of the sky and the far world than level ground does.
      const openness = shadedFacing.mul(shadedFacing);
      const skylight = vec3(0.32, 0.48, 0.85).mul(light.flux.g).mul(0.16).mul(openness);
      const fill = shading.ambientRadiance().mul(Math.PI).mul(openness.mul(0.75).add(0.25));
      lit.assign(albedo.mul(relief).mul(INV_PI).mul(light.direct.add(skylight).add(fill)));
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
      // Sea-level light, and each light's mirror glint. The glint is a
      // Gaussian lobe whose variance is the light's disc plus whatever waves
      // are too small to see; under the central sun it sits directly below
      // the viewer, under an orbiting lamp it stretches towards it.
      const mirrored = reflect(view.negate(), normal).toVar();
      const variance = hiddenSlope.mul(u.waveHeight).mul(u.waveHeight).mul(4).add(4.5e-4).toVar();
      const directLight = vec3(0).toVar();
      const glint = vec3(0).toVar();
      shading.forEachLight(positionWorld, float(0), ({ toLight, radiance }) => {
        directLight.addAssign(radiance.mul(max(dot(up, toLight), 0)));
        const angleSq = float(2)
          .mul(float(1).sub(dot(mirrored, toLight)))
          .max(0);
        glint.addAssign(
          radiance.mul(
            exp(angleSq.div(variance.mul(2)).negate())
              .div(variance.mul(2 * Math.PI))
              .mul(0.02),
          ),
        );
      });
      const surfaceLight = directLight.add(shading.ambientRadiance().mul(Math.PI)).toVar();
      const path = depth.mul(float(1).add(float(1).div(viewCos.max(0.25))));
      const absorption = vec3(0.34, 0.052, 0.024).div(u.waterClarity);
      const waterTransmittance = exp(absorption.mul(path).negate());
      const seabed = mix(srgb(0.84, 0.77, 0.58), srgb(0.3, 0.36, 0.34), smoothstep(0, 180, depth));
      const floor = seabed.mul(INV_PI).mul(surfaceLight).mul(waterTransmittance);
      const turbidity = float(1).sub(exp(path.mul(-0.035).div(u.waterClarity)));
      // Shelf seas carry sediment and plankton: brighter and greener than
      // the open ocean, which is what makes continental shelves visible.
      const shelf = float(1).sub(smoothstep(40, 420, depth));
      const body = mix(vec3(0.004, 0.02, 0.042), vec3(0.012, 0.062, 0.07), shelf)
        .mul(surfaceLight)
        .mul(turbidity);
      const refracted = floor.add(body);

      // --- Above the surface ---------------------------------------------------
      const fresnel = float(0.02).add(
        float(0.98).mul(pow(float(1).sub(max(dot(normal, view), 0)), float(5))),
      );
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
        .mul(shading.irradiance(farPoint, float(0)).flux);
      const reflected = farLand.mul(sky.transmittance).add(sky.inscatter);

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

/**
 * Surface of one orbiting body (index into the body list): rock lit and
 * shadowed like everything else, plus — if it is a lamp and currently
 * burning — its own glow.
 */
export function createBodyColorNode(
  u: HollowEarthUniforms,
  shading: HollowEarthShading,
  index: number,
) {
  const body = ORBITING_BODIES[index];
  // 0 is the sun, so a body's light index is its lamp slot + 1 (or 0: none).
  const lightIndex = LIGHT_BODY_INDICES.indexOf(index as (typeof LIGHT_BODY_INDICES)[number]) + 1;

  return Fn(() => {
    const centre = u.bodies[index].xyz;
    const normal = positionWorld.sub(centre).normalize().toVar();
    const altitude = float(SHELL_RADIUS).sub(length(positionWorld));

    const mottling = noise(normal.mul(4.2).add(vec3(index * 13.7)))
      .mul(0.6)
      .add(noise(normal.mul(17).add(vec3(index * 5.1))).mul(0.4))
      .toVar();
    const albedo = vec3(...body.albedo).mul(mottling.mul(1.1).add(0.45));

    const light = shading.irradiance(positionWorld, altitude, normal, lightIndex || -1);
    const lit = albedo
      .mul(INV_PI)
      .mul(light.direct.add(shading.ambientRadiance().mul(Math.PI)))
      .toVar();

    if (lightIndex > 0) {
      // Burning: limb-darkened, with the surface mottling showing through as
      // hotter and cooler patches.
      const view = cameraPosition.sub(positionWorld).normalize();
      const limb = pow(max(dot(normal, view), 0), float(0.55))
        .mul(0.6)
        .add(0.4);
      lit.addAssign(
        u.lights[lightIndex].color
          .mul(u.sunIntensity)
          .mul(GLOW_BOOST)
          .mul(limb)
          .mul(mottling.mul(0.5).add(0.75)),
      );
    }

    return lit;
  })();
}

/**
 * How much brighter a light's own surface is than the ground it lights, per
 * unit of light colour. Physically this is thousands; anything well past
 * white is enough.
 */
const GLOW_BOOST = 45;

/**
 * The central body. Burning, it is a limb-darkened photosphere; switched
 * off, a dark cinder lit by whatever else is shining.
 */
export function createSunColorNode(u: HollowEarthUniforms, shading: HollowEarthShading) {
  return Fn(() => {
    const normal = positionWorld.normalize().toVar();
    const view = cameraPosition.sub(positionWorld).normalize();
    const mu = max(dot(normal, view), 0);
    const limb = pow(mu, float(0.55)).mul(0.65).add(0.35);
    const glow = u.lights[0].color
      .mul(vec3(1.0, 0.93, 0.8))
      .mul(u.sunIntensity)
      .mul(GLOW_BOOST);
    // Even at its dimmest a cooling star still shows a dull red surface.
    const embers = vec3(0.5, 0.06, 0.01).mul(u.sunIntensity).mul(0.12);

    const altitude = float(SHELL_RADIUS).sub(length(positionWorld));
    const light = shading.irradiance(positionWorld, altitude, normal, 0);
    const cinder = vec3(0.05, 0.045, 0.04)
      .mul(noise(normal.mul(9)).mul(0.8).add(0.6))
      .mul(INV_PI)
      .mul(light.direct.add(shading.ambientRadiance().mul(Math.PI)));

    return glow.add(embers.mul(u.sunEmbers)).mul(limb).add(cinder);
  })();
}

/**
 * Additive glow on a larger sphere around a light (0 = the sun); fades to
 * nothing at the sphere's rim and scales with how brightly the light burns.
 */
export function createCoronaColorNode(u: HollowEarthUniforms, lightIndex: number) {
  return Fn(() => {
    const centre = u.lights[lightIndex].position.xyz;
    const normal = positionWorld.sub(centre).normalize();
    const view = cameraPosition.sub(positionWorld).normalize();
    const mu = max(dot(normal, view), 0);
    return u.lights[lightIndex].color
      .mul(vec3(1.0, 0.82, 0.6))
      .mul(u.sunIntensity)
      .mul(pow(mu, float(7)).mul(1.4));
  })();
}
