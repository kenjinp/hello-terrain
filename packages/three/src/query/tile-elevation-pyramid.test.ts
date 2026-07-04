import { describe, expect, it } from "vitest";
import { createSpatialIndex, insertSpatialIndexRaw } from "../quadtree/spatialIndex";
import {
  buildTileElevationPyramid,
  createTileElevationPyramid,
  lookupTileElevationRange,
} from "./tile-elevation-pyramid";

describe("tile-elevation-pyramid", () => {
  it("propagates a leaf peak to all ancestor tiles", () => {
    const index = createSpatialIndex(8);
    insertSpatialIndexRaw(index, 0, 2, 3, 1, 0);

    const tileBounds = new Float32Array(8 * 4);
    tileBounds[0] = 2;
    tileBounds[1] = 40;

    const pyramid = createTileElevationPyramid(8, 4);
    buildTileElevationPyramid(pyramid, index, tileBounds, 1);

    const out = { min: 0, max: 0 };
    expect(lookupTileElevationRange(pyramid, 0, 2, 3, 1, out)).toBe(true);
    expect(out.min).toBeCloseTo(2);
    expect(out.max).toBeCloseTo(40);

    expect(lookupTileElevationRange(pyramid, 0, 1, 1, 0, out)).toBe(true);
    expect(out.max).toBeCloseTo(40);

    expect(lookupTileElevationRange(pyramid, 0, 0, 0, 0, out)).toBe(true);
    expect(out.max).toBeCloseTo(40);
  });

  it("merges conservative min/max from multiple leaves under one ancestor", () => {
    const index = createSpatialIndex(8);
    insertSpatialIndexRaw(index, 0, 1, 0, 0, 0);
    insertSpatialIndexRaw(index, 0, 1, 1, 0, 1);

    const tileBounds = new Float32Array(8 * 4);
    tileBounds[0] = -5;
    tileBounds[1] = 10;
    tileBounds[4] = 3;
    tileBounds[5] = 25;

    const pyramid = createTileElevationPyramid(8, 4);
    buildTileElevationPyramid(pyramid, index, tileBounds, 2);

    const out = { min: 0, max: 0 };
    expect(lookupTileElevationRange(pyramid, 0, 0, 0, 0, out)).toBe(true);
    expect(out.min).toBeCloseTo(-5);
    expect(out.max).toBeCloseTo(25);
  });

  it("returns false for tiles with no pyramid data", () => {
    const index = createSpatialIndex(4);
    const tileBounds = new Float32Array(4 * 4);
    const pyramid = createTileElevationPyramid(4, 2);
    buildTileElevationPyramid(pyramid, index, tileBounds, 0);

    const out = { min: 0, max: 0 };
    expect(lookupTileElevationRange(pyramid, 0, 0, 0, 0, out)).toBe(false);
  });
});
