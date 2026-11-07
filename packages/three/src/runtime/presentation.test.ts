import { afterEach, expect, it, vi } from 'vitest';
import { float } from 'three/tsl';
import { StorageBufferAttribute, type WebGPURenderer } from 'three/webgpu';
import { compatiblePresentation, createPresentation, supportsPresentationCopy } from './presentation';
import { createFlatTopology } from '../quadtree/topology/flat';
import { createLeafStorage } from '../gpu/leafStorage';
import { createTerrainFieldStorage } from '../gpu/terrainFieldStorage';
import { createTerrainUniforms } from '../gpu/uniforms';
import { createTerrainMaterialContext } from '../tsl/terrainMaterial';
import { createTerrain, type TerrainConfig } from './three';
import Attributes from 'three/src/renderers/common/Attributes.js';
import { AttributeType } from 'three/src/renderers/common/Constants.js';

afterEach(() => vi.unstubAllGlobals());
function fixture(atlas = false) {
    vi.stubGlobal('GPUBufferUsage', { COPY_SRC: 4, COPY_DST: 8 });
    vi.stubGlobal('GPUTextureUsage', { COPY_SRC: 1, COPY_DST: 2 });
    const resources = new Map<unknown, any>();
    const get = (value: unknown) => { if (!resources.has(value)) resources.set(value, {}); return resources.get(value); };
    const submit = vi.fn();
    const bufferCopy = vi.fn(), textureCopy = vi.fn(), finish = vi.fn(() => ({}));
    const createCommandEncoder = vi.fn(() => ({ copyBufferToBuffer: bufferCopy, copyTextureToTexture: textureCopy, finish }));
    const backend = {
        device: { limits: { maxTextureArrayLayers: atlas ? 1 : 256 }, queue: { submit }, createCommandEncoder }, get,
        createStorageAttribute: vi.fn((attribute: StorageBufferAttribute) => {
            get(attribute).buffer ??= { size: attribute.array.byteLength, usage: 12 };
        }),
        destroyAttribute: vi.fn((attribute: StorageBufferAttribute) => { delete get(attribute).buffer; }),
    };
    const initTexture = vi.fn((texture: any) => {
        get(texture).texture ??= { width: texture.image.width, height: texture.image.height,
            depthOrArrayLayers: texture.image.depth ?? 1, format: texture.type, usage: 3 };
    });
    const renderer = { backend, initTexture } as unknown as WebGPURenderer;
    const commitAnchors = vi.fn();
    const prepareAnchors = vi.fn(() => commitAnchors);
    const topology = createFlatTopology({ rootSize: 16, origin: { x: 0, y: 0, z: 0 } });
    const precisionAttribute = new StorageBufferAttribute(new Float32Array(36), 4);
    topology.projection.gpu.createRenderPrecision = () => ({ positionNode: float(0), attribute: precisionAttribute, update() {}, prepare: prepareAnchors });
    const config: TerrainConfig = { topology, elevation: () => float(0), elevationRange: { min: 0, max: 0 },
        elevationScale: 1, innerTileSegments: 1, maxNodes: 9, maxLevel: 2, skirtScale: 1,
        terrainFieldFilter: 'linear', terrainFieldFormat: 'rgba16float', lod: { mode: 'distance', distanceFactor: 1 } };
    const uniforms = createTerrainUniforms({ rootSize: 16, rootOrigin: { x: 0, y: 0, z: 0 }, innerTileSegments: 1, skirtScale: 1,
        elevationScale: 1, radius: 1, instanceId: 'test' });
    const materialContext = createTerrainMaterialContext();
    const presentation = createPresentation(renderer, config, materialContext, uniforms);
    const source = { leafStorage: createLeafStorage(9), boundsAttribute: new StorageBufferAttribute(new Float32Array(36), 1),
        field: createTerrainFieldStorage(4, 9, renderer), count: 3 };
    source.leafStorage.data.fill(3);
    backend.createStorageAttribute(source.leafStorage.attribute);
    backend.createStorageAttribute(source.boundsAttribute);
    initTexture(source.field.texture);
    return { presentation, source, config, backend, renderer, resources, get, submit, bufferCopy, textureCopy,
        prepareAnchors, commitAnchors, precisionAttribute, createCommandEncoder };
}

