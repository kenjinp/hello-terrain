import { param } from "@hello-terrain/work";
import { float } from "three/tsl";
import type { LodCriteria, TerrainResidencyAnchor, Topology } from "../quadtree";
import type { ElevationCallback } from "../tsl/elevation";
import {
  cameraViewEquals,
  cloneCameraView,
  createInitialCameraView,
  type CameraView,
} from "./cameraView";
import { cloneResidencyAnchors, residencyAnchorsEquals } from "./residencyAnchorsParam";

/** Root tile size in world units. */
export const rootSize = param(256).displayName("rootSize");

/** World-space origin of the terrain. */
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

/** Sphere radius in world units (cube-sphere projection only). */
export const radius = param(1000).displayName("radius");

/** Maximum quadtree nodes. */
export const maxNodes = param(1024).displayName("maxNodes");

/** Maximum quadtree subdivision level. */
export const maxLevel = param(16).displayName("maxLevel");

/** Camera-relative origin and view-projection matrix for LOD and frustum culling. */
export const cameraView = param<CameraView>(createInitialCameraView(), {
  equals: cameraViewEquals,
  copy: cloneCameraView,
}).displayName("cameraView");

/**
 * World-space residency anchors that keep terrain data resident even when
 * render culling hides those tiles.
 */
export const residencyAnchors = param<readonly TerrainResidencyAnchor[]>([], {
  equals: residencyAnchorsEquals,
  copy: cloneResidencyAnchors,
}).displayName("residencyAnchors");

/** How subdivision decisions are made (distance vs screen-space LOD). */
export const lodCriteria = param<LodCriteria>({
  mode: "distance",
  distanceFactor: 1.5,
}).displayName("lodCriteria");

/** Optional custom terrain topology; defaults to bounded flat topology when null. */
export const topology = param<Topology | null>(null).displayName("topology");

/** Terrain field texture filter mode. */
export const terrainFieldFilter = param<"nearest" | "linear">("linear").displayName(
  "terrainFieldFilter",
);

/** Terrain elevation control function (per vertex, in gpu compute) */
export const elevationFn = param<ElevationCallback>(() => float(0));
