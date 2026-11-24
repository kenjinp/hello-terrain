import { clamp, cos, exp, float, Fn, If, mix, sin, smoothstep, texture3D, vec3 } from "three/tsl";
import * as THREE from "three/webgpu";
import type { HollowEarthUniforms } from "./shading";
import { SHELL_RADIUS } from "./world";

// oxlint-disable-next-line typescript/no-explicit-any
type TslNode = any;

/** Altitude of the cloud base and of the highest cloud tops, in metres. */
export const CLOUD_BASE = 1_500;
export const CLOUD_TOP = 6_500;
/**
 * Extinction of fully dense cloud, per metre. Real cloud is several times
 * denser; this is tuned to the step sizes a world-scale march can afford.
 */
const CLOUD_EXTINCTION = 0.004;

// Metres per repeat of the noise volume. The shape repeat is long enough
// that the weather pattern changes before the tiling can be seen.
const SHAPE_SCALE = 1 / 140_000;
const DETAIL_SCALE = 1 / 31_000;
const WISP_SCALE = 1 / 8_700;

const NOISE_SIZE = 64;

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

/**
 * The cloud noise volume, generated once on the CPU. Tileable, so it can be
 * repeated across a world 12,700 km wide:
 *
 * - R: Perlin–Worley — billowy base shapes
 * - G: Worley fbm — mid-scale erosion
 * - B: Perlin fbm — weather (where the cloud systems are)
 * - A: fine Worley fbm — wisps
 */
