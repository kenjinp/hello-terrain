import { param } from "@hello-terrain/work";
import { float } from "three/tsl";
import { ElevationCallback } from "../nodes/elevation/elevation.types";
import type { UpdateParams } from "../quadtree";

/** Root tile size in world units. */
export const rootSize = param(256).displayName("rootSize");

/** World-space origin of the terrain. */
export const origin = param<{ x: number; y: number; z: number }>({ x: 0, y: 0, z: 0 }).displayName(
  "origin",
);

/**
 * Number of segments per inner tile edge.
 * 13 is the max tiles we can support for 256 workgroups (13 + 3 === 16.. 16x16)
 */
export const innerTileSegments = param(13).displayName("innerTileSegments");

/** Skirt scale factor. */
export const skirtScale = param(100).displayName("skirtScale");

/** Heightmap vertical scale. */
export const heightmapScale = param(1).displayName("heightmapScale");

/** Maximum quadtree nodes. */
export const maxNodes = param(1028).displayName("maxNodes");

/** Maximum quadtree subdivision level. */
export const maxLevel = param(16).displayName("maxLevel");

/** Quadtree update configuration (camera, mode, etc.). */
export const quadtreeUpdate = param<UpdateParams>({
  cameraOrigin: { x: 0, y: 0, z: 0 },
  mode: "distance",
  distanceFactor: 1.5,
}).displayName("quadtreeUpdate");

/** Terrain elevation control function (per vertex, in gpu compute) */
export const elevationFn = param<ElevationCallback>(() => float(0));
