import {
    TileResidencyStateKind,
    type TileResidencyState,
    type TileResidencyTelemetry,
} from './residency';
import type { LeafSet } from './types';
import type { TileVisibilityState, TileVisibilityTelemetry } from './visibility';

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
        /** Visible slots drawn with their own computed content this update. */
        visibleReadyCount: number;
        /** Substitute slots (computed ancestors/descendants) drawn in place of pending tiles. */
        fallbackVisibleCount: number;
        /** Pending visible slots omitted from the draw list (no safe substitute). */
        notReadyVisibleCount: number;
        /** Dirty slots re-queued because a previous dispatch never completed (e.g. preempted run). */
        requeuedDirtyCount: number;
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
    /**
     * 1 once the slot's terrain field has been written by at least one compute
     * dispatch. Freshly (re)allocated slots are 0 until their first compute
     * lands; the visible list substitutes a computed ancestor/descendant for
     * such slots so LOD transitions never draw uncomputed data (LOD pop).
     */
    slotComputed: Uint8Array;
    /**
     * 1 while the slot needs a compute dispatch before its content is current.
     * Set on allocation, on return to residency, and on content-epoch change;
     * cleared only by {@link markSlotsComputed} after a dispatch actually ran.
     * Persisting the obligation here (instead of stamping the epoch at enqueue
     * time) means preempted/aborted runs re-queue the work on the next update
     * rather than silently dropping it — dropped dispatches previously left
     * permanently uncomputed tiles (holes).
     */
    slotDirty: Uint8Array;
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
    visibleReadyCount: 0,
    fallbackVisibleCount: 0,
    notReadyVisibleCount: 0,
    requeuedDirtyCount: 0,
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
    contentEpoch = 0
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
        slotKey: Array.from({ length: capacity }, () => ''),
        slotContentEpoch: new Uint32Array(capacity),
        slotSpace: new Uint8Array(capacity),
        slotLevel: new Uint8Array(capacity),
        slotX: new Int32Array(capacity),
        slotY: new Int32Array(capacity),
        slotState: new Uint8Array(capacity),
        slotComputed: new Uint8Array(capacity),
        slotDirty: new Uint8Array(capacity),
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

/**
 * Evicts the least-recently-resident inactive slot (ties broken by least
 * recently visible). Recency matters: retained-inactive slots are the
 * substitution cache that hides LOD pops — a just-split parent must outlive a
 * tile the camera left behind minutes ago, otherwise every split under memory
 * pressure draws a hole/flash until the child's compute lands.
 */
function evictInactiveSlot(state: TileSlotCacheState, residentKeys: Set<string>): number {
    let coldest = -1;
    let coldestResidentGen = 0xffffffff;
    let coldestVisibleGen = 0xffffffff;
    for (let slot = 0; slot < state.capacity; slot += 1) {
        const key = state.slotKey[slot];
        if (!key || residentKeys.has(key)) continue;
        const residentGen = state.slotLastResidentGeneration[slot]!;
        const visibleGen = state.slotLastVisibleGeneration[slot]!;
        if (
            residentGen < coldestResidentGen ||
            (residentGen === coldestResidentGen && visibleGen < coldestVisibleGen)
        ) {
            coldest = slot;
            coldestResidentGen = residentGen;
            coldestVisibleGen = visibleGen;
        }
    }
    if (coldest < 0) return -1;
    const key = state.slotKey[coldest]!;
    state.keyToSlot.delete(key);
    state.slotKey[coldest] = '';
    state.slotContentEpoch[coldest] = 0;
    state.slotSpace[coldest] = 0;
    state.slotLevel[coldest] = 0;
    state.slotX[coldest] = 0;
    state.slotY[coldest] = 0;
    state.slotState[coldest] = SlotState.Free;
    state.slotComputed[coldest] = 0;
    state.slotDirty[coldest] = 0;
    return coldest;
}

