/**
 * TileTable — the single authoritative home for a tile's runtime lifecycle
 * (spec/architecture-simplification.md, Phase 1).
 *
 * One flat SoA table where a row IS a persistent GPU field slot. Identity,
 * lifecycle flags, recency, and content epoch live on the row; the draw list,
 * dirty list, and ready-gated query list are derived views rebuilt by
 * {@link updateTileTable} in the same pass that mutates the rows — never
 * patched incrementally from other modules.
 *
 * Tile identity is integer-keyed through a {@link SpatialIndex} (open
 * addressing on raw `(space, level, x, y)`), rebuilt each update via a stamp
 * reset. No string keys, no Map churn, no deletion bookkeeping: evicted rows
 * simply aren't re-inserted.
 *
 * Correctness invariants carried over from the incremental-slot fixes:
 * - The dirty obligation is a row flag cleared only by {@link markRowsComputed}
 *   after a dispatch actually ran — preempted/aborted runs re-queue instead of
 *   silently dropping work (`requeuedDirtyCount`).
 * - Eviction is LRU (least-recently-resident, then least-recently-visible) so
 *   the substitution cache of just-split parents stays warm under pressure.
 * - The draw view never contains an uncomputed row: pending rows are hidden by
 *   ancestor/descendant substitution or omitted (`notReadyVisibleCount`).
 * - The query view (`queryRows`) contains only computed resident rows, so
 *   queries/raycasts can never resolve uninitialized field data.
 */
import { TileResidencyStateKind, type TileResidencyState } from './residency';
import {
    createSpatialIndex,
    insertSpatialIndexRaw,
    lookupSpatialIndexRaw,
    resetSpatialIndex,
    type SpatialIndex,
} from './spatialIndex';
import { U32_EMPTY, type LeafSet } from './types';
import type { TileVisibilityState, TileVisibilityTelemetry } from './visibility';
import type { TileResidencyTelemetry } from './residency';

export const TileRowFlags = {
    /** Row owns a tile key and GPU field slot (may be retained-inactive). */
    Allocated: 1,
    /** Row's field content was written by at least one completed dispatch. */
    Computed: 2,
    /** Row needs a compute dispatch before its content is current. */
    Dirty: 4,
} as const;

/**
 * Field names are a stable observability contract (GPU lab, docs debug
 * panels); they keep their historical "slot" vocabulary — a row IS a slot.
 */
export type TileTableTelemetry = TileVisibilityTelemetry &
    TileResidencyTelemetry & {
        visibleSlotCount: number;
        residentSlotCount: number;
        supportSlotCount: number;
        activeSlotCount: number;
        dirtyResidentCount: number;
        /** Mirrors `dirtyResidentCount` (the historical alias is folded). */
        dirtyVisibleCount: number;
        reusedCount: number;
        allocatedCount: number;
        evictedCount: number;
        retainedInactiveCount: number;
        overflowCount: number;
        dirtyResidentRatio: number;
        dirtyVisibleRatio: number;
        reuseRatio: number;
        /** Visible rows drawn with their own computed content this update. */
        visibleReadyCount: number;
        /** Substitute rows (computed ancestors/descendants) drawn for pending tiles. */
        fallbackVisibleCount: number;
        /** Pending visible rows omitted from the draw list (no safe substitute). */
        notReadyVisibleCount: number;
        /** Dirty rows re-queued because a previous dispatch never completed. */
        requeuedDirtyCount: number;
    };

