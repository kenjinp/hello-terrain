import { param } from "@hello-terrain/work";
import { type UpdateParams } from "../quadtree";

export const rootSizeParam = param(256);
export const originParam = param({ x: 0, y: 0, z: 0 });
export const innerTileSegmentsParam = param(14);
export const skirtScaleParam = param(100);
export const heightmapScaleParam = param(1);
export const maxNodesParam = param(1028);
export const maxLevelParam = param(16);
export const quadtreeUpdateParams = param<UpdateParams>({
  cameraOrigin: { x: 0, y: 0, z: 0 },
  mode: "distance",
  distanceFactor: 1.5,
});
