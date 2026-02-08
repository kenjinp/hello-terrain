import { task } from "@hello-terrain/work";
import { createTileWorldPosition } from "../nodes/worldPosition";
import { createHeightmapContextTask } from "./heightmap.task";
import { leafStorageTask } from "./quadtree.task";
import { createUniformsTask } from "./uniforms/uniforms.task";

/**
 * Builds the TSL position node for the terrain shader.
 *
 * Depends on leafStorageTask (buffer objects), createUniformsTask
 * (uniform nodes), and createHeightmapContextTask (heightmap storage).
 * These only change when their GPU resources are recreated
 * (e.g. buffer resize), so this task stays cached during normal quadtree
 * updates — no unnecessary shader rebuilds.
 */
export const positionNodeTask = task((get, work) => {
  const leafStorage = get(leafStorageTask);
  const terrainUniforms = get(createUniformsTask);
  const heightmapContext = get(createHeightmapContextTask);
  return work(() => createTileWorldPosition(leafStorage, terrainUniforms, heightmapContext.node));
}).displayName("terrainVertextPositionNodeTask");
