import { StorageBufferAttribute, type WebGPURenderer } from "three/webgpu";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSpatialIndex } from "../quadtree";
import { insertSpatialIndexRaw, lookupSpatialIndexRaw, resetSpatialIndex } from "../quadtree/spatialIndex";
import { createTerrainSnapshotState, disposeSnapshotReadback, triggerSnapshotReadback } from "./terrain-snapshot";

const MAX_NODES = 4;
const VERTICES_PER_NODE = 4;

/** A WebGPU renderer stand-in whose staging-buffer map fails with `error`. */
function rendererWithFailingMap(error: unknown): WebGPURenderer {
  const staging = {
    mapAsync: () => Promise.reject(error),
    destroy() {},
  };
  const device = {
    createBuffer: () => staging,
    createCommandEncoder: () => ({ copyBufferToBuffer() {}, finish: () => ({}) }),
    queue: { submit() {} },
  };
  const source = { size: MAX_NODES * VERTICES_PER_NODE * Float32Array.BYTES_PER_ELEMENT };
  return { backend: { device, get: () => ({ buffer: source }) } } as unknown as WebGPURenderer;
}

function scheduleReadback(renderer: WebGPURenderer) {
  const state = createTerrainSnapshotState(MAX_NODES, 4, MAX_NODES * VERTICES_PER_NODE);
  triggerSnapshotReadback(
    state,
    renderer,
    {} as StorageBufferAttribute,
    createSpatialIndex(MAX_NODES),
    undefined,
    {
      productionGeneration: 1,
      activeLeafCount: 1,
      totalElements: MAX_NODES * VERTICES_PER_NODE,
      verticesPerNode: VERTICES_PER_NODE,
      elevationScale: 1,
      originY: 0,
    },
  );
  return state;
}

describe("triggerSnapshotReadback", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Vitest fails the run on any unhandled rejection, which is what an aborted
  // readback produced before it was treated as an expected outcome.
  it("settles a readback aborted by disposal without an unhandled rejection", async () => {
    vi.stubGlobal("GPUBufferUsage", { COPY_DST: 0x8, MAP_READ: 0x1 });
    vi.stubGlobal("GPUMapMode", { READ: 0x1 });
    // What WebGPU raises when the staging buffer is destroyed mid-map.
    const aborted = new DOMException(
      "Buffer was destroyed before mapping was resolved.",
      "AbortError",
    );
    const state = scheduleReadback(rendererWithFailingMap(aborted));
    expect(state.readbackPending).toBe(true);

    await vi.waitFor(() => expect(state.readbackPending).toBe(false));
    expect(state.hasSnapshot).toBe(false);
  });
});

function snapshotFixture(deferred = false) {
  const state = createTerrainSnapshotState(MAX_NODES, 4, MAX_NODES * VERTICES_PER_NODE);
  const index = createSpatialIndex(MAX_NODES);
  insertSpatialIndexRaw(index, 0, 1, 0, 0, 0);
  insertSpatialIndexRaw(index, 0, 1, 1, 0, 1);
  const elevation = new StorageBufferAttribute(new Float32Array(16), 1);
  const bounds = new StorageBufferAttribute(new Float32Array([
    0, 10, -1, 11, 20, 30, 19, 31, 0, 0, 0, 0, 0, 0, 0, 0,
  ]), 1);
  const pending: Array<() => void> = [];
  const renderer = {
    getArrayBufferAsync(attribute: StorageBufferAttribute) {
      const copy = attribute.array.slice().buffer;
      return deferred
        ? new Promise<ArrayBuffer>((resolve) => pending.push(() => resolve(copy)))
        : Promise.resolve(copy);
    },
  } as unknown as WebGPURenderer;
  const schedule = (productionGeneration: number, source = elevation) => triggerSnapshotReadback(
    state, renderer, source, index, bounds,
    { productionGeneration, activeLeafCount: 2, totalElements: 16, verticesPerNode: 4, elevationScale: 1, originY: 0 },
  );
  const complete = async () => {
    pending.splice(0).forEach((resolve) => resolve());
    await vi.waitFor(() => expect(state.readbackPending).toBe(false));
  };
  return { state, index, elevation, bounds, schedule, complete };
}

