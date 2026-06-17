import type { StorageBufferAttribute, WebGPURenderer } from "three/webgpu";

/**
 * Reusable GPU->CPU readback staging buffer.
 *
 * Three.js' `WebGPURenderer.getArrayBufferAsync` allocates a fresh `_readback`
 * GPU buffer on every call and never destroys it, so calling it every frame
 * leaks GPU memory until the JS wrapper is garbage collected (a periodic,
 * large GPU stall). A {@link ReadbackSlot} holds a single staging buffer that
 * we own and reuse across frames, recreating it only when the source buffer
 * size changes.
 */
export interface ReadbackSlot {
  buffer: GPUBuffer | null;
  size: number;
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
export async function readStorageBufferInto(
  renderer: WebGPURenderer,
  attribute: StorageBufferAttribute,
  slot: ReadbackSlot,
  target: Float32Array,
  elementCount: number,
  label: string,
): Promise<boolean> {
  const backend = getBackend(renderer);
  const device = backend?.device;
  const source = backend?.get?.(attribute)?.buffer;
  if (!device || !source) return false;

  const requestedBytes = elementCount * Float32Array.BYTES_PER_ELEMENT;
  const copyBytes = Math.min(requestedBytes, source.size);
  if (copyBytes <= 0) return true;

  if (!slot.buffer || slot.size !== source.size) {
    slot.buffer?.destroy();
    slot.buffer = device.createBuffer({
      label,
      size: source.size,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    slot.size = source.size;
  }

  const staging = slot.buffer;
  const encoder = device.createCommandEncoder({ label });
  encoder.copyBufferToBuffer(source, 0, staging, 0, copyBytes);
  device.queue.submit([encoder.finish()]);

  await staging.mapAsync(GPUMapMode.READ, 0, copyBytes);
  const mapped = new Float32Array(staging.getMappedRange(0, copyBytes));
  target.set(mapped);
  staging.unmap();

  return true;
}

export function disposeReadbackSlot(slot: ReadbackSlot): void {
  slot.buffer?.destroy();
  slot.buffer = null;
  slot.size = 0;
}
