import { expect, it, vi } from "vitest";
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