describe("snapshot production and LOD bounds", () => {
  it("publishes new production without dirtying identical leaf-keyed LOD ranges", async () => {
    const f = snapshotFixture();
    f.schedule(1);
    await f.complete();
    expect(f.state.boundsGeneration).toBe(1);
    f.schedule(1);
    expect(f.state.readbackPending).toBe(false);
    expect(f.state.generation).toBe(1);

    // Elevation/controls may change without changing their conservative bounds.
    f.elevation.array[1] = 4;
    f.schedule(2);
    await f.complete();
    expect(f.state.frontElevation[1]).toBe(4);
    expect(f.state.generation).toBe(2);
    expect(f.state.boundsGeneration).toBe(1);

    // Storage-slot reorder is not a change to the ranges associated with tiles.
    resetSpatialIndex(f.index);
    insertSpatialIndexRaw(f.index, 0, 1, 0, 0, 1);
    insertSpatialIndexRaw(f.index, 0, 1, 1, 0, 0);
    f.bounds.array.set([20, 30, 19, 31, 0, 10, -1, 11]);
    f.schedule(3);
    await f.complete();
    expect(lookupSpatialIndexRaw(f.state.frontIndex, 0, 1, 0, 0)).toBe(1);
    expect(f.state.boundsGeneration).toBe(1);
    disposeSnapshotReadback(f.state);
  });

  it("does not lose a newer production requested while the previous map is pending", async () => {
    const f = snapshotFixture(true);
    f.elevation.array[0] = 7;
    f.schedule(1);
    resetSpatialIndex(f.index);
    insertSpatialIndexRaw(f.index, 0, 1, 2, 0, 0);
    insertSpatialIndexRaw(f.index, 0, 1, 3, 0, 1);
    f.elevation.array[0] = 21;
    f.bounds.array[1] = 25;
    f.schedule(2);
    await f.complete();
    expect(f.state.frontElevation[0]).toBe(7);
    expect(lookupSpatialIndexRaw(f.state.frontIndex, 0, 1, 0, 0)).toBe(0);

    // The next graph run can schedule generation 2; the blocked call did not
    // acknowledge it or replace the in-flight spatial-index snapshot.
    f.schedule(2);
    await f.complete();
    expect(f.state.frontElevation[0]).toBe(21);
    expect(f.state.frontTileBounds[1]).toBe(25);
    expect(lookupSpatialIndexRaw(f.state.frontIndex, 0, 1, 2, 0)).toBe(0);
    expect(f.state.boundsGeneration).toBe(2);
    disposeSnapshotReadback(f.state);
  });

  it("publishes zero bounds and accepts a recreated producer's restarted generation", async () => {
    const f = snapshotFixture();
    f.schedule(1);
    await f.complete();
    f.bounds.array.fill(0);
    f.schedule(2);
    await f.complete();
    expect(f.state.globalRange).toEqual({ min: 0, max: 0 });
    expect(f.state.boundsGeneration).toBe(2);
    const replacement = new StorageBufferAttribute(new Float32Array(16).fill(5), 1);
    f.bounds.array.set([5, 5, 5, 5, 5, 5, 5, 5]);
    f.schedule(2, replacement);
    await f.complete();
    expect(f.state.frontElevation[0]).toBe(5);
    expect(f.state.globalRange).toEqual({ min: 5, max: 5 });
    expect(f.state.boundsGeneration).toBe(3);
    disposeSnapshotReadback(f.state);
  });

  it("cannot publish a late map after disposal or contaminate a replacement cache", async () => {
    const retired = snapshotFixture(true);
    retired.schedule(1);
    disposeSnapshotReadback(retired.state);
    await retired.complete();
    expect(retired.state.hasSnapshot).toBe(false);
    expect(retired.state.boundsGeneration).toBe(0);
    const replacement = snapshotFixture();
    replacement.schedule(1);
    await replacement.complete();
    expect(replacement.state.globalRange).toEqual({ min: 0, max: 30 });
    expect(replacement.state.boundsGeneration).toBe(1);
    disposeSnapshotReadback(replacement.state);
  });
});
