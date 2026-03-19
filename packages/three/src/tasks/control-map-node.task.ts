import { task } from "@hello-terrain/work";
import {
  createTerrainColorNode,
  createTerrainNormalNode,
  createTerrainRoughnessNode,
} from "../tsl/terrainMaterial";
import { textureArrays } from "./params";
import { createControlMapContextTask } from "./control-map.task";
import { updateUniformsTask } from "./uniforms/uniforms.task";

export const controlMapNodeTask = task((get, work) => {
  const controlMapContext = get(createControlMapContextTask);
  const textureArrayContext = get(textureArrays);
  const terrainUniforms = get(updateUniformsTask);

  return work(() => {
    if (!textureArrayContext) return null;
    return {
      colorNode: createTerrainColorNode({
        controlMapContext,
        textureArrayContext,
        terrainUniforms,
      }),
      normalNode: createTerrainNormalNode({
        controlMapContext,
        textureArrayContext,
        terrainUniforms,
      }),
      roughnessNode: createTerrainRoughnessNode({
        controlMapContext,
        textureArrayContext,
        terrainUniforms,
      }),
    };
  });
}).displayName("controlMapNodeTask");
