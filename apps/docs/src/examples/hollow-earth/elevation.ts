import type { ElevationCallback } from "@hello-terrain/three";
import { clamp, exp2, float, max, mix, smoothstep, vec3 } from "three/tsl";
import { fbm, ridged } from "./noise";
import { SHELL_RADIUS } from "./world";

// oxlint-disable-next-line typescript/no-explicit-any
type TslNode = any;

/** 1 at `x <= from`, falling to 0 at `x >= to` (`from < to`). */
const falloff = (from: number, to: number, x: TslNode) => float(1).sub(smoothstep(from, to, x));

/**
 * Elevation for the hollow world, built to give the eye things of known size
 * to measure the shell against. Working in metres, then normalised by
 * `elevationScale`:
 *
 * - **Continents and shelves** from warped low-frequency noise.
 * - **Mountain belts**: ridged ranges up to ~7 km, confined to narrow ribbons
 *   (where a "plate" noise crosses its midpoint) so they read as cordilleras
 *   with passes, not as uniform bumpiness.
 * - **Plateaus** ~1.5 km high with abrupt edges.
 * - **Hill country** in patches, flat plains between.
 * - **Valleys** carved into the lowlands; where they cut below sea level
 *   they flood into lakes, inlets and fjords.
 * - **Ocean**: a shallow shelf, an abyssal plain, and seamount chains whose
 *   tallest peaks break the surface as islands.
 */
export function createHollowEarthElevation(params: {
  elevationScale: number;
  /** Vertices along a tile edge, to work out how fine a tile can sample. */
  innerTileSegments: number;
}): ElevationCallback {
  const ranges = ridged(9);

  return ({ worldPosition, tileLevel }) => {
    const p = worldPosition.mul(float(1 / SHELL_RADIUS)).toVar();

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

    // Shared domain warp so coasts, belts and plateaus all meander together.
    const warpPosition = p.mul(1.3);
    const warp = vec3(
      fbm(warpPosition.add(vec3(3.1, 9.2, 5.7)), 3),
      fbm(warpPosition.add(vec3(19.3, 7.1, 33.7)), 3),
      fbm(warpPosition.add(vec3(41.2, 17.9, 5.3)), 3),
    )
      .sub(0.5)
      .mul(0.55)
      .toVar();
    const q = p.add(warp).toVar();

    // Signed distance-like "continentalness": > 0 is land.
    const continent = fbm(q.mul(1.7).add(vec3(7.7, 1.3, 4.2)), 5)
      .sub(0.525)
      .toVar();
    const land = smoothstep(-0.004, 0.012, continent);
    const inland = smoothstep(0, 0.14, continent).toVar();

    // --- Mountain belts ---------------------------------------------------
    const plateA = fbm(q.mul(2.6).add(vec3(11.1, 23.4, 2.9)), 3);
    const plateB = fbm(q.mul(4.1).add(vec3(31.7, 3.3, 14.8)), 3);
    const beltA = falloff(0.012, 0.05, plateA.sub(0.5).abs());
    const beltB = falloff(0.008, 0.032, plateB.sub(0.47).abs()).mul(0.65);
    const passes = smoothstep(0.38, 0.58, fbm(q.mul(5.3).add(vec3(2.2, 8.8, 6.1)), 2))
      .mul(0.85)
      .add(0.15);
    const belt = max(beltA, beltB)
      .mul(passes)
      .mul(smoothstep(-0.01, 0.05, continent))
      .toVar();
    // ~60 km between major ridgelines, detail down to a few hundred metres.
    const crest = ranges(p.mul(110).add(warp.mul(9)), at(110)).toVar();
    const mountains = belt.mul(crest.mul(crest.mul(0.5).add(0.5)).mul(7600).add(500));

    // --- Plateaus, hills, plains ------------------------------------------
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

    const lowland = inland.mul(420).add(max(continent, 0).mul(1400)).add(35);

    // Relief below ~1.5 km: rough on mountains, gentle elsewhere.
    const fine = fbm(p.mul(5200).add(vec3(8.1, 3.9, 12.6)), 4, at(5200))
      .sub(0.5)
      .mul(2)
      .mul(belt.mul(crest).mul(280).add(hillMask.mul(55)).add(18));

    const valleyLine = fbm(q.mul(18).add(vec3(6.6, 21.2, 13.5)), 3, at(18))
      .sub(0.5)
      .abs();
    const valley = falloff(0.0, 0.028, valleyLine).mul(float(1).sub(belt));
    const carve = valley.mul(plateau.mul(0.7).add(hills.max(0).mul(0.6)).add(110));

    const landHeight = lowland.add(plateau).add(hills).add(mountains).add(fine).sub(carve);

    // --- Ocean ------------------------------------------------------------
    const shelf = falloff(-0.028, 0, continent);
    const abyss = falloff(-0.11, -0.022, continent).toVar();
    const seabedRelief = fbm(p.mul(40).add(vec3(4.4, 9.1, 1.2)), 4, at(40))
      .sub(0.5)
      .mul(1500);
    const seamounts = clamp(
      fbm(p.mul(110).add(vec3(22.2, 5.5, 17.1)), 3, at(110))
        .sub(0.625)
        .div(0.17),
      0,
      1.4,
    );
    const oceanHeight = shelf
      .mul(-130)
      .sub(8)
      .add(abyss.mul(seabedRelief.sub(3900)))
      .add(abyss.mul(seamounts.mul(seamounts).mul(5200)));

    const height = mix(oceanHeight, landHeight, land);
    return clamp(height.div(params.elevationScale), -0.95, 0.98);
  };
}
