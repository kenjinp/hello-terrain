import { task } from '@hello-terrain/work';
import type { WebGPURenderer } from 'three/webgpu';
import { createGpuSpatialIndex, uploadGpuSpatialIndex } from '../query/gpuSpatialIndex';
import { maxNodes } from './params';
import { residentLeafSetTask } from './quadtree.task';

export const gpuSpatialIndexStorageTask = task<{ renderer: WebGPURenderer }>((get, work, ctx) => {
    const maxNodesValue = get(maxNodes);
    return work((prev?: ReturnType<typeof createGpuSpatialIndex>) => {
        prev?.dispose?.();
        return createGpuSpatialIndex(maxNodesValue, ctx.resources?.renderer);
    });
})
    .displayName('gpuSpatialIndexStorageTask')
    .disposer((context) => context.dispose?.());

export const gpuSpatialIndexUploadTask = task((get, work, ctx) => {
    const residentLeafSet = get(residentLeafSetTask);
    const gpuSpatialIndex = get(gpuSpatialIndexStorageTask);

    return work(() => {
        if (ctx.signal.aborted) {
            throw ctx.signal.reason ?? new Error('Terrain GPU spatial index upload aborted');
        }
        uploadGpuSpatialIndex(gpuSpatialIndex, residentLeafSet.index);
        return gpuSpatialIndex;
    });
}).displayName('gpuSpatialIndexUploadTask');
