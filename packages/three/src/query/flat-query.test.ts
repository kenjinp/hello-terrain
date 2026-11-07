import { describe, expect, it, vi } from "vitest";
import type { StorageBufferAttribute } from "three/webgpu";
import { createSpatialIndex, insertSpatialIndexRaw } from "../quadtree/spatialIndex";
import { createCpuTerrainCache } from "./cpu-terrain-cache";
import { createTerrainSnapshotState } from "./terrain-snapshot";

describe("analytic flat query snapshots", () => {
  it("samples a linear field at the same texel centers as the GPU and refreshes stationary content", async () => {
    const segments = 4,
      edge = segments + 3,
      rootSize = 16;
    const cache = createCpuTerrainCache(1, {
      rootSize,
      originX: 0,
      originY: 0,
      originZ: 0,
      innerTileSegments: segments,
      elevationScale: 1,
      maxLevel: 0,
      radius: 1,
    });
    const index = createSpatialIndex(1);
    insertSpatialIndexRaw(index, 0, 0, 0, 0, 0);
    const field = (offset: number) =>
      Float32Array.from({ length: edge * edge }, (_, i) => {
        const x = (((i % edge) - 1) * rootSize) / segments - rootSize / 2;
        const z = ((Math.floor(i / edge) - 1) * rootSize) / segments - rootSize / 2;
        return offset + x * 0.25 - z * 0.5;
      });
    let buffer = field(2).buffer;
    const getArrayBufferAsync = vi.fn(async () => buffer);
    const renderer = { getArrayBufferAsync } as unknown as Parameters<
      typeof cache.triggerReadback
    >[0];
    const attribute = {} as StorageBufferAttribute;
    const firstProducer = {};
    cache.triggerReadback(renderer, attribute, index, undefined, 1, firstProducer);
    await vi.waitFor(() => expect(cache.ready).toBe(true));
    for (const [x, z] of [
      [0, 0],
      [-7, -7],
      [3.125, -1.75],
      [7.9, 5.1],
    ]) {
      expect(cache.getElevation(x, z)).toBeCloseTo(2 + x * 0.25 - z * 0.5, 6);
    }
    cache.triggerReadback(renderer, attribute, index, undefined, 1, firstProducer);
    expect(getArrayBufferAsync).toHaveBeenCalledTimes(1);
    buffer = field(7).buffer;
    cache.triggerReadback(renderer, attribute, index, undefined, 1, {});
    await vi.waitFor(() => expect(cache.generation).toBe(2));
    expect(cache.getElevation(0, 0)).toBe(7);
    cache.dispose();
  });
});


it("copies only active snapshot samples while retaining independent query and readback capacity", async () => {
  const maxNodes = 8, segments = 4, vertices = (segments + 3) ** 2;
  const state = createTerrainSnapshotState(maxNodes, 0, maxNodes * vertices);
  state.frontElevation.fill(2);
  state.frontLeafCount = 1;
  state.hasSnapshot = true;
  state.generation = 1;
  insertSpatialIndexRaw(state.frontIndex, 0, 0, 0, 0, 0);
  const set = vi.spyOn(Float32Array.prototype, "set");
  const cache = createCpuTerrainCache(maxNodes, {
    rootSize: 16, originX: 0, originY: 0, originZ: 0,
    innerTileSegments: segments, elevationScale: 1, maxLevel: 0, radius: 1,
  }, null, state);
  const destinations = set.mock.contexts.map(value => (value as Float32Array).length);
  const copied = set.mock.calls.filter(([source]) =>
    source instanceof Float32Array && source.buffer === state.frontElevation.buffer);
  set.mockRestore();
  expect(copied).toHaveLength(1);
  expect(copied[0][0]).toHaveLength(vertices);
  expect(destinations[0]).toBe(vertices);
  state.frontElevation.fill(9);
  expect(cache.getElevation(0, 0)).toBe(2);
  const data = new Float32Array(maxNodes * vertices).fill(7);
  const renderer = { getArrayBufferAsync: async () => data.buffer } as unknown as Parameters<typeof cache.triggerReadback>[0];
  cache.triggerReadback(renderer, {} as StorageBufferAttribute, state.frontIndex, undefined, 1, {});
  await cache.pending;
  expect(cache.getElevation(0, 0)).toBe(7);
  expect(state.frontElevation[0]).toBe(9);
  cache.dispose();
});


it("keeps compact captured queries intact after a failed expanded readback", async () => {
  const vertices = 49, maxNodes = 8;
  const source = createTerrainSnapshotState(maxNodes, 0, maxNodes * vertices);
  source.frontElevation.fill(3);
  source.frontLeafCount = 1;
  source.hasSnapshot = true;
  insertSpatialIndexRaw(source.frontIndex, 0, 0, 0, 0, 0);
  const cache = createCpuTerrainCache(maxNodes, {
    rootSize: 16, originX: 0, originY: 0, originZ: 0,
    innerTileSegments: 4, elevationScale: 1, maxLevel: 0, radius: 1,
  }, null, source);
  const captured = cache.capture();
  const failure = new Error("readback failed");
  const renderer = { getArrayBufferAsync: async () => { throw failure; } } as unknown as Parameters<typeof cache.triggerReadback>[0];
  cache.triggerReadback(renderer, {} as StorageBufferAttribute, source.frontIndex, undefined, maxNodes, {});
  await cache.pending;
  expect(cache.lastError).toBe(failure);
  expect(cache.getElevation(0, 0)).toBe(3);
  expect(captured.getElevation(0, 0)).toBe(3);
  cache.dispose();
  expect(captured.getElevation(0, 0)).toBe(3);
  captured.dispose();
});
