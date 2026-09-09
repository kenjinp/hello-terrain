import { expect, it, vi } from 'vitest';
import { float } from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { createTerrainRuntime } from './runtime';
import { createTerrainBinding } from './binding';
import { createFlatTopology } from '../quadtree/topology/flat';
import type { Terrain, TerrainConfig } from './three';

it('transforms samples/rays once, pins lease placement, and preserves borrowed material', async () => {
    const config = {
        topology: createFlatTopology({ rootSize: 256, origin: { x: 0, y: 0, z: 0 } }),
        maxNodes: 1,
        innerTileSegments: 4,
    } as TerrainConfig;
    const runtime = createTerrainRuntime(
        {
            resolve: (c: TerrainConfig) => c,
            equal: () => true,
            async produce() {
                return {
                    render: null,
                    retire: async () => {},
                    snapshot: async () => ({
                        sample: (point, revision) => ({
                            status: 'available' as const,
                            revision,
                            position: [point[0], 5, point[2]],
                            normal: [0, 1, 0],
                            elevation: 5,
                            sampleSpacing: 1,
                            tile: { space: 0, level: 0, x: 0, y: 0 },
                        }),
                        dispose() {},
                    }),
                };
            },
            dispose: async () => {},
        },
        config,
        { readback: 'on-change' }
    );
    await runtime.update({ position: [0, 10, 0] });
    const material = new MeshStandardNodeMaterial(),
        dispose = vi.spyOn(material, 'dispose');
    const binding = createTerrainBinding(runtime as unknown as Terrain, { material });
    binding.mesh.position.set(10, 20, 30);
    binding.mesh.scale.set(2, 3, 4);
    binding.mesh.rotation.z = Math.PI / 2;
    const sample = binding.sampleWorld([-287, 26, 46]);
    expect(sample.status).toBe('available');
    if (sample.status !== 'available') throw new Error('Expected sample');
    expect(sample.position[0]).toBeCloseTo(-5);
    expect(sample.position[1]).toBeCloseTo(26);
    expect(sample.position[2]).toBeCloseTo(46);
    expect(sample.normal[0]).toBeCloseTo(-1);
    expect(sample.elevation).toBe(5);
    const hit = binding.raycastWorld([100, 26, 46], [-1, 0, 0], { far: 200 });
    expect(hit.status).toBe('hit');
    if (hit.status === 'hit') expect(hit.distance).toBeCloseTo(105, 2);
    const lease = binding.acquireSnapshot()!;
    binding.mesh.position.x += 1000;
    const pinned = lease.sampleWorld([-287, 26, 46]);
    expect(pinned.status === 'available' && pinned.position[0]).toBeCloseTo(-5);
    binding.mesh.scale.x = 0;
    expect(() => binding.sampleWorld([0, 0, 0])).toThrow('singular');
    lease.release();
    await binding.dispose();
    await runtime.dispose();
    expect(dispose).not.toHaveBeenCalled();
    material.dispose();
});


it('publishes to an externally attached draw material before retiring the old GPU record', async () => {
    const config = { topology: createFlatTopology({ rootSize: 16, origin: { x: 0, y: 0, z: 0 } }), maxNodes: 1, innerTileSegments: 4 } as TerrainConfig;
    const firstNode = float(1), secondNode = float(2), child = new MeshStandardNodeMaterial();
    let count = 0;
    const runtime = createTerrainRuntime({ resolve: (value: TerrainConfig) => value, equal: () => true,
        async produce() {
            const number = ++count;
            return { render: { config, count: 1, positionNode: number === 1 ? firstNode : secondNode },
                snapshot: async () => { throw new Error('disabled'); },
                async retire() { if (number === 1) expect(child.positionNode).toBe(secondNode); },
            };
        }, dispose: async () => {},
    }, config, { readback: 'disabled' });
    const binding = createTerrainBinding(runtime as unknown as Terrain, { externalMaterialAttachment: true });
    await runtime.update({ position: [0, 10, 0] });
    child.positionNode = firstNode; binding.mesh.material = child;
    await runtime.update({ position: [0, 11, 0] });
    expect(child.positionNode).toBe(secondNode);
    await binding.dispose(); await runtime.dispose(); child.dispose();
});
