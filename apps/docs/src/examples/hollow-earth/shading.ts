import {
  cameraWorldMatrix,
  clamp,
  dot,
  exp,
  float,
  Fn,
  length,
  Loop,
  max,
  min,
  mix,
  positionView,
  pow,
  select,
  smoothstep,
  sqrt,
  uniform,
  vec3,
  vec4,
} from "three/tsl";
import { Vector3, Vector4 } from "three/webgpu";
import { ORBITING_BODIES, SHELL_RADIUS, SUN_RADIUS } from "./world";

// TSL node graphs are built dynamically; the published typings cannot follow
// swizzles and chained math through helper boundaries.
// oxlint-disable-next-line typescript/no-explicit-any
type TslNode = any;

/**
 * Sea-level scattering/absorption coefficients per metre (R, G, B), after
 * Hillaire 2020 — the same Rayleigh + Mie + ozone model Maxime Heckel walks
 * through in "On Rendering the Sky, Sunsets, and Planets".
 */
const RAYLEIGH_SCATTERING = [5.802e-6, 13.558e-6, 33.1e-6] as const;
const MIE_SCATTERING = 3.996e-6;
const MIE_EXTINCTION = 4.44e-6;
const OZONE_ABSORPTION = [0.65e-6, 1.881e-6, 0.085e-6] as const;

const RAYLEIGH_SCALE_HEIGHT = 8_500;
const MIE_SCALE_HEIGHT = 1_200;
const OZONE_LAYER_ALTITUDE = 25_000;
const OZONE_LAYER_HALF_WIDTH = 15_000;
/** Altitude (towards the centre) above which the air is treated as vacuum. */
const ATMOSPHERE_HEIGHT = 100_000;

const INV_4PI = 1 / (4 * Math.PI);

/** Per-scene uniforms. Created by the scene, never shared between instances. */
export function createHollowEarthUniforms() {
  return {
    /** xyz = body centre (world), w = body radius. */
    bodies: ORBITING_BODIES.map((body) => uniform(new Vector4(0, 0, 0, body.radius))),
    /** Solar irradiance arriving at the shell (arbitrary HDR units). */
    sunIntensity: uniform(20),
    rayleighDensity: uniform(1),
    mieDensity: uniform(1),
    ozoneDensity: uniform(1),
    /** Multiplier on every scale height: >1 is a taller, hazier sky. */
    scaleHeight: uniform(1),
    mieAnisotropy: uniform(0.76),
    /** How strongly a partially eclipsed sun reddens (limb-darkened light). */
    terminatorWarmth: uniform(0.7),
    /** Light bounced from the rest of the shell, as a fraction of sunlight. */
    worldshine: uniform(0.045),
    /**
     * Camera position modulo the detail period, written before each draw.
     * Waves and ground detail are evaluated at `detailOrigin + (fragment -
     * camera)`, which keeps metre-scale precision 6,371 km from the origin.
     */
    detailOrigin: uniform(new Vector3()),
    /** Seconds modulo the wave time period. */
    waveTime: uniform(0),
    waveHeight: uniform(1),
    waterClarity: uniform(1),
    /** 0 = clear skies everywhere, 1 = overcast everywhere. */
    cloudCoverage: uniform(0.44),
    cloudDensity: uniform(1),
    cloudShadowStrength: uniform(1),
    /** Rotation of the weather about the world Y axis, in radians. */
    cloudDrift: uniform(0),
  };
}

export type HollowEarthUniforms = ReturnType<typeof createHollowEarthUniforms>;

export interface AtmosphereResult {
  /** Radiance scattered towards the eye along the ray. */
  inscatter: TslNode;
  /** RGB transmittance of whatever sits at the end of the ray. */
  transmittance: TslNode;
  /** RGB transmittance of the air in front of the veil, if one was given. */
  veilTransmittance: TslNode;
}

/**
 * Lighting helpers for a world lit from its own centre.
 *
 * Two things make the inverted setting cheaper than a normal planet:
 *
 * 1. The sun is at the origin, so sunlight always travels radially outward.
 *    Density depends only on radius, so the optical depth between the sun and
 *    any sample is a closed-form function of altitude — the nested
 *    "march towards the light" loop of a conventional sky shader disappears.
 * 2. The only things that can block that light are a handful of spheres, so
 *    shadows (on the ground *and* inside the air volume) are analytic
 *    ray/sphere tests rather than shadow maps.
 */
