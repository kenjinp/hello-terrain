import { task } from "@hello-terrain/work";
import { createTerrainSampler } from "../query/terrain-sampler";
import { elevationFn } from "./params";
import { gpuSpatialIndexStorageTask } from "./gpuSpatialIndex.task";
import { createTerrainFieldTextureTask } from "./terrain-field.task";
import { createUniformsTask } from "./uniforms/uniforms.task";

export const createTerrainSamplerTask = task((get, work) => {
  const terrainFieldStorage = get(createTerrainFieldTextureTask);
  const spatialIndex = get(gpuSpatialIndexStorageTask);
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
