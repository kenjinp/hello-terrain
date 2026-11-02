import { task } from "@hello-terrain/work";
import { terrainTextureNodes, type TerrainTextureNodes } from "../texture/texture-nodes";
import { textureSet, textureRender } from "./params";
import { createTextureFieldContextTask } from "./texture-field.task";
import { topologyTask } from "./quadtree.task";
import { tileNodesTask } from "./elevation-field.task";

export const textureNodesTask = task((get, work) => {
  const field = get(createTextureFieldContextTask);
  const set = get(textureSet);
  const options = get(textureRender);
  const projection = get(topologyTask).projection;
  const tile = get(tileNodesTask);
  return work((): TerrainTextureNodes | null => field && set ? terrainTextureNodes({
    textureFieldStorage: field.storage, textureSet: set, projection, tile, options,
  }) : null);
}).displayName("textureNodesTask");
