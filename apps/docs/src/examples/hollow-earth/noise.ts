import {
  dot,
  float,
  floor,
  Fn,
  fract,
  If,
  max,
  mix,
  mod,
  select,
  sign,
  sin,
  smoothstep,
  vec3,
  vec4,
} from "three/tsl";

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

/** The band limit for one frequency: 1 if `spacing` resolves it, 0 if not. */
export const resolvedAt = (frequency: number, spacing: TslNode) => resolved(frequency, spacing);

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

/**
 * {@link periodicNoise} with its analytic gradient: `vec4(value, d/dx, d/dy,
 * d/dz)`. Same lattice and interpolation, so the value is identical.
 */
export const periodicNoiseD = Fn(([position, period]: [TslNode, TslNode]) => {
  const cell = floor(position).toVar();
  const f = fract(position).toVar();
  const u = f
    .mul(f)
    .mul(float(3).sub(f.mul(2)))
    .toVar();
  const du = f.mul(6).mul(float(1).sub(f)).toVar();

  const gradientAt = (x: number, y: number, z: number) =>
    latticeGradient(mod(cell.add(vec3(x, y, z)), period)).toVar();
  const ga = gradientAt(0, 0, 0);
  const gb = gradientAt(1, 0, 0);
  const gc = gradientAt(0, 1, 0);
  const gd = gradientAt(1, 1, 0);
  const ge = gradientAt(0, 0, 1);
  const gf = gradientAt(1, 0, 1);
  const gg = gradientAt(0, 1, 1);
  const gh = gradientAt(1, 1, 1);

  const va = dot(ga, f).toVar();
  const vb = dot(gb, f.sub(vec3(1, 0, 0))).toVar();
  const vc = dot(gc, f.sub(vec3(0, 1, 0))).toVar();
  const vd = dot(gd, f.sub(vec3(1, 1, 0))).toVar();
  const ve = dot(ge, f.sub(vec3(0, 0, 1))).toVar();
  const vf = dot(gf, f.sub(vec3(1, 0, 1))).toVar();
  const vg = dot(gg, f.sub(vec3(0, 1, 1))).toVar();
  const vh = dot(gh, f.sub(vec3(1, 1, 1))).toVar();

  // Trilinear interpolation expanded as a polynomial in u, so it can be
  // differentiated term by term.
  const k1 = vb.sub(va).toVar();
  const k2 = vc.sub(va).toVar();
  const k3 = ve.sub(va).toVar();
  const k4 = va.sub(vb).sub(vc).add(vd).toVar();
  const k5 = va.sub(vc).sub(ve).add(vg).toVar();
  const k6 = va.sub(vb).sub(ve).add(vf).toVar();
  const k7 = vb.add(vc).add(ve).add(vh).sub(va).sub(vd).sub(vf).sub(vg).toVar();

  const value = va
    .add(u.x.mul(k1))
    .add(u.y.mul(k2))
    .add(u.z.mul(k3))
    .add(u.x.mul(u.y).mul(k4))
    .add(u.y.mul(u.z).mul(k5))
    .add(u.z.mul(u.x).mul(k6))
    .add(u.x.mul(u.y).mul(u.z).mul(k7));

  const blended = ga
    .add(gb.sub(ga).mul(u.x))
    .add(gc.sub(ga).mul(u.y))
    .add(ge.sub(ga).mul(u.z))
    .add(ga.sub(gb).sub(gc).add(gd).mul(u.x.mul(u.y)))
    .add(ga.sub(gc).sub(ge).add(gg).mul(u.y.mul(u.z)))
    .add(ga.sub(gb).sub(ge).add(gf).mul(u.z.mul(u.x)))
    .add(gb.add(gc).add(ge).add(gh).sub(ga).sub(gd).sub(gf).sub(gg).mul(u.x.mul(u.y).mul(u.z)));
  const fromBlend = du.mul(
    vec3(
      k1.add(u.y.mul(k4)).add(u.z.mul(k6)).add(u.y.mul(u.z).mul(k7)),
      k2.add(u.z.mul(k5)).add(u.x.mul(k4)).add(u.z.mul(u.x).mul(k7)),
      k3.add(u.x.mul(k6)).add(u.y.mul(k5)).add(u.x.mul(u.y).mul(k7)),
    ),
  );

  return vec4(value.add(0.5), blended.add(fromBlend));
});

