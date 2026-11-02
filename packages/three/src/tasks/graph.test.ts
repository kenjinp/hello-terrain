import { task } from "@hello-terrain/work";
import { StorageBufferAttribute, type WebGPURenderer } from "three/webgpu";
import { describe, expect, it, vi } from "vitest";
import { terrainGraph, terrainTasks } from "./graph";
import { innerTileSegments, maxLevel, maxNodes, quadtreeUpdate, rootSize } from "./params";

async function terrainFixture() {
  const graph = terrainGraph();
  graph.set(rootSize, 240).set(maxNodes, 128).set(maxLevel, 5).set(innerTileSegments, 2);
  graph.set(quadtreeUpdate, { cameraOrigin: { x: 55, y: 15, z: 0 }, mode: "distance", distanceFactor: 1.5 });
  const renderer = {
    getArrayBufferAsync: async (attribute: StorageBufferAttribute) => attribute.array.slice().buffer,
  } as unknown as WebGPURenderer;
  const resources = { renderer };
  const run = () => graph.run({ targets: [terrainTasks.leafGpuBuffer], resources });
  await run();
  const elevation = new StorageBufferAttribute(new Float32Array(256 * 25), 1);
  const bounds = new StorageBufferAttribute(new Float32Array(256 * 4), 1);
  let production = 0;
  const publish = async (height: number) => {
    const cache = graph.get(terrainTasks.terrainQuery).cache;
    const before = cache.generation;
    elevation.array.fill(height);
    bounds.array.fill(height);
    cache.triggerReadback(
      renderer, elevation, graph.get(terrainTasks.quadtreeConfig).state.leafIndex,
      ++production, bounds, graph.get(terrainTasks.quadtreeUpdate).count,
    );
    await vi.waitFor(() => expect(cache.generation).toBe(before + 1));
    return cache;
  };
  return { graph, resources, run, publish };
}

describe("terrain graph bounds invalidation", () => {
  it("settles stationary LOD from published bounds without continued geometry updates", async () => {
    const f = await terrainFixture();
    try {
      const initial = f.graph.get(terrainTasks.leafGpuBuffer);
      await f.publish(100);
      await f.run();
      const elevated = f.graph.get(terrainTasks.leafGpuBuffer);
      // A plane 85 units above the stationary camera needs less refinement than
      // the initial undisplaced surface only 15 units below it.
      expect(elevated.count).toBeLessThan(initial.count);
      await f.publish(100);
      await f.run();
      const settled = f.graph.get(terrainTasks.leafGpuBuffer);
      expect(settled.count).toBe(elevated.count);
      const cache = await f.publish(100);
      const boundsGeneration = cache.boundsGeneration;
      await f.run();
      await f.run();
      expect(f.graph.get(terrainTasks.leafGpuBuffer)).toBe(settled);
      expect(cache.boundsGeneration).toBe(boundsGeneration);
      expect(cache.sampleTerrain(55, 0)).toMatchObject({ valid: true, elevation: 100 });
    } finally {
      f.graph.dispose();
    }
  });

  it("does not acknowledge bounds that arrive after a graph run has started", async () => {
    const f = await terrainFixture();
    try {
      const initialCount = f.graph.get(terrainTasks.leafGpuBuffer).count;
      let release!: () => void;
      let started!: () => void;
      const entered = new Promise<void>((resolve) => { started = resolve; });
      const pending = new Promise<void>((resolve) => { release = resolve; });
      const gate = task((get, work) => {
        get(terrainTasks.leafGpuBuffer);
        return work(async () => { started(); await pending; });
      });
      f.graph.add(gate);
      const running = f.graph.run({ targets: [gate], resources: f.resources });
      await entered;
      await f.publish(100);
      release();
      await running;
      await f.run();
      expect(f.graph.get(terrainTasks.leafGpuBuffer).count).toBeLessThan(initialCount);
      expect(f.graph.get(terrainTasks.terrainQuery).cache.sampleTerrain(55, 0).elevation).toBe(100);
    } finally {
      f.graph.dispose();
    }
  });

  it("tracks replacement caches independently and leaves disposed graphs empty", async () => {
    const f = await terrainFixture();
    const firstCache = await f.publish(100);
    await f.run();
    expect(firstCache.boundsGeneration).toBe(1);
    f.graph.set(maxNodes, 256);
    await f.run();
    const undisplaced = f.graph.get(terrainTasks.leafGpuBuffer).count;
    const replacement = await f.publish(100);
    expect(replacement).not.toBe(firstCache);
    expect(replacement.boundsGeneration).toBe(1);
    await f.run();
    expect(f.graph.get(terrainTasks.leafGpuBuffer).count).toBeLessThan(undisplaced);
    f.graph.dispose();
    await f.graph.run({ resources: f.resources });
    expect(f.graph.inspect().nodes).toEqual([]);

    const recreated = await terrainFixture();
    try {
      const initial = recreated.graph.get(terrainTasks.leafGpuBuffer).count;
      await recreated.publish(100);
      await recreated.run();
      expect(recreated.graph.get(terrainTasks.leafGpuBuffer).count).toBeLessThan(initial);
    } finally {
      recreated.graph.dispose();
    }
  });
});
