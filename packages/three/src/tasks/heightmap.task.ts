import { task } from "@hello-terrain/work";
import { storage } from "three/tsl";
import { StorageBufferAttribute } from "three/webgpu";
import type { ComputePipeline } from "../compute/gpu";
import { createElevationFunction } from "../nodes/elevation/elevation";
import { createElevation } from "../nodes/elevation/heights";
import { createTileCompute } from "../nodes/tile";
import { elevationFn, innerTileSegments, maxNodes } from "./params";
import { leafStorageTask } from "./quadtree.task";
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

/**
 * Root compute stage — generates elevation data and writes to the
 * heightmap storage buffer. Returns a single-element `ComputePipeline`.
 */
export const heightmapStageTask = task((get, work) => {
  const tile = get(createTileNodes);
  const uniforms = get(createUniformsTask);
  const heightmapContext = get(createHeightmapContextTask);
  const userElevationFn = get(elevationFn);

  return work((): ComputePipeline => {
    const heightFn = createElevationFunction(userElevationFn);
    const heightWriteFn = createElevation(tile, uniforms, heightFn);
    return [
      (nodeIndex, globalVertexIndex, uv) => {
        const height = heightWriteFn(nodeIndex, uv);
        heightmapContext.node.element(globalVertexIndex).assign(height);
      },
    ];
  });
}).displayName("heightmapStage");
