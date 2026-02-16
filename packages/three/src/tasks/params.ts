import { param } from "@hello-terrain/work";
import { float } from "three/tsl";
import type { Node, StorageBufferNode } from "three/webgpu";
import type { ElevationCallback } from "../tsl/elevation";
import type { Surface, UpdateParams } from "../quadtree";
import type { LeafStorageState, TerrainUniformsContext } from "../types";
import { createTileCompute } from "../gpu/tile";
import { createTileWorldPosition } from "../gpu/worldPosition";

export type SurfaceProjection = {
  createTileCompute: (
    leafStorage: LeafStorageState,
    uniforms: TerrainUniformsContext,
  ) => ReturnType<typeof createTileCompute>;
  createWorldPosition: (
    leafStorage: LeafStorageState,
    uniforms: TerrainUniformsContext,
    elevationFieldBufferNode?: StorageBufferNode,
    normalFieldBufferNode?: Node,
  ) => ReturnType<typeof createTileWorldPosition>;
};

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
 * 13 is the max tiles we can support for 256 workgroups (13 + 3 === 16.. 16x16)
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

/** Surface projection functions for tile compute and render position assembly. */
export const surfaceProjection = param<SurfaceProjection>({
  createTileCompute,
  createWorldPosition: createTileWorldPosition,
}).displayName("surfaceProjection");

/** Terrain elevation control function (per vertex, in gpu compute) */
export const elevationFn = param<ElevationCallback>(() => float(0));
