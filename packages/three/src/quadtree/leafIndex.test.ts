import { describe, expect, it } from "vitest";
import { buildLeafValueIndex } from "./leafIndex.js";
import { lookupSpatialIndexRaw } from "./spatialIndex.js";
import { allocLeafSet, U32_EMPTY } from "./types.js";

describe("quadtree/leafIndex", () => {
  it("can map visible leaf keys to persistent field slots", () => {
    const leaves = allocLeafSet(2);
    leaves.count = 2;
    leaves.space[0] = 0;
    leaves.level[0] = 3;
    leaves.x[0] = 4;
    leaves.y[0] = 5;
    leaves.space[1] = 2;
    leaves.level[1] = 1;
    leaves.x[1] = -1;
    leaves.y[1] = 7;

    const index = buildLeafValueIndex(leaves, new Uint32Array([12, 3]));

    expect(lookupSpatialIndexRaw(index, 0, 3, 4, 5)).toBe(12);
    expect(lookupSpatialIndexRaw(index, 2, 1, -1, 7)).toBe(3);
    expect(lookupSpatialIndexRaw(index, 2, 1, 0, 7)).toBe(U32_EMPTY);
  });
});
