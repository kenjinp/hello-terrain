import {
  atan,
  cos,
  cross,
  dot,
  exp,
  float,
  floor,
  Fn,
  fract,
  If,
  length,
  log,
  Loop,
  max,
  min,
  mix,
  pow,
  screenCoordinate,
  sin,
  smoothstep,
  sqrt,
  texture3D,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";
import type { HollowEarthShading, HollowEarthUniforms } from "./shading";
import { SHELL_RADIUS } from "./world";

// oxlint-disable-next-line typescript/no-explicit-any
type TslNode = any;

/** The gas and the stars stop this far short of the shell, above the air. */
const COSMOS_RADIUS = SHELL_RADIUS - 180_000;
/** Extinction of fully dense gas, per metre: ~0.2 optical depths per 1000 km. */
const GAS_EXTINCTION = 0.2e-6;
const NOISE_SIZE = 48;

/** Small deterministic PRNG so the texture is identical on every load. */
function createRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tileable 3D gradient noise with `period` lattice cells per texture. */
function createTileablePerlin(period: number, random: () => number) {
  const gradients = new Float32Array(period * period * period * 3);
  for (let i = 0; i < gradients.length; i += 3) {
    const z = random() * 2 - 1;
    const azimuth = random() * Math.PI * 2;
    const ring = Math.sqrt(1 - z * z);
    gradients[i] = ring * Math.cos(azimuth);
    gradients[i + 1] = ring * Math.sin(azimuth);
    gradients[i + 2] = z;
  }
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const corner = (ix: number, iy: number, iz: number, dx: number, dy: number, dz: number) => {
    const index = ((ix % period) + ((iy % period) + (iz % period) * period) * period) * 3;
    return gradients[index] * dx + gradients[index + 1] * dy + gradients[index + 2] * dz;
  };
  return (u: number, v: number, w: number) => {
    const x = u * period;
    const y = v * period;
    const z = w * period;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fy = y - iy;
    const fz = z - iz;
    const sx = fade(fx);
    const sy = fade(fy);
    const sz = fade(fz);
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const x00 = lerp(corner(ix, iy, iz, fx, fy, fz), corner(ix + 1, iy, iz, fx - 1, fy, fz), sx);
    const x10 = lerp(
      corner(ix, iy + 1, iz, fx, fy - 1, fz),
      corner(ix + 1, iy + 1, iz, fx - 1, fy - 1, fz),
      sx,
    );
    const x01 = lerp(
      corner(ix, iy, iz + 1, fx, fy, fz - 1),
      corner(ix + 1, iy, iz + 1, fx - 1, fy, fz - 1),
      sx,
    );
    const x11 = lerp(
      corner(ix, iy + 1, iz + 1, fx, fy - 1, fz - 1),
      corner(ix + 1, iy + 1, iz + 1, fx - 1, fy - 1, fz - 1),
      sx,
    );
    return lerp(lerp(x00, x10, sy), lerp(x01, x11, sy), sz);
  };
}

/** Tileable 3D Worley noise (1 at a feature point, 0 far from any). */
function createTileableWorley(cells: number, random: () => number) {
  const points = new Float32Array(cells * cells * cells * 3);
  for (let i = 0; i < points.length; i++) points[i] = random();
  return (u: number, v: number, w: number) => {
    const x = u * cells;
    const y = v * cells;
    const z = w * cells;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    let nearest = 9;
    for (let dz = -1; dz <= 1; dz++) {
      const cz = (iz + dz + cells) % cells;
      for (let dy = -1; dy <= 1; dy++) {
        const cy = (iy + dy + cells) % cells;
        for (let dx = -1; dx <= 1; dx++) {
          const cx = (ix + dx + cells) % cells;
          const index = (cx + (cy + cz * cells) * cells) * 3;
          const px = ix + dx + points[index] - x;
          const py = iy + dy + points[index + 1] - y;
          const pz = iz + dz + points[index + 2] - z;
          const distance = px * px + py * py + pz * pz;
          if (distance < nearest) nearest = distance;
        }
      }
    }
    return 1 - Math.min(Math.sqrt(nearest), 1);
  };
}

type Field = (u: number, v: number, w: number) => number;

const octaves = (layers: Field[], gain: number): Field => {
  return (u, v, w) => {
    let total = 0;
    let amplitude = 1;
    let range = 0;
    for (const layer of layers) {
      total += layer(u, v, w) * amplitude;
      range += amplitude;
      amplitude *= gain;
    }
    return total / range;
  };
};

/**
 * One small tileable noise volume for the nebulae, generated on the CPU at
 * start-up. R: Perlin–Worley, the billowing masses. G: Worley fbm, filaments.
 * B: Perlin fbm, used for large-scale structure and hue.
 */
export function createCosmosNoiseTexture() {
  const size = NOISE_SIZE;
  const random = createRandom(0x51ed270b);
  const perlin = octaves(
    [3, 6, 12].map((period) => createTileablePerlin(period, random)),
    0.5,
  );
  const billow = octaves(
    [3, 6, 12].map((cells) => createTileableWorley(cells, random)),
    0.5,
  );
  const filaments = octaves(
    [5, 10, 20].map((cells) => createTileableWorley(cells, random)),
    0.55,
  );
  const structure = octaves(
    [2, 4, 8].map((period) => createTileablePerlin(period, random)),
    0.5,
  );
  const fields: Field[] = [
    (u, v, w) => {
      const cells = billow(u, v, w);
      const base = perlin(u, v, w) * 0.5 + 0.5;
      return (base - (1 - cells) * 0.6) / (1 - (1 - cells) * 0.6 + 1e-3);
    },
    filaments,
    structure,
  ];

  const channels = fields.map(() => new Float32Array(size * size * size));
  let index = 0;
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = (x + 0.5) / size;
        const v = (y + 0.5) / size;
        const w = (z + 0.5) / size;
        for (let channel = 0; channel < fields.length; channel++) {
          channels[channel][index] = fields[channel](u, v, w);
        }
        index++;
      }
    }
  }

  // Stretch every channel to the full 8-bit range.
  const data = new Uint8Array(size * size * size * 4);
  for (let channel = 0; channel < channels.length; channel++) {
    const values = channels[channel];
    let low = Infinity;
    let high = -Infinity;
    for (const value of values) {
      if (value < low) low = value;
      if (value > high) high = value;
    }
    const scale = 255 / Math.max(high - low, 1e-6);
    for (let i = 0; i < values.length; i++) {
      data[i * 4 + channel] = Math.round((values[i] - low) * scale);
    }
  }

  const texture = new THREE.Data3DTexture(data, size, size, size);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.wrapR = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

