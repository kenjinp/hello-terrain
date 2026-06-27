import type { LeafSet } from "./types";
import type { TileVisibilityState, TileVisibilityTelemetry } from "./visibility";

export type TileSlotTelemetry = TileVisibilityTelemetry & {
  visibleSlotCount: number;
  activeSlotCount: number;
  dirtyVisibleCount: number;
  reusedCount: number;
  allocatedCount: number;
  evictedCount: number;
  retainedInactiveCount: number;
  overflowCount: number;
  dirtyVisibleRatio: number;
  reuseRatio: number;
};

export type TileSlotCacheState = {
  capacity: number;
  shapeKey: string;
  generation: number;
  activeSlotCount: number;
  keyToSlot: Map<string, number>;
  slotKey: string[];
  slotSpace: Uint8Array;
  slotLevel: Uint8Array;
  slotX: Int32Array;
  slotY: Int32Array;
  slotState: Uint8Array;
  slotLastVisibleGeneration: Uint32Array;
  visibleSlots: Uint32Array;
  dirtyVisibleSlots: Uint32Array;
  freeSlots: number[];
  telemetry: TileSlotTelemetry;
};

const EMPTY_TELEMETRY: TileSlotTelemetry = {
  candidateCount: 0,
  visibleCount: 0,
  guardCount: 0,
  frustumCulledCount: 0,
  horizonCulledCount: 0,
  unculledCount: 0,
  visibleRatio: 0,
  visibleSlotCount: 0,
  activeSlotCount: 0,
  dirtyVisibleCount: 0,
  reusedCount: 0,
  allocatedCount: 0,
  evictedCount: 0,
  retainedInactiveCount: 0,
  overflowCount: 0,
  dirtyVisibleRatio: 0,
  reuseRatio: 0,
};

const SlotState = {
  Free: 0,
  Resident: 1,
} as const;

export function tileKeyString(
  space: number,
  level: number,
  x: number,
  y: number,
): string {
  return `${space}:${level}:${x}:${y}`;
}

export function createTileSlotCacheState(
  capacity: number,
  shapeKey: string,
): TileSlotCacheState {
  const freeSlots: number[] = [];
  for (let slot = capacity - 1; slot >= 0; slot -= 1) freeSlots.push(slot);
  return {
    capacity,
    shapeKey,
    generation: 0,
    activeSlotCount: 0,
    keyToSlot: new Map(),
    slotKey: Array.from({ length: capacity }, () => ""),
    slotSpace: new Uint8Array(capacity),
    slotLevel: new Uint8Array(capacity),
    slotX: new Int32Array(capacity),
    slotY: new Int32Array(capacity),
    slotState: new Uint8Array(capacity),
    slotLastVisibleGeneration: new Uint32Array(capacity),
    visibleSlots: new Uint32Array(capacity),
    dirtyVisibleSlots: new Uint32Array(capacity),
    freeSlots,
    telemetry: { ...EMPTY_TELEMETRY },
  };
}

function residentCount(state: TileSlotCacheState) {
  let count = 0;
  for (let i = 0; i < state.capacity; i += 1) {
    if (state.slotState[i] === SlotState.Resident) count += 1;
  }
  return count;
}

function evictInactiveSlot(
  state: TileSlotCacheState,
  visibleKeys: Set<string>,
): number {
  for (let slot = 0; slot < state.capacity; slot += 1) {
    const key = state.slotKey[slot];
    if (!key || visibleKeys.has(key)) continue;
    state.keyToSlot.delete(key);
    state.slotKey[slot] = "";
    state.slotSpace[slot] = 0;
    state.slotLevel[slot] = 0;
    state.slotX[slot] = 0;
    state.slotY[slot] = 0;
    state.slotState[slot] = SlotState.Free;
    return slot;
  }
  return -1;
}

function allocateSlot(
  state: TileSlotCacheState,
  visibleKeys: Set<string>,
): { slot: number; evicted: boolean } {
  const freeSlot = state.freeSlots.pop();
  if (typeof freeSlot === "number") return { slot: freeSlot, evicted: false };
  const evictedSlot = evictInactiveSlot(state, visibleKeys);
  return { slot: evictedSlot, evicted: evictedSlot >= 0 };
}

