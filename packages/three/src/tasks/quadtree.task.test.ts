import { graph } from '@hello-terrain/work';
import type { WebGPURenderer } from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import { createInitialCameraView, readCameraView } from './cameraView.js';
import { elevationScale, cameraView, maxNodes } from './params.js';
import { leafStorageTask, terrainFieldContentEpochTask } from './quadtree.task.js';

async function readFieldContentEpoch(g: ReturnType<typeof graph>) {
    await g.run({ targets: [terrainFieldContentEpochTask] });
    return g.get(terrainFieldContentEpochTask);
}

describe('tasks/quadtree', () => {
    it('advances field content epoch only for field-affecting dependency changes', async () => {
        const g = graph();
        g.add(terrainFieldContentEpochTask);

        const first = await readFieldContentEpoch(g);

        g.set(cameraView, {
            cameraOrigin: { x: 10, y: 20, z: 30 },
            viewProjectionMatrix: Array.from({ length: 16 }, (_, i) => i),
        });
        const afterCameraUpdate = await readFieldContentEpoch(g);
        expect(afterCameraUpdate).toBe(first);

        g.set(elevationScale, 2);
        const afterFieldUpdate = await readFieldContentEpoch(g);
        expect(afterFieldUpdate).toBe(first + 1);
    });

    it('exports readCameraView helper for consumer loops', () => {
        const out = createInitialCameraView();
        expect(out.cameraOrigin).toEqual({ x: 0, y: 0, z: 0 });
        expect(out.viewProjectionMatrix.length).toBe(16);
        expect(typeof readCameraView).toBe('function');
    });

    it('disposes the previous leaf storage when maxNodes legitimately changes', async () => {
        const g = graph<{ renderer: WebGPURenderer }>();
        g.add(leafStorageTask);
        // Headless: tasks guard on resources?.renderer, so a stub is sufficient.
        const resources = { renderer: undefined as unknown as WebGPURenderer };

        await g.run({ targets: [leafStorageTask], resources });
        const first = g.get(leafStorageTask);
        const disposeSpy = vi.fn();
        first.dispose = disposeSpy;

        // Same value: gated by param equality — no re-run, no disposal.
        g.set(maxNodes, first.data.length / 4);
        await g.run({ targets: [leafStorageTask], resources });
        expect(g.get(leafStorageTask)).toBe(first);
        expect(disposeSpy).not.toHaveBeenCalled();

        // Real change: storage is recreated and the previous one disposed.
        g.set(maxNodes, first.data.length / 4 + 8);
        await g.run({ targets: [leafStorageTask], resources });
        const second = g.get(leafStorageTask);
        expect(second).not.toBe(first);
        expect(disposeSpy).toHaveBeenCalledTimes(1);

        // Graph disposal releases the final storage via the task disposer.
        const finalDisposeSpy = vi.fn();
        second.dispose = finalDisposeSpy;
        g.dispose();
        expect(finalDisposeSpy).toHaveBeenCalledTimes(1);
    });
});
