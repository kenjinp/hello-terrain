import { Ray, Vector3 } from "three";
import { StorageBufferAttribute, type WebGPURenderer } from "three/webgpu";
import { describe, expect, it } from "vitest";
import { createCubeSphereProjection } from "../projection/cubeSphere";
import { createFlatProjection } from "../projection/flat";
import { createSpatialIndex, insertSpatialIndexRaw } from "../quadtree/spatialIndex";
import { packTextureControl } from "../texture/control";
import type { TerrainHoleMode } from "../texture/texture-hole";
import { createCpuTerrainCache } from "./cpu-terrain-cache";
import { cpuRaycast, cubeSphereRaycast } from "./cpu-raycast";

async function settleReadback() {
  // Drain the resolved source reads, Promise.all promotion, and pending-flag cleanup.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function terrain(sphere: boolean, readback = true, holes: TerrainHoleMode = "discard") {
  const edge = 5, maxNodes = 8, count = sphere ? 6 : 1;
  const projection = sphere ? createCubeSphereProjection({ radius: 10 }) : createFlatProjection();
  const cache = createCpuTerrainCache(maxNodes, {
    rootSize: 20, originX: 0, originY: 0, originZ: 0, innerTileSegments: 2,
    elevationScale: 1, maxLevel: 4, radius: 10, textureEnabled: true, textureReadback: readback, holes,
  }, projection.cpu.createSurfaceOps());
  const index = createSpatialIndex(maxNodes);
  for (let face = 0; face < count; face++) insertSpatialIndexRaw(index, face, 0, 0, 0, face);
  const elevation = new StorageBufferAttribute(new Float32Array(maxNodes * edge * edge), 1);
  const words = new Uint32Array(maxNodes * edge * edge).fill(packTextureControl({ base: 31, overlay: 17, blend: 0.25 }));
  words.fill(packTextureControl({ base: 31, hole: true }), sphere ? 4 * edge * edge : 0, sphere ? 5 * edge * edge : edge * edge);
  const controls = new StorageBufferAttribute(words, 1);
  const renderer = { getArrayBufferAsync: async (attribute: StorageBufferAttribute) => attribute.array.buffer } as unknown as WebGPURenderer;
  cache.triggerReadback(renderer, elevation, index, undefined, count, readback ? controls : undefined);
  await settleReadback();
  return { cache, runtime: projection.cpu.createRuntimeQueries(cache), words, controls, elevation, renderer, index, count };
}

describe("texture control query snapshots", () => {
  it("preserves high-bit controls and pairs holes with elevation and batch validity", async () => {
    const { cache } = await terrain(false);
    expect(cache.sampleTerrain(0, 0)).toMatchObject({ valid: false, hole: true, textureBase: 31, textureControl: packTextureControl({ base: 31, hole: true }) });
    expect(cache.getElevation(0, 0)).toBeNull();
    expect(cache.getNormal(0, 0)).toBeNull();
    const batch = cache.sampleTerrainBatch(new Float32Array([0, 0]));
    expect([...batch.valid]).toEqual([0]);
    expect([...batch.holes!]).toEqual([1]);
    expect(batch.textureControls![0]).toBe(packTextureControl({ base: 31, hole: true }));
    cache.dispose();
  });

  it("reports unknown holes when readback is disabled and leaves geometric queries usable", async () => {
    const { cache } = await terrain(false, false);
    expect(cache.sampleTerrain(0, 0)).toMatchObject({ valid: true, hole: null, textureControl: null });
    expect(cache.getElevation(0, 0)).toBe(0);
    expect(cache.sampleTerrainBatch(new Float32Array([0, 0])).holes).toBeNull();
    cache.dispose();
  });

  it("reports no holes without readback when hole rendering is explicitly disabled", async () => {
    const { cache } = await terrain(false, false, "none");
    expect(cache.sampleTerrain(0, 0)).toMatchObject({ valid: true, hole: false, textureControl: null });
    cache.dispose();
  });

  it("refreshes authored control changes without requiring a quadtree generation change", async () => {
    const state = await terrain(false);
    state.words.fill(packTextureControl({ base: 2 }));
    state.cache.triggerReadback(state.renderer, state.elevation, state.index, undefined, state.count, state.controls);
    await settleReadback();
    expect(state.cache.sampleTerrain(0, 0)).toMatchObject({ valid: true, hole: false, textureBase: 2 });
    state.cache.dispose();
  });

  it("passes through a front hemisphere hole and hits the solid rear surface", async () => {
    const { cache, runtime } = await terrain(true);
    const hit = cubeSphereRaycast(runtime.sphereQuery!, new Ray(new Vector3(0, 0, 30), new Vector3(0, 0, -1)), {
      radius: 10, maxRadius: 11, centerX: 0, centerY: 0, centerZ: 0,
    });
    expect(hit?.position.z).toBeCloseTo(-10, 3);
    expect(hit?.distance).toBeCloseTo(40, 3);
    cache.dispose();
  });

  it("does not produce a flat ray hit inside a hole", async () => {
    const { cache, runtime } = await terrain(false);
    const hit = cpuRaycast(runtime.query, new Ray(new Vector3(0, 10, 0), new Vector3(0, -1, 0)), {
      rootSize: 20, originX: 0, originY: 0, originZ: 0, minY: -1, maxY: 1, centerX: 0, centerY: 0, centerZ: 0,
    });
    expect(hit).toBeNull();
    cache.dispose();
  });
});
