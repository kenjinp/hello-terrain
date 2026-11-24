import type { ElevationCallback } from "@hello-terrain/three";
import { clamp, dot, exp2, float, max, mix, smoothstep, step, vec3 } from "three/tsl";
import { fbm, noise, resolvedAt, ridged, voronoi } from "./noise";
import { SHELL_RADIUS } from "./world";

// oxlint-disable-next-line typescript/no-explicit-any
type TslNode = any;

/** 1 at `x <= from`, falling to 0 at `x >= to` (`from < to`). */
const falloff = (from: number, to: number, x: TslNode) => float(1).sub(smoothstep(from, to, x));

/** Octaves in the mountain ridge function. */
export const RANGE_OCTAVES = 9;
/** Ridge-noise frequency on the unit sphere: ~60 km between major crests. */
export const RANGE_FREQUENCY = 110;
/** How far the shared domain warp displaces the ridge noise. */
export const RANGE_WARP = 9;
/** Height of the tallest crests above a range's base, in metres. */
export const RANGE_HEIGHT = 7600;

/**
 * Ridge noise is squeezed by this factor across a plate border, so crests
 * run parallel to the border the way fold belts do.
 */
export const RANGE_STRETCH = 2.3;

/** Squeeze `v` along the unit vector `across` by {@link RANGE_STRETCH}. */
export const stretchAcross = (v: TslNode, across: TslNode) =>
  v.add(across.mul(dot(v, across)).mul(RANGE_STRETCH - 1));

/** Where to sample the ridge function for a point from {@link tectonics}. */
export const rangePosition = (world: { p: TslNode; warp: TslNode; across: TslNode }) =>
  stretchAcross(world.p.mul(RANGE_FREQUENCY).add(world.warp.mul(RANGE_WARP)), world.across);

/** Crest value (0..1) → fraction of {@link RANGE_HEIGHT}; sharpens peaks. */
export const rangeProfile = (crest: TslNode) => crest.mul(crest.mul(0.5).add(0.5));
/** Derivative of {@link rangeProfile}. */
export const rangeProfileSlope = (crest: TslNode) => crest.add(0.5);

/** Plates per unit of the unit sphere; ~30 plates cross the surface. */
const PLATE_FREQUENCY = 1.55;

/**
 * Plate-tectonics-flavoured layout of the world, as functions of a point on
 * the unit sphere. Shared by the elevation function (in the compute pass)
 * and the terrain material (per fragment), so both agree on where mountain
 * belts run.
 *
 * The surface is cut into ~30 Voronoi plates. Each is continental or
 * oceanic and has a drift direction, so every border has a type:
 *
 * | Border                      | What it builds                               |
 * | --------------------------- | -------------------------------------------- |
 * | continent ⟶⟵ continent      | a broad, high range (Himalaya)               |
 * | ocean ⟶⟵ continent          | coastal cordillera, trench offshore (Andes)  |
 * | ocean ⟶⟵ ocean              | trench and a volcanic island arc (Aleutians) |
 * | ocean ⟵⟶ ocean              | mid-ocean ridge                              |
 * | continent ⟵⟶ continent      | rift valley, flooding into long lakes        |
 *
 * Must be called while a TSL function is being built.
 */
