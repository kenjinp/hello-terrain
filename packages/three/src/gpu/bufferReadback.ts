import type { StorageBufferAttribute, WebGPURenderer } from "three/webgpu";

/**
 * Reusable GPU->CPU readback staging buffer.
 *
 * Three.js' `WebGPURenderer.getArrayBufferAsync` allocates a fresh `_readback`
 * GPU buffer on every call and never destroys it, so calling it every frame
 * leaks GPU memory until the JS wrapper is garbage collected (a periodic,
 * large GPU stall). A {@link ReadbackSlot} holds a single staging buffer that
 * we own and reuse across frames, recreating it only when the source buffer
 * capacity grows.
 */
export interface ReadbackSlot {
  buffer: GPUBuffer | null;
  size: number;
  /** Per-source staging when a complete active batch exceeds maxBufferSize. */
  children?: ReadbackSlot[];
}

export function createReadbackSlot(): ReadbackSlot {
  return { buffer: null, size: 0 };
}

type WebGPUBackendAccess = {
  device?: GPUDevice;
  get?: (attribute: StorageBufferAttribute) => { buffer?: GPUBuffer } | undefined;
};

function getBackend(renderer: WebGPURenderer): WebGPUBackendAccess | undefined {
  return (renderer as WebGPURenderer & { backend?: WebGPUBackendAccess }).backend;
}

/**
 * True when the renderer exposes a WebGPU device + attribute buffer lookup, so
 * the pooled readback path can be used instead of `getArrayBufferAsync`.
 */
export function canDeviceReadback(renderer: WebGPURenderer): boolean {
  const backend = getBackend(renderer);
  return Boolean(backend?.device) && typeof backend?.get === "function";
}

/**
 * Copy the first `elementCount` float elements of a storage buffer attribute
 * into `target`, reusing the staging buffer held by `slot`.
 *
 * Only the requested (active) region is copied and mapped, which keeps the
 * staging buffer a stable size (the full source buffer) while avoiding the cost
 * of transferring the entire buffer when few tiles are active.
 *
 * Callers must serialize calls that share a `slot` (a buffer cannot be mapped
 * twice concurrently); the terrain readback path gates this via its
 * `readbackPending` flag. Returns `false` when the renderer lacks a usable
 * WebGPU backend, in which case the caller should fall back.
 *
 * `label` is applied to the staging buffer and command encoder for debugging
 * (e.g. in the WebGPU inspector).
 */
export function readStorageBufferInto(
  renderer: WebGPURenderer,
  attribute: StorageBufferAttribute,
  slot: ReadbackSlot,
  target: Float32Array,
  elementCount: number,
  label: string,
): Promise<boolean> {
  return readStorageBuffersInto(renderer, [{ attribute, target, elementCount }], slot, label);
}

export interface StorageBufferReadbackRequest {
  attribute: StorageBufferAttribute;
  target: Float32Array;
  elementCount: number;
}

/**
 * Copy a coherent set of active storage-buffer regions using one submission and
 * one mapping. Capacity follows the sum of full source sizes, while offsets and
 * mapped length follow only active data. If the active batch exceeds the device
 * allocation limit, per-source slots retain the original multi-map behavior.
 * Callers must serialize use of the slot.
 * All sources are checked before submitting anything; missing/undersized sources
 * return false rather than publishing a partially filled snapshot.
 */
export async function readStorageBuffersInto(
  renderer: WebGPURenderer,
  requests: readonly StorageBufferReadbackRequest[],
  slot: ReadbackSlot,
  label: string,
): Promise<boolean> {
  const backend = getBackend(renderer);
  const device = backend?.device;
  if (!device || !backend?.get) return false;

  let capacity = 0;
  let activeBytes = 0;
  const copies: { source: GPUBuffer; target: Float32Array; offset: number; bytes: number }[] = [];
  for (const { attribute, target, elementCount } of requests) {
    if (!Number.isSafeInteger(elementCount) || elementCount < 0 || elementCount > target.length) {
      throw new RangeError("Invalid storage readback element count");
    }
    const source = backend.get(attribute)?.buffer;
    const bytes = elementCount * Float32Array.BYTES_PER_ELEMENT;
    if (!source || source.size < bytes) return false;
    capacity += source.size;
    copies.push({ source, target, offset: activeBytes, bytes });
    activeBytes += bytes;
  }
  if (activeBytes === 0) return true;

  const maxBufferSize = device.limits?.maxBufferSize ?? Infinity;
  if (copies.some(copy => copy.bytes > maxBufferSize)) {
    throw new RangeError("Storage readback exceeds device maxBufferSize");
  }
  if (activeBytes > maxBufferSize) {
    // Each source fits individually even when their combined active data does
    // not. Start every copy before awaiting any map to keep the pair coherent.
    // Retain child staging buffers across repeated oversized snapshots.
    if (slot.buffer) disposeReadbackSlot(slot);
    const children = slot.children ??= [];
    while (children.length > requests.length) disposeReadbackSlot(children.pop()!);
    const pending = requests.map((request, index) =>
      readStorageBuffersInto(
        renderer, [request], children[index] ??= createReadbackSlot(), `${label}-${index}`,
      ),
    );
    // A rejected map must not release the caller's serialization gate while a
    // sibling buffer is still mapped/pending and could be reused by a retry.
    const results = await Promise.allSettled(pending);
    for (const result of results) if (result.status === "rejected") throw result.reason;
    return results.every(result => result.status === "fulfilled" && result.value);
  }

  if (slot.children) disposeReadbackSlot(slot);
  // Full source capacity may exceed a single allocation even when active data
  // fits. Reserve no more than the device allows, retaining the batched path.
  capacity = Math.min(capacity, maxBufferSize);
  if (!slot.buffer || slot.size < capacity || slot.size > maxBufferSize) {
    disposeReadbackSlot(slot);
    slot.buffer = device.createBuffer({
      label,
      size: capacity,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    slot.size = capacity;
  }

  const staging = slot.buffer;
  let mapped = false;
  try {
    const encoder = device.createCommandEncoder({ label });
    for (const copy of copies) {
      if (copy.bytes > 0) encoder.copyBufferToBuffer(copy.source, 0, staging, copy.offset, copy.bytes);
    }
    device.queue.submit([encoder.finish()]);
    // Map offset zero is 8-byte aligned. Copy offsets and the total mapped size
    // are multiples of four, including odd-length float regions.
    await staging.mapAsync(GPUMapMode.READ, 0, activeBytes);
    mapped = true;
    const data = new Float32Array(staging.getMappedRange(0, activeBytes));
    for (const copy of copies) {
      const offset = copy.offset / Float32Array.BYTES_PER_ELEMENT;
      copy.target.set(data.subarray(offset, offset + copy.bytes / Float32Array.BYTES_PER_ELEMENT));
    }
    return true;
  } catch (error) {
    // Failed mappings/encodes must not leave a poisoned slot for the next retry.
    if (slot.buffer === staging) disposeReadbackSlot(slot);
    throw error;
  } finally {
    if (mapped) staging.unmap();
  }
}

export function disposeReadbackSlot(slot: ReadbackSlot): void {
  slot.buffer?.destroy();
  slot.buffer = null;
  slot.size = 0;
  if (slot.children) {
    for (const child of slot.children) disposeReadbackSlot(child);
    delete slot.children;
  }
}
