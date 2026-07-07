import { describe, expect, it } from 'vitest';
import type { TileResidencyState } from './residency.js';
import { lookupSpatialIndexRaw } from './spatialIndex.js';
import { markRowsComputed, updateTileTable } from './tileTable.js';
import { U32_EMPTY, allocLeafSet } from './types.js';
import type { TileVisibilityState } from './visibility.js';

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
    return visibilityForIndices(
        count,
        Array.from({ length: count }, (_value, index) => index)
    );
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
    visibleResidentCount = indices.length
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
    return residencyForIndices(
        count,
        Array.from({ length: count }, (_value, index) => index)
    );
}

const hasKey = (
    table: ReturnType<typeof updateTileTable>,
    space: number,
    level: number,
    x: number,
    y: number
) => lookupSpatialIndexRaw(table.keyIndex, space, level, x, y) !== U32_EMPTY;

describe('quadtree/tileTable', () => {
    it('reports newly visible tiles as dirty once and then reused', () => {
        const leaves = makeLeaves([
            [0, 2, 1, 1],
            [0, 2, 2, 1],
            [0, 2, 1, 2],
        ]);
        const visibility = allVisible(leaves.count);
        const residency = allVisibleResident(leaves.count);

        const first = updateTileTable(leaves, visibility, residency, 8, 'cubeSphere:8', 1);
        // Frame 1: everything is pending (no compute yet) — omitted, not drawn.
        expect(first.telemetry.visibleSlotCount).toBe(0);
        expect(first.telemetry.notReadyVisibleCount).toBe(3);
        expect(first.telemetry.residentSlotCount).toBe(3);
        expect(first.telemetry.activeSlotCount).toBe(3);
        expect(first.telemetry.allocatedCount).toBe(3);
        expect(first.telemetry.dirtyVisibleCount).toBe(3);
        expect(first.telemetry.dirtyResidentCount).toBe(3);
        expect(first.telemetry.reusedCount).toBe(0);
        expect(first.space[0]).toBe(0);
        expect(first.level[0]).toBe(2);
        expect(first.x[0]).toBe(1);
        expect(first.y[0]).toBe(1);

        // Model the dispatch completing (as the compute task does each run).
        markRowsComputed(first, first.dirtyRows, first.telemetry.dirtyResidentCount);

        const second = updateTileTable(leaves, visibility, residency, 8, 'cubeSphere:8', 1, first);
        expect(second.telemetry.visibleSlotCount).toBe(3);
        expect(second.telemetry.activeSlotCount).toBe(3);
        expect(second.telemetry.allocatedCount).toBe(0);
        expect(second.telemetry.dirtyVisibleCount).toBe(0);
        expect(second.telemetry.requeuedDirtyCount).toBe(0);
        expect(second.telemetry.reusedCount).toBe(3);
        expect(second.telemetry.reuseRatio).toBe(1);
    });

    it('requeues dirty rows when a dispatch never completed (preempted run)', () => {
        const leaves = makeLeaves([
            [0, 2, 1, 1],
            [0, 2, 2, 1],
        ]);
        const visibility = allVisible(leaves.count);
        const residency = allVisibleResident(leaves.count);

        const first = updateTileTable(leaves, visibility, residency, 8, 'shape', 1);
        expect(first.telemetry.dirtyResidentCount).toBe(2);
        // No markRowsComputed: the run was aborted before the compute dispatch.

        const second = updateTileTable(leaves, visibility, residency, 8, 'shape', 1, first);
        // The obligation survives — the rows are re-queued, not silently dropped.
        expect(second.telemetry.dirtyResidentCount).toBe(2);
        expect(second.telemetry.requeuedDirtyCount).toBe(2);

        markRowsComputed(second, second.dirtyRows, second.telemetry.dirtyResidentCount);
        const third = updateTileTable(leaves, visibility, residency, 8, 'shape', 1, second);
        expect(third.telemetry.dirtyResidentCount).toBe(0);
        expect(third.telemetry.requeuedDirtyCount).toBe(0);
    });

    it('recreates rows when the topology shape key changes', () => {
        const leaves = makeLeaves([
            [0, 2, 1, 1],
            [0, 2, 2, 1],
        ]);
        const visibility = allVisible(leaves.count);
        const residency = allVisibleResident(leaves.count);

        const first = updateTileTable(leaves, visibility, residency, 8, 'cubeSphere|radius=1000', 1);
        const second = updateTileTable(
            leaves,
            visibility,
            residency,
            8,
            'cubeSphere|radius=2000',
            1,
            first
        );

        expect(second).not.toBe(first);
        expect(second.telemetry.allocatedCount).toBe(2);
        expect(second.telemetry.dirtyVisibleCount).toBe(2);
        expect(second.telemetry.reusedCount).toBe(0);
    });

    it('dirties reused visible rows when field content changes', () => {
        const leaves = makeLeaves([
            [0, 2, 1, 1],
            [0, 2, 2, 1],
        ]);
        const visibility = allVisible(leaves.count);
        const residency = allVisibleResident(leaves.count);

        const first = updateTileTable(leaves, visibility, residency, 8, 'shape', 1);
        markRowsComputed(first, first.dirtyRows, first.telemetry.dirtyResidentCount);
        const second = updateTileTable(leaves, visibility, residency, 8, 'shape', 2, first);

        expect(second).toBe(first);
        expect(second.telemetry.allocatedCount).toBe(0);
        expect(second.telemetry.reusedCount).toBe(2);
        expect(second.telemetry.dirtyVisibleCount).toBe(2);
        expect(second.rowContentEpoch[0]).toBe(2);
        expect(second.rowContentEpoch[1]).toBe(2);
    });

    it('dirties retained inactive rows when they re-enter after field content changes', () => {
        const firstLeaves = makeLeaves([
            [0, 2, 1, 1],
            [0, 2, 2, 1],
        ]);
        const first = updateTileTable(
            firstLeaves,
            allVisible(firstLeaves.count),
            allVisibleResident(firstLeaves.count),
            4,
            'shape',
            1
        );
        markRowsComputed(first, first.dirtyRows, first.telemetry.dirtyResidentCount);

        const visibleAOnly = makeLeaves([[0, 2, 1, 1]]);
        const second = updateTileTable(
            visibleAOnly,
            allVisible(visibleAOnly.count),
            allVisibleResident(visibleAOnly.count),
            4,
            'shape',
            2,
            first
        );
        expect(second.telemetry.dirtyVisibleCount).toBe(1);
        markRowsComputed(second, second.dirtyRows, second.telemetry.dirtyResidentCount);

        const bothAgain = updateTileTable(
            firstLeaves,
            allVisible(firstLeaves.count),
            allVisibleResident(firstLeaves.count),
            4,
            'shape',
            2,
            second
        );
        expect(bothAgain.telemetry.reusedCount).toBe(2);
        expect(bothAgain.telemetry.allocatedCount).toBe(0);
        expect(bothAgain.telemetry.dirtyVisibleCount).toBe(1);
    });

    it('retains inactive rows and dirties only newly visible replacements', () => {
        const firstLeaves = makeLeaves([
            [0, 2, 1, 1],
            [0, 2, 2, 1],
        ]);
        const first = updateTileTable(
            firstLeaves,
            allVisible(firstLeaves.count),
            allVisibleResident(firstLeaves.count),
            4,
            'shape',
            1
        );
        markRowsComputed(first, first.dirtyRows, first.telemetry.dirtyResidentCount);
        const secondLeaves = makeLeaves([
            [0, 2, 1, 1],
            [0, 2, 3, 1],
        ]);

        const second = updateTileTable(
            secondLeaves,
            allVisible(secondLeaves.count),
            allVisibleResident(secondLeaves.count),
            4,
            'shape',
            1,
            first
        );

        expect(second.telemetry.reusedCount).toBe(1);
        expect(second.telemetry.allocatedCount).toBe(1);
        expect(second.telemetry.dirtyVisibleCount).toBe(1);
        expect(second.telemetry.activeSlotCount).toBe(3);
        expect(second.telemetry.retainedInactiveCount).toBe(1);
    });

    it('substitutes the computed parent for freshly split children until their compute lands', () => {
        // Frame 1: the parent tile is the only leaf; its compute lands.
        const parentLeaves = makeLeaves([[0, 1, 1, 1]]);
        const first = updateTileTable(
            parentLeaves,
            allVisible(1),
            allVisibleResident(1),
            8,
            'shape',
            1
        );
        markRowsComputed(first, first.dirtyRows, first.telemetry.dirtyResidentCount);
        const second = updateTileTable(
            parentLeaves,
            allVisible(1),
            allVisibleResident(1),
            8,
            'shape',
            1,
            first
        );
        const parentRow = second.drawRows[0]!;

        // Frame 2: the parent splits; its four children are pending, so the
        // still-cached parent is drawn in their place.
        const childLeaves = makeLeaves([
            [0, 2, 2, 2],
            [0, 2, 3, 2],
            [0, 2, 2, 3],
            [0, 2, 3, 3],
        ]);
        const third = updateTileTable(
            childLeaves,
            allVisible(4),
            allVisibleResident(4),
            8,
            'shape',
            1,
            second
        );
        expect(third.telemetry.visibleSlotCount).toBe(1);
        expect(third.drawRows[0]).toBe(parentRow);
        expect(third.telemetry.fallbackVisibleCount).toBe(1);
        // The pending children are still scheduled for compute.
        expect(third.telemetry.dirtyResidentCount).toBe(4);
        markRowsComputed(third, third.dirtyRows, third.telemetry.dirtyResidentCount);

        // Frame 3: the children's compute has landed — they draw directly.
        const fourth = updateTileTable(
            childLeaves,
            allVisible(4),
            allVisibleResident(4),
            8,
            'shape',
            1,
            third
        );
        expect(fourth.telemetry.visibleSlotCount).toBe(4);
        expect(Array.from(fourth.drawRows.subarray(0, 4))).not.toContain(parentRow);
    });

    it('substitutes computed children for a freshly merged parent until its compute lands', () => {
        // Frame 1: four child leaves; their compute lands.
        const childLeaves = makeLeaves([
            [0, 2, 2, 2],
            [0, 2, 3, 2],
            [0, 2, 2, 3],
            [0, 2, 3, 3],
        ]);
        const first = updateTileTable(
            childLeaves,
            allVisible(4),
            allVisibleResident(4),
            8,
            'shape',
            1
        );
        markRowsComputed(first, first.dirtyRows, first.telemetry.dirtyResidentCount);
        const second = updateTileTable(
            childLeaves,
            allVisible(4),
            allVisibleResident(4),
            8,
            'shape',
            1,
            first
        );
        const childRows = Array.from(second.drawRows.subarray(0, 4));

        // Frame 2: the children merge into a pending parent — the still-cached
        // children are drawn in its place.
        const parentLeaves = makeLeaves([[0, 1, 1, 1]]);
        const third = updateTileTable(
            parentLeaves,
            allVisible(1),
            allVisibleResident(1),
            8,
            'shape',
            1,
            second
        );
        expect(third.telemetry.visibleSlotCount).toBe(4);
        expect(Array.from(third.drawRows.subarray(0, 4)).sort()).toEqual([...childRows].sort());
        markRowsComputed(third, third.dirtyRows, third.telemetry.dirtyResidentCount);

        // Frame 3: the parent's compute has landed — it draws directly.
        const fourth = updateTileTable(
            parentLeaves,
            allVisible(1),
            allVisibleResident(1),
            8,
            'shape',
            1,
            third
        );
        expect(fourth.telemetry.visibleSlotCount).toBe(1);
        expect(childRows).not.toContain(fourth.drawRows[0]);
    });

    it('omits pending tiles from the draw view when no cached substitute exists', () => {
        const leaves = makeLeaves([
            [0, 2, 1, 1],
            [0, 2, 2, 1],
        ]);
        const state = updateTileTable(
            leaves,
            allVisible(leaves.count),
            allVisibleResident(leaves.count),
            8,
            'shape',
            1
        );
        // Initial load: nothing is computed and nothing is cached. Omitting for
        // a frame beats drawing uninitialized field data (flash/garbage).
        expect(state.telemetry.visibleSlotCount).toBe(0);
        expect(state.telemetry.notReadyVisibleCount).toBe(2);
        // The pending tiles are still scheduled for compute.
        expect(state.telemetry.dirtyResidentCount).toBe(2);

        markRowsComputed(state, state.dirtyRows, state.telemetry.dirtyResidentCount);
        const second = updateTileTable(
            leaves,
            allVisible(leaves.count),
            allVisibleResident(leaves.count),
            8,
            'shape',
            1,
            state
        );
        expect(second.telemetry.visibleSlotCount).toBe(2);
        expect(second.telemetry.visibleReadyCount).toBe(2);
        expect(second.telemetry.notReadyVisibleCount).toBe(0);
    });

    it('evicts the least-recently-resident row first (keeps warm substitutes)', () => {
        const tileA: [number, number, number, number] = [0, 2, 0, 0];
        const tileB: [number, number, number, number] = [0, 2, 1, 0];
        const tileC: [number, number, number, number] = [0, 2, 2, 0];
        const tileD: [number, number, number, number] = [0, 2, 3, 0];
        const tileE: [number, number, number, number] = [0, 2, 4, 0];
        const run = (
            keys: Array<[number, number, number, number]>,
            prev?: ReturnType<typeof updateTileTable>
        ) => {
            const leaves = makeLeaves(keys);
            return updateTileTable(
                leaves,
                allVisible(keys.length),
                allVisibleResident(keys.length),
                4,
                'shape',
                1,
                prev
            );
        };

        // C drops out of residency first, D one generation later.
        let table = run([tileA, tileB, tileC, tileD]);
        table = run([tileA, tileB, tileD], table); // C inactive since here
        table = run([tileA, tileB], table); // D inactive since here

        // E needs a row: with no free rows, the coldest inactive row (C) must
        // be evicted — not simply the lowest row index.
        table = run([tileA, tileB, tileE], table);
        expect(table.telemetry.evictedCount).toBe(1);
        expect(hasKey(table, 0, 2, 2, 0)).toBe(false); // C evicted
        expect(hasKey(table, 0, 2, 3, 0)).toBe(true); // D retained
    });

    it('allocates and dirties resident support tiles even when they are not visible', () => {
        const leaves = makeLeaves([
            [0, 2, 1, 1],
            [0, 2, 2, 1],
        ]);
        const visibility = visibilityForIndices(leaves.count, [0]);
        const residency = residencyForIndices(leaves.count, [0, 1], 1);

        const state = updateTileTable(leaves, visibility, residency, 8, 'shape', 1);

        // The pending visible tile is omitted from the draw view this frame,
        // but residency/support/dirty accounting is unaffected.
        expect(state.telemetry.visibleSlotCount).toBe(0);
        expect(state.telemetry.notReadyVisibleCount).toBe(1);
        expect(state.telemetry.residentSlotCount).toBe(2);
        expect(state.telemetry.supportSlotCount).toBe(1);
        expect(state.telemetry.allocatedCount).toBe(2);
        expect(state.telemetry.dirtyResidentCount).toBe(2);
        expect(state.telemetry.dirtyVisibleCount).toBe(2);
        expect(Array.from(state.residentRows.subarray(0, 2))).toEqual([0, 1]);

        markRowsComputed(state, state.dirtyRows, state.telemetry.dirtyResidentCount);
        const second = updateTileTable(leaves, visibility, residency, 8, 'shape', 1, state);
        expect(second.telemetry.visibleSlotCount).toBe(1);
        expect(Array.from(second.drawRows.subarray(0, 1))).toEqual([0]);
    });

    it('exposes only computed resident rows through the query view', () => {
        const leaves = makeLeaves([
            [0, 2, 1, 1],
            [0, 2, 2, 1],
        ]);
        const visibility = allVisible(leaves.count);
        const residency = allVisibleResident(leaves.count);

        const first = updateTileTable(leaves, visibility, residency, 8, 'shape', 1);
        // Nothing computed yet: queries must not resolve any tile.
        expect(first.queryRowCount).toBe(0);

        markRowsComputed(first, first.dirtyRows, first.telemetry.dirtyResidentCount);
        const second = updateTileTable(leaves, visibility, residency, 8, 'shape', 1, first);
        expect(second.queryRowCount).toBe(2);
        expect(Array.from(second.queryRows.subarray(0, 2)).sort()).toEqual([0, 1]);
    });

    it('keys tiles with negative coordinates distinctly (infinite-flat roots)', () => {
        const leaves = makeLeaves([
            [0, 0, -1, -1],
            [0, 0, 1, 1],
            [0, 0, -1, 1],
        ]);
        const visibility = allVisible(leaves.count);
        const residency = allVisibleResident(leaves.count);

        const first = updateTileTable(leaves, visibility, residency, 8, 'shape', 1);
        expect(first.telemetry.allocatedCount).toBe(3);
        markRowsComputed(first, first.dirtyRows, first.telemetry.dirtyResidentCount);

        const second = updateTileTable(leaves, visibility, residency, 8, 'shape', 1, first);
        // All three tiles resolve back to their own rows — no aliasing.
        expect(second.telemetry.reusedCount).toBe(3);
        expect(second.telemetry.allocatedCount).toBe(0);
        expect(hasKey(second, 0, 0, -1, -1)).toBe(true);
        expect(hasKey(second, 0, 0, -1, 1)).toBe(true);
        expect(second.x[0]).toBe(-1);
        expect(second.y[0]).toBe(-1);
    });
});
