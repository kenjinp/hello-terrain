import { task } from "@hello-terrain/work";
import { storage } from "three/tsl";
import { StorageBufferAttribute } from "three/webgpu";
import type { ComputePipeline } from "../gpu/compute";
import { createElevation } from "../gpu/elevation-field";
import { elevationFn, innerTileSegments, maxNodes, surfaceProjection } from "./params";
import { leafStorageTask } from "./quadtree.task";
import { createElevationFunction } from "../tsl/elevation";
import { createUniformsTask } from "./uniforms/uniforms.task";

export const createElevationFieldContextTask = task((get, work) => {
  const edgeVertexCount = get(innerTileSegments) + 3;
  const verticesPerNode = edgeVertexCount * edgeVertexCount; // 289
  const totalElements = get(maxNodes) * verticesPerNode;
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
}).displayName("createElevationFieldContextTask");

export const tileNodesTask = task((get, work) => {
  const leafStorage = get(leafStorageTask);
  const uniforms = get(createUniformsTask);
  const projection = get(surfaceProjection);
  return work(() => {
    return projection.createTileCompute(leafStorage, uniforms);
  });
}).displayName("tileNodesTask");

/**
 * Root compute stage — generates elevation data and writes to the
 * elevation field storage buffer. Returns a single-element `ComputePipeline`.
 */
export const elevationFieldStageTask = task((get, work) => {
  const tile = get(tileNodesTask);
  const uniforms = get(createUniformsTask);
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
}).displayName("elevationFieldStageTask");
