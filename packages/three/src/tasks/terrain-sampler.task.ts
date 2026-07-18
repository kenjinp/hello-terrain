import { task } from '@hello-terrain/work';
import { createTerrainSampler } from '../query/terrain-sampler';
import { elevationFn, maxLevel } from './params';
import { gpuSpatialIndexStorageTask } from './gpuSpatialIndex.task';
import { topologyTask } from './quadtree.task';
import { createTerrainFieldTextureTask } from './terrain-field.task';
import { tileBoundsContextTask } from './tile-bounds.task';
import { updateUniformsTask } from './uniforms/uniforms.task';

export const createTerrainSamplerTask = task((get, work) => {
    const terrainFieldStorage = get(createTerrainFieldTextureTask);
    const tileBoundsContext = get(tileBoundsContextTask);
    const spatialIndex = get(gpuSpatialIndexStorageTask);
    const uniforms = get(updateUniformsTask);
    const elevationCallback = get(elevationFn);
    const maxLevelValue = get(maxLevel);
    const projection = get(topologyTask).projection;

    return work(() =>
        createTerrainSampler({
            terrainFieldStorage,
            tileBoundsNode: tileBoundsContext.node,
            spatialIndex,
            uniforms,
            elevationCallback,
            maxLevel: maxLevelValue,
            projection,
        })
    );
}).displayName('createTerrainSamplerTask');
