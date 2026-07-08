import { param } from '@hello-terrain/work';
import { float } from 'three/tsl';
import type { LodCriteria, TerrainResidencyAnchor, Topology } from '../quadtree';
import type { ElevationCallback } from '../tsl/elevation';
import { cameraViewEquals, createInitialCameraView, type CameraView } from './cameraView';
import { residencyAnchorsEquals } from './residencyAnchorsParam';

/** Root tile size in world units. */
export const rootSize = param(256).displayName('rootSize');

/** World-space origin of the terrain. */
export const origin = param<{ x: number; y: number; z: number }>({
    x: 0,
    y: 0,
    z: 0,
}).displayName('origin');

/**
 * Default number of segments per inner tile edge. The effective edge vertex
 * count is `innerTileSegments + 3`
 */
export const innerTileSegments = param(61).displayName('innerTileSegments');

/** Skirt scale factor. */
export const skirtScale = param(100).displayName('skirtScale');

/** Elevation vertical scale. */
export const elevationScale = param(1).displayName('elevationScale');

/** Sphere radius in world units (cube-sphere projection only). */
export const radius = param(1000).displayName('radius');

/** Maximum quadtree nodes. */
export const maxNodes = param(1024).displayName('maxNodes');

/** Maximum quadtree subdivision level. */
export const maxLevel = param(16).displayName('maxLevel');

/** Camera-relative origin and view-projection matrix for LOD and frustum culling. */
export const cameraView = param<CameraView>(createInitialCameraView(), {
    equals: cameraViewEquals,
}).displayName('cameraView');

/**
 * World-space residency anchors that keep terrain data resident even when
 * render culling hides those tiles.
 */
export const residencyAnchors = param<readonly TerrainResidencyAnchor[]>([], {
    equals: residencyAnchorsEquals,
}).displayName('residencyAnchors');

/** How subdivision decisions are made (distance vs screen-space LOD). */
export const lodCriteria = param<LodCriteria>({
    mode: 'distance',
    distanceFactor: 1.5,
}).displayName('lodCriteria');

/** Optional custom terrain topology; defaults to bounded flat topology when null. */
export const topology = param<Topology | null>(null).displayName('topology');

/** Terrain field texture filter mode. */
export const terrainFieldFilter = param<'nearest' | 'linear'>('linear').displayName(
    'terrainFieldFilter'
);

/**
 * Whether draw/query views are gated on computed terrain-field content.
 *
 * `terrainGraph()` enables this: with the field compute pipeline present,
 * drawing or querying a tile whose dispatch hasn't landed shows uninitialized
 * or leftover slot data (flash/garbage/phantom ground), so pending tiles are
 * substituted/omitted until `markRowsComputed` runs.
 *
 * Hand-assembled graphs WITHOUT `executeComputeTask` must leave this `false`
 * (the default): nothing ever marks rows computed there, and their rendering
 * doesn't consume the terrain field, so gating would blank the terrain
 * forever.
 */
export const gateOnComputedField = param<boolean>(false).displayName('gateOnComputedField');

/** Terrain elevation control function (per vertex, in gpu compute) */
export const elevationFn = param<ElevationCallback>(() => float(0));