it('keeps presentation compatibility for authored elevation/LOD changes but rejects structural changes', () => {
    const f = fixture();
    expect(compatiblePresentation(f.config, { ...f.config, elevation: () => float(9), elevationRange: { min: -1, max: 9 }, lod: { mode: 'screen', targetPixels: 4 } })).toBe(true);
    for (const patch of [{ maxNodes: 10 }, { innerTileSegments: 2 }, { maxLevel: 3 }, { elevationScale: 2 },
        { skirtScale: 2 }, { terrainFieldFilter: 'nearest' }, { terrainFieldFormat: 'rgba32float' },
        { topology: createFlatTopology({ rootSize: 16, origin: { x: 0, y: 0, z: 0 } }) }]) {
        expect(compatiblePresentation(f.config, { ...f.config, ...patch } as TerrainConfig)).toBe(false);
    }
    f.presentation.dispose();
});

it('prepares immutable CPU metadata and copies active buffers/layers before committing anchors', () => {
    const f = fixture();
    const node = f.presentation.positionNode;
    const commit = f.presentation.prepare(f.source);
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.commitAnchors).not.toHaveBeenCalled();
    expect(f.presentation.leafStorage.data[0]).toBe(0);
    expect(f.bufferCopy.mock.calls.map(call => call[4])).toEqual([48, 48]);
    expect(f.textureCopy.mock.calls[0][2]).toEqual([4, 4, 3]);
    f.source.leafStorage.data.fill(99);
    commit();
    expect(f.presentation.leafStorage.data[0]).toBe(3);
    expect(f.submit).toHaveBeenCalledTimes(1);
    expect(f.commitAnchors).toHaveBeenCalledTimes(1);
    expect(f.submit.mock.invocationCallOrder[0]).toBeLessThan(f.commitAnchors.mock.invocationCallOrder[0]);
    f.source.count = 1;
    f.presentation.prepare(f.source)();
    expect(f.presentation.positionNode).toBe(node);
    f.presentation.dispose();
});

it('copies only occupied atlas rows and the final partial row', () => {
    const f = fixture(true);
    f.source.count = 7;
    f.presentation.prepare(f.source)();
    expect(f.textureCopy.mock.calls.map(call => call[2])).toEqual([[12, 8, 1], [4, 4, 1]]);
    expect(f.textureCopy.mock.calls[1][0].origin).toEqual([0, 8, 0]);
    expect(f.textureCopy.mock.calls[1][1].origin).toEqual([0, 8, 0]);
    f.presentation.dispose();
});

it('leaves last-good metadata/anchors unchanged on prepare or submission failure', () => {
    const f = fixture();
    f.presentation.prepare(f.source)();
    const previous = f.presentation.leafStorage.data.slice();
    f.source.leafStorage.data.fill(8);
    f.prepareAnchors.mockImplementationOnce(() => { throw new Error('prepare failed'); });
    expect(() => f.presentation.prepare(f.source)).toThrow('prepare failed');
    expect(f.presentation.leafStorage.data).toEqual(previous);
    const commit = f.presentation.prepare(f.source);
    f.submit.mockImplementationOnce(() => { throw new Error('submit failed'); });
    expect(commit).toThrow('submit failed');
    expect(f.presentation.leafStorage.data).toEqual(previous);
    expect(f.commitAnchors).toHaveBeenCalledTimes(1);
    f.presentation.dispose();
});

it('validates copy availability, usage and compatibility before submission', () => {
    const f = fixture();
    f.get(f.source.boundsAttribute).buffer.usage = 0;
    expect(() => f.presentation.prepare(f.source)).toThrow('buffer copy');
    f.get(f.source.boundsAttribute).buffer.usage = 12;
    f.get(f.source.field.texture).texture.usage = 0;
    expect(() => f.presentation.prepare(f.source)).toThrow('texture copy');
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.commitAnchors).not.toHaveBeenCalled();
    f.presentation.dispose();
});

it('disposes only owned resources, once, and rejects use after disposal', () => {
    const f = fixture();
    f.presentation.prepare(f.source)();
    f.backend.createStorageAttribute(f.precisionAttribute);
    const textureDispose = vi.spyOn(f.presentation.field.texture, 'dispose');
    f.presentation.dispose(); f.presentation.dispose();
    expect(textureDispose).toHaveBeenCalledTimes(1);
    expect(f.backend.destroyAttribute.mock.calls.map(call => call[0])).toEqual([
        f.presentation.leafStorage.attribute, f.presentation.boundsAttribute, f.precisionAttribute,
    ]);
    expect(f.get(f.source.leafStorage.attribute).buffer).toBeDefined();
    expect(() => f.presentation.prepare(f.source)).toThrow('disposed');
    expect(supportsPresentationCopy({ backend: {} } as unknown as WebGPURenderer)).toBe(false);
});