export function tectonics(point: TslNode) {
  const p = vec3(point).toVar();

  // One domain warp for everything, so coasts and belts meander together.
  const warpPosition = p.mul(1.3);
  const warp = vec3(
    fbm(warpPosition.add(vec3(3.1, 9.2, 5.7)), 3),
    fbm(warpPosition.add(vec3(19.3, 7.1, 33.7)), 3),
    fbm(warpPosition.add(vec3(41.2, 17.9, 5.3)), 3),
  )
    .sub(0.5)
    .mul(0.5)
    .toVar();
  const q = p.add(warp).toVar();

  const plates = voronoi(q.mul(PLATE_FREQUENCY).add(vec3(0.37, 0.61, 0.19)));
  const border = plates.border.toVar();
  const nearSeed = plates.random(plates.nearestCell, 17).toVar();
  const farSeed = plates.random(plates.secondCell, 17).toVar();
  const nearContinental = step(0.56, nearSeed.x).toVar();
  const farContinental = step(0.56, farSeed.x).toVar();

  // Closing speed across the border: > 0 where the plates collide.
  const nearDrift = plates.random(plates.nearestCell, 31).mul(2).sub(1);
  const farDrift = plates.random(plates.secondCell, 31).mul(2).sub(1);
  const closing = dot(nearDrift.sub(farDrift), plates.acrossDirection).toVar();
  const convergent = smoothstep(0.05, 0.6, closing).toVar();
  const divergent = smoothstep(0.05, 0.6, closing.negate()).toVar();

  // "Continentalness": the plate's type, eased across borders, then eroded
  // and extended by fractal noise so coastlines are not plate outlines.
  const plateLand = mix(
    nearContinental.add(farContinental).mul(0.5),
    nearContinental,
    smoothstep(0, 0.14, border),
  );
  const continent = plateLand
    .sub(0.5)
    .mul(0.3)
    .add(
      fbm(q.mul(1.9).add(vec3(7.7, 1.3, 4.2)), 5)
        .sub(0.5)
        .mul(0.85),
    )
    .add(
      fbm(q.mul(9).add(vec3(2.6, 8.4, 0.9)), 3)
        .sub(0.5)
        .mul(0.09),
    )
    .sub(0.012)
    .toVar();
  const land = smoothstep(-0.003, 0.009, continent).toVar();
  const inland = smoothstep(0, 0.12, continent).toVar();

  const bothContinental = nearContinental.mul(farContinental);
  const bothOceanic = float(1).sub(nearContinental).mul(float(1).sub(farContinental));
  const mixed = float(1).sub(bothContinental).sub(bothOceanic);

  // --- Mountain belts ------------------------------------------------------
  const passes = smoothstep(0.36, 0.56, fbm(q.mul(5.3).add(vec3(2.2, 8.8, 6.1)), 2))
    .mul(0.75)
    .add(0.25);
  const collision = bothContinental.mul(falloff(0.015, 0.11, border));
  const cordillera = mixed.mul(falloff(0.01, 0.075, border)).mul(0.85);
  // Old, worn-down ranges away from any border (Urals, Appalachians).
  const ancient = falloff(
    0.01,
    0.04,
    fbm(q.mul(3.1).add(vec3(11.1, 23.4, 2.9)), 3)
      .sub(0.5)
      .abs(),
  )
    .mul(inland)
    .mul(0.38);
  const belt = max(max(collision, cordillera).mul(convergent), ancient)
    .mul(passes)
    .mul(smoothstep(-0.004, 0.03, continent))
    .toVar();

  return {
    p,
    q,
    warp,
    /** Unit vector pointing across the nearest plate border. */
    across: plates.acrossDirection,
    border,
    continent,
    land,
    inland,
    belt,
    convergent,
    divergent,
    bothContinental,
    bothOceanic,
    mixed,
  };
}

/**
 * Elevation for the hollow world, built to give the eye things of known size
 * to measure the shell against. Working in metres, then normalised by
 * `elevationScale`. On top of the plate layout from {@link tectonics}:
 *
 * - **Plateaus** ~1.5 km high with abrupt edges, **hill country** in
 *   patches, flat plains between, and **valleys** that flood into lakes and
 *   inlets where they cut below sea level.
 * - **Continental shelves**: a broad terrace ~130 m down, then the
 *   continental slope dropping to a ~4 km abyssal plain.
 * - **Island chains**: volcanic arcs behind ocean trenches, and hotspot
 *   tracks — strings of seamounts whose tallest peaks surface.
 */
