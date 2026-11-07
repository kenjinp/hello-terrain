import { afterEach, expect, it, vi } from "vitest";
import type { StorageBufferAttribute, WebGPURenderer } from "three/webgpu";
import { createReadbackSlot, disposeReadbackSlot, readStorageBufferInto, readStorageBuffersInto } from "./bufferReadback";
import { createTerrainSnapshotState, disposeSnapshotReadback, triggerSnapshotReadback } from "../query/terrain-snapshot";
import { createSpatialIndex } from "../quadtree";

afterEach(() => vi.unstubAllGlobals());

function fixture() {
  vi.stubGlobal("GPUBufferUsage", { COPY_DST: 8, MAP_READ: 1 });
  vi.stubGlobal("GPUMapMode", { READ: 1 });
  const mappings: Promise<void>[] = [];
  function buffer(size: number) {
    const data = new ArrayBuffer(size);
    return {
      size, data,
      destroy: vi.fn(), unmap: vi.fn(),
      mapAsync: vi.fn(() => mappings.shift() ?? Promise.resolve()),
      getMappedRange: vi.fn((offset: number, length: number) => data.slice(offset, offset + length)),
    };
  }
  type Buffer = ReturnType<typeof buffer>;
  type Copy = { source: Buffer; start: number; target: Buffer; offset: number; size: number };
  const sources = new Map<StorageBufferAttribute, { buffer: Buffer }>();
  const copyBufferToBuffer = vi.fn();
  const device = {
    limits: { maxBufferSize: 256 * 1024 * 1024 },
    createBuffer: vi.fn(({ size }: { size: number }) => buffer(size)),
    createCommandEncoder: vi.fn(() => {
      const copies: Copy[] = [];
      return {
        copyBufferToBuffer(source: Buffer, start: number, target: Buffer, offset: number, size: number) {
          copyBufferToBuffer(source, start, target, offset, size);
          copies.push({ source, start, target, offset, size });
        },
        finish: () => copies,
      };
    }),
    queue: { submit: vi.fn((commands: Copy[][]) => {
      for (const command of commands) for (const copy of command) {
        new Uint8Array(copy.target.data, copy.offset, copy.size)
          .set(new Uint8Array(copy.source.data, copy.start, copy.size));
      }
    }) },
  };
  const renderer = { backend: { device, get: (attribute: StorageBufferAttribute) => sources.get(attribute) } } as unknown as WebGPURenderer;
  function source(values: number[]) {
    const attribute = {} as StorageBufferAttribute;
    const gpu = buffer(values.length * 4);
    new Float32Array(gpu.data).set(values);
    sources.set(attribute, { buffer: gpu });
    return attribute;
  }
  return { renderer, source, device, sources, mappings, copyBufferToBuffer };
}

it("batches active regions with compact float offsets, one submission and one map", async () => {
  const f = fixture();
  const slot = createReadbackSlot();
  const a = f.source([1, 2, 3, 4, 5, 6]);
  const b = f.source([7, 8, 9, 10]);
  const first = new Float32Array([99, 99, 99, 99]);
  const second = new Float32Array(4);
  expect(await readStorageBuffersInto(f.renderer, [
    { attribute: a, target: first, elementCount: 3 },
    { attribute: b, target: second, elementCount: 4 },
  ], slot, "test")).toBe(true);
  expect([...first]).toEqual([1, 2, 3, 99]);
  expect([...second]).toEqual([7, 8, 9, 10]);
  expect(slot.size).toBe(40);
  expect(f.device.createCommandEncoder).toHaveBeenCalledTimes(1);
  expect(f.device.queue.submit).toHaveBeenCalledTimes(1);
  expect(f.copyBufferToBuffer.mock.calls.map(args => args.slice(3))).toEqual([[0, 12], [12, 16]]);
  const staging = f.device.createBuffer.mock.results[0].value;
  expect(staging.mapAsync).toHaveBeenCalledExactlyOnceWith(1, 0, 28);
  expect(staging.getMappedRange).toHaveBeenCalledExactlyOnceWith(0, 28);
  expect(staging.unmap).toHaveBeenCalledTimes(1);
});

it("handles empty request lists and zero active data without allocation or submission", async () => {
  const f = fixture();
  const slot = createReadbackSlot();
  expect(await readStorageBuffersInto(f.renderer, [], slot, "empty")).toBe(true);
  expect(await readStorageBuffersInto(f.renderer, [{ attribute: f.source([1]), target: new Float32Array(0), elementCount: 0 }], slot, "empty")).toBe(true);
  expect(f.device.createBuffer).not.toHaveBeenCalled();
  expect(f.device.queue.submit).not.toHaveBeenCalled();
});

