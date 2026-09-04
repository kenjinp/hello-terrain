import { param } from "@hello-terrain/work";
import { float } from "three/tsl";
import type { Topology, UpdateParams } from "../quadtree";
import type { ElevationCallback } from "../tsl/elevation";

/**
 * Root tile size in world units. Drives the default flat topology; when a
 * custom `topology` carries its own `rootSize` that value wins.
 */
export const rootSize = param(256).displayName("rootSize");

/**
 * World-space origin of the terrain. Drives the default flat topology; when a
 * custom `topology` carries its own `origin` (or `projection.center`) that
 * value wins.
 */
export const origin = param<{ x: number; y: number; z: number }>({
  x: 0,
  y: 0,
  z: 0,
}).displayName("origin");

/**
 * Default number of segments per inner tile edge. The effective edge vertex
 * count is `innerTileSegments + 3`
 */
export const innerTileSegments = param(61).displayName("innerTileSegments");

/** Skirt scale factor. */
export const skirtScale = param(100).displayName("skirtScale");

/** Elevation vertical scale. */
export const elevationScale = param(1).displayName("elevationScale");

/**
 * Sphere radius in world units (cube-sphere projection only).
 *
 * @deprecated The topology owns the radius: `createCubeSphereTopology({ radius })`
 * exposes it as `topology.projection.radius`, which the GPU uniforms and CPU
 * query/raycast read directly. This param is only a fallback for custom
 * topologies whose projection has no `radius`, and will be removed.
 */
export const radius = param(1000).displayName("radius");

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

/** Optional custom terrain topology; defaults to bounded flat topology when null. */
export const topology = param<Topology | null>(null).displayName("topology");

/** Terrain field texture filter mode. */
export const terrainFieldFilter = param<"nearest" | "linear">("linear").displayName(
  "terrainFieldFilter",
);

/** Terrain elevation control function (per vertex, in gpu compute) */
export const elevationFn = param<ElevationCallback>(() => float(0));
