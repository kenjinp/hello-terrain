import { task } from "@hello-terrain/work";
import { createGpuSpatialIndex, uploadGpuSpatialIndex } from "../query/gpuSpatialIndex";
import { maxNodes } from "./params";
import { residentLeafSetTask } from "./quadtree.task";

export const gpuSpatialIndexStorageTask = task((get, work) => {
  const maxNodesValue = get(maxNodes);
  return work(() => createGpuSpatialIndex(maxNodesValue));
}).displayName("gpuSpatialIndexStorageTask");

export const gpuSpatialIndexUploadTask = task((get, work, ctx) => {
  const residentLeafSet = get(residentLeafSetTask);
  const gpuSpatialIndex = get(gpuSpatialIndexStorageTask);

  return work(() => {
    if (ctx.signal.aborted) {
      throw ctx.signal.reason ?? new Error("Terrain GPU spatial index upload aborted");
    }
    uploadGpuSpatialIndex(gpuSpatialIndex, residentLeafSet.index);
    return gpuSpatialIndex;
  });
}).displayName("gpuSpatialIndexUploadTask");
