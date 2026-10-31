import type { StorageBufferAttribute, WebGPURenderer } from "three/webgpu";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSpatialIndex } from "../quadtree";
import { createTerrainSnapshotState, triggerSnapshotReadback } from "./terrain-snapshot";

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
