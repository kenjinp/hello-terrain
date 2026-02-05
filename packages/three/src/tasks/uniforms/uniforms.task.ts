import { task } from "@hello-terrain/work";
import { Vector3 } from "three";
import {
  heightmapScaleParam,
  innerTileSegmentsParam,
  originParam,
  rootSizeParam,
  skirtScaleParam,
} from "../../params";
import { terrainInstanceIdTask } from "../terrainInstance.task";
import { TerrainUniformsParams, createTerrainUniforms } from "./terrainUniforms";

const scratchVector3 = new Vector3();

/**
 * Creates the terrain uniform nodes once. Downstream cache("once") tasks
 * (like terrainVertextPositionNodeTask) capture references to these nodes
 * in shader graphs, so the same instances must persist across runs.
 */
export const createTerrainUniformsTask = task((get, work) => {
  const params: TerrainUniformsParams = {
    rootOrigin: get(originParam),
    rootSize: get(rootSizeParam),
    innerTileSegments: get(innerTileSegmentsParam),
    skirtScale: get(skirtScaleParam),
    heightmapScale: get(heightmapScaleParam),
    instanceId: get(terrainInstanceIdTask),
  };
  return work(() => createTerrainUniforms(params));
})
  .displayName("createTerrainUniformsTask")
  .cache("once");

/**
 * Updates the terrain uniform values each run. Reads the persisted uniform
 * nodes from createTerrainUniformsTask and writes the latest param values.
 */
export const updateTerrainUniformsTask = task((get, work) => {
  const terrainUniformsContext = get(createTerrainUniformsTask);
  const rootSize = get(rootSizeParam);
  const rootOrigin = get(originParam);
  const innerTileSegments = get(innerTileSegmentsParam);
  const skirtScale = get(skirtScaleParam);
  const heightmapScale = get(heightmapScaleParam);

  return work(() => {
    terrainUniformsContext.uRootSize.value = rootSize;
    terrainUniformsContext.uRootOrigin.value = scratchVector3.set(
      rootOrigin.x,
      rootOrigin.y,
      rootOrigin.z,
    );
    terrainUniformsContext.uInnerTileSegments.value = innerTileSegments;
    terrainUniformsContext.uSkirtScale.value = skirtScale;
    terrainUniformsContext.uHeightmapScale.value = heightmapScale;

    return terrainUniformsContext;
  });
}).displayName("updateTerrainUniformsTask");