export type TileTable = {
    capacity: number;
    shapeKey: string;
    contentEpoch: number;
    generation: number;
    /** Rows 0..activeRowCount-1 cover every row referenced this update. */
    activeRowCount: number;

    /** Row identity (valid while Allocated). */
    space: Uint8Array;
    level: Uint8Array;
    x: Int32Array;
    y: Int32Array;

    /** Lifecycle flags per row ({@link TileRowFlags}). */
    flags: Uint8Array;
    /** Content epoch the row was last queued for. */
    rowContentEpoch: Uint32Array;
    lastVisibleGen: Uint32Array;
    lastResidentGen: Uint32Array;

    /** key -> row. Rebuilt each update over Allocated rows (stamp reset). */
    keyIndex: SpatialIndex;

    /** Scratch: rows protected from eviction this generation. */
    protectedGen: Uint32Array;
    /** Scratch: resolved row per resident-candidate ordinal (pass A -> B). */
    leafRowScratch: Uint32Array;

    /** Derived views (counts live in telemetry / queryRowCount). */
    drawRows: Uint32Array;
    residentRows: Uint32Array;
    dirtyRows: Uint32Array;
    queryRows: Uint32Array;
    queryRowCount: number;

    freeRows: number[];
    telemetry: TileTableTelemetry;
};