/** Uniforms for the interior starscape. Per scene, like the others. */
export function createCosmosUniforms() {
  return {
    starBrightness: uniform(1),
    nebulaBrightness: uniform(1),
    nebulaDensity: uniform(1),
    /** Angle one pixel subtends, in radians; keeps distant stars from aliasing. */
    pixelAngle: uniform(0.001),
  };
}

export type CosmosUniforms = ReturnType<typeof createCosmosUniforms>;

/**
 * Shells of stars, from just inside the air down towards the centre. Each is
 * a sphere the view ray is intersected with, so the layers slide against one
 * another as the camera moves. Deeper layers pack more stars into each
 * degree of sky: looking inward, the starfield gets denser and finer the
 * way it would if there were far more room in there than the shell allows.
 */
const STAR_LAYERS = [
  { radius: 1.0, cells: 22, gain: 1.0, galaxies: false },
  { radius: 0.88, cells: 30, gain: 1.0, galaxies: false },
  { radius: 0.66, cells: 44, gain: 0.85, galaxies: true },
  { radius: 0.44, cells: 62, gain: 0.7, galaxies: true },
  { radius: 0.24, cells: 86, gain: 0.55, galaxies: false },
] as const;

const hash3 = Fn(([cell]: [TslNode]) => {
  const x = dot(cell, vec3(127.1, 311.7, 74.7));
  const y = dot(cell, vec3(269.5, 183.3, 246.1));
  const z = dot(cell, vec3(113.5, 271.9, 124.6));
  return fract(sin(vec3(x, y, z)).mul(43758.5453));
});

/**
 * What fills the inside of the world: glowing gas, and stars and galaxies
 * that should not fit in a sphere 12,700 km across.
 */
