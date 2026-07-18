import type { StorageBufferAttribute, WebGPURenderer } from 'three/webgpu';
import type { StorageBufferNode } from 'three/webgpu';

type BackendAccess = {
    has?: (object: object) => boolean;
    get?: (object: object) => { buffer?: GPUBuffer } | undefined;
    delete?: (object: object) => void;
};

function getBackend(renderer: WebGPURenderer | undefined): BackendAccess | undefined {
    return (renderer as (WebGPURenderer & { backend?: BackendAccess }) | undefined)?.backend;
}

/**
 * Destroys the GPU buffer backing a storage attribute and detaches it from the
 * renderer's backend cache. No-op when the attribute never reached the GPU
 * (no renderer, or never rendered/dispatched).
 *
 * three has no `BufferAttribute.dispose()`; without this, replaced storage
 * attributes keep their GPU allocation alive until the renderer itself is
 * disposed.
 */
export function disposeStorageBufferAttribute(
    renderer: WebGPURenderer | undefined,
    attribute: StorageBufferAttribute
): void {
    const backend = getBackend(renderer);
    if (!backend) return;
    // Backend.get() auto-creates an entry for unknown objects — check first.
    if (backend.has && !backend.has(attribute)) return;
    const data = backend.get?.(attribute);
    try {
        data?.buffer?.destroy();
    } catch {
        // Already destroyed or device lost — nothing left to release.
    }
    backend.delete?.(attribute);
}

/**
 * Releases a `{ attribute, node }` storage pair: destroys the GPU buffer and
 * disposes the TSL node so renderer-side node caches let go of it.
 */
export function disposeStorageBufferState(
    renderer: WebGPURenderer | undefined,
    state: { attribute: StorageBufferAttribute; node: StorageBufferNode }
): void {
    (state.node as { dispose?: () => void }).dispose?.();
    disposeStorageBufferAttribute(renderer, state.attribute);
}
