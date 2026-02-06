import { describe, expect, it } from "vitest";
import { allocSeamTable, U32_EMPTY } from "./types.js";
import { createState } from "./state.js";
import { buildSeams2to1 } from "./seams.js";
import { update } from "./update.js";
import { createFlatSurface } from "./surface/flat.js";

describe("quadtree/update", () => {
  it("produces leaves and enforces 2:1 balance (validated via seam table)", () => {
    const surface = createFlatSurface({
      rootSize: 16,
      origin: { x: 0, y: 0, z: 0 },
    });

    const state = createState({ maxNodes: 4096, maxLevel: 6 }, surface);

    const leaves = update(state, surface, {
      cameraOrigin: { x: -7.9, y: 0, z: -7.9 },
      mode: "distance",
      distanceFactor: 1.0,
    });

    expect(leaves.count).toBeGreaterThan(0);
    expect(leaves.count).toBeLessThanOrEqual(leaves.capacity);

    const seams = allocSeamTable(leaves.capacity);
    buildSeams2to1(surface, leaves, seams, state.leafIndex);

    expect(seams.count).toBe(leaves.count);

    for (let i = 0; i < leaves.count; i++) {
      const base = i * seams.stride;
      for (let j = 0; j < seams.stride; j++) {
        const n = seams.neighbors[base + j];
        if (n === U32_EMPTY) continue;

        const dl = Math.abs(leaves.level[i] - leaves.level[n]);
        expect(dl).toBeLessThanOrEqual(1);
      }
    }
  });
});