export function createCosmos(
  u: HollowEarthUniforms,
  cosmos: CosmosUniforms,
  shading: HollowEarthShading,
  noiseTexture: THREE.Data3DTexture,
) {
  // Explicit level: sampled inside loops and branches.
  const noiseAt = (position: TslNode) => texture3D(noiseTexture, position, 0);

  /** Gas at a world position: rgb = its colour, a = density (0..1). */
  const gas = Fn(([position]: [TslNode]) => {
    const p = vec3(position).toVar();
    const distance = length(p).max(1).toVar();
    const r = distance.div(COSMOS_RADIUS).toVar();
    const direction = p.div(distance);

    const masses = noiseAt(p.mul(1 / 7.5e6).add(vec3(0.21, 0.63, 0.47))).r;
    // Sampled in log-radius: every halving of the distance to the centre
    // repeats the pattern at half the size, so structure never runs out as
    // you look inward — the gas has no largest or smallest scale.
    const depth = log(r.add(0.035));
    const nested = noiseAt(direction.mul(1.3).add(vec3(0.6, 1.0, 0.8).mul(depth.mul(0.85)))).b;
    const filaments = noiseAt(p.mul(1 / 1.6e6)).g;

    const body = masses
      .mul(0.62)
      .add(nested.mul(0.58))
      .sub(float(0.98).sub(cosmos.nebulaDensity.mul(0.34)));
    const density = body
      .mul(2.4)
      .clamp(0, 1)
      .mul(filaments.mul(0.95).add(0.4))
      // Thin out against the air, so the gas never touches the sky.
      .mul(float(1).sub(smoothstep(0.84, 1, r)));

    const warm = mix(vec3(1.0, 0.26, 0.4), vec3(0.16, 0.6, 0.78), smoothstep(0.35, 0.7, nested));
    const color = mix(warm, vec3(0.45, 0.3, 1.0), smoothstep(0.45, 0.9, filaments).mul(0.6));
    return vec4(color, density);
  });

  /**
   * March the gas along a view ray, up to whatever solid thing the ray hits.
   * It glows on its own and scatters whatever lights are on — with their
   * shadows, so an eclipsing body drags a dark cone through it. Must be
   * called while a TSL function is being built.
   */
  function marchNebula(
    rayOrigin: TslNode,
    rayDirection: TslNode,
    sceneDistance: TslNode,
    steps: number,
  ) {
    const origin = vec3(rayOrigin).toVar();
    const direction = vec3(rayDirection).toVar();
    const originRadius = length(origin);
    const b = dot(origin, direction).toVar();
    const c = originRadius.sub(COSMOS_RADIUS).mul(originRadius.add(COSMOS_RADIUS));
    const discriminant = b.mul(b).sub(c).toVar();
    const root = sqrt(max(discriminant, 0)).toVar();
    const start = max(b.negate().sub(root), 0).toVar();
    const end = min(b.negate().add(root), sceneDistance).toVar();
    const span = end.sub(start).toVar();

    const radiance = vec3(0).toVar();
    const transmittance = float(1).toVar();

    If(discriminant.greaterThan(0).and(span.greaterThan(1)), () => {
      // Offset each pixel's samples by a random fraction of a step; the eye
      // forgives grain far more readily than banding, and the upsample
      // smooths most of it away.
      const jitter = fract(sin(dot(screenCoordinate.xy, vec2(12.9898, 78.233))).mul(43758.5453));
      const stepLength = span.div(steps).toVar();
      const glow = cosmos.nebulaBrightness.mul(u.sunIntensity).mul(0.1);
      // Right beside a light the inverse square runs away, so cap it. (A
      // variable because it is shared between the per-light branches.)
      const brightest = vec3(u.sunIntensity.mul(12)).toVar();

      Loop(steps, ({ i }: { i: TslNode }) => {
        const position = origin
          .add(direction.mul(start.add(stepLength.mul(float(i).add(jitter)))))
          .toVar();
        const sample = gas(position).toVar();

        If(sample.a.greaterThan(0.004), () => {
          const lit = vec3(0).toVar();
          const altitude = float(SHELL_RADIUS).sub(length(position));
          shading.forEachLight(position, altitude, ({ radiance: light }) => {
            lit.addAssign(min(light, brightest));
          });
          const emitted = sample.rgb.mul(glow).add(sample.rgb.mul(lit).mul(0.006));
          const stepTransmittance = exp(
            sample.a.mul(stepLength).mul(cosmos.nebulaDensity).mul(-GAS_EXTINCTION),
          );
          radiance.addAssign(emitted.mul(float(1).sub(stepTransmittance)).mul(transmittance));
          transmittance.mulAssign(stepTransmittance);
        });
      });
    });

    return { radiance, transmittance };
  }

  /**
   * One star, if this patch of a layer has one. `onLayer` is the point where
   * the view ray meets the layer, as a unit vector from the centre;
   * `toHit` is that same point relative to the camera, in layer radii.
   */
  const star = Fn(([onLayer, toHit, cells, seed]: TslNode[]) => {
    const cell = floor(vec3(onLayer).mul(cells)).toVar();
    const random = hash3(cell.add(seed)).toVar();
    // Push the star back onto the sphere so every cell the sphere cuts shows it.
    const centre = cell.add(0.2).add(random.yzx.mul(0.6)).normalize();
    // Angle between the view ray and the star, as seen from the camera — not
    // distance along the layer, which would smear stars into streaks wherever
    // the layer is seen edge-on.
    const toStar = vec3(toHit).add(centre.sub(onLayer)).toVar();
    const along = vec3(toHit).normalize();
    const miss = cross(along, toStar).length().div(toStar.length().max(1e-6));
    const size = random.z.mul(random.z).mul(0.0011).add(0.0005);
    // A star smaller than a pixel is spread over the pixel and dimmed to
    // match, so distant layers stay steady as the camera moves.
    const spread = size.mul(size).add(cosmos.pixelAngle.mul(cosmos.pixelAngle).mul(0.6));
    const brightness = pow(random.y, float(7)).mul(2.6).add(0.03);
    const tint = mix(vec3(1.0, 0.72, 0.5), vec3(0.7, 0.82, 1.0), random.z);
    return tint
      .mul(brightness)
      .mul(exp(miss.mul(miss).div(spread).negate()))
      .mul(size.mul(size).div(spread).max(0.25))
      .mul(smoothstep(0.4, 0.42, random.x));
  });

  /** A spiral galaxy, where this region of a layer has one. */
  const galaxy = Fn(([direction, seed]: TslNode[]) => {
    const dir = vec3(direction).toVar();
    const cell = floor(dir.mul(4)).toVar();
    const random = hash3(cell.add(seed)).toVar();
    const result = vec3(0).toVar();

    If(random.x.greaterThan(0.72), () => {
      const centre = cell.add(0.5).add(random.sub(0.5).mul(0.5)).normalize().toVar();
      const offset = dir.sub(centre.mul(dot(dir, centre))).toVar();
      const size = random.y.mul(0.022).add(0.012);
      // A random disc orientation, seen at a random tilt.
      const axis = hash3(cell.add(seed).add(9)).sub(0.5).normalize();
      const e1 = cross(centre, axis).normalize().toVar();
      const e2 = cross(centre, e1);
      const x = dot(offset, e1).div(size).toVar();
      const y = dot(offset, e2)
        .div(size.mul(random.z.mul(0.7).add(0.3)))
        .toVar();
      const r2 = x.mul(x).add(y.mul(y)).toVar();

      If(r2.lessThan(1.6), () => {
        const r = sqrt(r2).toVar();
        // Two logarithmic arms.
        const arms = cos(
          atan(y, x)
            .mul(2)
            .sub(log(r.add(0.04)).mul(4.5))
            .add(random.x.mul(20)),
        )
          .mul(0.5)
          .add(0.5);
        const disc = exp(r.mul(-3.6))
          .mul(arms.mul(arms).mul(0.75).add(0.25))
          .mul(float(1).sub(smoothstep(0.9, 1.25, r)));
        const bulge = exp(r2.mul(-40));
        result.assign(
          vec3(1.0, 0.85, 0.6)
            .mul(bulge)
            .mul(1.6)
            .add(vec3(0.55, 0.7, 1.0).mul(disc)),
        );
      });
    });

    return result;
  });

  /**
   * Stars and galaxies along a view ray, in front of whatever the ray hits.
   * Analytic — a ray/sphere test and a hash per layer — so it can run per
   * full-resolution pixel and keep stars sharp. Must be called while a TSL
   * function is being built.
   */
  function starfield(rayOrigin: TslNode, rayDirection: TslNode, sceneDistance: TslNode) {
    const origin = vec3(rayOrigin).toVar();
    const direction = vec3(rayDirection).toVar();
    const limit = float(sceneDistance).toVar();
    const originRadius = length(origin).toVar();
    const b = dot(origin, direction).toVar();
    const result = vec3(0).toVar();

    STAR_LAYERS.forEach((layer, index) => {
      const radius = COSMOS_RADIUS * layer.radius;
      const c = originRadius.sub(radius).mul(originRadius.add(radius));
      const discriminant = b.mul(b).sub(c).toVar();
      If(discriminant.greaterThan(0), () => {
        const root = sqrt(discriminant).toVar();
        // The far crossing, and the near one when the camera is outside.
        for (const side of [1, -1]) {
          const t = b.negate().add(root.mul(side)).toVar();
          If(t.greaterThan(0).and(t.lessThan(limit)), () => {
            const onLayer = origin.add(direction.mul(t)).div(radius).toVar();
            const seed = vec3(index * 31.7 + side * 3.3, index * 12.1, index * 5.9);
            const toHit = direction.mul(t.div(radius));
            result.addAssign(star(onLayer, toHit, float(layer.cells), seed).mul(layer.gain));
            if (layer.galaxies) {
              result.addAssign(galaxy(onLayer, seed.add(57)).mul(layer.gain * 0.16));
            }
          });
        }
      });
    });

    return result.mul(cosmos.starBrightness).mul(u.sunIntensity);
  }

  return { marchNebula, starfield };
}

export type HollowEarthCosmos = ReturnType<typeof createCosmos>;
