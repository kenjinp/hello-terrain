import {
  TileResidencyStateKind,
  type TileResidencyState,
  type TileResidencyTelemetry,
} from "./residency";
import type { LeafSet } from "./types";
import type { TileVisibilityState, TileVisibilityTelemetry } from "./visibility";

export type TileSlotTelemetry = TileVisibilityTelemetry &
  TileResidencyTelemetry & {
    visibleSlotCount: number;
    residentSlotCount: number;
    supportSlotCount: number;
    activeSlotCount: number;
    dirtyResidentCount: number;
    dirtyVisibleCount: number;
    reusedCount: number;
    allocatedCount: number;
    evictedCount: number;
    retainedInactiveCount: number;
    overflowCount: number;
    dirtyResidentRatio: number;
    dirtyVisibleRatio: number;
    reuseRatio: number;
  };

export type TileSlotCacheState = {
  capacity: number;
  shapeKey: string;
  contentEpoch: number;
  generation: number;
  activeSlotCount: number;
  keyToSlot: Map<string, number>;
  slotKey: string[];
  slotContentEpoch: Uint32Array;
  slotSpace: Uint8Array;
  slotLevel: Uint8Array;
  slotX: Int32Array;
  slotY: Int32Array;
  slotState: Uint8Array;
  slotLastVisibleGeneration: Uint32Array;
  slotLastResidentGeneration: Uint32Array;
  visibleSlots: Uint32Array;
  residentSlots: Uint32Array;
  dirtyResidentSlots: Uint32Array;
  /** Legacy alias for `dirtyResidentSlots` while APIs migrate. */
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
  visibleResidentCount: 0,
  anchorResidentCount: 0,
  residentCount: 0,
  anchorCount: 0,
  residentRatio: 0,
  visibleSlotCount: 0,
  residentSlotCount: 0,
  supportSlotCount: 0,
  activeSlotCount: 0,
  dirtyResidentCount: 0,
  dirtyVisibleCount: 0,
  reusedCount: 0,
  allocatedCount: 0,
  evictedCount: 0,
  retainedInactiveCount: 0,
  overflowCount: 0,
  dirtyResidentRatio: 0,
  dirtyVisibleRatio: 0,
  reuseRatio: 0,
};

const SlotState = {
  Free: 0,
  Resident: 1,
} as const;

export function tileKeyString(space: number, level: number, x: number, y: number): string {
  return `${space}:${level}:${x}:${y}`;
}

export function createTileSlotCacheState(
  capacity: number,
  shapeKey: string,
  contentEpoch = 0,
): TileSlotCacheState {
  const freeSlots: number[] = [];
  for (let slot = capacity - 1; slot >= 0; slot -= 1) freeSlots.push(slot);
  const dirtyResidentSlots = new Uint32Array(capacity);
  return {
    capacity,
    shapeKey,
    contentEpoch,
    generation: 0,
    activeSlotCount: 0,
    keyToSlot: new Map(),
    slotKey: Array.from({ length: capacity }, () => ""),
    slotContentEpoch: new Uint32Array(capacity),
    slotSpace: new Uint8Array(capacity),
    slotLevel: new Uint8Array(capacity),
    slotX: new Int32Array(capacity),
    slotY: new Int32Array(capacity),
    slotState: new Uint8Array(capacity),
    slotLastVisibleGeneration: new Uint32Array(capacity),
    slotLastResidentGeneration: new Uint32Array(capacity),
    visibleSlots: new Uint32Array(capacity),
    residentSlots: new Uint32Array(capacity),
    dirtyResidentSlots,
    dirtyVisibleSlots: dirtyResidentSlots,
    freeSlots,
    telemetry: { ...EMPTY_TELEMETRY },
  };
}

function countResidentSlots(state: TileSlotCacheState) {
  let count = 0;
  for (let i = 0; i < state.capacity; i += 1) {
    if (state.slotState[i] === SlotState.Resident) count += 1;
  }
  return count;
}

