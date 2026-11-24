import {
  cameraWorldMatrix,
  clamp,
  dot,
  exp,
  float,
  Fn,
  If,
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
import { LIGHT_BODY_INDICES, ORBITING_BODIES, SHELL_RADIUS, SUN_RADIUS } from "./world";

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
    /**
     * Every light source: index 0 is the central sun, the rest are the bodies
     * in {@link LIGHT_BODY_INDICES}. `position` is xyz = centre, w = radius;
     * `color` is linear RGB scaled by relative brightness (zero = off). Which
     * ones shine, and how brightly, is the light system's business — the
     * shaders just loop over these.
     */
    lights: [
      { position: uniform(new Vector4(0, 0, 0, SUN_RADIUS)), color: uniform(new Vector3(1, 1, 1)) },
      ...LIGHT_BODY_INDICES.map((bodyIndex) => ({
        position: uniform(new Vector4(0, 0, 0, ORBITING_BODIES[bodyIndex].radius)),
        color: uniform(new Vector3(0, 0, 0)),
      })),
    ],
    /** Irradiance at the shell from a light of brightness 1 (arbitrary HDR units). */
    sunIntensity: uniform(20),
    rayleighDensity: uniform(1),
    mieDensity: uniform(1),
    ozoneDensity: uniform(1),
    /** Multiplier on every scale height: >1 is a taller, hazier sky. */
    scaleHeight: uniform(1),
    mieAnisotropy: uniform(0.76),
    /** How strongly a partially eclipsed sun reddens (limb-darkened light). */
    terminatorWarmth: uniform(0.7),
    /**
     * Fill light as a fraction of `sunIntensity`: light bounced from the rest
     * of the shell plus the glow of the starscape. Computed per frame from
     * whatever is currently shining.
     */
    ambient: uniform(new Vector3(0.03, 0.035, 0.045)),
    /** 1 where the central body should show a dull red surface when unlit. */
    sunEmbers: uniform(0),
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
  };
}

export type HollowEarthUniforms = ReturnType<typeof createHollowEarthUniforms>;

export interface AtmosphereResult {
  /** Radiance scattered towards the eye along the ray. */
  inscatter: TslNode;
  /** RGB transmittance of whatever sits at the end of the ray. */
  transmittance: TslNode;
}

/**
 * Lighting helpers for a world lit from inside.
 *
 * Two things make the inverted setting cheaper than a normal planet:
 *
 * 1. Every light is high in the sky from everywhere on the shell — the
 *    central sun is always at the zenith, and a lamp on an orbit inside the
 *    shell never sinks near the horizon. Density depends only on radius, so
 *    the optical depth between a light and a sample is the vertical column
 *    (closed form) over the cosine of the light's zenith angle. The nested
 *    "march towards the light" loop of a conventional sky shader disappears.
 * 2. The only things that can block light are a handful of spheres, so
 *    shadows (on the ground *and* inside the air volume) are analytic
 *    ray/sphere tests rather than shadow maps.
 */
