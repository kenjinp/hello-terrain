import type { StorageBufferAttribute, WebGPURenderer } from "three/webgpu";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSpatialIndex, insertSpatialIndexRaw } from "../quadtree/spatialIndex";
import { createTerrainSnapshotState, triggerSnapshotReadback } from "./terrain-snapshot";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("triggerSnapshotReadback", () => {
  const maxNodes = 4;
  const maxLevel = 4;
  const innerTileSegments = 2;
  const edge = innerTileSegments + 3;
  const verticesPerNode = edge * edge;
  const totalElements = maxNodes * verticesPerNode;
  const attribute = {} as unknown as StorageBufferAttribute;

  const captured = {
    activeLeafCount: 1,
    totalElements,
    verticesPerNode,
    elevationScale: 1,
    originY: 0,
  };

  function seededIndex() {
    const index = createSpatialIndex(maxNodes);
    insertSpatialIndexRaw(index, 0, 0, 0, 0, 0);
    return index;
  }

  /** Fallback-path renderer (no WebGPU backend) whose readback is controllable. */
  function fakeRenderer(getArrayBufferAsync: () => Promise<ArrayBuffer>) {
    return { getArrayBufferAsync } as unknown as WebGPURenderer;
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns true when scheduled and false while pending or unchanged", async () => {
    const state = createTerrainSnapshotState(maxNodes, maxLevel, totalElements);
    const index = seededIndex();
    const elevation = new Float32Array(totalElements).fill(7);
    const renderer = fakeRenderer(async () => elevation.buffer);

    expect(triggerSnapshotReadback(state, renderer, attribute, index, undefined, captured)).toBe(
      true,
    );
    expect(state.readbackPending).toBe(true);
    // Already pending → not scheduled.
    expect(triggerSnapshotReadback(state, renderer, attribute, index, undefined, captured)).toBe(
      false,
    );

    await flush();
    expect(state.readbackPending).toBe(false);
    expect(state.hasSnapshot).toBe(true);
    expect(state.frontElevation[0]).toBe(7);

    // Same spatial-index generation → nothing new to read.
    expect(triggerSnapshotReadback(state, renderer, attribute, index, undefined, captured)).toBe(
      false,
    );
  });

  it("returns false when the renderer cannot read back", () => {
    const state = createTerrainSnapshotState(maxNodes, maxLevel, totalElements);
    const renderer = {} as unknown as WebGPURenderer;
    expect(
      triggerSnapshotReadback(state, renderer, attribute, seededIndex(), undefined, captured),
    ).toBe(false);
    expect(state.readbackPending).toBe(false);
  });

  it("recovers from a failed readback without swapping buffers", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const state = createTerrainSnapshotState(maxNodes, maxLevel, totalElements);
    const index = seededIndex();
    const renderer = fakeRenderer(() => Promise.reject(new Error("device lost")));

    expect(triggerSnapshotReadback(state, renderer, attribute, index, undefined, captured)).toBe(
      true,
    );
    expect(state.readbackPending).toBe(true);

    await flush();

    expect(state.readbackPending).toBe(false);
    expect(state.hasSnapshot).toBe(false);
    expect(state.generation).toBe(0);
    expect(errorSpy).toHaveBeenCalledTimes(1);

    // Same index generation, but the failure must allow a retry.
    expect(triggerSnapshotReadback(state, renderer, attribute, index, undefined, captured)).toBe(
      true,
    );
    await flush();
    expect(state.readbackPending).toBe(false);
    expect(state.hasSnapshot).toBe(false);
    // Identical error message is reported only once.
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("reports each distinct failure message once, then succeeds", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const state = createTerrainSnapshotState(maxNodes, maxLevel, totalElements);
    const index = seededIndex();
    const elevation = new Float32Array(totalElements).fill(3);

    let attempt = 0;
    const renderer = fakeRenderer(() => {
      attempt += 1;
      if (attempt === 1) return Promise.reject(new Error("first"));
      if (attempt === 2) return Promise.reject(new Error("second"));
      return Promise.resolve(elevation.buffer);
    });

    triggerSnapshotReadback(state, renderer, attribute, index, undefined, captured);
    await flush();
    triggerSnapshotReadback(state, renderer, attribute, index, undefined, captured);
    await flush();
    expect(errorSpy).toHaveBeenCalledTimes(2);
    expect(state.hasSnapshot).toBe(false);

    expect(triggerSnapshotReadback(state, renderer, attribute, index, undefined, captured)).toBe(
      true,
    );
    await flush();
    expect(state.readbackPending).toBe(false);
    expect(state.hasSnapshot).toBe(true);
    expect(state.frontElevation[0]).toBe(3);
  });

  it("handles a rejected bounds readback on the Promise.all path", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const state = createTerrainSnapshotState(maxNodes, maxLevel, totalElements);
    const index = seededIndex();
    const elevation = new Float32Array(totalElements);
    const boundsAttribute = { isBounds: true } as unknown as StorageBufferAttribute;

    const renderer = {
      getArrayBufferAsync: (attr: StorageBufferAttribute) =>
        attr === boundsAttribute
          ? Promise.reject(new Error("bounds failed"))
          : Promise.resolve(elevation.buffer),
    } as unknown as WebGPURenderer;

    expect(
      triggerSnapshotReadback(state, renderer, attribute, index, boundsAttribute, captured),
    ).toBe(true);
    await flush();

    expect(state.readbackPending).toBe(false);
    expect(state.hasSnapshot).toBe(false);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(
      triggerSnapshotReadback(state, renderer, attribute, index, boundsAttribute, captured),
    ).toBe(true);
  });
});