it("checks every source before writing targets or scheduling partial copies", async () => {
  const f = fixture();
  const slot = createReadbackSlot();
  const target = new Float32Array([42]);
  const first = { attribute: f.source([1]), target, elementCount: 1 };
  expect(await readStorageBuffersInto(f.renderer, [first, { attribute: {} as StorageBufferAttribute, target, elementCount: 1 }], slot, "missing")).toBe(false);
  expect(await readStorageBuffersInto(f.renderer, [{ attribute: f.source([2]), target: new Float32Array(2), elementCount: 2 }], slot, "short")).toBe(false);
  expect(target[0]).toBe(42);
  expect(f.device.queue.submit).not.toHaveBeenCalled();
  expect(f.device.createBuffer).not.toHaveBeenCalled();
  expect(await readStorageBuffersInto({} as WebGPURenderer, [], slot, "unsupported")).toBe(false);
});

it("rejects invalid counts before creating staging resources", async () => {
  const f = fixture();
  for (const count of [-1, 0.5, 2, NaN]) {
    await expect(readStorageBuffersInto(f.renderer, [{ attribute: f.source([1, 2]), target: new Float32Array(1), elementCount: count }], createReadbackSlot(), "invalid")).rejects.toThrow(RangeError);
  }
  expect(f.device.createBuffer).not.toHaveBeenCalled();
});

it("reuses capacity across active-size changes and grows/disposes staging explicitly", async () => {
  const f = fixture();
  const slot = createReadbackSlot();
  const attribute = f.source([1, 2, 3, 4]);
  const read = (a: StorageBufferAttribute, count: number) => readStorageBufferInto(f.renderer, a, slot, new Float32Array(count), count, "reuse");
  await read(attribute, 1);
  const old = f.device.createBuffer.mock.results[0].value;
  await read(attribute, 4);
  await read(f.source([3]), 1);
  expect(f.device.createBuffer).toHaveBeenCalledTimes(1);
  await read(f.source([1, 2, 3, 4, 5]), 5);
  expect(old.destroy).toHaveBeenCalledTimes(1);
  const grown = f.device.createBuffer.mock.results[1].value;
  expect(slot.size).toBe(20);
  disposeReadbackSlot(slot);
  disposeReadbackSlot(slot);
  expect(grown.destroy).toHaveBeenCalledTimes(1);
  expect(slot).toEqual({ buffer: null, size: 0 });
});

it("destroys rejected mappings and permits retry without touching targets", async () => {
  const f = fixture();
  const slot = createReadbackSlot();
  const target = new Float32Array([99]);
  const request = [{ attribute: f.source([7]), target, elementCount: 1 }];
  f.mappings.push(Promise.reject(new Error("map failed")));
  await expect(readStorageBuffersInto(f.renderer, request, slot, "failure")).rejects.toThrow("map failed");
  expect(target[0]).toBe(99);
  expect(f.device.createBuffer.mock.results[0].value.destroy).toHaveBeenCalledTimes(1);
  expect(slot).toEqual({ buffer: null, size: 0 });
  expect(await readStorageBuffersInto(f.renderer, request, slot, "retry")).toBe(true);
  expect(target[0]).toBe(7);
});

it("unmaps and releases the staging slot if reading the mapped range fails", async () => {
  const f = fixture();
  const slot = createReadbackSlot();
  const attribute = f.source([7]);
  await readStorageBufferInto(f.renderer, attribute, slot, new Float32Array(1), 1, "seed");
  const staging = f.device.createBuffer.mock.results[0].value;
  staging.getMappedRange.mockImplementationOnce(() => { throw new Error("range failed"); });
  await expect(readStorageBufferInto(f.renderer, attribute, slot, new Float32Array(1), 1, "range")).rejects.toThrow("range failed");
  expect(staging.unmap).toHaveBeenCalledTimes(2);
  expect(slot.buffer).toBe(null);
});

function snapshotFixture() {
  const f = fixture();
  const state = createTerrainSnapshotState(2, 0, 6);
  const index = createSpatialIndex(2);
  const elevation = f.source([1, 2, 3, 99, 99, 99]);
  const bounds = f.source([1, 3, 1, 3, 99, 99, 99, 99]);
  const trigger = (key: object, boundsAttribute: StorageBufferAttribute | undefined = bounds, activeLeafCount = 1) => triggerSnapshotReadback(
    state, f.renderer, elevation, index, boundsAttribute,
    { activeLeafCount, totalElements: 6, verticesPerNode: 3, elevationScale: -2, originY: 10, contentKey: key },
  );
  return { ...f, state, index, elevation, bounds, trigger };
}

