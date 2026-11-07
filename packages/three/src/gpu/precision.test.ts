import { expect, it, vi } from 'vitest';
const nodes = vi.hoisted(() => [] as any[]);
vi.mock('three/tsl', async importOriginal => {
    const actual = await importOriginal<typeof import('three/tsl')>();
    return { ...actual, storage: (...args: Parameters<typeof actual.storage>) => {
        const node = actual.storage(...args); nodes.push(node); return node;
    } };
});
import { float } from 'three/tsl';
import { Matrix4 } from 'three/webgpu';
import { createFlatPrecisionPosition } from './precision';
import { createLeafStorage } from './leafStorage';
import { createTerrainUniforms } from './uniforms';
import { createTerrainMaterialContext } from '../tsl/terrainMaterial';

it('prepares anchors without changing live camera data until commit, including discarded preparations', () => {
    const leafStorage = createLeafStorage(2);
    const uniforms = createTerrainUniforms({ rootSize: 16, rootOrigin: { x: 0, y: 0, z: 0 }, innerTileSegments: 1,
        skirtScale: 1, elevationScale: 1, radius: 1, instanceId: 'test' });
    const precision = createFlatPrecisionPosition({ leafStorage, uniforms, positionNode: float(0), materialContext: createTerrainMaterialContext() });
    const anchor = nodes[nodes.length - 1];
    const frame = { camera: { matrixWorldInverse: new Matrix4() }, object: { matrixWorld: new Matrix4() } };
    const draw = () => { anchor.update(frame); return Array.from(precision.attribute.array); };
    precision.prepare(1, new Int32Array([0, 0, 0, 0]))();
    const original = draw();
    const commit = precision.prepare(1, new Int32Array([1, 0, 0, 0]));
    expect(draw()).toEqual(original);
    precision.prepare(1, new Int32Array([1, 1, 1, 0])); // discarded/aborted candidate
    expect(draw()).toEqual(original);
    expect(() => precision.prepare(3)).toThrow('anchor count');
    expect(draw()).toEqual(original);
    commit();
    expect(draw().slice(0, 3)).toEqual([-4, 0, -4]);
});