it('first Three attribute binding retains preinitialized GPU bounds without uploading CPU zeros', () => {
    const f = fixture();
    f.presentation.prepare(f.source)();
    const bounds = f.presentation.boundsAttribute;
    const buffer = f.get(bounds).buffer;
    const updateAttribute = vi.fn();
    const attributes = new Attributes({ ...f.backend, updateAttribute } as any);
    attributes.update(bounds, AttributeType.STORAGE);
    attributes.update(bounds, AttributeType.STORAGE);
    expect(f.get(bounds).buffer).toBe(buffer);
    expect(updateAttribute).not.toHaveBeenCalled();
    f.presentation.dispose();
});

it('keeps compatible draw identity and fences old presentation resources on structural replacement', async () => {
    const f = fixture();
    const fence = vi.fn(() => Promise.resolve());
    Object.assign(f.backend.device.queue, { onSubmittedWorkDone: fence });
    Object.assign(f.renderer, { compute: vi.fn() });
    const initTexture = vi.mocked(f.renderer.initTexture);
    initTexture.mockClear();
    f.backend.get = (resource: any) => {
        const entry = f.get(resource);
        if (resource?.isStorageBufferAttribute) entry.buffer ??= { size: resource.array.byteLength, usage: 12 };
        if (resource?.isTexture) entry.texture ??= { width: resource.image.width, height: resource.image.height,
            depthOrArrayLayers: resource.image.depth ?? 1, format: resource.type, usage: 3 };
        return entry;
    };
    const terrain = createTerrain({ ...f.config, renderer: f.renderer, queries: { readback: 'disabled' } });
    const view = { position: [0, 10, 0] as [number, number, number] };
    expect((await terrain.update(view)).status).toBe('published');
    const firstNode = terrain.getRender()!.positionNode;
    const firstTexture = initTexture.mock.calls[0][0];
    const disposeOldTexture = vi.spyOn(firstTexture, 'dispose');
    terrain.configure({ elevation: () => float(2), elevationRange: { min: 2, max: 2 } });
    expect((await terrain.update(view)).status).toBe('published');
    expect(terrain.getRender()!.positionNode).toBe(firstNode);
    expect(disposeOldTexture).not.toHaveBeenCalled();
    let finish!: () => void;
    fence.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    terrain.configure({ innerTileSegments: 2 });
    const changed = terrain.update(view);
    // An incompatible retired production slot can itself need an earlier fence.
    await vi.waitFor(() => expect(finish).toBeDefined());
    expect(disposeOldTexture).not.toHaveBeenCalled();
    finish();
    expect((await changed).status).toBe('published');
    expect(terrain.getRender()!.positionNode).not.toBe(firstNode);
    expect(disposeOldTexture).toHaveBeenCalledTimes(1);
    await terrain.dispose();
    expect(disposeOldTexture).toHaveBeenCalledTimes(1);
    f.presentation.dispose();
});

it('retains rotating resources for a custom precision hook without transactional preparation', async () => {
    const f = fixture();
    Object.assign(f.backend.device.queue, { onSubmittedWorkDone: vi.fn(async () => {}) });
    Object.assign(f.renderer, { compute: vi.fn() });
    const update = vi.fn();
    f.config.topology.projection.gpu.createRenderPrecision = () => ({ positionNode: float(1), attribute: new StorageBufferAttribute(new Float32Array(36), 4), update });
    const initTexture = vi.mocked(f.renderer.initTexture);
    initTexture.mockClear();
    const terrain = createTerrain({ ...f.config, renderer: f.renderer, queries: { readback: 'disabled' } });
    const view = { position: [0, 10, 0] as [number, number, number] };
    expect((await terrain.update(view)).status).toBe('published');
    const first = terrain.getRender()!.positionNode;
    terrain.configure({ elevation: () => float(2) });
    expect((await terrain.update(view)).status).toBe('published');
    expect(terrain.getRender()!.positionNode).not.toBe(first);
    expect(update).toHaveBeenCalledTimes(2);
    expect(initTexture).not.toHaveBeenCalled();
    await terrain.dispose();
    f.presentation.dispose();
});


it('falls back when the backend exposes a device without callable copy submission facilities', () => {
    const f = fixture();
    expect(supportsPresentationCopy(f.renderer)).toBe(true);
    const variant = (device: unknown) => ({ ...f.renderer, backend: { ...f.backend, device } }) as unknown as WebGPURenderer;
    expect(supportsPresentationCopy(variant({ ...f.backend.device, createCommandEncoder: undefined }))).toBe(false);
    expect(supportsPresentationCopy(variant({ ...f.backend.device, createCommandEncoder: true }))).toBe(false);
    expect(supportsPresentationCopy(variant({ ...f.backend.device, queue: undefined }))).toBe(false);
    expect(supportsPresentationCopy(variant({ ...f.backend.device, queue: { submit: true } }))).toBe(false);
    f.presentation.dispose();
});
