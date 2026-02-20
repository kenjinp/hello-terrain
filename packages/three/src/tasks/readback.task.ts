import { task } from "@hello-terrain/work";
import type { WebGPURenderer } from "three/webgpu";
import { readbackTerrainField } from "../query/readback";
import type { TerrainReadbackCache } from "../query/types";
import { executeComputeTask } from "./compute.task";
import { createTerrainFieldTextureTask } from "./terrain-field.task";

export interface TerrainReadbackContext {
  cache?: TerrainReadbackCache;
}

export const createTerrainReadbackContextTask = task((_get, work) =>
  work((): TerrainReadbackContext => ({})),
)
  .displayName("createTerrainReadbackContextTask")
  .cache("once");

export const terrainReadbackTask = task<{ renderer: WebGPURenderer }>(
  (get, work, { resources }) => {
    const _computeExecuted = get(executeComputeTask);
    const terrainFieldStorage = get(createTerrainFieldTextureTask);
    const readbackContext = get(createTerrainReadbackContextTask);

    return work(async () => {
      const result = await readbackTerrainField(
        resources?.renderer,
        terrainFieldStorage,
        readbackContext.cache,
      );
      readbackContext.cache = result.cache;
      return result;
    });
  },
)
  .displayName("terrainReadbackTask")
  .lane("gpu");
