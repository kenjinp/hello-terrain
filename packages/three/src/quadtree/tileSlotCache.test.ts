import { describe, expect, it } from "vitest";
import { allocLeafSet } from "./types.js";
import { updateTileSlotCache } from "./tileSlotCache.js";
import type { TileResidencyState } from "./residency.js";
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
  return visibilityForIndices(count, Array.from({ length: count }, (_value, index) => index));
}

function visibilityForIndices(count: number, indices: number[]): TileVisibilityState {
  const visibleCandidateIndices = new Uint32Array(Math.max(1, indices.length));
  const visibilityState = new Uint8Array(Math.max(1, count));
  for (let i = 0; i < indices.length; i += 1) visibleCandidateIndices[i] = indices[i] ?? 0;
  return {
    visibleCandidateIndices,
    visibilityState,
    telemetry: {
      candidateCount: count,
      visibleCount: indices.length,
      guardCount: 0,
      frustumCulledCount: count - indices.length,
      horizonCulledCount: 0,
      unculledCount: 0,
      visibleRatio: count > 0 ? indices.length / count : 0,
    },
  };
}

function residencyForIndices(
  count: number,
  indices: number[],
  visibleResidentCount = indices.length,
): TileResidencyState {
  const residentCandidateIndices = new Uint32Array(Math.max(1, indices.length));
  const residencyState = new Uint8Array(Math.max(1, count));
  for (let i = 0; i < indices.length; i += 1) residentCandidateIndices[i] = indices[i] ?? 0;
  return {
    residentCandidateIndices,
    residencyState,
    telemetry: {
      candidateCount: count,
      visibleResidentCount,
      anchorResidentCount: indices.length - visibleResidentCount,
      residentCount: indices.length,
      anchorCount: indices.length > visibleResidentCount ? 1 : 0,
      residentRatio: count > 0 ? indices.length / count : 0,
    },
  };
}

function allVisibleResident(count: number): TileResidencyState {
  return residencyForIndices(count, Array.from({ length: count }, (_value, index) => index));
}

