import { describe, expect, it } from 'vitest';
import type { StorageBufferAttribute, WebGPURenderer } from 'three/webgpu';
import { createSpatialIndex, insertSpatialIndexRaw } from '../quadtree';
import { createTerrainSnapshotState, triggerSnapshotReadback } from './terrain-snapshot';

const VERTICES_PER_NODE = 4;
const MAX_NODES = 8;
const TOTAL_ELEMENTS = MAX_NODES * VERTICES_PER_NODE;

function makeRenderer() {
    const resolvers: Array<(buffer: ArrayBuffer) => void> = [];
    const renderer = {
        getArrayBufferAsync: () =>
            new Promise<ArrayBuffer>((resolve) => {
                resolvers.push(resolve);
            }),
    } as unknown as WebGPURenderer;
    return { renderer, resolvers };
}

function makeIndex() {
    const index = createSpatialIndex(MAX_NODES);
    insertSpatialIndexRaw(index, 0, 0, 0, 0, 0);
    return index;
}

const fakeAttribute = {} as StorageBufferAttribute;

function capture(dirtySlots?: number[]) {
    return {
        activeLeafCount: 4,
        totalElements: TOTAL_ELEMENTS,
        verticesPerNode: VERTICES_PER_NODE,
        elevationScale: 1,
        originY: 0,
        dirtySlots,
        dirtySlotCount: dirtySlots?.length ?? 0,
    };
}

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('query/terrain-snapshot dirty accumulation', () => {
    it('accumulates dirty batches that arrive while a readback is in flight', async () => {
        const state = createTerrainSnapshotState(MAX_NODES, 4, TOTAL_ELEMENTS);
        const { renderer, resolvers } = makeRenderer();
        const index = makeIndex();

        triggerSnapshotReadback(state, renderer, fakeAttribute, index, undefined, capture([0]));
        expect(state.readbackPending).toBe(true);

        // A dirty batch lands while the readback is in flight: previously this
        // was silently dropped (permanently stale CPU data for slot 1); it
        // must survive in the pending set instead.
        triggerSnapshotReadback(state, renderer, fakeAttribute, index, undefined, capture([1]));
        expect(state.readbackPending).toBe(true);
        expect(state.pendingDirtySlots.has(1)).toBe(true);

        resolvers[0]!(new ArrayBuffer(TOTAL_ELEMENTS * 4));
        await flushMicrotasks();
        expect(state.readbackPending).toBe(false);
        expect(state.hasSnapshot).toBe(true);

        // Same index generation, no NEW dirty input — but un-fetched pending
        // data must still schedule a readback (previously gated out).
        triggerSnapshotReadback(state, renderer, fakeAttribute, index, undefined, capture());
        expect(state.readbackPending).toBe(true);
        expect(state.pendingDirtySlots.size).toBe(0); // drained into the schedule
    });

    it('requeues drained slots when the readback fails', async () => {
        const state = createTerrainSnapshotState(MAX_NODES, 4, TOTAL_ELEMENTS);
        const rejecters: Array<(error: Error) => void> = [];
        const renderer = {
            getArrayBufferAsync: () =>
                new Promise<ArrayBuffer>((_resolve, reject) => {
                    rejecters.push(reject);
                }),
        } as unknown as WebGPURenderer;
        const index = makeIndex();

        triggerSnapshotReadback(state, renderer, fakeAttribute, index, undefined, capture([2]));
        expect(state.readbackPending).toBe(true);

        rejecters[0]!(new Error('device lost'));
        await flushMicrotasks();
        expect(state.readbackPending).toBe(false);
        // Slot 2's data never landed — it must be retried on the next schedule
        // (initial full-visible fetch also re-covers indexed slots).
        expect(state.pendingDirtySlots.has(2)).toBe(true);
    });

    it('drops out-of-range pending slots at schedule time, not merge time', () => {
        const state = createTerrainSnapshotState(MAX_NODES, 4, TOTAL_ELEMENTS);
        const { renderer } = makeRenderer();
        const index = makeIndex();

        // Slot 6 exceeds this capture's activeLeafCount (4): it must be
        // droppable at schedule time without poisoning the schedule.
        triggerSnapshotReadback(state, renderer, fakeAttribute, index, undefined, capture([6, 1]));
        expect(state.readbackPending).toBe(true);
        expect(state.pendingDirtySlots.size).toBe(0);
    });
});
