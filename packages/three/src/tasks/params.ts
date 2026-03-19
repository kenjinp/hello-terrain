import { param } from "@hello-terrain/work";
import { float } from "three/tsl";
import type { TextureArrayContext } from "../gpu/textureArray";
import type { ElevationCallback } from "../tsl/elevation";
import type { TextureControlCallback } from "../tsl/textureControl";
import type { Surface, UpdateParams } from "../quadtree";

/** Root tile size in world units. */
export const rootSize = param(256).displayName("rootSize");

/** World-space origin of the terrain. */
export const origin = param<{ x: number; y: number; z: number }>({
  x: 0,
  y: 0,
  z: 0,
}).displayName("origin");

/**
 * Number of segments per inner tile edge.
 * Effective edge vertex count is `innerTileSegments + 3`.
 */
export const innerTileSegments = param(13).displayName("innerTileSegments");

/** Skirt scale factor. */
export const skirtScale = param(100).displayName("skirtScale");

/** Elevation vertical scale. */
export const elevationScale = param(1).displayName("elevationScale");

/** Maximum quadtree nodes. */
export const maxNodes = param(1024).displayName("maxNodes");

/** Maximum quadtree subdivision level. */
export const maxLevel = param(16).displayName("maxLevel");

/** Quadtree update configuration (camera, mode, etc.). */
export const quadtreeUpdate = param<UpdateParams>({
  cameraOrigin: { x: 0, y: 0, z: 0 },
  mode: "distance",
  distanceFactor: 1.5,
}).displayName("quadtreeUpdate");

/** Optional custom terrain surface; defaults to bounded flat surface when null. */
export const surface = param<Surface | null>(null).displayName("surface");

/** Terrain field texture filter mode. */
export const terrainFieldFilter = param<"nearest" | "linear">("linear").displayName("terrainFieldFilter");

/** Terrain elevation control function (per vertex, in gpu compute) */
export const elevationFn = param<ElevationCallback>(() => float(0));

/** Terrain texture control function (per vertex, in gpu compute) */
export const textureControlFn =
  param<TextureControlCallback | null>(null).displayName("textureControlFn");

/** Consumer-provided texture arrays used by terrain material nodes. */
export const textureArrays =
  param<TextureArrayContext | null>(null).displayName("textureArrays");
