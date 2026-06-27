import { describe, expect, it } from "vitest";
import { allocLeafSet } from "./types.js";
import { updateTileSlotCache } from "./tileSlotCache.js";
import type { TileVisibilityState } from "./visibility.js";

function makeLeaves(keys: Array<[number, number, number, number]>) {
  const leaves = allocLeafSet(Math.max(1, keys.length));
  leaves.count = keys.length;
  keys.forEach(([space, level, x, y], index) => {
    leaves.space[index] = space;
    leaves.level[index] = level;
    leaves.x[index] = x;
    leaves.y[index] = y;
  });
  return leaves;
}

function allVisible(count: number): TileVisibilityState {
  const visibleCandidateIndices = new Uint32Array(Math.max(1, count));
  const visibilityState = new Uint8Array(Math.max(1, count));
  for (let i = 0; i < count; i += 1) visibleCandidateIndices[i] = i;
  return {
    visibleCandidateIndices,
    visibilityState,
    telemetry: {
      candidateCount: count,
      visibleCount: count,
      guardCount: 0,
      frustumCulledCount: 0,
      horizonCulledCount: 0,
      unculledCount: 0,
      visibleRatio: count > 0 ? 1 : 0,
    },
  };
}

describe("quadtree/tileSlotCache", () => {
  it("reports newly visible tiles as dirty once and then reused", () => {
    const leaves = makeLeaves([
      [0, 2, 1, 1],
      [0, 2, 2, 1],
      [0, 2, 1, 2],
    ]);
    const visibility = allVisible(leaves.count);

    const first = updateTileSlotCache(leaves, visibility, 8, "cubeSphere:8");
    expect(first.telemetry.visibleSlotCount).toBe(3);
    expect(first.telemetry.activeSlotCount).toBe(3);
    expect(first.telemetry.allocatedCount).toBe(3);
    expect(first.telemetry.dirtyVisibleCount).toBe(3);
    expect(first.telemetry.reusedCount).toBe(0);
    expect(first.slotSpace[0]).toBe(0);
    expect(first.slotLevel[0]).toBe(2);
    expect(first.slotX[0]).toBe(1);
    expect(first.slotY[0]).toBe(1);

    const second = updateTileSlotCache(leaves, visibility, 8, "cubeSphere:8", first);
    expect(second.telemetry.visibleSlotCount).toBe(3);
    expect(second.telemetry.activeSlotCount).toBe(3);
    expect(second.telemetry.allocatedCount).toBe(0);
    expect(second.telemetry.dirtyVisibleCount).toBe(0);
    expect(second.telemetry.reusedCount).toBe(3);
    expect(second.telemetry.reuseRatio).toBe(1);
  });

  it("retains inactive slots and dirties only newly visible replacements", () => {
    const firstLeaves = makeLeaves([
      [0, 2, 1, 1],
      [0, 2, 2, 1],
    ]);
    const first = updateTileSlotCache(firstLeaves, allVisible(firstLeaves.count), 4, "shape");
    const secondLeaves = makeLeaves([
      [0, 2, 1, 1],
      [0, 2, 3, 1],
    ]);

    const second = updateTileSlotCache(
      secondLeaves,
      allVisible(secondLeaves.count),
      4,
      "shape",
      first,
    );

    expect(second.telemetry.reusedCount).toBe(1);
    expect(second.telemetry.allocatedCount).toBe(1);
    expect(second.telemetry.dirtyVisibleCount).toBe(1);
    expect(second.telemetry.activeSlotCount).toBe(3);
    expect(second.telemetry.retainedInactiveCount).toBe(1);
  });
});
