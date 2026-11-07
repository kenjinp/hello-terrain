import { storage } from 'three/tsl';
import { StorageBufferAttribute, type StorageBufferNode, type WebGPURenderer } from 'three/webgpu';
import type { TerrainConfig } from './three';
import { createLeafStorage } from '../gpu/leafStorage';
import { createTerrainFieldStorage, TILE_BOUNDS_FLOATS_PER_TILE, type TerrainFieldStorage } from '../gpu/terrainFieldStorage';
import { createTerrainUniforms } from '../gpu/uniforms';
import type { TerrainUniformsContext, LeafStorageState } from '../types';
import type { TerrainMaterialContext } from '../tsl/terrainMaterial';

/** Conservative compatibility: authored source/LOD/range changes do not change draw resources. */
export function compatiblePresentation(a: TerrainConfig, b: TerrainConfig) {
    return a.topology === b.topology && a.maxNodes === b.maxNodes &&
        a.innerTileSegments === b.innerTileSegments && a.maxLevel === b.maxLevel &&
        a.elevationScale === b.elevationScale && a.skirtScale === b.skirtScale &&
        a.terrainFieldFilter === b.terrainFieldFilter && a.terrainFieldFormat === b.terrainFieldFormat;
}

type Backend = {
    device: GPUDevice;
    get(resource: unknown): { buffer?: GPUBuffer; texture?: GPUTexture };
    createStorageAttribute(attribute: StorageBufferAttribute): void;
    destroyAttribute(attribute: StorageBufferAttribute): void;
};
export function supportsPresentationCopy(renderer: WebGPURenderer) {
    const backend = renderer.backend as unknown as Partial<Backend>;
    return Boolean(
        typeof backend.device?.createCommandEncoder === 'function' &&
        typeof backend.device?.queue?.submit === 'function' &&
        typeof backend.get === 'function' &&
        typeof backend.createStorageAttribute === 'function' &&
        typeof backend.destroyAttribute === 'function' &&
        typeof renderer.initTexture === 'function'
    );
}

