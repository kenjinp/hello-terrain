import { afterEach, expect, it, vi } from "vitest";
import * as readback from "../gpu/bufferReadback";
afterEach(() => vi.restoreAllMocks());
import type { StorageBufferAttribute, WebGPURenderer } from "three/webgpu";
import { createSpatialIndex } from "../quadtree";
import {
  createTerrainSnapshotState,
  disposeSnapshotReadback,
  triggerSnapshotReadback,
} from "./terrain-snapshot";

function fixture() {
  const state = createTerrainSnapshotState(1, 0, 1);
  const pending: { resolve: (value: ArrayBuffer) => void; reject: (error: Error) => void }[] = [];
  const read = vi.fn(
    () => new Promise<ArrayBuffer>((resolve, reject) => pending.push({ resolve, reject })),
  );
  const renderer = { getArrayBufferAsync: read } as unknown as WebGPURenderer;
  const index = createSpatialIndex(1);
  const trigger = (contentKey: object) =>
    triggerSnapshotReadback(state, renderer, {} as StorageBufferAttribute, index, undefined, {
      activeLeafCount: 1,
      totalElements: 1,
      verticesPerNode: 1,
      elevationScale: 1,
      originY: 0,
      contentKey,
    });
  return { state, pending, read, trigger };
}

it("serializes delayed snapshots and eventually publishes stationary replacement content", async () => {
  const { state, pending, read, trigger } = fixture();
  const first = {},
    replacement = {};
  trigger(first);
  trigger(replacement);
  expect(read).toHaveBeenCalledTimes(1);
  pending[0].resolve(new Float32Array([2]).buffer);
  await vi.waitFor(() => expect(state.readbackPending).toBe(false));
  expect(state.frontElevation[0]).toBe(2);
  trigger(replacement);
  pending[1].resolve(new Float32Array([7]).buffer);
  await vi.waitFor(() => expect(state.generation).toBe(2));
  expect(state.frontElevation[0]).toBe(7);
  trigger(replacement);
  expect(read).toHaveBeenCalledTimes(2);
});

it("does not publish or schedule snapshots after disposal during readback", async () => {
  const { state, pending, read, trigger } = fixture();
  trigger({});
  disposeSnapshotReadback(state);
  pending[0].resolve(new Float32Array([2]).buffer);
  await vi.waitFor(() => expect(state.readbackPending).toBe(false));
  expect(state.hasSnapshot).toBe(false);
  expect(state.generation).toBe(0);
  trigger({});
  expect(read).toHaveBeenCalledTimes(1);
});

it("retries unchanged content after a rejected readback", async () => {
  const { state, pending, read, trigger } = fixture();
  const key = {};
  trigger(key);
  pending[0].reject(new Error("simulated mapping rejection"));
  await vi.waitFor(() => expect(state.readbackPending).toBe(false));
  trigger(key);
  expect(read).toHaveBeenCalledTimes(2);
  pending[1].resolve(new Float32Array([7]).buffer);
  await vi.waitFor(() => expect(state.generation).toBe(1));
});

it("submits elevation and zero-valued bounds copies together before either resolves", async () => {
  const { state, read, pending } = fixture();
  triggerSnapshotReadback(state, { getArrayBufferAsync: read } as unknown as WebGPURenderer,
    {} as StorageBufferAttribute, createSpatialIndex(1), {} as StorageBufferAttribute,
    { activeLeafCount: 1, totalElements: 1, verticesPerNode: 1, elevationScale: 1, originY: 0 });
  expect(read).toHaveBeenCalledTimes(2);
  pending[1].resolve(new Float32Array(4).buffer);
  await Promise.resolve(); expect(state.hasSnapshot).toBe(false);
  pending[0].resolve(new Float32Array([0]).buffer); await state.pending;
  expect(state.hasSnapshot).toBe(true); expect(state.globalRange).toEqual({ min: 0, max: 0 });
});


function dirtyTailFixture() {
  const state = createTerrainSnapshotState(8, 0, 8);
  const index = createSpatialIndex(8);
  const renderer = {} as WebGPURenderer;
  const elevation = {} as StorageBufferAttribute;
  const bounds = {} as StorageBufferAttribute;
  const capability = vi.spyOn(readback, "canDeviceReadback").mockReturnValue(true);
  const batch = vi.spyOn(readback, "readStorageBuffersInto").mockImplementation(async (_, requests) => {
    for (const request of requests) request.target.fill(7, 0, request.elementCount);
    return true;
  });
  const trigger = (count: number, withBounds = true) => {
    triggerSnapshotReadback(state, renderer, elevation, index, withBounds ? bounds : undefined, {
      activeLeafCount: count, totalElements: 8, verticesPerNode: 1,
      elevationScale: 1, originY: 0, contentKey: {},
    });
    return state.pending;
  };
  return { state, trigger, batch, capability, renderer };
}

