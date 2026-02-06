import { graph } from "@hello-terrain/work";
import { instanceIdTask } from "./instanceId.task";
import { positionNodeTask } from "./positions.task";
import {
  leafGpuBufferTask,
  leafStorageTask,
  quadtreeConfigTask,
  quadtreeUpdateTask,
} from "./quadtree.task";
import { createUniformsTask, updateUniformsTask } from "./uniforms/uniforms.task";

export { instanceIdTask } from "./instanceId.task";

export function terrainGraph() {
  return graph()
    .add(instanceIdTask)
    .add(quadtreeConfigTask)
    .add(quadtreeUpdateTask)
    .add(leafStorageTask)
    .add(leafGpuBufferTask)
    .add(createUniformsTask)
    .add(updateUniformsTask)
    .add(positionNodeTask);
}

/** All terrain task refs for direct access. */
export const terrainTasks = {
  instanceId: instanceIdTask,
  quadtreeConfig: quadtreeConfigTask,
  quadtreeUpdate: quadtreeUpdateTask,
  leafStorage: leafStorageTask,
  leafGpuBuffer: leafGpuBufferTask,
  createUniforms: createUniformsTask,
  updateUniforms: updateUniformsTask,
  positionNode: positionNodeTask,
} as const;