function evictInactiveSlot(state: TileSlotCacheState, residentKeys: Set<string>): number {
  for (let slot = 0; slot < state.capacity; slot += 1) {
    const key = state.slotKey[slot];
    if (!key || residentKeys.has(key)) continue;
    state.keyToSlot.delete(key);
    state.slotKey[slot] = "";
    state.slotContentEpoch[slot] = 0;
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
  residentKeys: Set<string>,
): { slot: number; evicted: boolean } {
  const freeSlot = state.freeSlots.pop();
  if (typeof freeSlot === "number") return { slot: freeSlot, evicted: false };
  const evictedSlot = evictInactiveSlot(state, residentKeys);
  return { slot: evictedSlot, evicted: evictedSlot >= 0 };
}

function resetTelemetry(
  telemetry: TileSlotTelemetry,
  visibilityTelemetry: TileVisibilityTelemetry,
  residencyTelemetry: TileResidencyTelemetry,
) {
  telemetry.candidateCount = visibilityTelemetry.candidateCount;
  telemetry.visibleCount = visibilityTelemetry.visibleCount;
  telemetry.guardCount = visibilityTelemetry.guardCount;
  telemetry.frustumCulledCount = visibilityTelemetry.frustumCulledCount;
  telemetry.horizonCulledCount = visibilityTelemetry.horizonCulledCount;
  telemetry.unculledCount = visibilityTelemetry.unculledCount;
  telemetry.visibleRatio = visibilityTelemetry.visibleRatio;
  telemetry.visibleResidentCount = residencyTelemetry.visibleResidentCount;
  telemetry.anchorResidentCount = residencyTelemetry.anchorResidentCount;
  telemetry.residentCount = residencyTelemetry.residentCount;
  telemetry.anchorCount = residencyTelemetry.anchorCount;
  telemetry.residentRatio = residencyTelemetry.residentRatio;
  telemetry.visibleSlotCount = 0;
  telemetry.residentSlotCount = 0;
  telemetry.supportSlotCount = 0;
  telemetry.activeSlotCount = 0;
  telemetry.dirtyResidentCount = 0;
  telemetry.dirtyVisibleCount = 0;
  telemetry.reusedCount = 0;
  telemetry.allocatedCount = 0;
  telemetry.evictedCount = 0;
  telemetry.retainedInactiveCount = 0;
  telemetry.overflowCount = 0;
  telemetry.dirtyResidentRatio = 0;
  telemetry.dirtyVisibleRatio = 0;
  telemetry.reuseRatio = 0;
}

export function updateTileSlotCache(
  leaves: LeafSet,
  visibility: TileVisibilityState,
  residency: TileResidencyState,
  capacity: number,
  shapeKey: string,
  contentEpoch: number,
  prev?: TileSlotCacheState,
): TileSlotCacheState {
  const state =
    prev && prev.capacity === capacity && prev.shapeKey === shapeKey
      ? prev
      : createTileSlotCacheState(capacity, shapeKey, contentEpoch);
  const telemetry = state.telemetry;
  const residentKeys = new Set<string>();
  const residentCount = Math.min(
    residency.telemetry.residentCount,
    residency.residentCandidateIndices.length,
  );
  const visibleResidentCount = Math.min(residency.telemetry.visibleResidentCount, residentCount);

  state.generation += 1;
  state.activeSlotCount = 0;
  state.contentEpoch = contentEpoch;
  resetTelemetry(telemetry, visibility.telemetry, residency.telemetry);

  for (let residentIndex = 0; residentIndex < residentCount; residentIndex += 1) {
    const leafIndex = residency.residentCandidateIndices[residentIndex] ?? 0;
    const space = leaves.space[leafIndex] ?? 0;
    const level = leaves.level[leafIndex] ?? 0;
    const x = leaves.x[leafIndex] ?? 0;
    const y = leaves.y[leafIndex] ?? 0;
    residentKeys.add(tileKeyString(space, level, x, y));
  }

  for (let residentIndex = 0; residentIndex < residentCount; residentIndex += 1) {
    const leafIndex = residency.residentCandidateIndices[residentIndex] ?? 0;
    const space = leaves.space[leafIndex] ?? 0;
    const level = leaves.level[leafIndex] ?? 0;
    const x = leaves.x[leafIndex] ?? 0;
    const y = leaves.y[leafIndex] ?? 0;
    const key = tileKeyString(space, level, x, y);
    const residencyKind = residency.residencyState[leafIndex];
    const visible =
      residencyKind === TileResidencyStateKind.Visible ||
      (residencyKind !== TileResidencyStateKind.Anchor && residentIndex < visibleResidentCount);
    let slot = state.keyToSlot.get(key);
    let allocated = false;

    if (slot === undefined) {
      const allocation = allocateSlot(state, residentKeys);
      slot = allocation.slot;
      if (slot < 0) {
        telemetry.overflowCount += 1;
        continue;
      }
      if (allocation.evicted) telemetry.evictedCount += 1;
      state.keyToSlot.set(key, slot);
      state.slotKey[slot] = key;
      state.slotState[slot] = SlotState.Resident;
      telemetry.allocatedCount += 1;
      allocated = true;
    } else {
      telemetry.reusedCount += 1;
    }

    state.slotSpace[slot] = space;
    state.slotLevel[slot] = level;
    state.slotX[slot] = x;
    state.slotY[slot] = y;
    const wasResidentLastFrame = state.slotLastResidentGeneration[slot] === state.generation - 1;
    state.slotLastResidentGeneration[slot] = state.generation;
    state.residentSlots[telemetry.residentSlotCount] = slot;
    telemetry.residentSlotCount += 1;
    if (visible) {
      state.slotLastVisibleGeneration[slot] = state.generation;
      state.visibleSlots[telemetry.visibleSlotCount] = slot;
      telemetry.visibleSlotCount += 1;
    } else {
      telemetry.supportSlotCount += 1;
    }
    state.activeSlotCount = Math.max(state.activeSlotCount, slot + 1);

    if (allocated || !wasResidentLastFrame || state.slotContentEpoch[slot] !== contentEpoch) {
      state.dirtyResidentSlots[telemetry.dirtyResidentCount] = slot;
      telemetry.dirtyResidentCount += 1;
      state.dirtyVisibleSlots[telemetry.dirtyVisibleCount] = slot;
      telemetry.dirtyVisibleCount += 1;
      state.slotContentEpoch[slot] = contentEpoch;
    }
  }

  const totalResidentCount = countResidentSlots(state);
  telemetry.activeSlotCount = state.activeSlotCount;
  telemetry.retainedInactiveCount = Math.max(0, totalResidentCount - telemetry.residentSlotCount);
  telemetry.dirtyResidentRatio =
    telemetry.residentSlotCount > 0
      ? telemetry.dirtyResidentCount / telemetry.residentSlotCount
      : 0;
  telemetry.dirtyVisibleRatio = telemetry.dirtyResidentRatio;
  telemetry.reuseRatio =
    telemetry.residentSlotCount > 0 ? telemetry.reusedCount / telemetry.residentSlotCount : 0;

  return state;
}