export function createCloudNoiseTexture() {
  const size = NOISE_SIZE;
  const random = createRandom(0x51ed270b);
  const perlin = [4, 8, 16].map((period) => createTileablePerlin(period, random));
  const weather = [3, 6, 12, 24].map((period) => createTileablePerlin(period, random));
  const shapeWorley = [4, 8, 16].map((cells) => createTileableWorley(cells, random));
  const detailWorley = [6, 12, 24].map((cells) => createTileableWorley(cells, random));
  const wispWorley = [10, 20].map((cells) => createTileableWorley(cells, random));

  const channels = [0, 1, 2, 3].map(() => new Float32Array(size * size * size));
  const octaves = (layers: ((u: number, v: number, w: number) => number)[], gain: number) => {
    return (u: number, v: number, w: number) => {
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
  const perlinFbm = octaves(perlin, 0.5);
  const weatherFbm = octaves(weather, 0.55);
  const shapeFbm = octaves(shapeWorley, 0.5);
  const detailFbm = octaves(detailWorley, 0.5);
  const wispFbm = octaves(wispWorley, 0.5);

  let index = 0;
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = (x + 0.5) / size;
        const v = (y + 0.5) / size;
        const w = (z + 0.5) / size;
        const billow = shapeFbm(u, v, w);
        // Perlin remapped so Worley cells bulge out of it.
        const base = perlinFbm(u, v, w) * 0.5 + 0.5;
        channels[0][index] = (base - (1 - billow) * 0.6) / (1 - (1 - billow) * 0.6 + 1e-3);
        channels[1][index] = detailFbm(u, v, w);
        channels[2][index] = weatherFbm(u, v, w);
        channels[3][index] = wispFbm(u, v, w);
        index++;
      }
    }
  }

  // Stretch every channel to the full 8-bit range.
  const data = new Uint8Array(size * size * size * 4);
  for (let channel = 0; channel < 4; channel++) {
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

/**
 * A cloud deck for the inside of the shell.
 *
 * The density field is deliberately *separable*: a weather pattern that
 * depends only on direction from the centre, times a profile that depends
 * only on altitude, with 3D noise eroding the edges. Because all sunlight in
 * this world travels along radii, that makes the light's path through the
 * cloud a one-dimensional problem — `shadow()` is the optical depth of the
 * column above a point, in closed form. It plays the role of the Beer shadow
 * maps in three-geospatial's clouds, without the maps: the same function
 * shadows the ground, the sea, the cloud itself and every sample of the air,
 * which is where the shafts of light under broken cloud come from.
 */
export function createClouds(u: HollowEarthUniforms, noiseTexture: THREE.Data3DTexture) {
  // Explicit level: these are sampled inside loops and branches.
  const sample = (position: TslNode) => texture3D(noiseTexture, position, 0);

  /** Rotate about the world Y axis by the wind angle, so weather drifts. */
  const drift = (position: TslNode) => {
    const c = cos(u.cloudDrift);
    const s = sin(u.cloudDrift);
    return vec3(
      position.x.mul(c).sub(position.z.mul(s)),
      position.y,
      position.x.mul(s).add(position.z.mul(c)),
    );
  };

  /**
   * Weather at a direction from the centre: x = coverage (0 = clear sky,
   * 1 = overcast), y = how tall the clouds grow there (0..1 of the deck).
   */
  const weather = Fn(([direction]: [TslNode]) => {
    const d = drift(direction).toVar();
    const systems = sample(d.mul(0.9).add(vec3(0.13, 0.57, 0.31))).b;
    const fronts = sample(
      vec3(d.z, d.x, d.y)
        .mul(2.3)
        .add(vec3(0.71, 0.22, 0.48)),
    ).b;
    const pattern = systems.mul(0.62).add(fronts.mul(0.38));
    // Capped below 1 so even the thickest systems keep breaks in them.
    const coverage = clamp(pattern.sub(float(1).sub(u.cloudCoverage)).mul(2.6).add(0.5), 0, 0.86);
    const growth = sample(
      vec3(d.y, d.z, d.x)
        .mul(1.6)
        .add(vec3(0.4, 0.9, 0.15)),
    ).b;
    return vec3(coverage, mix(float(0.3), float(1), smoothstep(0.3, 0.75, growth)), 0);
  });

  /** Base cloud shape before fine erosion, from the weather and one tap. */
  const baseShape = (position: TslNode, coverage: TslNode, profile: TslNode) => {
    const shape = sample(drift(position).mul(SHAPE_SCALE)).r;
    return clamp(shape.mul(profile).sub(float(1).sub(coverage)).div(coverage.max(1e-3)), 0, 1);
  };

  /** Cloud density (0..1) at a world position. */
  const density = Fn(([position]: [TslNode]) => {
    const p = vec3(position).toVar();
    const radius = p.length().toVar();
    const altitude = float(SHELL_RADIUS).sub(radius);
    const heightFraction = altitude
      .sub(CLOUD_BASE)
      .div(CLOUD_TOP - CLOUD_BASE)
      .toVar();
    const result = float(0).toVar();

    If(heightFraction.greaterThan(0).and(heightFraction.lessThan(1)), () => {
      const local = weather(p.div(radius)).toVar();
      If(local.x.greaterThan(0.01), () => {
        // Rounded bottoms, tops set by how tall clouds grow here.
        const profile = smoothstep(0, 0.1, heightFraction).mul(
          float(1).sub(smoothstep(local.y.mul(0.55), local.y, heightFraction)),
        );
        const base = baseShape(p, local.x, profile).toVar();
        If(base.greaterThan(0.001), () => {
          const moved = drift(p).toVar();
          const erosion = sample(moved.mul(DETAIL_SCALE))
            .g.mul(0.65)
            .add(sample(moved.mul(WISP_SCALE)).a.mul(0.35));
          // Erode the edges, leave the cores solid.
          const strength = float(1).sub(base.mul(0.75)).mul(0.6);
          result.assign(
            clamp(base.sub(erosion.mul(strength)).div(float(1).sub(strength)), 0, 1).mul(
              u.cloudDensity,
            ),
          );
        });
      });
    });

    return result;
  });

  /**
   * Optical depth of the cloud between `position` and the sun. Closed form:
   * the column's total depth (weather × one shape tap at mid-deck) times the
   * fraction of the profile that lies above `position`.
   */
  const opticalDepth = Fn(([position]: [TslNode]) => {
    const p = vec3(position).toVar();
    const radius = p.length().toVar();
    const altitude = float(SHELL_RADIUS).sub(radius);
    const result = float(0).toVar();

    If(altitude.lessThan(CLOUD_TOP), () => {
      const direction = p.div(radius).toVar();
      const local = weather(direction).toVar();
      If(local.x.greaterThan(0.01), () => {
        const deckDepth = local.y.mul(CLOUD_TOP - CLOUD_BASE);
        const middle = direction.mul(float(SHELL_RADIUS - CLOUD_BASE).sub(deckDepth.mul(0.4)));
        const column = baseShape(middle, local.x, float(0.85))
          .mul(deckDepth)
          .mul(0.5 * CLOUD_EXTINCTION)
          .mul(u.cloudDensity);
        const heightFraction = altitude.sub(CLOUD_BASE).div(CLOUD_TOP - CLOUD_BASE);
        result.assign(column.mul(float(1).sub(smoothstep(0, local.y, heightFraction))));
      });
    });

    return result;
  });

  /**
   * Fraction of direct sunlight reaching `position` through the clouds, for
   * the ground, the sea and the air. Never fully black: light scattered
   * forward through the cloud still arrives.
   */
  const shadow = (position: TslNode) =>
    exp(opticalDepth(position).mul(u.cloudShadowStrength).negate()).mul(0.9).add(0.1);

  /**
   * Sunlight reaching a point *inside* the cloud. Light that has scattered
   * several times travels much further than Beer's law allows, which is why
   * clouds are white and not black inside; approximated by summing a few
   * progressively weaker, progressively more penetrating copies.
   */
  const interiorLight = (position: TslNode) => {
    const depth = opticalDepth(position).toVar();
    return exp(depth.negate())
      .add(exp(depth.mul(-0.3)).mul(0.5))
      .add(exp(depth.mul(-0.08)).mul(0.25))
      .div(1.75);
  };

  return { density, shadow, interiorLight, extinction: CLOUD_EXTINCTION };
}

export type HollowEarthClouds = ReturnType<typeof createClouds>;
