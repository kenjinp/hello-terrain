import { describe, expect, it } from "vitest";
import { allocLeafSet } from "../quadtree/types.js";
import { buildLeafIndex } from "../quadtree/leafIndex.js";
import { worldToTile } from "./worldToTile.js";

describe("query/worldToTile", () => {
  it("resolves a world position to tile-local coordinates", () => {
    const leaves = allocLeafSet(4);
    leaves.count = 1;
    leaves.space[0] = 0;
    leaves.level[0] = 0;
    leaves.x[0] = 0;
    leaves.y[0] = 0;

    const leafIndex = buildLeafIndex(leaves);
    const hit = worldToTile({
      worldX: 0,
      worldZ: 0,
      leafSet: leaves,
      leafIndex,
      rootOrigin: { x: 0, z: 0 },
      rootSize: 100,
      innerTileSegments: 13,
      maxLevel: 4,
    });

    expect(hit).not.toBeNull();
    expect(hit?.leafIndex).toBe(0);
    expect(hit?.tileLocalU).toBeCloseTo(0.5);
    expect(hit?.tileLocalV).toBeCloseTo(0.5);
  });

  it("prefers the finest level tile when multiple levels overlap", () => {
    const leaves = allocLeafSet(8);
    leaves.count = 2;
    // Coarse root tile
    leaves.space[0] = 0;
    leaves.level[0] = 0;
    leaves.x[0] = 0;
    leaves.y[0] = 0;
    // Finer tile in positive quadrant (world x/z in [0..50] for rootSize=100)
    leaves.space[1] = 0;
    leaves.level[1] = 1;
    leaves.x[1] = 1;
    leaves.y[1] = 1;

    const leafIndex = buildLeafIndex(leaves);
    const hit = worldToTile({
      worldX: 10,
      worldZ: 10,
      leafSet: leaves,
      leafIndex,
      rootOrigin: { x: 0, z: 0 },
      rootSize: 100,
      innerTileSegments: 13,
      maxLevel: 4,
    });

    expect(hit).not.toBeNull();
    expect(hit?.leafIndex).toBe(1);
  });
});
