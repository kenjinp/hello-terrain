import { task } from "@hello-terrain/work";
import { createGpuSpatialIndex, uploadGpuSpatialIndex } from "../query/gpuSpatialIndex";
import { maxNodes } from "./params";
import { visibleLeafSetTask } from "./quadtree.task";

export const gpuSpatialIndexStorageTask = task((get, work) => {
  const maxNodesValue = get(maxNodes);
  return work(() => createGpuSpatialIndex(maxNodesValue));
}).displayName("gpuSpatialIndexStorageTask");

export const gpuSpatialIndexUploadTask = task((get, work) => {
  const visibleLeafSet = get(visibleLeafSetTask);
  const gpuSpatialIndex = get(gpuSpatialIndexStorageTask);

  return work(() => {
    uploadGpuSpatialIndex(gpuSpatialIndex, visibleLeafSet.index);
    return gpuSpatialIndex;
  });
}).displayName("gpuSpatialIndexUploadTask");