/** Mean of a folded, squared octave: what an unresolved crest averages to. */
const MEAN_CREST = 0.56;
const RIDGE_LACUNARITY = 2.07;
const RIDGE_GAIN = 0.52;
const RIDGE_FOLD = 2.1;
const RIDGE_FEEDBACK = 2.2;
const RIDGE_NORMALISE = 0.8;

const ridgeOctaves = (octaves: number) => {
  const table: { frequency: number; amplitude: number; offset: [number, number, number] }[] = [];
  let frequency = 1;
  let amplitude = 1;
  let range = 0;
  for (let i = 0; i < octaves; i++) {
    table.push({ frequency, amplitude, offset: [i * 13.1, i * 7.7, i * 19.3] });
    range += amplitude;
    frequency *= RIDGE_LACUNARITY;
    amplitude *= RIDGE_GAIN;
  }
  return { table, scale: 1 / (range * RIDGE_NORMALISE) };
};

/**
 * Ridged multifractal (~0..1): each octave is folded into a crest, and an
 * octave only adds detail where the one above it was already high. That is
 * what gives sharp ridgelines with smooth valley floors between them.
 * Arguments: position, vertex spacing (see {@link fbm}).
 */
export const ridged = (octaves: number) => {
  const { table, scale } = ridgeOctaves(octaves);
  return Fn(([position, spacing]: [TslNode, TslNode]) => {
    const total = float(0).toVar();
    const weight = float(1).toVar();
    for (const octave of table) {
      const sample = noise(position.mul(octave.frequency).add(vec3(...octave.offset)));
      // Gradient noise clusters around its midpoint; stretch it so the fold
      // spans crest (noise at its midpoint) to valley floor (either extreme).
      const fold = float(1).sub(sample.sub(0.5).abs().mul(RIDGE_FOLD).min(1));
      const crest = mix(
        float(MEAN_CREST),
        fold.mul(fold),
        resolved(octave.frequency, spacing),
      ).toVar();
      crest.mulAssign(weight);
      weight.assign(crest.mul(RIDGE_FEEDBACK).clamp(0, 1));
      total.addAssign(crest.mul(octave.amplitude));
    }
    return total.mul(scale).clamp(0, 1);
  });
};

/**
 * The same ridged function evaluated at two band limits at once — what a
 * coarse mesh carries (`coarseSpacing`) and what a pixel can show
 * (`fineSpacing`) — each with its gradient. The difference between the two
 * is the relief the mesh is missing, which a material can put back as shading.
 *
 * Must be called while a TSL function is being built. Gradients are with
 * respect to `position`.
 */
