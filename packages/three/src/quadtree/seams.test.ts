import { describe, expect, it } from "vitest";
import { buildSeams2to1 } from "./seams.js";
import { createState } from "./state.js";
import { createInfiniteFlatTopology } from "./topology/infiniteFlat.js";
import { allocLeafSet, allocSeamTable, Dir, type LeafSet, type SeamTable, U32_EMPTY } from "./types.js";
import { update } from "./update.js";

function pushLeaf(leaves: LeafSet, level: number, x: number, y: number): number {
  const i = leaves.count;
  leaves.space[i] = 0;
  leaves.level[i] = level;
  leaves.x[i] = x;
  leaves.y[i] = y;
  leaves.count = i + 1;
  return i;
}

function seamSlots(seams: SeamTable, leaf: number, dir: Dir): [number, number] {
  const base = leaf * seams.stride + dir * 2;
  return [seams.neighbors[base], seams.neighbors[base + 1]];
}

function countSeamEntries(seams: SeamTable): number {
  let n = 0;
  for (let i = 0; i < seams.count * seams.stride; i++) {
    if (seams.neighbors[i] !== U32_EMPTY) n++;
  }
  return n;
}

describe("quadtree/seams", () => {
  it("resolves coarser and finer neighbors for leaves with negative coords", () => {
    const topology = createInfiniteFlatTopology({ rootSize: 256, origin: { x: 0, y: 0, z: 0 } });

    // Parent N = (-1,-1)@L1 is fully subdivided into four level-2 leaves; its
    // left neighbor B = (-2,-1)@L1 is a coarser leaf.
    const leaves = allocLeafSet(8);
    const topLeft = pushLeaf(leaves, 2, -2, -2);
    const topRight = pushLeaf(leaves, 2, -1, -2);
    const bottomLeft = pushLeaf(leaves, 2, -2, -1);
    const bottomRight = pushLeaf(leaves, 2, -1, -1);
    const coarse = pushLeaf(leaves, 1, -2, -1);

    const seams = buildSeams2to1(topology, leaves, allocSeamTable(leaves.capacity));
    expect(seams.count).toBe(leaves.count);

    // Coarser-neighbor path: parent (-2 >> 1, -1 >> 1) = (-1,-1)@L1, LEFT -> (-2,-1)@L1.
    expect(seamSlots(seams, bottomLeft, Dir.LEFT)).toEqual([coarse, U32_EMPTY]);
    expect(seamSlots(seams, topLeft, Dir.LEFT)).toEqual([coarse, U32_EMPTY]);

    // Same-level sibling path still works.
    expect(seamSlots(seams, bottomLeft, Dir.RIGHT)).toEqual([bottomRight, U32_EMPTY]);
    expect(seamSlots(seams, bottomLeft, Dir.TOP)).toEqual([topLeft, U32_EMPTY]);
    expect(seamSlots(seams, topRight, Dir.LEFT)).toEqual([topLeft, U32_EMPTY]);

    // Finer-neighbor path from the coarse leaf: children of (-1,-1)@L1 along its left edge.
    expect(seamSlots(seams, coarse, Dir.RIGHT)).toEqual([topLeft, bottomLeft]);

    // No leaf beyond the subdivided block.
    expect(seamSlots(seams, bottomLeft, Dir.BOTTOM)).toEqual([U32_EMPTY, U32_EMPTY]);
    expect(seamSlots(seams, coarse, Dir.LEFT)).toEqual([U32_EMPTY, U32_EMPTY]);
  });

  it("produces the same seam structure for mirrored positive coords", () => {
    const topology = createInfiniteFlatTopology({ rootSize: 256, origin: { x: 0, y: 0, z: 0 } });

    // Mirror of the negative layout: parent (0,0)@L1 subdivided, right neighbor (1,0)@L1 coarse.
    const leaves = allocLeafSet(8);
    const topLeft = pushLeaf(leaves, 2, 0, 0);
    const topRight = pushLeaf(leaves, 2, 1, 0);
    const bottomLeft = pushLeaf(leaves, 2, 0, 1);
    const bottomRight = pushLeaf(leaves, 2, 1, 1);
    const coarse = pushLeaf(leaves, 1, 1, 0);

    const seams = buildSeams2to1(topology, leaves, allocSeamTable(leaves.capacity));

    expect(seamSlots(seams, bottomRight, Dir.RIGHT)).toEqual([coarse, U32_EMPTY]);
    expect(seamSlots(seams, topRight, Dir.RIGHT)).toEqual([coarse, U32_EMPTY]);
    expect(seamSlots(seams, coarse, Dir.LEFT)).toEqual([topRight, bottomRight]);
    expect(seamSlots(seams, bottomLeft, Dir.RIGHT)).toEqual([bottomRight, U32_EMPTY]);
    expect(seamSlots(seams, topLeft, Dir.LEFT)).toEqual([U32_EMPTY, U32_EMPTY]);
  });

  it("builds mirror-symmetric seam tables for updates in negative and positive quadrants", () => {
    const topology = createInfiniteFlatTopology({
      rootSize: 256,
      origin: { x: 0, y: 0, z: 0 },
      rootGridRadius: 1,
    });

    const build = (cameraOrigin: { x: number; y: number; z: number }) => {
      const state = createState({ maxNodes: 8192, maxLevel: 8 }, topology);
      const leaves = update(state, topology, { cameraOrigin, mode: "distance", distanceFactor: 1.5 });
      const seams = buildSeams2to1(topology, leaves, allocSeamTable(leaves.capacity), state.leafIndex);

      for (let i = 0; i < leaves.count; i++) {
        const base = i * seams.stride;
        for (let j = 0; j < seams.stride; j++) {
          const n = seams.neighbors[base + j];
          if (n === U32_EMPTY) continue;
          expect(Math.abs(leaves.level[i] - leaves.level[n])).toBeLessThanOrEqual(1);
        }
      }

      return { leafCount: leaves.count, seamEntries: countSeamEntries(seams) };
    };

    const positive = build({ x: 500, y: 5, z: 700 });
    const negative = build({ x: -500, y: 5, z: -700 });

    expect(negative.leafCount).toBe(positive.leafCount);
    expect(negative.seamEntries).toBe(positive.seamEntries);
    expect(negative.seamEntries).toBeGreaterThan(0);
  });
});