function allocateSlot(
    state: TileSlotCacheState,
    residentKeys: Set<string>
): { slot: number; evicted: boolean } {
    const freeSlot = state.freeSlots.pop();
    if (typeof freeSlot === 'number') return { slot: freeSlot, evicted: false };
    const evictedSlot = evictInactiveSlot(state, residentKeys);
    return { slot: evictedSlot, evicted: evictedSlot >= 0 };
}

function resetTelemetry(
    telemetry: TileSlotTelemetry,
    visibilityTelemetry: TileVisibilityTelemetry,
    residencyTelemetry: TileResidencyTelemetry
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
    telemetry.visibleReadyCount = 0;
    telemetry.fallbackVisibleCount = 0;
    telemetry.notReadyVisibleCount = 0;
    telemetry.requeuedDirtyCount = 0;
}

/**
 * Marks slots as having valid computed terrain-field content. Called by the
 * compute execute task after dispatching the terrain pipeline for a dirty-slot
 * batch; from the next cache update on, those slots are drawn directly instead
 * of via ancestor/descendant substitution.
 */
export function markSlotsComputed(
    state: TileSlotCacheState,
    slots: Uint32Array,
    count: number
): void {
    const n = Math.min(count, slots.length);
    for (let i = 0; i < n; i += 1) {
        const slot = slots[i]!;
        if (slot < state.capacity) {
            state.slotComputed[slot] = 1;
            // The dirty obligation is only discharged here — after a dispatch
            // actually ran — never at enqueue time, so preempted runs re-queue.
            state.slotDirty[slot] = 0;
        }
    }
}

/**
 * LOD-pop suppression. Freshly (re)allocated visible slots have no computed
 * terrain field yet; drawing them pops flat/stale geometry for a frame or two
 * until their first compute lands. Instead:
 *
 * - A pending child (from a split) is replaced by its computed parent slot,
 *   which is still cached; all of that parent's visible children are hidden so
 *   the parent and children never overlap.
 * - A pending parent (from a merge) is replaced by its four computed child
 *   slots when all of them are still cached.
 * - With no cached substitute, the pending slot is OMITTED from the draw list
 *   for this update (`notReadyVisibleCount`). A one-or-two-frame missing tile
 *   beats drawing uninitialized or another tile's leftover field data, which
 *   reads as flashing/garbage geometry.
 *
 * Compute for pending slots is unaffected (the dirty list is built from the
 * resident set), so substitution resolves after one compute round-trip.
 */