export function createPresentation(renderer: WebGPURenderer, config: TerrainConfig,
    materialContext: TerrainMaterialContext, sourceUniforms: TerrainUniformsContext) {
    const leafStorage = createLeafStorage(config.maxNodes);
    const field = createTerrainFieldStorage(config.innerTileSegments + 3, config.maxNodes, renderer,
        { format: config.terrainFieldFormat, filter: config.terrainFieldFilter });
    const boundsAttribute = new StorageBufferAttribute(new Float32Array(config.maxNodes * TILE_BOUNDS_FLOATS_PER_TILE), 1);
    boundsAttribute.name = 'presentationBounds';
    const bounds = storage(boundsAttribute, 'float', config.maxNodes * TILE_BOUNDS_FLOATS_PER_TILE) as StorageBufferNode;
    const uniforms = createTerrainUniforms({
        rootSize: sourceUniforms.uRootSize.value, rootOrigin: sourceUniforms.uRootOrigin.value,
        innerTileSegments: config.innerTileSegments, skirtScale: config.skirtScale,
        elevationScale: config.elevationScale, radius: sourceUniforms.uRadius.value,
        instanceId: crypto.randomUUID(),
    });
    const context = { leafStorage, uniforms, terrainFieldStorage: field, tileBoundsNode: bounds, materialContext };
    let precision: ReturnType<NonNullable<TerrainConfig['topology']['projection']['gpu']['createRenderPrecision']>> | undefined;
    try {
        const vertex = config.topology.projection.gpu.renderVertexPosition(context);
        precision = config.topology.projection.gpu.createRenderPrecision?.({ ...context, positionNode: vertex });
        if (precision && !precision.prepare) throw new Error('Presentation requires transactional precision');
        const backend = renderer.backend as unknown as Backend;
        let disposed = false;
        return {
            config, leafStorage, field, boundsAttribute, precision,
            positionNode: precision?.positionNode ?? vertex,
            /** Prepare everything that can throw before touching live draw data. */
            prepare(source: { leafStorage: LeafStorageState; field: TerrainFieldStorage; boundsAttribute: StorageBufferAttribute; count: number }) {
                if (disposed) throw new Error('Terrain presentation is disposed');
                const { count } = source;
                if (!Number.isInteger(count) || count < 0 || count > config.maxNodes || source.leafStorage.data.length < count * 4)
                    throw new Error('Invalid presentation leaf count');
                if (source.field.backendType !== field.backendType || source.field.edgeVertexCount !== field.edgeVertexCount ||
                    source.field.tileCount !== field.tileCount || source.field.texture.type !== field.texture.type)
                    throw new Error('Incompatible terrain presentation texture');
                const leaves = source.leafStorage.data.slice(0, count * 4);
                const commitAnchors = precision?.prepare?.(count, leaves);
                // Explicit r182 backend integration, matching the existing readback and
                // destruction boundary. createStorageAttribute is idempotent; normal
                // Three binding initialization sees the same owned GPU buffer.
                backend.createStorageAttribute(leafStorage.attribute);
                backend.createStorageAttribute(boundsAttribute);
                renderer.initTexture(field.texture);
                const sourceLeaf = backend.get(source.leafStorage.attribute).buffer;
                const sourceBounds = backend.get(source.boundsAttribute).buffer;
                const targetLeaf = backend.get(leafStorage.attribute).buffer;
                const targetBounds = backend.get(boundsAttribute).buffer;
                const sourceTexture = backend.get(source.field.texture).texture;
                const targetTexture = backend.get(field.texture).texture;
                const leafBytes = count * 4 * Int32Array.BYTES_PER_ELEMENT;
                const boundsBytes = count * TILE_BOUNDS_FLOATS_PER_TILE * Float32Array.BYTES_PER_ELEMENT;
                if (!sourceLeaf || !sourceBounds || !targetLeaf || !targetBounds || !sourceTexture || !targetTexture)
                    throw new Error('Terrain presentation GPU resources are unavailable');
                for (const [src, dst, bytes] of [[sourceLeaf, targetLeaf, leafBytes], [sourceBounds, targetBounds, boundsBytes]] as const) {
                    if (src.size < bytes || dst.size < bytes || !(src.usage & GPUBufferUsage.COPY_SRC) || !(dst.usage & GPUBufferUsage.COPY_DST))
                        throw new Error('Invalid terrain presentation buffer copy');
                }
                if (!(sourceTexture.usage & GPUTextureUsage.COPY_SRC) || !(targetTexture.usage & GPUTextureUsage.COPY_DST) ||
                    sourceTexture.format !== targetTexture.format || sourceTexture.width !== targetTexture.width ||
                    sourceTexture.height !== targetTexture.height || sourceTexture.depthOrArrayLayers !== targetTexture.depthOrArrayLayers)
                    throw new Error('Invalid terrain presentation texture copy');
                const encoder = backend.device.createCommandEncoder({ label: 'terrainPresentation' });
                if (count > 0) {
                    encoder.copyBufferToBuffer(sourceLeaf, 0, targetLeaf, 0, leafBytes);
                    encoder.copyBufferToBuffer(sourceBounds, 0, targetBounds, 0, boundsBytes);
                    const edge = field.edgeVertexCount;
                    if (field.backendType === 'atlas') {
                        const perRow = Math.ceil(Math.sqrt(field.tileCount));
                        const rows = Math.floor(count / perRow), remaining = count % perRow;
                        if (rows) encoder.copyTextureToTexture({ texture: sourceTexture }, { texture: targetTexture }, [perRow * edge, rows * edge, 1]);
                        if (remaining) encoder.copyTextureToTexture(
                            { texture: sourceTexture, origin: [0, rows * edge, 0] },
                            { texture: targetTexture, origin: [0, rows * edge, 0] }, [remaining * edge, edge, 1]);
                    } else {
                        encoder.copyTextureToTexture({ texture: sourceTexture }, { texture: targetTexture }, [edge, edge, count]);
                    }
                }
                const commands = encoder.finish();
                return () => {
                    // Prior draws precede this copy on the same queue. A synchronous
                    // submission error leaves CPU metadata and live anchors unchanged.
                    backend.device.queue.submit([commands]);
                    leafStorage.data.set(leaves);
                    commitAnchors?.();
                };
            },
            /** Caller fences the last submitted draw/copy before destroying. */
            dispose() {
                if (disposed) return;
                disposed = true;
                field.texture.dispose();
                for (const attribute of [leafStorage.attribute, boundsAttribute, precision?.attribute]) {
                    if (attribute && backend.get(attribute).buffer) backend.destroyAttribute(attribute);
                }
            },
        };
    } catch (error) {
        field.texture.dispose();
        throw error;
    }
}
export type TerrainPresentation = ReturnType<typeof createPresentation>;
