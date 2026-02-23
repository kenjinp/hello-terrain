import { task } from "@hello-terrain/work";
import { createGpuSpatialIndex, uploadGpuSpatialIndex } from "../query/gpuSpatialIndex";
import { maxNodes } from "./params";
import { quadtreeConfigTask, quadtreeUpdateTask } from "./quadtree.task";

export const gpuSpatialIndexStorageTask = task((get, work) => {
  const maxNodesValue = get(maxNodes);
  return work(() => createGpuSpatialIndex(maxNodesValue));
}).displayName("gpuSpatialIndexStorageTask");

export const gpuSpatialIndexUploadTask = task((get, work) => {
  const quadtreeConfig = get(quadtreeConfigTask);
  get(quadtreeUpdateTask);
  const gpuSpatialIndex = get(gpuSpatialIndexStorageTask);

  return work(() => {
    uploadGpuSpatialIndex(gpuSpatialIndex, quadtreeConfig.state.leafIndex);
    return gpuSpatialIndex;
  });
}).displayName("gpuSpatialIndexUploadTask");
