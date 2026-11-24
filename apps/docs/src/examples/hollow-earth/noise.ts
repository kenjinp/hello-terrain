import { dot, float, floor, Fn, fract, mix, mod, sin, smoothstep, vec3 } from "three/tsl";

// oxlint-disable-next-line typescript/no-explicit-any
type TslNode = any;

const latticeGradient = Fn(([cell]: [TslNode]) => {
  const x = dot(cell, vec3(127.1, 311.7, 74.7));
  const y = dot(cell, vec3(269.5, 183.3, 246.1));
  const z = dot(cell, vec3(113.5, 271.9, 124.6));
  return fract(sin(vec3(x, y, z)).mul(43758.5453))
    .mul(2)
    .sub(1)
    .normalize();
});

/**
 * Gradient noise (~0..1) that repeats every `period` cells.
 *
 * Wrapping the lattice does two jobs. It lets the noise be fed wrapped,
 * camera-relative coordinates without a seam, and it keeps the hash inputs
 * small: hashing raw lattice coordinates in the tens of thousands (a
 * kilometre-scale octave on an Earth-sized sphere) runs `sin` out of float32
 * precision and the noise turns to static.
 */
export const periodicNoise = Fn(([position, period]: [TslNode, TslNode]) => {
  const cell = floor(position).toVar();
  const f = fract(position).toVar();
  const blend = f.mul(f).mul(float(3).sub(f.mul(2)));
  const corner = (x: number, y: number, z: number) => {
    const offset = vec3(x, y, z);
    return dot(latticeGradient(mod(cell.add(offset), period)), f.sub(offset));
  };
  const x00 = mix(corner(0, 0, 0), corner(1, 0, 0), blend.x);
  const x10 = mix(corner(0, 1, 0), corner(1, 1, 0), blend.x);
  const x01 = mix(corner(0, 0, 1), corner(1, 0, 1), blend.x);
  const x11 = mix(corner(0, 1, 1), corner(1, 1, 1), blend.x);
  return mix(mix(x00, x10, blend.y), mix(x01, x11, blend.y), blend.z).add(0.5);
});

/** Lattice period used for world-space (non camera-relative) noise. */
const WORLD_PERIOD = 256;

/** Single octave of world-space noise, ~0..1. */
export const noise = (position: TslNode) => periodicNoise(position, float(WORLD_PERIOD));

/**
 * How much of an octave a mesh can represent: 1 when its noise cells span
 * several vertices, 0 when they are smaller than the vertex spacing. Octaves
 * the mesh cannot resolve would otherwise alias into random spikes — on the
 * far side of the world, where vertices are tens of kilometres apart, a 7 km
 * ridge sampled that way turns into shards.
 */
const resolved = (frequency: number, spacing: TslNode | undefined) =>
  spacing === undefined ? float(1) : smoothstep(1.5, 4, float(1 / frequency).div(spacing));

/**
 * Fractal noise, normalised to ~0..1 with a mean of 0.5.
 *
 * `spacing` is the mesh's vertex spacing in the same units as `position`;
 * pass it to fade out octaves the mesh is too coarse to carry.
 */
export function fbm(
  position: TslNode,
  octaves: number,
  spacing?: TslNode,
  lacunarity = 2.03,
  gain = 0.5,
) {
  let total: TslNode = float(0);
  let frequency = 1;
  let amplitude = 1;
  let range = 0;
  for (let i = 0; i < octaves; i++) {
    // Offset each octave so their lattices never line up.
    const sample = noise(position.mul(frequency).add(vec3(i * 17.3, i * 5.9, i * 11.1)));
    total = total.add(sample.sub(0.5).mul(resolved(frequency, spacing)).mul(amplitude));
    range += amplitude;
    frequency *= lacunarity;
    amplitude *= gain;
  }
  return total.div(range).add(0.5);
}

/** Mean of a folded, squared octave: what an unresolved crest averages to. */
const MEAN_CREST = 0.5;

/**
 * Ridged multifractal (~0..1): each octave is folded into a crest, and an
 * octave only adds detail where the one above it was already high. That is
 * what gives sharp ridgelines with smooth valley floors between them.
 * Arguments: position, vertex spacing (see {@link fbm}).
 */
export const ridged = (octaves: number) =>
  Fn(([position, spacing]: [TslNode, TslNode]) => {
    const total = float(0).toVar();
    const weight = float(1).toVar();
    let frequency = 1;
    let amplitude = 1;
    let range = 0;
    for (let i = 0; i < octaves; i++) {
      const sample = noise(position.mul(frequency).add(vec3(i * 13.1, i * 7.7, i * 19.3)));
      // Gradient noise clusters around its midpoint; stretch it so the fold
      // spans crest (noise at its midpoint) to valley floor (either extreme).
      const fold = float(1).sub(sample.sub(0.5).abs().mul(2.6).min(1));
      const crest = mix(float(MEAN_CREST), fold.mul(fold), resolved(frequency, spacing)).toVar();
      crest.mulAssign(weight);
      weight.assign(crest.mul(2.2).clamp(0, 1));
      total.addAssign(crest.mul(amplitude));
      range += amplitude;
      frequency *= 2.07;
      amplitude *= 0.52;
    }
    return total.div(range * 0.8).clamp(0, 1);
  });