export function createHollowEarthShading(u: HollowEarthUniforms) {
  const shellRadius = float(SHELL_RADIUS);

  /**
   * Fraction of one light's disc visible from a point (0 = total eclipse).
   * For each body, compare the body's disc with the cross-section of the cone
   * joining the point to the light at the body's distance; the overlap gives
   * a soft penumbra whose width follows the real geometry.
   */
  const lightVisibility = u.lights.map((light, lightIndex) => {
    // A lamp does not shadow itself.
    const ownBody = lightIndex === 0 ? -1 : LIGHT_BODY_INDICES[lightIndex - 1];
    return Fn(([point]: [TslNode]) => {
      const p = vec3(point).toVar();
      const toLightVector = light.position.xyz.sub(p).toVar();
      const lightDistance = length(toLightVector).max(1).toVar();
      const toLight = toLightVector.div(lightDistance).toVar();
      const visibility = float(1).toVar();

      u.bodies.forEach((body, bodyIndex) => {
        if (bodyIndex === ownBody) return;
        const relative = body.xyz.sub(p).toVar();
        // Distance along the light ray to its closest approach to the body…
        const along = dot(relative, toLight).toVar();
        // …and how far the ray misses the body's centre by.
        const miss = length(relative.sub(toLight.mul(along)));
        const bodyRadius = body.w;
        const coneRadius = light.position.w.mul(along.div(lightDistance)).max(1).toVar();
        // The +1 keeps the edges apart when a body is switched off (radius 0).
        const overlap = float(1).sub(
          smoothstep(bodyRadius.sub(coneRadius).abs(), bodyRadius.add(coneRadius).add(1), miss),
        );
        const coveredArea = min(bodyRadius, coneRadius).div(coneRadius);
        const between = along.greaterThan(0).and(along.lessThan(lightDistance));
        const covered = select(between, overlap.mul(coveredArea).mul(coveredArea), float(0));
        visibility.mulAssign(float(1).sub(clamp(covered, 0, 1)));
      });

      return visibility;
    });
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

  /**
   * Run `visit` once for every light that is switched on, with the direction
   * to it and the radiance it delivers to `point` — after eclipses, distance
   * and the air above the point. Must be called while a TSL function is
   * being built. `skipLight` leaves one out (a lamp lighting its own surface).
   *
   * Each light sits in its own `If`, so anything `visit` reads that is shared
   * between lights must already be a variable (`.toVar()`): TSL assigns a
   * shared expression inside the first branch that uses it, and the other
   * branches would read it unset whenever that light is switched off.
   */
  function forEachLight(
    point: TslNode,
    altitude: TslNode,
    visit: (light: { toLight: TslNode; radiance: TslNode }) => void,
    skipLight = -1,
  ) {
    const p = vec3(point).toVar();
    const up = p.normalize().negate().toVar();
    const density = densityAt(altitude);
    const column = extinction(sunOpticalDepth(altitude, density)).toVar();

    u.lights.forEach((light, index) => {
      if (index === skipLight) return;
      If(light.color.x.add(light.color.y).add(light.color.z).greaterThan(1e-5), () => {
        const toLightVector = light.position.xyz.sub(p).toVar();
        const distance = length(toLightVector).max(light.position.w).toVar();
        const toLight = toLightVector.div(distance).toVar();
        const visibility = lightVisibility[index](p).toVar();
        // As a disc is eaten away only its limb remains, which is dimmer and
        // redder — that is what paints a terminator orange without any
        // slanted light path.
        const limb = mix(vec3(1.0, 0.42, 0.16), vec3(1, 1, 1), smoothstep(0, 0.75, visibility));
        const tint = mix(vec3(1, 1, 1), limb, u.terminatorWarmth).mul(visibility);
        // Inverse-square falloff, normalised to the irradiance the central
        // sun delivers at the shell.
        const falloff = shellRadius.div(distance);
        // Slant path through the air: vertical column over cos(zenith angle).
        const airmass = float(1).div(max(dot(toLight, up), 0.25));
        const radiance = light.color
          .mul(tint)
          .mul(falloff.mul(falloff))
          .mul(exp(column.mul(airmass).negate()))
          .mul(u.sunIntensity);
        visit({ toLight, radiance });
      });
    });
  }

  /**
   * Total light arriving at a point: `direct` is weighted by the cosine to
   * `normal` (what a surface facing that way receives), `flux` is not.
   */
  function irradiance(point: TslNode, altitude: TslNode, normal?: TslNode, skipLight = -1) {
    const direct = vec3(0).toVar();
    const flux = vec3(0).toVar();
    // Evaluated once, outside the per-light branches (see `forEachLight`).
    const facing = normal ? vec3(normal).toVar() : null;
    forEachLight(
      point,
      altitude,
      ({ toLight, radiance }) => {
        flux.addAssign(radiance);
        if (facing) direct.addAssign(radiance.mul(max(dot(facing, toLight), 0)));
      },
      skipLight,
    );
    return { direct, flux };
  }

  /**
   * Soft fill light: the rest of the lit shell seen through two skies, plus
   * the glow of the starscape.
   */
  const ambientRadiance = () => u.ambient.mul(u.sunIntensity);

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
    const anisotropy = u.mieAnisotropy;
    const ambient = ambientRadiance().mul(INV_4PI).toVar();

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
        const altitude = altitudeOf(length(position)).toVar();
        const density = densityAt(altitude).toVar();

        // Midpoint rule: half the step's depth before sampling, half after.
        opticalDepth.addAssign(density.mul(stepLength.mul(0.5)));

        const viewTransmittance = exp(extinction(opticalDepth).negate()).toVar();
        const rayleigh = vec3(...RAYLEIGH_SCATTERING)
          .mul(density.x)
          .toVar();
        const mie = vec3(MIE_SCATTERING).mul(density.y).toVar();
        // A variable, not an expression: the lights below are each wrapped in
        // an `If`, and TSL would otherwise compute this inside the first one
        // and read it — unset — from the others whenever that light is off.
        const g2 = anisotropy.mul(anisotropy).toVar();

        const direct = vec3(0).toVar();
        forEachLight(position, altitude, ({ toLight, radiance }) => {
          // Light travels along `-toLight` and scatters towards `-direction`.
          const cosTheta = dot(toLight, direction).toVar();
          const cosSq = cosTheta.mul(cosTheta);
          const rayleighPhase = cosSq.add(1).mul(3 / (16 * Math.PI));
          const miePhase = float(1)
            .sub(g2)
            .mul(cosSq.add(1))
            .div(
              g2
                .add(2)
                .mul(pow(g2.add(1).sub(anisotropy.mul(cosTheta).mul(2)).max(1e-4), float(1.5))),
            )
            .mul(3 / (8 * Math.PI));
          direct.addAssign(rayleigh.mul(rayleighPhase).add(mie.mul(miePhase)).mul(radiance));
        });
        const fill = rayleigh.add(mie).mul(ambient);

        const contribution = direct.add(fill).mul(viewTransmittance).mul(stepLength);
        inscatter.addAssign(contribution);
        opticalDepth.addAssign(density.mul(stepLength.mul(0.5)));
      });
    };

    marchSegment(float(0), nearEnd, false);
    marchSegment(farStart, total, true);

    return {
      inscatter,
      transmittance: exp(extinction(opticalDepth).negate()),
    };
  }

  /**
   * RGB transmittance of the air along a ray, and nothing else: no light, no
   * shadows, no texture lookups. Cheap enough to run at full resolution while
   * the scattering is computed at a fraction of it.
   */
  function marchTransmittance(
    rayOrigin: TslNode,
    rayDirection: TslNode,
    rayLength: TslNode,
    steps: number,
  ) {
    const origin = vec3(rayOrigin).toVar();
    const direction = vec3(rayDirection).toVar();
    const total = float(rayLength).toVar();

    const innerRadius = shellRadius.sub(u.scaleHeight.mul(ATMOSPHERE_HEIGHT));
    const originRadius = length(origin);
    const b = dot(origin, direction).toVar();
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
    const marchSegment = (start: TslNode, end: TslNode, denseAtEnd: boolean) => {
      const segmentLength = end.sub(start).max(0).toVar();
      Loop(steps, ({ i }: { i: TslNode }) => {
        const x0 = float(i).div(steps);
        const x1 = float(i).add(1).div(steps);
        const warp = (x: TslNode) =>
          denseAtEnd ? float(1).sub(float(1).sub(x).mul(float(1).sub(x))) : x.mul(x);
        const u0 = warp(x0);
        const u1 = warp(x1);
        const t = start.add(segmentLength.mul(u0.add(u1).mul(0.5)));
        const altitude = altitudeOf(length(origin.add(direction.mul(t))));
        opticalDepth.addAssign(densityAt(altitude).mul(segmentLength.mul(u1.sub(u0))));
      });
    };
    marchSegment(float(0), nearEnd, false);
    marchSegment(farStart, total, true);

    return exp(extinction(opticalDepth).negate());
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
    marchAtmosphere,
    marchTransmittance,
    ambientRadiance,
    forEachLight,
    irradiance,
  };
}

export type HollowEarthShading = ReturnType<typeof createHollowEarthShading>;