function applyPendingSlotSubstitution(state: TileSlotCacheState): void {
    const telemetry = state.telemetry;
    const count = telemetry.visibleSlotCount;

    let hasPending = false;
    for (let i = 0; i < count; i += 1) {
        if (state.slotComputed[state.visibleSlots[i]!] === 0) {
            hasPending = true;
            break;
        }
    }
    if (!hasPending) {
        telemetry.visibleReadyCount = count;
        return;
    }

    /** Pending slots replaced by their (computed) children. */
    const replacedByChildren = new Set<number>();
    /** Pending slots with no safe substitute — omitted from the draw list. */
    const omittedSlots = new Set<number>();
    /** Parent keys drawn in place of their pending children. */
    const suppressedParentKeys = new Set<string>();
    const addedSlots: number[] = [];
    const addedSet = new Set<number>();
    const addSubstitute = (slot: number) => {
        if (addedSet.has(slot)) return;
        addedSet.add(slot);
        addedSlots.push(slot);
    };

    for (let i = 0; i < count; i += 1) {
        const slot = state.visibleSlots[i]!;
        if (state.slotComputed[slot] !== 0) continue;
        const space = state.slotSpace[slot]!;
        const level = state.slotLevel[slot]!;
        const x = state.slotX[slot]!;
        const y = state.slotY[slot]!;

        // Split: draw the still-cached parent until this child's compute lands.
        if (level > 0) {
            const parentKey = tileKeyString(space, level - 1, x >> 1, y >> 1);
            const parentSlot = state.keyToSlot.get(parentKey);
            if (parentSlot !== undefined && state.slotComputed[parentSlot] === 1) {
                suppressedParentKeys.add(parentKey);
                addSubstitute(parentSlot);
                continue;
            }
        }

        // Merge: draw the four still-cached children until the parent's compute
        // lands. Requires all four (partial coverage would leave holes).
        let childSlots: number[] | null = [];
        for (let corner = 0; corner < 4; corner += 1) {
            const childKey = tileKeyString(
                space,
                level + 1,
                (x << 1) + (corner & 1),
                (y << 1) + (corner >> 1)
            );
            const childSlot = state.keyToSlot.get(childKey);
            if (childSlot === undefined || state.slotComputed[childSlot] !== 1) {
                childSlots = null;
                break;
            }
            childSlots.push(childSlot);
        }
        if (childSlots !== null) {
            replacedByChildren.add(slot);
            for (const childSlot of childSlots) addSubstitute(childSlot);
            continue;
        }
        // No safe substitute: omit rather than draw uncomputed slot data.
        omittedSlots.add(slot);
    }

    let write = 0;
    for (let i = 0; i < count; i += 1) {
        const slot = state.visibleSlots[i]!;
        if (replacedByChildren.has(slot)) continue;
        if (omittedSlots.has(slot)) continue;
        if (addedSet.has(slot)) continue;
        if (suppressedParentKeys.size > 0) {
            const level = state.slotLevel[slot]!;
            if (level > 0) {
                const parentKey = tileKeyString(
                    state.slotSpace[slot]!,
                    level - 1,
                    state.slotX[slot]! >> 1,
                    state.slotY[slot]! >> 1
                );
                if (suppressedParentKeys.has(parentKey)) continue;
            }
        }
        state.visibleSlots[write] = slot;
        write += 1;
    }
    telemetry.visibleReadyCount = write;
    for (const slot of addedSlots) {
        if (write >= state.capacity) break;
        state.visibleSlots[write] = slot;
        write += 1;
        // Keep substitutes warm and covered by the GPU leaf-buffer upload range.
        state.slotLastVisibleGeneration[slot] = state.generation;
        state.activeSlotCount = Math.max(state.activeSlotCount, slot + 1);
    }
    telemetry.fallbackVisibleCount = write - telemetry.visibleReadyCount;
    telemetry.notReadyVisibleCount = omittedSlots.size;
    telemetry.visibleSlotCount = write;
}

export function updateTileSlotCache(
    leaves: LeafSet,
    visibility: TileVisibilityState,
    residency: TileResidencyState,
    capacity: number,
    shapeKey: string,
    contentEpoch: number,
    prev?: TileSlotCacheState
): TileSlotCacheState {
    const state =
        prev && prev.capacity === capacity && prev.shapeKey === shapeKey
            ? prev
            : createTileSlotCacheState(capacity, shapeKey, contentEpoch);
    const telemetry = state.telemetry;
    const residentKeys = new Set<string>();
    const residentCount = Math.min(
        residency.telemetry.residentCount,
        residency.residentCandidateIndices.length
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
            state.slotComputed[slot] = 0;
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
            state.slotDirty[slot] = 1;
            state.slotContentEpoch[slot] = contentEpoch;
        } else if (state.slotDirty[slot] === 1) {
            // Still dirty from a previous update whose dispatch never completed
            // (preempted/aborted run, or renderer unavailable): re-queue it.
            telemetry.requeuedDirtyCount += 1;
        }
        if (state.slotDirty[slot] === 1) {
            state.dirtyResidentSlots[telemetry.dirtyResidentCount] = slot;
            telemetry.dirtyResidentCount += 1;
            state.dirtyVisibleSlots[telemetry.dirtyVisibleCount] = slot;
            telemetry.dirtyVisibleCount += 1;
        }
    }

    applyPendingSlotSubstitution(state);

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
