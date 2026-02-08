import { task } from "@hello-terrain/work";
import { storage } from "three/tsl";
import { StorageBufferAttribute, WebGPURenderer } from "three/webgpu";
import { createComputeToBufferMap } from "../compute/gpu";
import { createElevationFunction } from "../nodes/elevation/elevation";
import { createElevation } from "../nodes/elevation/heights";
import { createTileCompute } from "../nodes/tile";
import { elevationFn, innerTileSegments, maxNodes } from "./params";
import { leafGpuBufferTask, leafStorageTask } from "./quadtree.task";
import { createUniformsTask } from "./uniforms/uniforms.task";

export const createHeightmapContextTask = task((get, work) => {
  const edgeVertexCount = get(innerTileSegments) + 3;
  const verticesPerNode = edgeVertexCount * edgeVertexCount; // 289
  const totalElements = get(maxNodes) * verticesPerNode; // 1028 * 289 = 297,092
  return work(() => {
    const data = new Float32Array(totalElements);
    const attribute = new StorageBufferAttribute(data, 1);
    const node = storage(attribute, "float", totalElements);

    return {
      data,
      attribute,
      node,
    };
  });
}).displayName("createHeightmapContextTask");

export const createTileNodes = task((get, work) => {
  const leafStorage = get(leafStorageTask);
  const uniforms = get(createUniformsTask);
  return work(() => {
    return createTileCompute(leafStorage, uniforms);
  });
}).displayName("createTileNodes");

export const createComputeHeightmapTask = task((get, work) => {
  const userProvidedElevationFn = get(elevationFn);
  const tile = get(createTileNodes);
  const uniforms = get(createUniformsTask);
  const leafState = get(leafGpuBufferTask);
  const heightmapContext = get(createHeightmapContextTask);
  const tileEdgeVertexCount = get(innerTileSegments) + 3;

  return work(() => {
    const heightFn = createElevationFunction(userProvidedElevationFn);
    // needs as input the nodeIndex and localUV
    const heightWriteFn = createElevation(tile, uniforms, heightFn);
    const { create } = createComputeToBufferMap(
      (nodeIndex, globalVertexIndex, uv, _localCoordinates) => {
        const height = heightWriteFn(nodeIndex, uv);
        heightmapContext.node.element(globalVertexIndex).assign(height);
      },
      leafState.count,
    );
    return create(tileEdgeVertexCount);
  });
}).displayName("createComputeHeightmapTask");

export const computeHeightmapTask = task<{ renderer: WebGPURenderer }>(
  (get, work, { resources }) => {
    const { execute } = get(createComputeHeightmapTask);
    return work(() => (resources?.renderer ? execute(resources?.renderer) : () => {}));
  },
)
  .displayName("computeHeightmapTask")
  .lane("gpu");
