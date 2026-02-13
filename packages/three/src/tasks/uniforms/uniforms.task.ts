import { task } from "@hello-terrain/work";
import { Vector3 } from "three";
import { createTerrainUniforms } from "../../gpu/uniforms";
import type { TerrainUniformsParams } from "../../types";
import { instanceIdTask } from "../instanceId.task";
import { elevationScale, innerTileSegments, origin, rootSize, skirtScale } from "../params";

const scratchVector3 = new Vector3();

/**
 * Creates the terrain uniform nodes once. Downstream tasks capture
 * references to these nodes in shader graphs, so the same instances
 * must persist across runs.
 */
export const createUniformsTask = task((get, work) => {
  const uniformParams: TerrainUniformsParams = {
    rootOrigin: get(origin),
    rootSize: get(rootSize),
    innerTileSegments: get(innerTileSegments),
    skirtScale: get(skirtScale),
    elevationScale: get(elevationScale),
    instanceId: get(instanceIdTask),
  };
  return work(() => createTerrainUniforms(uniformParams));
})
  .displayName("createUniformsTask")
  .cache("once");

/**
 * Updates the terrain uniform values each run. Reads the persisted uniform
 * nodes from createUniformsTask and writes the latest param values.
 */
export const updateUniformsTask = task((get, work) => {
  const terrainUniformsContext = get(createUniformsTask);
  const rootSizeVal = get(rootSize);
  const rootOrigin = get(origin);
  const innerTileSegmentsVal = get(innerTileSegments);
  const skirtScaleVal = get(skirtScale);
  const elevationScaleVal = get(elevationScale);

  return work(() => {
    terrainUniformsContext.uRootSize.value = rootSizeVal;
    terrainUniformsContext.uRootOrigin.value = scratchVector3.set(
      rootOrigin.x,
      rootOrigin.y,
      rootOrigin.z,
    );
    terrainUniformsContext.uInnerTileSegments.value = innerTileSegmentsVal;
    terrainUniformsContext.uSkirtScale.value = skirtScaleVal;
    terrainUniformsContext.uElevationScale.value = elevationScaleVal;

    return terrainUniformsContext;
  });
}).displayName("updateUniformsTask");