export function ridgedBands(
  octaves: number,
  position: TslNode,
  coarseSpacing: TslNode,
  fineSpacing: TslNode,
) {
  const { table, scale } = ridgeOctaves(octaves);
  const coarse = float(0).toVar();
  const fine = float(0).toVar();
  const coarseGradient = vec3(0).toVar();
  const fineGradient = vec3(0).toVar();
  const coarseWeight = float(1).toVar();
  const fineWeight = float(1).toVar();

  for (const octave of table) {
    const coarseResolved = resolved(octave.frequency, coarseSpacing).toVar();
    // A pixel never shows less than the mesh already has.
    const fineResolved = max(resolved(octave.frequency, fineSpacing), coarseResolved).toVar();
    const crest = float(MEAN_CREST).toVar();
    const crestGradient = vec3(0).toVar();

    // Octaves neither band can resolve stay at their mean: no noise lookup.
    If(fineResolved.greaterThan(0.001), () => {
      const sample = periodicNoiseD(
        position.mul(octave.frequency).add(vec3(...octave.offset)),
        float(WORLD_PERIOD),
      ).toVar();
      const centred = sample.x.sub(0.5);
      const folded = centred.abs().mul(RIDGE_FOLD);
      const fold = float(1).sub(folded.min(1)).toVar();
      const foldSlope = select(
        folded.lessThan(1),
        sign(centred).mul(-RIDGE_FOLD * octave.frequency),
        float(0),
      );
      crest.assign(fold.mul(fold));
      crestGradient.assign(sample.yzw.mul(foldSlope).mul(fold).mul(2));
    });

    const coarseCrest = mix(float(MEAN_CREST), crest, coarseResolved).mul(coarseWeight).toVar();
    coarseGradient.addAssign(
      crestGradient.mul(coarseResolved).mul(coarseWeight).mul(octave.amplitude),
    );
    coarseWeight.assign(coarseCrest.mul(RIDGE_FEEDBACK).clamp(0, 1));
    coarse.addAssign(coarseCrest.mul(octave.amplitude));

    const fineCrest = mix(float(MEAN_CREST), crest, fineResolved).mul(fineWeight).toVar();
    fineGradient.addAssign(crestGradient.mul(fineResolved).mul(fineWeight).mul(octave.amplitude));
    fineWeight.assign(fineCrest.mul(RIDGE_FEEDBACK).clamp(0, 1));
    fine.addAssign(fineCrest.mul(octave.amplitude));
  }

  return {
    coarse: coarse.mul(scale).clamp(0, 1),
    fine: fine.mul(scale).clamp(0, 1),
    coarseGradient: coarseGradient.mul(scale),
    fineGradient: fineGradient.mul(scale),
  };
}

/** 1 when a mesh with this vertex spacing already carries every ridge octave. */
export const ridgedComplete = (octaves: number, spacing: TslNode) => {
  const { table } = ridgeOctaves(octaves);
  return resolved(table[table.length - 1].frequency, spacing);
};

const hash3 = Fn(([cell]: [TslNode]) => {
  const x = dot(cell, vec3(127.1, 311.7, 74.7));
  const y = dot(cell, vec3(269.5, 183.3, 246.1));
  const z = dot(cell, vec3(113.5, 271.9, 124.6));
  return fract(sin(vec3(x, y, z)).mul(43758.5453));
});

/**
 * 3D Voronoi: the two nearest feature points to `position`, as offsets from
 * it plus the integer cell each belongs to. Must be called while a TSL
 * function is being built.
 */
export function voronoi(position: TslNode) {
  const cell = floor(position).toVar();
  const f = fract(position).toVar();
  const nearestDistance = float(64).toVar();
  const secondDistance = float(64).toVar();
  const nearestOffset = vec3(0).toVar();
  const secondOffset = vec3(0).toVar();
  const nearestCell = vec3(0).toVar();
  const secondCell = vec3(0).toVar();

  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        const neighbour = cell.add(vec3(x, y, z)).toVar();
        const offset = vec3(x, y, z).add(hash3(neighbour)).sub(f).toVar();
        const distance = dot(offset, offset).toVar();
        If(distance.lessThan(nearestDistance), () => {
          secondDistance.assign(nearestDistance);
          secondOffset.assign(nearestOffset);
          secondCell.assign(nearestCell);
          nearestDistance.assign(distance);
          nearestOffset.assign(offset);
          nearestCell.assign(neighbour);
        }).ElseIf(distance.lessThan(secondDistance), () => {
          secondDistance.assign(distance);
          secondOffset.assign(offset);
          secondCell.assign(neighbour);
        });
      }
    }
  }

  const across = secondOffset.sub(nearestOffset).toVar();
  const acrossDirection = across.div(across.length().max(1e-5)).toVar();
  return {
    nearestCell,
    secondCell,
    /** Unit vector from the nearest feature point towards the second. */
    acrossDirection,
    /** Distance to the border between the two cells, in cell units. */
    border: dot(nearestOffset.add(secondOffset).mul(0.5), acrossDirection),
    /** Per-cell random vec3 in 0..1, decorrelated by `salt`. */
    random: (cellId: TslNode, salt: number) =>
      hash3(cellId.add(vec3(salt, salt * 1.7, salt * 2.3))),
  };
}