describe("quadtree/tileSlotCache", () => {
  it("reports newly visible tiles as dirty once and then reused", () => {
    const leaves = makeLeaves([
      [0, 2, 1, 1],
      [0, 2, 2, 1],
      [0, 2, 1, 2],
    ]);
    const visibility = allVisible(leaves.count);
    const residency = allVisibleResident(leaves.count);

    const first = updateTileSlotCache(leaves, visibility, residency, 8, "cubeSphere:8", 1);
    expect(first.telemetry.visibleSlotCount).toBe(3);
    expect(first.telemetry.residentSlotCount).toBe(3);
    expect(first.telemetry.activeSlotCount).toBe(3);
    expect(first.telemetry.allocatedCount).toBe(3);
    expect(first.telemetry.dirtyVisibleCount).toBe(3);
    expect(first.telemetry.dirtyResidentCount).toBe(3);
    expect(first.telemetry.reusedCount).toBe(0);
    expect(first.slotSpace[0]).toBe(0);
    expect(first.slotLevel[0]).toBe(2);
    expect(first.slotX[0]).toBe(1);
    expect(first.slotY[0]).toBe(1);

    const second = updateTileSlotCache(
      leaves,
      visibility,
      residency,
      8,
      "cubeSphere:8",
      1,
      first,
    );
    expect(second.telemetry.visibleSlotCount).toBe(3);
    expect(second.telemetry.activeSlotCount).toBe(3);
    expect(second.telemetry.allocatedCount).toBe(0);
    expect(second.telemetry.dirtyVisibleCount).toBe(0);
    expect(second.telemetry.reusedCount).toBe(3);
    expect(second.telemetry.reuseRatio).toBe(1);
  });

  it("recreates slots when the topology shape key changes", () => {
    const leaves = makeLeaves([
      [0, 2, 1, 1],
      [0, 2, 2, 1],
    ]);
    const visibility = allVisible(leaves.count);
    const residency = allVisibleResident(leaves.count);

    const first = updateTileSlotCache(
      leaves,
      visibility,
      residency,
      8,
      "cubeSphere|radius=1000",
      1,
    );
    const second = updateTileSlotCache(
      leaves,
      visibility,
      residency,
      8,
      "cubeSphere|radius=2000",
      1,
      first,
    );

    expect(second).not.toBe(first);
    expect(second.telemetry.allocatedCount).toBe(2);
    expect(second.telemetry.dirtyVisibleCount).toBe(2);
    expect(second.telemetry.reusedCount).toBe(0);
  });

  it("dirties reused visible slots when field content changes", () => {
    const leaves = makeLeaves([
      [0, 2, 1, 1],
      [0, 2, 2, 1],
    ]);
    const visibility = allVisible(leaves.count);
    const residency = allVisibleResident(leaves.count);

    const first = updateTileSlotCache(leaves, visibility, residency, 8, "shape", 1);
    const second = updateTileSlotCache(leaves, visibility, residency, 8, "shape", 2, first);

    expect(second).toBe(first);
    expect(second.telemetry.allocatedCount).toBe(0);
    expect(second.telemetry.reusedCount).toBe(2);
    expect(second.telemetry.dirtyVisibleCount).toBe(2);
    expect(second.slotContentEpoch[0]).toBe(2);
    expect(second.slotContentEpoch[1]).toBe(2);
  });

  it("dirties retained inactive slots when they re-enter after field content changes", () => {
    const firstLeaves = makeLeaves([
      [0, 2, 1, 1],
      [0, 2, 2, 1],
    ]);
    const first = updateTileSlotCache(
      firstLeaves,
      allVisible(firstLeaves.count),
      allVisibleResident(firstLeaves.count),
      4,
      "shape",
      1,
    );

    const visibleAOnly = makeLeaves([[0, 2, 1, 1]]);
    const second = updateTileSlotCache(
      visibleAOnly,
      allVisible(visibleAOnly.count),
      allVisibleResident(visibleAOnly.count),
      4,
      "shape",
      2,
      first,
    );
    expect(second.telemetry.dirtyVisibleCount).toBe(1);

    const bothAgain = updateTileSlotCache(
      firstLeaves,
      allVisible(firstLeaves.count),
      allVisibleResident(firstLeaves.count),
      4,
      "shape",
      2,
      second,
    );
    expect(bothAgain.telemetry.reusedCount).toBe(2);
    expect(bothAgain.telemetry.allocatedCount).toBe(0);
    expect(bothAgain.telemetry.dirtyVisibleCount).toBe(1);
  });

  it("retains inactive slots and dirties only newly visible replacements", () => {
    const firstLeaves = makeLeaves([
      [0, 2, 1, 1],
      [0, 2, 2, 1],
    ]);
    const first = updateTileSlotCache(
      firstLeaves,
      allVisible(firstLeaves.count),
      allVisibleResident(firstLeaves.count),
      4,
      "shape",
      1,
    );
    const secondLeaves = makeLeaves([
      [0, 2, 1, 1],
      [0, 2, 3, 1],
    ]);

    const second = updateTileSlotCache(
      secondLeaves,
      allVisible(secondLeaves.count),
      allVisibleResident(secondLeaves.count),
      4,
      "shape",
      1,
      first,
    );

    expect(second.telemetry.reusedCount).toBe(1);
    expect(second.telemetry.allocatedCount).toBe(1);
    expect(second.telemetry.dirtyVisibleCount).toBe(1);
    expect(second.telemetry.activeSlotCount).toBe(3);
    expect(second.telemetry.retainedInactiveCount).toBe(1);
  });

  it("allocates and dirties resident support tiles even when they are not visible", () => {
    const leaves = makeLeaves([
      [0, 2, 1, 1],
      [0, 2, 2, 1],
    ]);
    const visibility = visibilityForIndices(leaves.count, [0]);
    const residency = residencyForIndices(leaves.count, [0, 1], 1);

    const state = updateTileSlotCache(leaves, visibility, residency, 8, "shape", 1);

    expect(state.telemetry.visibleSlotCount).toBe(1);
    expect(state.telemetry.residentSlotCount).toBe(2);
    expect(state.telemetry.supportSlotCount).toBe(1);
    expect(state.telemetry.allocatedCount).toBe(2);
    expect(state.telemetry.dirtyResidentCount).toBe(2);
    expect(state.telemetry.dirtyVisibleCount).toBe(2);
    expect(Array.from(state.visibleSlots.subarray(0, 1))).toEqual([0]);
    expect(Array.from(state.residentSlots.subarray(0, 2))).toEqual([0, 1]);
  });
});