export function createHollowEarthElevation(params: {
  elevationScale: number;
  /** Vertices along a tile edge, to work out how fine a tile can sample. */
  innerTileSegments: number;
}): ElevationCallback {
  const ranges = ridged(RANGE_OCTAVES);

  return ({ worldPosition, tileLevel }) => {
    const world = tectonics(worldPosition.mul(float(1 / SHELL_RADIUS)));
    const { p, q, border, continent, land, inland, belt } = world;

    // Vertex spacing of this tile on the unit sphere: a cube face spans a
    // quarter of a great circle and halves with every level. Each noise call
    // below is told the spacing in its own units, so it can drop octaves the
    // tile is too coarse to carry (see `resolved` in noise.ts). Neighbouring
    // levels then disagree slightly along shared edges, by about a pixel at
    // the distance they are drawn; skirts cover it.
    const spacing = float(Math.PI / 2 / params.innerTileSegments)
      .div(exp2(float(tileLevel)))
      .toVar();
    const at = (frequency: number) => spacing.mul(frequency);

    // --- Land ---------------------------------------------------------------
    const crest = ranges(rangePosition(world), at(RANGE_FREQUENCY * RANGE_STRETCH)).toVar();
    const mountains = belt.mul(rangeProfile(crest).mul(RANGE_HEIGHT).add(500));
    // Foothills: the ground swells up towards a range before the peaks start.
    const foothills = smoothstep(0, 0.6, belt).mul(450);

    const plateauMask = smoothstep(0.555, 0.59, fbm(q.mul(3.3).add(vec3(5.5, 12.1, 27.3)), 3))
      .mul(inland)
      .mul(float(1).sub(belt))
      .toVar();
    const plateau = plateauMask.mul(fbm(p.mul(900), 3, at(900)).mul(350).add(1350));

    const hillMask = smoothstep(0.42, 0.62, fbm(q.mul(6.1).add(vec3(14.2, 4.4, 9.9)), 2)).toVar();
    const hills = fbm(p.mul(450).add(vec3(1.7, 6.3, 2.2)), 5, at(450))
      .sub(0.5)
      .mul(2)
      .mul(hillMask.mul(700).add(90))
      .mul(float(1).sub(belt.mul(0.5)));

    const lowland = inland.mul(380).add(max(continent, 0).mul(1500)).add(30);

    // Relief below ~1.5 km: rough on mountains, gentle elsewhere.
    const fine = fbm(p.mul(5200).add(vec3(8.1, 3.9, 12.6)), 4, at(5200))
      .sub(0.5)
      .mul(2)
      .mul(belt.mul(crest).mul(280).add(hillMask.mul(55)).add(18));

    // The valley network is a thin line where noise crosses its midpoint. It
    // cannot be band-limited through the noise (the mean *is* the midpoint,
    // which would carve everything), so fade the carving itself instead.
    const valleyLine = fbm(q.mul(18).add(vec3(6.6, 21.2, 13.5)), 3)
      .sub(0.5)
      .abs();
    const valley = falloff(0.0, 0.028, valleyLine)
      .mul(float(1).sub(belt))
      .mul(resolvedAt(18 * 8, spacing));
    const carve = valley.mul(plateau.mul(0.7).add(hills.max(0).mul(0.6)).add(110));

    // Rift valleys where continental plates pull apart.
    const rift = world.bothContinental
      .mul(world.divergent)
      .mul(falloff(0.004, 0.022, border))
      .mul(inland)
      .mul(900);

    const landHeight = lowland
      .add(foothills)
      .add(plateau)
      .add(hills)
      .add(mountains)
      .add(fine)
      .sub(carve)
      .sub(rift);

    // --- Ocean --------------------------------------------------------------
    // Shelf: a gentle terrace out to the shelf break, then the slope.
    const shelfBreak = -0.034;
    const terrace = falloff(shelfBreak, 0, continent).mul(-130).sub(6);
    const abyss = falloff(-0.075, shelfBreak, continent).toVar();
    const abyssalRelief = fbm(p.mul(40).add(vec3(4.4, 9.1, 1.2)), 4, at(40))
      .sub(0.5)
      .mul(1100);

    const oceanBorder = float(1).sub(world.bothContinental);
    // Trench right on a closing border; the arc stands a little behind it.
    const trench = oceanBorder
      .mul(world.convergent)
      .mul(falloff(0.0, 0.02, border))
      .mul(-3600);
    const arcLine = falloff(0.0, 0.016, border.sub(0.04).abs());
    const volcano = smoothstep(0.5, 0.68, noise(p.mul(150).add(vec3(31.3, 2.1, 17.7))));
    const islandArc = world.bothOceanic
      .mul(world.convergent)
      .mul(arcLine)
      .mul(volcano.mul(3600).add(2300));
    const spreadingRidge = world.bothOceanic
      .mul(world.divergent)
      .mul(falloff(0.0, 0.07, border))
      .mul(
        fbm(p.mul(160).add(vec3(9.9, 4.2, 6.6)), 3, at(160))
          .mul(900)
          .add(1500),
      );

    // Hotspot tracks: beads of volcanoes strung along thin wandering lines.
    const track = falloff(
      0.0,
      0.009,
      fbm(q.mul(6.3).add(vec3(15.4, 27.1, 8.8)), 2)
        .sub(0.5)
        .abs(),
    );
    const bead = smoothstep(0.52, 0.7, noise(p.mul(120).add(vec3(22.2, 5.5, 17.1))));
    const hotspots = track.mul(bead).mul(5600);

    const oceanHeight = terrace
      .add(abyss.mul(abyssalRelief.sub(4100)))
      .add(abyss.mul(trench.add(spreadingRidge).add(hotspots)))
      .add(abyss.mul(islandArc));

    const height = mix(oceanHeight, landHeight, land);
    return clamp(height.div(params.elevationScale), -0.95, 0.98);
  };
}