it("publishes paired data and the captured index only after the single map completes", async () => {
  const f = snapshotFixture();
  let finish!: () => void;
  f.mappings.push(new Promise<void>(resolve => { finish = resolve; }));
  const generation = f.index.stampGen;
  f.trigger({});
  expect(f.device.queue.submit).toHaveBeenCalledTimes(1);
  f.index.stampGen++;
  new Float32Array(f.sources.get(f.elevation)!.buffer.data).fill(100);
  expect(f.state.hasSnapshot).toBe(false);
  finish();
  await f.state.pending;
  expect([...f.state.frontElevation]).toEqual([1, 2, 3, 0, 0, 0]);
  expect([...f.state.frontTileBounds]).toEqual([1, 3, 1, 3, 0, 0, 0, 0]);
  expect(f.state.frontIndex.stampGen).toBe(generation);
  expect(f.state.globalRange).toEqual({ min: 4, max: 8 });
  expect(f.state.generation).toBe(1);
  disposeSnapshotReadback(f.state);
});

it("preserves the previous snapshot and retries the same content after batch failure", async () => {
  const f = snapshotFixture();
  f.trigger({}); await f.state.pending;
  const before = f.state.frontElevation;
  const key = {};
  f.mappings.push(Promise.reject(new Error("map failed")));
  f.trigger(key); await f.state.pending;
  expect(f.state.frontElevation).toBe(before);
  expect(f.state.generation).toBe(1);
  expect(f.state.readbackPending).toBe(false);
  expect(f.state.lastError).toBeInstanceOf(Error);
  f.trigger(key); await f.state.pending;
  expect(f.state.generation).toBe(2);
  expect(f.state.lastError).toBe(null);
  disposeSnapshotReadback(f.state);
});

it("rejects a missing bounds source atomically, then retries when it becomes available", async () => {
  const f = snapshotFixture();
  const source = f.sources.get(f.bounds)!;
  f.sources.delete(f.bounds);
  const key = {};
  f.trigger(key); await f.state.pending;
  expect(f.state.hasSnapshot).toBe(false);
  expect(f.device.queue.submit).not.toHaveBeenCalled();
  f.sources.set(f.bounds, source);
  f.trigger(key); await f.state.pending;
  expect(f.state.hasSnapshot).toBe(true);
  disposeSnapshotReadback(f.state);
});

it("supports absent bounds and zero leaves without extra copy/map operations", async () => {
  const f = snapshotFixture();
  triggerSnapshotReadback(f.state, f.renderer, f.elevation, f.index, undefined,
    { activeLeafCount: 1, totalElements: 6, verticesPerNode: 3, elevationScale: 1, originY: 0, contentKey: {} });
  await f.state.pending;
  expect(f.copyBufferToBuffer).toHaveBeenCalledTimes(1);
  expect(f.state.globalRange).toBe(null);
  f.trigger({}, f.bounds, 0); await f.state.pending;
  expect(f.device.queue.submit).toHaveBeenCalledTimes(1);
  expect(f.state.frontLeafCount).toBe(0);
  expect(f.state.generation).toBe(2);
  disposeSnapshotReadback(f.state);
});

it("does not publish after disposal during a pending batch mapping", async () => {
  const f = snapshotFixture();
  let fail!: (error: Error) => void;
  f.mappings.push(new Promise<void>((_, reject) => { fail = reject; }));
  f.trigger({});
  const staging = f.device.createBuffer.mock.results[0].value;
  disposeSnapshotReadback(f.state);
  fail(new Error("destroyed while mapping"));
  await f.state.pending;
  expect(f.state.generation).toBe(0);
  expect(f.state.readbackPending).toBe(false);
  expect(f.state.snapshotReadback.buffer).toBe(null);
  expect(staging.destroy).toHaveBeenCalledTimes(1);
  f.trigger({});
  expect(f.device.queue.submit).toHaveBeenCalledTimes(1);
});


it("caps combined capacity to the device limit while retaining a single active map", async () => {
  const f = fixture();
  f.device.limits.maxBufferSize = 24;
  const slot = createReadbackSlot();
  const a = new Float32Array(2), b = new Float32Array(2);
  await readStorageBuffersInto(f.renderer, [
    { attribute: f.source([1, 2, 3, 4]), target: a, elementCount: 2 },
    { attribute: f.source([5, 6, 7, 8]), target: b, elementCount: 2 },
  ], slot, "capped");
  expect(slot.size).toBe(24);
  expect(f.device.createBuffer).toHaveBeenCalledTimes(1);
  expect(f.device.queue.submit).toHaveBeenCalledTimes(1);
  expect([...a]).toEqual([1, 2]);
  expect([...b]).toEqual([5, 6]);
  expect(f.device.createBuffer.mock.results[0].value.mapAsync).toHaveBeenCalledExactlyOnceWith(1, 0, 16);
  disposeReadbackSlot(slot);
});