function resetTelemetry(
  telemetry: TileSlotTelemetry,
  visibilityTelemetry: TileVisibilityTelemetry,
) {
  telemetry.candidateCount = visibilityTelemetry.candidateCount;
  telemetry.visibleCount = visibilityTelemetry.visibleCount;
  telemetry.guardCount = visibilityTelemetry.guardCount;
  telemetry.frustumCulledCount = visibilityTelemetry.frustumCulledCount;
  telemetry.horizonCulledCount = visibilityTelemetry.horizonCulledCount;
  telemetry.unculledCount = visibilityTelemetry.unculledCount;
  telemetry.visibleRatio = visibilityTelemetry.visibleRatio;
  telemetry.visibleSlotCount = 0;
  telemetry.activeSlotCount = 0;
  telemetry.dirtyVisibleCount = 0;
  telemetry.reusedCount = 0;
  telemetry.allocatedCount = 0;
  telemetry.evictedCount = 0;
  telemetry.retainedInactiveCount = 0;
  telemetry.overflowCount = 0;
  telemetry.dirtyVisibleRatio = 0;
  telemetry.reuseRatio = 0;
}

export function updateTileSlotCache(
  leaves: LeafSet,
  visibility: TileVisibilityState,
  capacity: number,
  shapeKey: string,
  prev?: TileSlotCacheState,
): TileSlotCacheState {
  const state =
    prev && prev.capacity === capacity && prev.shapeKey === shapeKey
      ? prev
      : createTileSlotCacheState(capacity, shapeKey);
  const telemetry = state.telemetry;
  const visibleKeys = new Set<string>();
  const visibleCount = Math.min(
    visibility.telemetry.visibleCount,
    visibility.visibleCandidateIndices.length,
  );

  state.generation += 1;
  state.activeSlotCount = 0;
  resetTelemetry(telemetry, visibility.telemetry);

  const tiles: Array<{
    key: string;
    space: number;
    level: number;
    x: number;
    y: number;
  }> = [];
  for (let visibleIndex = 0; visibleIndex < visibleCount; visibleIndex += 1) {
    const leafIndex = visibility.visibleCandidateIndices[visibleIndex] ?? 0;
    const space = leaves.space[leafIndex] ?? 0;
    const level = leaves.level[leafIndex] ?? 0;
    const x = leaves.x[leafIndex] ?? 0;
    const y = leaves.y[leafIndex] ?? 0;
    const key = tileKeyString(space, level, x, y);
    tiles.push({ key, space, level, x, y });
    visibleKeys.add(key);
  }

  for (const tile of tiles) {
    let slot = state.keyToSlot.get(tile.key);
    let allocated = false;

    if (slot === undefined) {
      const allocation = allocateSlot(state, visibleKeys);
      slot = allocation.slot;
      if (slot < 0) {
        telemetry.overflowCount += 1;
        continue;
      }
      if (allocation.evicted) telemetry.evictedCount += 1;
      state.keyToSlot.set(tile.key, slot);
      state.slotKey[slot] = tile.key;
      state.slotState[slot] = SlotState.Resident;
      telemetry.allocatedCount += 1;
      allocated = true;
    } else {
      telemetry.reusedCount += 1;
    }

    state.slotSpace[slot] = tile.space;
    state.slotLevel[slot] = tile.level;
    state.slotX[slot] = tile.x;
    state.slotY[slot] = tile.y;
    state.slotLastVisibleGeneration[slot] = state.generation;
    state.visibleSlots[telemetry.visibleSlotCount] = slot;
    telemetry.visibleSlotCount += 1;
    state.activeSlotCount = Math.max(state.activeSlotCount, slot + 1);

    if (allocated) {
      state.dirtyVisibleSlots[telemetry.dirtyVisibleCount] = slot;
      telemetry.dirtyVisibleCount += 1;
    }
  }

  const totalResidentCount = residentCount(state);
  telemetry.activeSlotCount = state.activeSlotCount;
  telemetry.retainedInactiveCount = Math.max(
    0,
    totalResidentCount - telemetry.visibleSlotCount,
  );
  telemetry.dirtyVisibleRatio =
    telemetry.visibleSlotCount > 0
      ? telemetry.dirtyVisibleCount / telemetry.visibleSlotCount
      : 0;
  telemetry.reuseRatio =
    telemetry.visibleSlotCount > 0
      ? telemetry.reusedCount / telemetry.visibleSlotCount
      : 0;

  return state;
}
