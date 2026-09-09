import { describe, expect, it, vi } from "vitest";
import type { StorageBufferAttribute } from "three/webgpu";
import { createSpatialIndex, insertSpatialIndexRaw } from "../quadtree/spatialIndex";
import { createCpuTerrainCache } from "./cpu-terrain-cache";

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
