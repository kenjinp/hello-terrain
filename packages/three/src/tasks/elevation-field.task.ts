import { task } from '@hello-terrain/work';
import { storage } from 'three/tsl';
import { StorageBufferAttribute } from 'three/webgpu';
import type { StorageBufferNode, WebGPURenderer } from 'three/webgpu';
import type { ComputePipeline } from '../gpu/compute';
import { disposeStorageBufferState } from '../gpu/dispose';
import { createElevation } from '../gpu/elevation-field';
import { createTileCompute } from '../gpu/tile';
import { elevationFn, innerTileSegments, maxNodes } from './params';
import { leafStorageTask, topologyTask } from './quadtree.task';
import { createElevationFunction } from '../tsl/elevation';
import { updateUniformsTask } from './uniforms/uniforms.task';

interface ElevationFieldContextState {
    data: Float32Array<ArrayBuffer>;
    attribute: StorageBufferAttribute;
    node: StorageBufferNode;
    /** Releases the GPU buffer backing the elevation field. */
    dispose: () => void;
}

export const createElevationFieldContextTask = task<{ renderer: WebGPURenderer }>(
    (get, work, ctx) => {
        const edgeVertexCount = get(innerTileSegments) + 3;
        const verticesPerNode = edgeVertexCount * edgeVertexCount;
        const totalElements = get(maxNodes) * verticesPerNode;
        return work((prev?: ElevationFieldContextState) => {
            prev?.dispose();
            const renderer = ctx.resources?.renderer;
            const data = new Float32Array(totalElements);
            const attribute = new StorageBufferAttribute(data, 1);
            attribute.name = 'elevationField';
            const node = storage(attribute, 'float', totalElements).setName(
                'elevationField'
            ) as StorageBufferNode;

            const state: ElevationFieldContextState = {
                data,
                attribute,
                node,
                dispose: () => disposeStorageBufferState(renderer, { attribute, node }),
            };
            return state;
        });
    }
)
    .displayName('createElevationFieldContextTask')
    .disposer((state) => state.dispose());

export const tileNodesTask = task((get, work) => {
    const leafStorage = get(leafStorageTask);
    const uniforms = get(updateUniformsTask);
    const topology = get(topologyTask);
    return work(() => {
        return createTileCompute(leafStorage, uniforms, topology.projection);
    });
}).displayName('tileNodesTask');

/**
 * Root compute stage — generates elevation data and writes to the
 * elevation field storage buffer. Returns a single-element `ComputePipeline`.
 */
export const elevationFieldStageTask = task((get, work) => {
    const tile = get(tileNodesTask);
    const uniforms = get(updateUniformsTask);
    const elevationFieldContext = get(createElevationFieldContextTask);
    const userElevationFn = get(elevationFn);

    return work((): ComputePipeline => {
        const heightFn = createElevationFunction(userElevationFn);
        const heightWriteFn = createElevation(tile, uniforms, heightFn);
        return [
            (nodeIndex, globalVertexIndex, _uv, localCoordinates) => {
                const height = heightWriteFn(nodeIndex, localCoordinates);
                elevationFieldContext.node.element(globalVertexIndex).assign(height);
            },
        ];
    });
}).displayName('elevationFieldStageTask');
