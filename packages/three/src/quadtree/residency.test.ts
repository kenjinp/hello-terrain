import { describe, expect, it } from 'vitest';
import { computeTileResidency } from './residency.js';
import { createFlatTopology } from './topology/flat.js';
import { allocLeafSet } from './types.js';
import type { TileVisibilityState } from './visibility.js';

function makeLeaves() {
    const leaves = allocLeafSet(2);
    leaves.count = 2;
    leaves.level[0] = 1;
    leaves.x[0] = 0;
    leaves.y[0] = 0;
    leaves.level[1] = 1;
    leaves.x[1] = 1;
    leaves.y[1] = 1;
    return leaves;
}

function visibleOnly(index: number): TileVisibilityState {
    return {
        visibleCandidateIndices: new Uint32Array([index]),
        visibilityState: new Uint8Array(2),
        telemetry: {
            candidateCount: 2,
            visibleCount: 1,
            guardCount: 0,
            frustumCulledCount: 1,
            horizonCulledCount: 0,
            unculledCount: 0,
            visibleRatio: 0.5,
        },
    };
}

describe('quadtree/residency', () => {
    it('keeps visible tiles resident and adds anchor-intersecting culled tiles', () => {
        const leaves = makeLeaves();
        const topology = createFlatTopology({
            rootSize: 100,
            origin: { x: 0, y: 0, z: 0 },
        });

        const state = computeTileResidency({
            leaves,
            visibility: visibleOnly(1),
            topology,
            cameraOrigin: { x: 0, y: 0, z: 0 },
            residency: {
                anchors: [
                    {
                        position: { x: -25, y: 0, z: -25 },
                        radius: 1,
                    },
                ],
            },
        });

        expect(state.telemetry.visibleResidentCount).toBe(1);
        expect(state.telemetry.anchorResidentCount).toBe(1);
        expect(state.telemetry.residentCount).toBe(2);
        expect(Array.from(state.residentCandidateIndices.subarray(0, 2))).toEqual([1, 0]);
    });
});
