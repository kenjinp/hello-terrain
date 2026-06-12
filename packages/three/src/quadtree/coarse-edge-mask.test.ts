import { describe, expect, it } from "vitest";
import { allocSeamTable, U32_EMPTY, type LeafSet, type Topology } from "./types.js";
import { createState } from "./state.js";
import { buildCoarseEdgeMask, buildSeams2to1 } from "./seams.js";
import { update } from "./update.js";
import { createFlatTopology } from "./topology/flat.js";
import { createCubeSphereTopology } from "./topology/cubeSphere.js";

/**
 * The mask is the subset of the (tested) seam table where edge slot 0 points at
 * a strictly-coarser neighbor. Re-deriving it from `buildSeams2to1` and the leaf
 * levels gives an independent oracle for `buildCoarseEdgeMask`.
 */
function expectedMaskFromSeams(
  leaves: LeafSet,
  topology: Topology,
  leafIndexScratch: ReturnType<typeof createState>["leafIndex"],
): Uint8Array {
  const seams = allocSeamTable(leaves.capacity);
  buildSeams2to1(topology, leaves, seams, leafIndexScratch);
  const expected = new Uint8Array(leaves.count);
  for (let i = 0; i < leaves.count; i++) {
    let mask = 0;
    for (let dir = 0; dir < 4; dir++) {
      const n = seams.neighbors[i * seams.stride + dir * 2 + 0];
      if (n === U32_EMPTY) continue;
      if (leaves.level[n] === leaves.level[i] - 1) mask |= 1 << dir;
    }
    expected[i] = mask;
  }
  return expected;
}

describe("quadtree/buildCoarseEdgeMask", () => {
  it("flags coarse-neighbor edges on a flat LOD boundary", () => {
    const topology = createFlatTopology({ rootSize: 16, origin: { x: 0, y: 0, z: 0 } });
    const state = createState({ maxNodes: 4096, maxLevel: 6 }, topology);

    const leaves = update(state, topology, {
      cameraOrigin: { x: -7.9, y: 0, z: -7.9 },
      mode: "distance",
      distanceFactor: 1.0,
    });

    const mask = buildCoarseEdgeMask(topology, leaves, new Uint8Array(leaves.capacity), state.leafIndex);
    const expected = expectedMaskFromSeams(leaves, topology, state.leafIndex);

    expect(Array.from(mask.subarray(0, leaves.count))).toEqual(
      Array.from(expected.subarray(0, leaves.count)),
    );

    // A multi-level leaf set must contain at least one stitched edge.
    let anyMarked = false;
    for (let i = 0; i < leaves.count; i++) if (mask[i] !== 0) anyMarked = true;
    expect(anyMarked).toBe(true);
  });

  it("flags coarse-neighbor edges across cube-sphere faces", () => {
    const topology = createCubeSphereTopology({ radius: 1000, maxHeight: 50 });
    const state = createState({ maxNodes: 8192, maxLevel: 8 }, topology);

    // Camera near a cube-face corner so refinement straddles a face seam.
    const leaves = update(state, topology, {
      cameraOrigin: { x: 1000, y: 1000, z: 0 },
      mode: "distance",
      distanceFactor: 1.0,
    });

    const mask = buildCoarseEdgeMask(topology, leaves, new Uint8Array(leaves.capacity), state.leafIndex);
    const expected = expectedMaskFromSeams(leaves, topology, state.leafIndex);

    expect(Array.from(mask.subarray(0, leaves.count))).toEqual(
      Array.from(expected.subarray(0, leaves.count)),
    );
  });

  it("throws when the output buffer is too small", () => {
    const topology = createFlatTopology({ rootSize: 16, origin: { x: 0, y: 0, z: 0 } });
    const state = createState({ maxNodes: 256, maxLevel: 4 }, topology);
    const leaves = update(state, topology, {
      cameraOrigin: { x: -7.9, y: 0, z: -7.9 },
      mode: "distance",
      distanceFactor: 1.0,
    });
    expect(() => buildCoarseEdgeMask(topology, leaves, new Uint8Array(1))).toThrow();
  });
});
