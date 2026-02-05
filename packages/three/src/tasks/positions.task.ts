import { task } from "@hello-terrain/work";
import { ShaderCallNodeInternal } from "three/src/nodes/TSL.js";
import { createTileWorldPosition } from "../nodes/worldPosition";
import { leafGpuBufferTask } from "./quadtree.task";
import { createTerrainUniformsTask } from "./uniforms/uniforms.task";

export const terrainVertextPositionNodeTask = task((get, work) => {
  const leafSet = get(leafGpuBufferTask);
  const terrainUniformsContext = get(createTerrainUniformsTask);
  let worldPositionFn: ShaderCallNodeInternal | undefined = undefined;
  return work(() => {
    if (!worldPositionFn) {
      worldPositionFn = createTileWorldPosition(leafSet, terrainUniformsContext);
    }
    return worldPositionFn;
  });
})
  .displayName("terrainVertextPositionNodeTask")
  .cache("once");
