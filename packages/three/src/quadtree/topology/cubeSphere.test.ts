import { describe, expect, it } from 'vitest';
import { Dir, type TileId } from '../types.js';
import { createState } from '../state.js';
import { update } from '../update.js';
import { createCubeSphereTopology } from './cubeSphere.js';

const DIRS: Dir[] = [Dir.LEFT, Dir.RIGHT, Dir.TOP, Dir.BOTTOM];

function tilesEqual(a: TileId, b: TileId): boolean {
    return a.space === b.space && a.level === b.level && a.x === b.x && a.y === b.y;
}

describe('quadtree/topology/cubeSphere', () => {
    it('emits six level-0 root faces', () => {
        const topology = createCubeSphereTopology({ radius: 1000 });
        const out: TileId[] = Array.from({ length: 6 }, () => ({
            space: -1,
            level: -1,
            x: -1,
            y: -1,
        }));

        const count = topology.rootTiles({ x: 0, y: 0, z: 0 }, out);
        expect(count).toBe(6);
        for (let s = 0; s < 6; s++) {
            expect(out[s]).toEqual({ space: s, level: 0, x: 0, y: 0 });
        }
    });

    it('computes in-face neighbors like a bounded grid', () => {
        const topology = createCubeSphereTopology({ radius: 1000 });
        const out: TileId = { space: 0, level: 0, x: 0, y: 0 };

        // Interior tile on a 4x4 face (level 2).
        expect(topology.neighborSameLevel({ space: 4, level: 2, x: 1, y: 1 }, Dir.RIGHT, out)).toBe(
            true
        );
        expect(out).toEqual({ space: 4, level: 2, x: 2, y: 1 });

        expect(topology.neighborSameLevel({ space: 4, level: 2, x: 1, y: 1 }, Dir.BOTTOM, out)).toBe(
            true
        );
        expect(out).toEqual({ space: 4, level: 2, x: 1, y: 2 });
    });

    it('is a closed surface: every edge has a valid neighbor', () => {
        const topology = createCubeSphereTopology({ radius: 1000 });
        const out: TileId = { space: 0, level: 0, x: 0, y: 0 };

        for (let level = 1; level <= 3; level++) {
            const n = 1 << level;
            for (let space = 0; space < 6; space++) {
                for (let x = 0; x < n; x++) {
                    for (let y = 0; y < n; y++) {
                        for (const dir of DIRS) {
                            const ok = topology.neighborSameLevel({ space, level, x, y }, dir, out);
                            expect(ok).toBe(true);
                            expect(out.space).toBeGreaterThanOrEqual(0);
                            expect(out.space).toBeLessThan(6);
                            expect(out.level).toBe(level);
                            expect(out.x).toBeGreaterThanOrEqual(0);
                            expect(out.x).toBeLessThan(n);
                            expect(out.y).toBeGreaterThanOrEqual(0);
                            expect(out.y).toBeLessThan(n);
                        }
                    }
                }
            }
        }
    });

    it('neighbor relationships are mutual across face edges', () => {
        const topology = createCubeSphereTopology({ radius: 1000 });
        const neighbor: TileId = { space: 0, level: 0, x: 0, y: 0 };
        const back: TileId = { space: 0, level: 0, x: 0, y: 0 };

        const level = 2;
        const n = 1 << level;
        for (let space = 0; space < 6; space++) {
            for (let x = 0; x < n; x++) {
                for (let y = 0; y < n; y++) {
                    const tile: TileId = { space, level, x, y };
                    for (const dir of DIRS) {
                        topology.neighborSameLevel(tile, dir, neighbor);
                        const neighborCopy: TileId = { ...neighbor };

                        // `tile` must appear among the neighbor's own neighbors.
                        let mutual = false;
                        for (const dir2 of DIRS) {
                            topology.neighborSameLevel(neighborCopy, dir2, back);
                            if (tilesEqual(back, tile)) {
                                mutual = true;
                                break;
                            }
                        }
                        expect(mutual).toBe(true);
                    }
                }
            }
        }
    });

    it('crosses faces at level-1 edges', () => {
        const topology = createCubeSphereTopology({ radius: 1000 });
        const out: TileId = { space: 0, level: 0, x: 0, y: 0 };

        // The LEFT edge of the +X face (space 0) must leave the face.
        expect(topology.neighborSameLevel({ space: 0, level: 1, x: 0, y: 0 }, Dir.LEFT, out)).toBe(
            true
        );
        expect(out.space).not.toBe(0);
        expect(out.x).toBeGreaterThanOrEqual(0);
        expect(out.x).toBeLessThan(2);
        expect(out.y).toBeGreaterThanOrEqual(0);
        expect(out.y).toBeLessThan(2);
    });

    it('produces conservative finite bounds', () => {
        const topology = createCubeSphereTopology({ radius: 1000 });
        const out = { cx: 0, cy: 0, cz: 0, r: 0 };

        topology.tileBounds({ space: 0, level: 0, x: 0, y: 0 }, { x: 0, y: 0, z: 0 }, out);
        expect(Number.isFinite(out.r)).toBe(true);
        expect(out.r).toBeGreaterThan(0);
        // A whole face's bounding radius cannot exceed the sphere diameter.
        expect(out.r).toBeLessThan(2000 + 1);

        // Deeper tiles are smaller.
        const deep = { cx: 0, cy: 0, cz: 0, r: 0 };
        topology.tileBounds({ space: 0, level: 4, x: 0, y: 0 }, { x: 0, y: 0, z: 0 }, deep);
        expect(deep.r).toBeLessThan(out.r);
    });

    it('exposes the cube-sphere projection and radius', () => {
        const topology = createCubeSphereTopology({ radius: 1234 });
        expect(topology.projection.kind).toBe('cubeSphere');
        expect(topology.cacheKey).toBe(topology.projection.cacheKey);
        expect(topology.projection.radius).toBe(1234);
        expect(topology.spaceCount).toBe(6);
        expect(topology.maxRootCount).toBe(6);
    });

    it('keys radius and center changes for cache invalidation', () => {
        const base = createCubeSphereTopology({ radius: 1000 });
        const grown = createCubeSphereTopology({ radius: 2000 });
        const shifted = createCubeSphereTopology({
            radius: 1000,
            center: { x: 1, y: 2, z: 3 },
        });
        const inverted = createCubeSphereTopology({ radius: 1000, invert: true });

        expect(
            new Set([base.cacheKey, grown.cacheKey, shifted.cacheKey, inverted.cacheKey]).size
        ).toBe(4);
        expect(base.projection.cacheKey).toBe(base.cacheKey);
    });

    it('runs a full LOD update without throwing and respects the node budget', () => {
        const topology = createCubeSphereTopology({ radius: 1000 });
        const state = createState({ maxNodes: 8192, maxLevel: 8 }, topology);

        const leaves = update(state, topology, {
            cameraOrigin: { x: 1200, y: 0, z: 0 },
            mode: 'distance',
            distanceFactor: 1.0,
        });

        expect(leaves.count).toBeGreaterThan(6);
        expect(leaves.count).toBeLessThanOrEqual(leaves.capacity);

        // Every leaf belongs to a valid face and lies within its level grid.
        for (let i = 0; i < leaves.count; i++) {
            const level = leaves.level[i];
            const n = 1 << level;
            expect(leaves.space[i]).toBeGreaterThanOrEqual(0);
            expect(leaves.space[i]).toBeLessThan(6);
            expect(leaves.x[i]).toBeGreaterThanOrEqual(0);
            expect(leaves.x[i]).toBeLessThan(n);
            expect(leaves.y[i]).toBeGreaterThanOrEqual(0);
            expect(leaves.y[i]).toBeLessThan(n);
        }
    });
});
