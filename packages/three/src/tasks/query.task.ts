import { task } from "@hello-terrain/work";
import {
  createGpuSpatialIndexData,
  createGpuSpatialIndexState,
  updateGpuSpatialIndexState,
  type GpuSpatialIndexState,
} from "../query/gpuSpatialIndex";
import { createGpuBatchQueryRunner } from "../query/gpuBatchQuery";
import { createTerrainSampler } from "../query/tslSampler";
import {
  createTerrainQuery,
  type TerrainQueryParams,
} from "../query/terrainQuery";
import type { SpatialIndex } from "../quadtree/leafIndex";
import {
  elevationFn,
  maxLevel,
  origin,
  rootSize,
  innerTileSegments,
  elevationScale,
} from "./params";
import { quadtreeUpdateTask } from "./quadtree.task";
import { terrainReadbackTask } from "./readback.task";
import { createTerrainFieldTextureTask } from "./terrain-field.task";
import { createUniformsTask } from "./uniforms/uniforms.task";
import type { WebGPURenderer } from "three/webgpu";

export interface TerrainQueryContext {
  gpuSpatialLeafIndex?: SpatialIndex;
  gpuSpatialIndexState?: GpuSpatialIndexState;
}

export const createTerrainQueryContextTask = task((_get, work) =>
  work((): TerrainQueryContext => ({})),
).displayName("createTerrainQueryContextTask");

export const terrainQueryTask = task((get, work) => {
  const leafSet = get(quadtreeUpdateTask);
  const readback = get(terrainReadbackTask);
  const originValue = get(origin);
  const rootSizeValue = get(rootSize);
  const innerSegmentsValue = get(innerTileSegments);
  const elevationScaleValue = get(elevationScale);
  const maxLevelValue = get(maxLevel);

  const params: TerrainQueryParams = {
    rootOrigin: { x: originValue.x, z: originValue.z },
    rootSize: rootSizeValue,
    innerTileSegments: innerSegmentsValue,
    elevationScale: elevationScaleValue,
    maxLevel: maxLevelValue,
  };

  return work(() => {
    if (!readback.ready) return undefined;
    return createTerrainQuery(leafSet, readback.cache, params);
  });
}).displayName("terrainQueryTask");

export const gpuSpatialIndexTask = task((get, work) => {
  const queryContext = get(createTerrainQueryContextTask);
  const leafSet = get(quadtreeUpdateTask);
  const maxLevelValue = get(maxLevel);

  return work(() => {
    const { data, index } = createGpuSpatialIndexData(
      leafSet,
      maxLevelValue,
      queryContext.gpuSpatialLeafIndex,
    );
    queryContext.gpuSpatialLeafIndex = index;
    if (
      !queryContext.gpuSpatialIndexState ||
      queryContext.gpuSpatialIndexState.data.size !== data.size
    ) {
      queryContext.gpuSpatialIndexState = createGpuSpatialIndexState(
        data,
        maxLevelValue,
      );
    } else {
      queryContext.gpuSpatialIndexState = updateGpuSpatialIndexState(
        queryContext.gpuSpatialIndexState,
        data,
        maxLevelValue,
      );
    }
    return queryContext.gpuSpatialIndexState;
  });
}).displayName("gpuSpatialIndexTask");

export const createTerrainSamplerTask = task((get, work) => {
  const terrainFieldStorage = get(createTerrainFieldTextureTask);
  const spatialIndex = get(gpuSpatialIndexTask);
  const uniforms = get(createUniformsTask);
  const elevationCallback = get(elevationFn);

  return work(() =>
    createTerrainSampler({
      terrainFieldStorage,
      spatialIndex,
      uniforms,
      elevationCallback,
    }),
  );
}).displayName("createTerrainSamplerTask");

export const gpuBatchQueryTask = task<{ renderer: WebGPURenderer }>(
  (get, work, { resources }) => {
    const sampler = get(createTerrainSamplerTask);
    return work(() => createGpuBatchQueryRunner(resources?.renderer, sampler));
  },
)
  .displayName("gpuBatchQueryTask")
  .lane("gpu");