const EMPTY_TELEMETRY: TileTableTelemetry = {
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

export function createTileTable(capacity: number, shapeKey: string, contentEpoch = 0): TileTable {
    const freeRows: number[] = [];
    for (let row = capacity - 1; row >= 0; row -= 1) freeRows.push(row);
    return {
        capacity,
        shapeKey,
        contentEpoch,
        generation: 0,
        activeRowCount: 0,
        space: new Uint8Array(capacity),
        level: new Uint8Array(capacity),
        x: new Int32Array(capacity),
        y: new Int32Array(capacity),
        flags: new Uint8Array(capacity),
        rowContentEpoch: new Uint32Array(capacity),
        lastVisibleGen: new Uint32Array(capacity),
        lastResidentGen: new Uint32Array(capacity),
        keyIndex: createSpatialIndex(capacity),
        protectedGen: new Uint32Array(capacity),
        leafRowScratch: new Uint32Array(capacity),
        drawRows: new Uint32Array(capacity),
        residentRows: new Uint32Array(capacity),
        dirtyRows: new Uint32Array(capacity),
        queryRows: new Uint32Array(capacity),
        queryRowCount: 0,
        freeRows,
        telemetry: { ...EMPTY_TELEMETRY },
    };
}

/**
 * Evicts the least-recently-resident unprotected row (ties broken by least
 * recently visible). Recency matters: retained-inactive rows are the
 * substitution cache that hides LOD pops — a just-split parent must outlive a
 * tile the camera left behind minutes ago.
 */
function evictColdestRow(table: TileTable): number {
    let coldest = -1;
    let coldestResidentGen = 0xffffffff;
    let coldestVisibleGen = 0xffffffff;
    for (let row = 0; row < table.capacity; row += 1) {
        if ((table.flags[row]! & TileRowFlags.Allocated) === 0) continue;
        if (table.protectedGen[row] === table.generation) continue;
        const residentGen = table.lastResidentGen[row]!;
        const visibleGen = table.lastVisibleGen[row]!;
        if (
            residentGen < coldestResidentGen ||
            (residentGen === coldestResidentGen && visibleGen < coldestVisibleGen)
        ) {
            coldest = row;
            coldestResidentGen = residentGen;
            coldestVisibleGen = visibleGen;
        }
    }
    if (coldest < 0) return -1;
    table.flags[coldest] = 0;
    table.rowContentEpoch[coldest] = 0;
    return coldest;
}

function allocateRow(table: TileTable): { row: number; evicted: boolean } {
    const freeRow = table.freeRows.pop();
    if (typeof freeRow === 'number') return { row: freeRow, evicted: false };
    const evictedRow = evictColdestRow(table);
    return { row: evictedRow, evicted: evictedRow >= 0 };
}

function resetTelemetry(
    telemetry: TileTableTelemetry,
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
 * Marks rows as having valid computed terrain-field content. Called by the
 * compute execute task after dispatching the terrain pipeline for a dirty
 * batch. The dirty obligation is only discharged here — after a dispatch
 * actually ran — never at enqueue time, so preempted runs re-queue.
 */
export function markRowsComputed(table: TileTable, rows: Uint32Array, count: number): void {
    const n = Math.min(count, rows.length);
    for (let i = 0; i < n; i += 1) {
        const row = rows[i]!;
        if (row < table.capacity) {
            table.flags[row] = (table.flags[row]! | TileRowFlags.Computed) & ~TileRowFlags.Dirty;
        }
    }
}

/**
 * LOD-pop suppression over the draw view. Freshly (re)allocated visible rows
 * have no computed terrain field yet; drawing them would show uninitialized
 * or leftover data. Instead:
 *
 * - A pending child (from a split) is replaced by its computed parent row,
 *   which is still cached; all of that parent's visible children are hidden so
 *   the parent and children never overlap.
 * - A pending parent (from a merge) is replaced by its four computed child
 *   rows when all of them are still cached.
 * - With no cached substitute, the pending row is OMITTED from the draw view
 *   for this update (`notReadyVisibleCount`).
 *
 * Scheduled for deletion in Phase 2 (staged LOD commits) of
 * spec/architecture-simplification.md.
 */
function applyPendingRowSubstitution(table: TileTable): void {
    const telemetry = table.telemetry;
    const count = telemetry.visibleSlotCount;

    let hasPending = false;
    for (let i = 0; i < count; i += 1) {
        if ((table.flags[table.drawRows[i]!]! & TileRowFlags.Computed) === 0) {
            hasPending = true;
            break;
        }
    }
    if (!hasPending) {
        telemetry.visibleReadyCount = count;
        return;
    }

    const isComputed = (row: number) => (table.flags[row]! & TileRowFlags.Computed) !== 0;
    const parentRowOf = (row: number): number =>
        table.level[row]! > 0
            ? lookupSpatialIndexRaw(
                  table.keyIndex,
                  table.space[row]!,
                  table.level[row]! - 1,
                  table.x[row]! >> 1,
                  table.y[row]! >> 1
              )
            : U32_EMPTY;

    /** Pending rows replaced by their (computed) children. */
    const replacedByChildren = new Set<number>();
    /** Pending rows with no safe substitute — omitted from the draw view. */
    const omittedRows = new Set<number>();
    /** Parent rows drawn in place of their pending children. */
    const suppressedParentRows = new Set<number>();
    const addedRows: number[] = [];
    const addedSet = new Set<number>();
    const addSubstitute = (row: number) => {
        if (addedSet.has(row)) return;
        addedSet.add(row);
        addedRows.push(row);
    };

    for (let i = 0; i < count; i += 1) {
        const row = table.drawRows[i]!;
        if (isComputed(row)) continue;

        // Split: draw the still-cached parent until this child's compute lands.
        const parentRow = parentRowOf(row);
        if (parentRow !== U32_EMPTY && isComputed(parentRow)) {
            suppressedParentRows.add(parentRow);
            addSubstitute(parentRow);
            continue;
        }

        // Merge: draw the four still-cached children until the parent's compute
        // lands. Requires all four (partial coverage would leave holes).
        const space = table.space[row]!;
        const level = table.level[row]!;
        const x = table.x[row]!;
        const y = table.y[row]!;
        let childRows: number[] | null = [];
        for (let corner = 0; corner < 4; corner += 1) {
            const childRow = lookupSpatialIndexRaw(
                table.keyIndex,
                space,
                level + 1,
                (x << 1) + (corner & 1),
                (y << 1) + (corner >> 1)
            );
            if (childRow === U32_EMPTY || !isComputed(childRow)) {
                childRows = null;
                break;
            }
            childRows.push(childRow);
        }
        if (childRows !== null) {
            replacedByChildren.add(row);
            for (const childRow of childRows) addSubstitute(childRow);
            continue;
        }

        // No safe substitute: omit rather than draw uncomputed row data.
        omittedRows.add(row);
    }

    let write = 0;
    for (let i = 0; i < count; i += 1) {
        const row = table.drawRows[i]!;
        if (replacedByChildren.has(row)) continue;
        if (omittedRows.has(row)) continue;
        if (addedSet.has(row)) continue;
        if (suppressedParentRows.size > 0) {
            const parentRow = parentRowOf(row);
            if (parentRow !== U32_EMPTY && suppressedParentRows.has(parentRow)) continue;
        }
        table.drawRows[write] = row;
        write += 1;
    }
    telemetry.visibleReadyCount = write;
    for (const row of addedRows) {
        if (write >= table.capacity) break;
        table.drawRows[write] = row;
        write += 1;
        // Keep substitutes warm and covered by the GPU leaf-buffer upload range.
        table.lastVisibleGen[row] = table.generation;
        table.activeRowCount = Math.max(table.activeRowCount, row + 1);
    }
    telemetry.fallbackVisibleCount = write - telemetry.visibleReadyCount;
    telemetry.notReadyVisibleCount = omittedRows.size;
    telemetry.visibleSlotCount = write;
}

export function updateTileTable(
    leaves: LeafSet,
    visibility: TileVisibilityState,
    residency: TileResidencyState,
    capacity: number,
    shapeKey: string,
    contentEpoch: number,
    /**
     * Gate draw/query views on computed field content. Only valid when the
     * graph actually runs the field compute pipeline (`executeComputeTask`
     * calls {@link markRowsComputed}); geometry-only graphs must pass `false`
     * or nothing will ever draw. See the `gateOnComputedField` param.
     */
    gateOnComputedField: boolean,
    prev?: TileTable
): TileTable {
    const table =
        prev && prev.capacity === capacity && prev.shapeKey === shapeKey
            ? prev
            : createTileTable(capacity, shapeKey, contentEpoch);
    const telemetry = table.telemetry;
    const residentCount = Math.min(
        residency.telemetry.residentCount,
        residency.residentCandidateIndices.length
    );
    const visibleResidentCount = Math.min(residency.telemetry.visibleResidentCount, residentCount);

    table.generation += 1;
    table.activeRowCount = 0;
    table.contentEpoch = contentEpoch;
    resetTelemetry(telemetry, visibility.telemetry, residency.telemetry);

    // Pass A: resolve rows through last update's key index and protect them
    // from eviction, BEFORE any allocation can evict this update's tiles.
    for (let residentIndex = 0; residentIndex < residentCount; residentIndex += 1) {
        const leafIndex = residency.residentCandidateIndices[residentIndex] ?? 0;
        const row = lookupSpatialIndexRaw(
            table.keyIndex,
            leaves.space[leafIndex] ?? 0,
            leaves.level[leafIndex] ?? 0,
            leaves.x[leafIndex] ?? 0,
            leaves.y[leafIndex] ?? 0
        );
        table.leafRowScratch[residentIndex] = row;
        if (row !== U32_EMPTY) table.protectedGen[row] = table.generation;
    }

    // Pass B: allocate missing rows, refresh identity/recency, queue dirty
    // work, and build the resident/draw views.
    for (let residentIndex = 0; residentIndex < residentCount; residentIndex += 1) {
        const leafIndex = residency.residentCandidateIndices[residentIndex] ?? 0;
        let row = table.leafRowScratch[residentIndex]!;
        let allocated = false;

        if (row === U32_EMPTY) {
            const allocation = allocateRow(table);
            if (allocation.row < 0) {
                telemetry.overflowCount += 1;
                continue;
            }
            row = allocation.row;
            if (allocation.evicted) telemetry.evictedCount += 1;
            table.flags[row] = TileRowFlags.Allocated;
            table.protectedGen[row] = table.generation;
            telemetry.allocatedCount += 1;
            allocated = true;
        } else {
            telemetry.reusedCount += 1;
        }

        table.space[row] = leaves.space[leafIndex] ?? 0;
        table.level[row] = leaves.level[leafIndex] ?? 0;
        table.x[row] = leaves.x[leafIndex] ?? 0;
        table.y[row] = leaves.y[leafIndex] ?? 0;

        const wasResidentLastFrame = table.lastResidentGen[row] === table.generation - 1;
        table.lastResidentGen[row] = table.generation;
        table.residentRows[telemetry.residentSlotCount] = row;
        telemetry.residentSlotCount += 1;

        const residencyKind = residency.residencyState[leafIndex];
        const visible =
            residencyKind === TileResidencyStateKind.Visible ||
            (residencyKind !== TileResidencyStateKind.Anchor && residentIndex < visibleResidentCount);
        if (visible) {
            table.lastVisibleGen[row] = table.generation;
            table.drawRows[telemetry.visibleSlotCount] = row;
            telemetry.visibleSlotCount += 1;
        } else {
            telemetry.supportSlotCount += 1;
        }
        table.activeRowCount = Math.max(table.activeRowCount, row + 1);

        const epochChanged = table.rowContentEpoch[row] !== contentEpoch;
        if (allocated || !wasResidentLastFrame || epochChanged) {
            table.flags[row] = table.flags[row]! | TileRowFlags.Dirty;
            table.rowContentEpoch[row] = contentEpoch;
        } else if ((table.flags[row]! & TileRowFlags.Dirty) !== 0) {
            // Still dirty from an update whose dispatch never completed
            // (preempted/aborted run, or renderer unavailable): re-queue.
            telemetry.requeuedDirtyCount += 1;
        }
        if ((table.flags[row]! & TileRowFlags.Dirty) !== 0) {
            table.dirtyRows[telemetry.dirtyResidentCount] = row;
            telemetry.dirtyResidentCount += 1;
        }
    }
    telemetry.dirtyVisibleCount = telemetry.dirtyResidentCount;

    // Rebuild the key index over Allocated rows (stamp reset; evicted rows
    // simply aren't re-inserted). Substitution below depends on it.
    resetSpatialIndex(table.keyIndex);
    let allocatedRowCount = 0;
    for (let row = 0; row < table.capacity; row += 1) {
        if ((table.flags[row]! & TileRowFlags.Allocated) === 0) continue;
        insertSpatialIndexRaw(
            table.keyIndex,
            table.space[row]!,
            table.level[row]!,
            table.x[row]!,
            table.y[row]!,
            row
        );
        allocatedRowCount += 1;
    }

    if (gateOnComputedField) {
        applyPendingRowSubstitution(table);

        // Ready-gated query view: only computed resident rows may resolve from
        // queries/raycasts/the GPU spatial index.
        let queryRowCount = 0;
        for (let i = 0; i < telemetry.residentSlotCount; i += 1) {
            const row = table.residentRows[i]!;
            if ((table.flags[row]! & TileRowFlags.Computed) === 0) continue;
            table.queryRows[queryRowCount] = row;
            queryRowCount += 1;
        }
        table.queryRowCount = queryRowCount;
    } else {
        // No field compute in this graph: rendering doesn't consume the
        // terrain field, so readiness is meaningless — draw every visible row
        // and expose every resident row to queries.
        telemetry.visibleReadyCount = telemetry.visibleSlotCount;
        table.queryRows.set(table.residentRows.subarray(0, telemetry.residentSlotCount));
        table.queryRowCount = telemetry.residentSlotCount;
    }

    telemetry.activeSlotCount = table.activeRowCount;
    telemetry.retainedInactiveCount = Math.max(0, allocatedRowCount - telemetry.residentSlotCount);
    telemetry.dirtyResidentRatio =
        telemetry.residentSlotCount > 0
            ? telemetry.dirtyResidentCount / telemetry.residentSlotCount
            : 0;
    telemetry.dirtyVisibleRatio = telemetry.dirtyResidentRatio;
    telemetry.reuseRatio =
        telemetry.residentSlotCount > 0 ? telemetry.reusedCount / telemetry.residentSlotCount : 0;

    return table;
}