export function createHollowEarthShading(
  u: HollowEarthUniforms,
  /** Fraction of sunlight that gets through the clouds to a point, if any. */
  cloudShadow?: (point: TslNode) => TslNode,
) {
  const shellRadius = float(SHELL_RADIUS);

  /**
   * Fraction of the sun's disc visible from `p` (0 = total eclipse). For each
   * body, compare the body's disc with the cross-section of the cone joining
   * `p` to the sun at the body's distance; the overlap gives a soft penumbra
   * whose width follows the real geometry.
   */
  const sunVisibility = Fn(([point]: [TslNode]) => {
    const p = vec3(point).toVar();
    const sunDistance = length(p).max(1).toVar();
    const toSun = p.negate().div(sunDistance).toVar();
    const visibility = float(1).toVar();

    for (const body of u.bodies) {
      const relative = body.xyz.sub(p).toVar();
      // Distance along the sun ray to its closest approach to the body…
      const along = dot(relative, toSun).toVar();
      // …and how far the ray misses the body's centre by.
      const miss = length(relative.sub(toSun.mul(along)));
      const bodyRadius = body.w;
      const coneRadius = float(SUN_RADIUS).mul(along.div(sunDistance)).max(1).toVar();
      const overlap = float(1).sub(
        smoothstep(bodyRadius.sub(coneRadius).abs(), bodyRadius.add(coneRadius), miss),
      );
      const coveredArea = min(bodyRadius, coneRadius).div(coneRadius);
      const between = along.greaterThan(0).and(along.lessThan(sunDistance));
      const covered = select(between, overlap.mul(coveredArea).mul(coveredArea), float(0));
      visibility.mulAssign(float(1).sub(clamp(covered, 0, 1)));
    }

    return visibility;
  });

  /**
   * Sunlight colour reaching `p`, before atmospheric extinction. As the disc
   * is eaten away only its limb remains, which is dimmer and redder — that is
   * what paints the terminator orange without any slanted light path.
   */
  const sunLight = Fn(([point]: [TslNode]) => {
    const visibility = sunVisibility(point).toVar();
    const limb = mix(vec3(1.0, 0.42, 0.16), vec3(1, 1, 1), smoothstep(0, 0.75, visibility));
    return mix(vec3(1, 1, 1), limb, u.terminatorWarmth).mul(visibility);
  });

  /** Altitude above sea level, measured inward (towards the sun). */
  const altitudeOf = (radius: TslNode) => max(shellRadius.sub(radius), float(-12_000));

  /** Relative densities (Rayleigh, Mie, ozone). Thickest against the shell. */
  const densityAt = (altitude: TslNode) => {
    const rayleigh = exp(altitude.negate().div(u.scaleHeight.mul(RAYLEIGH_SCALE_HEIGHT)));
    const mie = exp(altitude.negate().div(u.scaleHeight.mul(MIE_SCALE_HEIGHT)));
    const ozoneCentre = u.scaleHeight.mul(OZONE_LAYER_ALTITUDE);
    const ozoneWidth = u.scaleHeight.mul(OZONE_LAYER_HALF_WIDTH);
    const ozone = max(float(0), float(1).sub(altitude.sub(ozoneCentre).abs().div(ozoneWidth)));
    return vec3(rayleigh.mul(u.rayleighDensity), mie.mul(u.mieDensity), ozone.mul(u.ozoneDensity));
  };

  /**
   * Optical depth of the column between `altitude` and the sun. Closed form:
   * `∫ exp(-h/H) dh = H · exp(-h/H)` for the exponentials, and the area of the
   * remaining part of the ozone tent.
   */
  const sunOpticalDepth = (altitude: TslNode, density: TslNode) => {
    const ozoneCentre = u.scaleHeight.mul(OZONE_LAYER_ALTITUDE);
    const ozoneWidth = u.scaleHeight.mul(OZONE_LAYER_HALF_WIDTH);
    const below = clamp(altitude.sub(ozoneCentre.sub(ozoneWidth)).div(ozoneWidth), 0, 1);
    const above = clamp(ozoneCentre.add(ozoneWidth).sub(altitude).div(ozoneWidth), 0, 1);
    const ozoneColumn = ozoneWidth
      .mul(
        select(
          altitude.lessThan(ozoneCentre),
          float(1).sub(below.mul(below).mul(0.5)),
          above.mul(above).mul(0.5),
        ),
      )
      .mul(u.ozoneDensity);
    return vec3(
      density.x.mul(u.scaleHeight.mul(RAYLEIGH_SCALE_HEIGHT)),
      density.y.mul(u.scaleHeight.mul(MIE_SCALE_HEIGHT)),
      ozoneColumn,
    );
  };

  const extinction = (opticalDepth: TslNode) =>
    vec3(...RAYLEIGH_SCATTERING)
      .mul(opticalDepth.x)
      .add(vec3(MIE_EXTINCTION).mul(opticalDepth.y))
      .add(vec3(...OZONE_ABSORPTION).mul(opticalDepth.z));

  /** Sun irradiance at `altitude` after eclipses and air, ignoring cloud. */
  const clearSunIrradiance = (point: TslNode, altitude: TslNode) => {
    const density = densityAt(altitude);
    return sunLight(point)
      .mul(exp(extinction(sunOpticalDepth(altitude, density)).negate()))
      .mul(u.sunIntensity);
  };

  /** Sun irradiance reaching a point at `altitude`, every shadow included. */
  const sunIrradiance = (point: TslNode, altitude: TslNode) =>
    clearSunIrradiance(point, altitude).mul(cloudShadow ? cloudShadow(point) : float(1));

  /** Soft fill light: the rest of the lit shell, seen through two skies. */
  const worldshineRadiance = () => vec3(0.62, 0.78, 1.0).mul(u.worldshine).mul(u.sunIntensity);

  /**
   * Raymarch single scattering along a view ray. Must be called while a TSL
   * function is being built (it declares variables in the current scope).
   *
   * The air only matters within ~100 km of the shell, but a ray can cross
   * 12,700 km of vacuum in between. So the ray is clipped against the
   * "top of atmosphere" sphere and marched as (up to) two segments — the air
   * around the eye and the air in front of whatever the ray hits — with
   * samples bunched towards the dense end of each.
   */
  function marchAtmosphere(
    rayOrigin: TslNode,
    rayDirection: TslNode,
    rayLength: TslNode,
    steps: number,
    /**
     * Something semi-opaque part-way along the ray (the clouds): air behind
     * `distance` only shows through by `transmittance`.
     */
    veil?: { distance: TslNode; transmittance: TslNode },
  ): AtmosphereResult {
    const origin = vec3(rayOrigin).toVar();
    const direction = vec3(rayDirection).toVar();
    const total = float(rayLength).toVar();

    const innerRadius = shellRadius.sub(u.scaleHeight.mul(ATMOSPHERE_HEIGHT));
    const originRadius = length(origin);
    const b = dot(origin, direction).toVar();
    // (|o| - r)(|o| + r) instead of |o|² - r²: keeps float32 precision at 6e6 m.
    const c = originRadius.sub(innerRadius).mul(originRadius.add(innerRadius)).toVar();
    const discriminant = b.mul(b).sub(c);
    const inVacuum = c.lessThan(0);
    const crossesVacuum = discriminant.greaterThan(0).and(inVacuum.or(b.lessThan(0)));
    const root = sqrt(max(discriminant, 0));
    const half = total.mul(0.5);
    const leaveAir = select(inVacuum, float(0), select(crossesVacuum, b.negate().sub(root), half));
    const reenterAir = select(crossesVacuum, b.negate().add(root), half);
    const nearEnd = min(leaveAir, total).max(0).toVar();
    const farStart = min(reenterAir, total).max(0).toVar();

    const opticalDepth = vec3(0).toVar();
    const inscatter = vec3(0).toVar();
    const veilOpticalDepth = vec3(0).toVar();
    const anisotropy = u.mieAnisotropy;
    const ambient = worldshineRadiance().mul(INV_4PI).toVar();

    const marchSegment = (start: TslNode, end: TslNode, denseAtEnd: boolean) => {
      const segmentLength = end.sub(start).max(0).toVar();
      Loop(steps, ({ i }: { i: TslNode }) => {
        const x0 = float(i).div(steps);
        const x1 = float(i).add(1).div(steps);
        const warp = (x: TslNode) =>
          denseAtEnd ? float(1).sub(float(1).sub(x).mul(float(1).sub(x))) : x.mul(x);
        const u0 = warp(x0);
        const u1 = warp(x1);
        const stepLength = segmentLength.mul(u1.sub(u0)).toVar();
        const t = start.add(segmentLength.mul(u0.add(u1).mul(0.5))).toVar();
        const position = origin.add(direction.mul(t)).toVar();
        const radius = length(position).toVar();
        const altitude = altitudeOf(radius).toVar();
        const density = densityAt(altitude).toVar();

        // Midpoint rule: half the step's depth before sampling, half after.
        opticalDepth.addAssign(density.mul(stepLength.mul(0.5)));

        const viewTransmittance = exp(extinction(opticalDepth).negate()).toVar();
        const sunTransmittance = exp(extinction(sunOpticalDepth(altitude, density)).negate());

        // Light travels outward along `position`; it scatters towards `-direction`.
        const cosTheta = dot(position.div(radius), direction).negate().toVar();
        const cosSq = cosTheta.mul(cosTheta);
        const rayleighPhase = cosSq.add(1).mul(3 / (16 * Math.PI));
        const g2 = anisotropy.mul(anisotropy);
        const miePhase = float(1)
          .sub(g2)
          .mul(cosSq.add(1))
          .div(
            g2
              .add(2)
              .mul(pow(g2.add(1).sub(anisotropy.mul(cosTheta).mul(2)).max(1e-4), float(1.5))),
          )
          .mul(3 / (8 * Math.PI));

        const rayleigh = vec3(...RAYLEIGH_SCATTERING).mul(density.x);
        const mie = vec3(MIE_SCATTERING).mul(density.y);
        const direct = rayleigh
          .mul(rayleighPhase)
          .add(mie.mul(miePhase))
          .mul(sunLight(position))
          .mul(cloudShadow ? cloudShadow(position) : float(1))
          .mul(sunTransmittance)
          .mul(u.sunIntensity);
        const fill = rayleigh.add(mie).mul(ambient);

        const contribution = direct.add(fill).mul(viewTransmittance).mul(stepLength);
        if (veil) {
          // Fraction of this step that lies in front of the veil. A hard
          // in-front/behind test would band wherever the veil's distance
          // crosses a step boundary.
          const stepStart = start.add(segmentLength.mul(u0));
          const inFront = veil.distance.sub(stepStart).div(stepLength.max(1e-3)).clamp(0, 1);
          inscatter.addAssign(contribution.mul(mix(veil.transmittance, float(1), inFront)));
          opticalDepth.addAssign(density.mul(stepLength.mul(0.5)));
          veilOpticalDepth.addAssign(density.mul(stepLength).mul(inFront));
        } else {
          inscatter.addAssign(contribution);
          opticalDepth.addAssign(density.mul(stepLength.mul(0.5)));
        }
      });
    };

    marchSegment(float(0), nearEnd, false);
    marchSegment(farStart, total, true);

    return {
      inscatter,
      transmittance: exp(extinction(opticalDepth).negate()),
      veilTransmittance: exp(extinction(veilOpticalDepth).negate()),
    };
  }

  /**
   * Fragment position relative to the camera, in world orientation. Derived
   * from view space so it stays smooth near the eye; `positionWorld` itself is
   * quantised to ~0.5 m at Earth radius in float32.
   */
  const cameraRelativePosition = () => cameraWorldMatrix.mul(vec4(positionView, 0)).xyz;

  return {
    altitudeOf,
    cameraRelativePosition,
    clearSunIrradiance,
    marchAtmosphere,
    sunIrradiance,
    sunLight,
    sunVisibility,
    worldshineRadiance,
  };
}

export type HollowEarthShading = ReturnType<typeof createHollowEarthShading>;