it("falls back to reusable per-source slots when active data exceeds maxBufferSize", async () => {
  const f = fixture();
  f.device.limits.maxBufferSize = 16;
  const slot = createReadbackSlot();
  const a = f.source([1, 2, 3, 4]), b = f.source([5, 6, 7, 8]);
  const first = new Float32Array(4), second = new Float32Array(4);
  const requests = [
    { attribute: a, target: first, elementCount: 4 },
    { attribute: b, target: second, elementCount: 4 },
  ];
  const pending = readStorageBuffersInto(f.renderer, requests, slot, "split");
  // Both submissions occur synchronously, before subsequent writes can interleave.
  expect(f.device.queue.submit).toHaveBeenCalledTimes(2);
  new Float32Array(f.sources.get(a)!.buffer.data).fill(99);
  new Float32Array(f.sources.get(b)!.buffer.data).fill(99);
  expect(await pending).toBe(true);
  expect([...first]).toEqual([1, 2, 3, 4]);
  expect([...second]).toEqual([5, 6, 7, 8]);
  expect(slot.children).toHaveLength(2);
  expect(f.device.createBuffer.mock.calls.every(([descriptor]) => descriptor.size <= 16)).toBe(true);
  await readStorageBuffersInto(f.renderer, requests, slot, "reuse");
  expect(f.device.createBuffer).toHaveBeenCalledTimes(2);
  disposeReadbackSlot(slot);
  for (const result of f.device.createBuffer.mock.results) expect(result.value.destroy).toHaveBeenCalledTimes(1);
  expect(slot).toEqual({ buffer: null, size: 0 });
});

it("drains every fallback map after a sibling rejects before permitting reuse", async () => {
  const f = fixture();
  f.device.limits.maxBufferSize = 16;
  const slot = createReadbackSlot();
  let finish!: () => void;
  f.mappings.push(Promise.reject(new Error("first map failed")), new Promise<void>(resolve => { finish = resolve; }));
  const requests = [1, 2].map(value => ({ attribute: f.source([value, value, value, value]), target: new Float32Array(4), elementCount: 4 }));
  const completed = vi.fn();
  const pending = readStorageBuffersInto(f.renderer, requests, slot, "split-error").then(
    value => { completed(); return value; },
    error => { completed(); return error; },
  );
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(completed).not.toHaveBeenCalled();
  expect(f.device.createBuffer.mock.results[0].value.destroy).toHaveBeenCalledTimes(1);
  expect(f.device.createBuffer.mock.results[1].value.unmap).not.toHaveBeenCalled();
  finish();
  expect(await pending).toEqual(new Error("first map failed"));
  expect(f.device.createBuffer.mock.results[1].value.unmap).toHaveBeenCalledTimes(1);
  expect(await readStorageBuffersInto(f.renderer, requests, slot, "retry")).toBe(true);
  expect(f.device.createBuffer).toHaveBeenCalledTimes(3);
  disposeReadbackSlot(slot);
  for (const result of f.device.createBuffer.mock.results) expect(result.value.destroy).toHaveBeenCalledTimes(1);
});

it("recursively disposes pending fallback slots and drains their rejections", async () => {
  const f = fixture();
  f.device.limits.maxBufferSize = 16;
  const slot = createReadbackSlot();
  const rejects: ((error: Error) => void)[] = [];
  f.mappings.push(...[0, 1].map(() => new Promise<void>((_, reject) => rejects.push(reject))));
  const requests = [1, 2].map(value => ({ attribute: f.source([value, value, value, value]), target: new Float32Array(4), elementCount: 4 }));
  const pending = readStorageBuffersInto(f.renderer, requests, slot, "dispose");
  const rejected = expect(pending).rejects.toThrow("destroyed");
  disposeReadbackSlot(slot);
  rejects.forEach(reject => reject(new Error("destroyed")));
  await rejected;
  expect(slot).toEqual({ buffer: null, size: 0 });
  for (const result of f.device.createBuffer.mock.results) expect(result.value.destroy).toHaveBeenCalledTimes(1);
});

it("releases obsolete child slots when a later active batch fits one allocation", async () => {
  const f = fixture();
  f.device.limits.maxBufferSize = 16;
  const slot = createReadbackSlot();
  const requests = [1, 2].map(value => ({ attribute: f.source([value, value, value, value]), target: new Float32Array(4), elementCount: 4 }));
  await readStorageBuffersInto(f.renderer, requests, slot, "large");
  await readStorageBuffersInto(f.renderer, requests.map(request => ({ ...request, elementCount: 1 })), slot, "small");
  expect(slot.children).toBeUndefined();
  expect(slot.size).toBe(16);
  expect(f.device.createBuffer).toHaveBeenCalledTimes(3);
  expect(f.device.createBuffer.mock.results[0].value.destroy).toHaveBeenCalledTimes(1);
  expect(f.device.createBuffer.mock.results[1].value.destroy).toHaveBeenCalledTimes(1);
  disposeReadbackSlot(slot);
});
