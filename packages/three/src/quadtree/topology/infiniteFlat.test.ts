import { describe, expect, it } from "vitest";
import { buildLeafIndex } from "../leafIndex.js";
import { lookupSpatialIndexRaw } from "../spatialIndex.js";
import { createState } from "../state.js";
import { Dir, type LeafSet, type Topology, U32_EMPTY } from "../types.js";
import { update } from "../update.js";
import { createInfiniteFlatTopology } from "./infiniteFlat.js";

/**
 * Count 2:1 balance violations: a leaf whose same-direction neighbor is more
 * than one level coarser. Uses arithmetic shifts so negative coords resolve to
 * the correct ancestor.
 */
function countBalanceViolations(topology: Topology, leaves: LeafSet): number {
  const index = buildLeafIndex(leaves);
  const tile = { space: 0, level: 0, x: 0, y: 0 };
  const neighbor = { space: 0, level: 0, x: 0, y: 0 };
  let violations = 0;

  for (let i = 0; i < leaves.count; i++) {
    const leafLevel = leaves.level[i];
    if (leafLevel < 2) continue;

    for (let dir = 0; dir < 4; dir++) {
      for (let candidateLevel = leafLevel - 2; candidateLevel >= 0; candidateLevel--) {
        const shift = leafLevel - candidateLevel;
        tile.space = leaves.space[i];
        tile.level = candidateLevel;
        tile.x = leaves.x[i] >> shift;
        tile.y = leaves.y[i] >> shift;

        if (!topology.neighborSameLevel(tile, dir as Dir, neighbor)) break;

        const j = lookupSpatialIndexRaw(index, neighbor.space, neighbor.level, neighbor.x, neighbor.y);
        if (j !== U32_EMPTY) {
          violations++;
          break;
        }
      }
    }
  }

  return violations;
}

function runUpdate(topology: Topology, cameraOrigin: { x: number; y: number; z: number }): LeafSet {
  const state = createState({ maxNodes: 8192, maxLevel: 8 }, topology);
  return update(state, topology, {
    cameraOrigin,
    mode: "distance",
    distanceFactor: 1.5,
  });
}

describe("quadtree/topology/infiniteFlat", () => {
  it("computes same-level neighbors across negative coordinates", () => {
    const topology = createInfiniteFlatTopology({ rootSize: 256, origin: { x: 0, y: 0, z: 0 } });
    const out = { space: 0, level: 0, x: 0, y: 0 };

    expect(topology.neighborSameLevel({ space: 0, level: 3, x: -8, y: -3 }, Dir.LEFT, out)).toBe(true);
    expect(out).toEqual({ space: 0, level: 3, x: -9, y: -3 });

    expect(topology.neighborSameLevel({ space: 0, level: 3, x: -1, y: 0 }, Dir.RIGHT, out)).toBe(true);
    expect(out).toEqual({ space: 0, level: 3, x: 0, y: 0 });

    expect(topology.neighborSameLevel({ space: 0, level: 3, x: 0, y: -1 }, Dir.BOTTOM, out)).toBe(true);
    expect(out).toEqual({ space: 0, level: 3, x: 0, y: 0 });
  });

  it("selects negative root tiles when the camera is in a negative quadrant", () => {
    const topology = createInfiniteFlatTopology({
      rootSize: 256,
      origin: { x: 0, y: 0, z: 0 },
      rootGridRadius: 1,
    });

    const roots = Array.from({ length: topology.maxRootCount }, () => ({ space: 0, level: 0, x: 0, y: 0 }));
    const count = topology.rootTiles({ x: -500, y: 5, z: -700 }, roots);

    expect(count).toBe(9);
    // camRootX = floor((-500 + 128) / 256) = -2, camRootY = floor((-700 + 128) / 256) = -3
    expect(roots.map((r) => r.x)).toEqual([-3, -2, -1, -3, -2, -1, -3, -2, -1]);
    expect(roots.map((r) => r.y)).toEqual([-4, -4, -4, -3, -3, -3, -2, -2, -2]);
  });

  it("holds 2:1 balance in negative and positive quadrants", () => {
    const topology = createInfiniteFlatTopology({
      rootSize: 256,
      origin: { x: 0, y: 0, z: 0 },
      rootGridRadius: 1,
    });

    const negative = runUpdate(topology, { x: -500, y: 5, z: -700 });
    expect(negative.count).toBeGreaterThan(0);
    expect(negative.x.subarray(0, negative.count).some((x) => x < 0)).toBe(true);
    expect(negative.y.subarray(0, negative.count).some((y) => y < 0)).toBe(true);
    expect(countBalanceViolations(topology, negative)).toBe(0);

    const positive = runUpdate(topology, { x: 500, y: 5, z: 700 });
    expect(positive.count).toBeGreaterThan(0);
    expect(countBalanceViolations(topology, positive)).toBe(0);
  });

  it("produces mirror-symmetric leaf counts across the origin", () => {
    const topology = createInfiniteFlatTopology({
      rootSize: 256,
      origin: { x: 0, y: 0, z: 0 },
      rootGridRadius: 1,
    });

    // The root grid lines sit at ±128, ±384, … so mirroring the camera through
    // the origin mirrors the whole leaf layout; counts must match.
    const positive = runUpdate(topology, { x: 500, y: 5, z: 700 });
    const negative = runUpdate(topology, { x: -500, y: 5, z: -700 });
    const mixed = runUpdate(topology, { x: -500, y: 5, z: 700 });

    expect(negative.count).toBe(positive.count);
    expect(mixed.count).toBe(positive.count);
  });
});