it("clears only stale tails for each physical buffer across grow/shrink swaps", async () => {
  const f = dirtyTailFixture();
  const first = f.state.backElevation;
  const second = f.state.frontElevation;
  const fillFirst = vi.spyOn(first, "fill");
  const fillSecond = vi.spyOn(second, "fill");
  await f.trigger(6);
  await f.trigger(2);
  fillFirst.mockClear();
  await f.trigger(3);
  // First buffer previously held six values, regardless of last frame's two.
  expect(fillFirst.mock.calls).toEqual([[0, 3, 6], [7, 0, 3]]);
  expect([...f.state.frontElevation]).toEqual([7, 7, 7, 0, 0, 0, 0, 0]);
  expect([...f.state.frontTileBounds]).toEqual([...Array.from({ length: 12 }, () => 7), ...Array.from({ length: 20 }, () => 0)]);
  fillSecond.mockClear();
  await f.trigger(5);
  expect(fillSecond.mock.calls).toEqual([[7, 0, 5]]);
  expect([...f.state.frontElevation]).toEqual([7, 7, 7, 7, 7, 0, 0, 0]);
  await f.trigger(0);
  expect([...f.state.frontElevation]).toEqual(Array.from({ length: 8 }, () => 0));
  expect([...f.state.frontTileBounds]).toEqual(Array.from({ length: 32 }, () => 0));
});

it("clears partial writes after failed batched readback without changing the published snapshot", async () => {
  const f = dirtyTailFixture();
  await f.trigger(2);
  const published = f.state.frontElevation;
  f.batch.mockImplementationOnce(async (_, requests) => {
    requests[0].target.fill(9, 0, requests[0].elementCount);
    throw new Error("second map failed");
  });
  await f.trigger(7);
  expect(f.state.frontElevation).toBe(published);
  expect(f.state.generation).toBe(1);
  await f.trigger(1);
  expect([...f.state.frontElevation]).toEqual([7, 0, 0, 0, 0, 0, 0, 0]);
  expect([...f.state.frontTileBounds]).toEqual([7, 7, 7, 7, ...Array.from({ length: 28 }, () => 0)]);
});

it("tracks bounds independently when optional bounds prevent a front/back swap", async () => {
  const f = dirtyTailFixture();
  await f.trigger(5);
  await f.trigger(4);
  await f.trigger(2, false);
  expect([...f.state.backTileBounds]).toEqual(Array.from({ length: 32 }, () => 0));
  await f.trigger(1);
  expect([...f.state.frontTileBounds]).toEqual([7, 7, 7, 7, ...Array.from({ length: 28 }, () => 0)]);
  expect(f.state.globalRange).toEqual({ min: 7, max: 7 });
});

it("tracks full fallback results before reusing their arrays for active-only device readback", async () => {
  const f = dirtyTailFixture();
  f.capability.mockReturnValue(false);
  Object.assign(f.renderer, { getArrayBufferAsync: vi.fn(async () => new Float32Array(8).fill(9).buffer) });
  await f.trigger(1, false);
  expect([...f.state.frontElevation]).toEqual(Array.from({ length: 8 }, () => 9));
  f.capability.mockReturnValue(true);
  await f.trigger(2, false);
  await f.trigger(1, false);
  expect([...f.state.frontElevation]).toEqual([7, 0, 0, 0, 0, 0, 0, 0]);
});

it("handles later replacement arrays conservatively and retains full-capacity readback", async () => {
  const f = dirtyTailFixture();
  await f.trigger(2);
  f.state.backElevation = new Float32Array(8).fill(9);
  await f.trigger(1);
  expect([...f.state.frontElevation]).toEqual([7, 0, 0, 0, 0, 0, 0, 0]);
  await f.trigger(8);
  expect([...f.state.frontElevation]).toEqual(Array.from({ length: 8 }, () => 7));
  expect(f.state.frontElevation.length).toBe(8);
});
