import { graph } from "@hello-terrain/work";
import { terrainVertextPositionNodeTask } from "./positions.task";
import {
  leafGpuBufferTask,
  leafStorageTask,
  quadtreeConfigTask,
  quadtreeUpdateTask,
} from "./quadtree.task";
import { terrainInstanceIdTask } from "./terrainInstance.task";
import { createTerrainUniformsTask, updateTerrainUniformsTask } from "./uniforms/uniforms.task";

export function createGraph() {
  const g = graph()
    .add(terrainInstanceIdTask)
    .add(quadtreeConfigTask)
    .add(quadtreeUpdateTask)
    .add(leafStorageTask)
    .add(leafGpuBufferTask)
    .add(createTerrainUniformsTask)
    .add(updateTerrainUniformsTask)
    .add(terrainVertextPositionNodeTask);
  return g;
}
