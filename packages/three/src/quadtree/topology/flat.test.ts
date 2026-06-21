import { describe, expect, it } from "vitest";
import { Dir } from "../types.js";
import { createFlatTopology } from "./flat.js";

describe("quadtree/topology/flat", () => {
  it("computes same-level neighbors with boundary checks", () => {
    const topology = createFlatTopology({ rootSize: 100, origin: { x: 0, y: 0, z: 0 } });

    const out = { space: 0, level: 0, x: 0, y: 0 };

    expect(topology.neighborSameLevel({ space: 0, level: 1, x: 0, y: 0 }, Dir.LEFT, out)).toBe(false);
    expect(topology.neighborSameLevel({ space: 0, level: 1, x: 0, y: 0 }, Dir.TOP, out)).toBe(false);

    expect(topology.neighborSameLevel({ space: 0, level: 1, x: 0, y: 0 }, Dir.RIGHT, out)).toBe(true);
    expect(out).toEqual({ space: 0, level: 1, x: 1, y: 0 });

    expect(topology.neighborSameLevel({ space: 0, level: 1, x: 0, y: 0 }, Dir.BOTTOM, out)).toBe(true);
    expect(out).toEqual({ space: 0, level: 1, x: 0, y: 1 });
  });

  it("computes conservative camera-relative bounds", () => {
    const topology = createFlatTopology({ rootSize: 100, origin: { x: 0, y: 10, z: 0 } });

    const out = { cx: 0, cy: 0, cz: 0, r: 0 };
    topology.tileBounds({ space: 0, level: 1, x: 0, y: 0 }, { x: 0, y: 0, z: 0 }, out);

    // root covers [-50..50], level1 tile size=50, (x=0,y=0) center at (-25,-25) in X/Z
    expect(out.cx).toBeCloseTo(-25);
    expect(out.cy).toBeCloseTo(10);
    expect(out.cz).toBeCloseTo(-25);
    expect(out.r).toBeGreaterThan(0);
  });

  it("sizes the radius from the elevation half-span, not the datum distance", () => {
    const topology = createFlatTopology({ rootSize: 100, origin: { x: 0, y: 0, z: 0 } });

    const out = { cx: 0, cy: 0, cz: 0, r: 0 };
    // A plateau well above the datum with a small local relief: [100, 120].
    topology.tileBounds(
      { space: 0, level: 1, x: 0, y: 0 },
      { x: 0, y: 0, z: 0 },
      out,
      { min: 100, max: 120 },
    );

    const size = 50; // rootSize / 2^level
    const halfDiag = 0.7071067811865476 * size;
    // Center sits at the mid-elevation, radius bounds the half-span around it.
    expect(out.cy).toBeCloseTo(110);
    expect(out.r).toBeCloseTo(halfDiag + 10);
    // The old datum-relative form would have inflated this to halfDiag + 120.
    expect(out.r).toBeLessThan(halfDiag + 120);
  });
});
