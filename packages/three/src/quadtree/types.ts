import type { SurfaceProjection } from "../projection/types";

export const Dir = {
  LEFT: 0,
  RIGHT: 1,
  TOP: 2,
  BOTTOM: 3,
} as const;

export type Dir = (typeof Dir)[keyof typeof Dir];

export const U32_EMPTY = 0xffffffff;

export type TileId = {
  /** 0 for flat terrain; 0..5 for cube-sphere faces */
  space: number;
  level: number;
  /** tile coordinate at this level (signed to support infinite surfaces) */
  x: number;
  /** tile coordinate at this level (signed to support infinite surfaces) */
  y: number;
};

export type TileBounds = {
  /** camera-relative center */
  cx: number;
  cy: number;
  cz: number;
  /** conservative radius */
  r: number;
};

/** Scaled world-space elevation displacement range for a tile. */
export type ElevationRangeOut = {
  min: number;
  max: number;
};

export type Topology = {
  spaceCount: number;
  /** maximum number of roots returned by `rootTiles` */
  maxRootCount: number;

  /**
   * Injected surface projection strategy. Encapsulates the GPU position/normal
   * assembly and the CPU query/raycast/visibility/LOD behavior for this
   * topology, so the pipeline never branches on a projection kind.
   */
  projection: SurfaceProjection;

  /**
   * Compute the same-level neighbor TileId in the requested direction.
   * Returns false if the neighbor is outside the valid topology.
   *
   * IMPORTANT: This must handle cross-space edges in the future (cube-sphere).
   */
  neighborSameLevel(tile: TileId, dir: Dir, out: TileId): boolean;

  /**
   * Conservative camera-relative bounds for LOD decisions.
   * Avoids absolute world coordinates so Earth-scale worlds remain stable.
   * When `elevationRange` is provided, bounds should account for displaced geometry.
   */
  tileBounds(
    tile: TileId,
    cameraOrigin: { x: number; y: number; z: number },
    out: TileBounds,
    elevationRange?: ElevationRangeOut,
  ): void;

  /**
   * Fill root tiles for the current frame and return the count.
   * Implementations should write level-0 tiles into `out[0..count)`.
   */
  rootTiles(cameraOrigin: { x: number; y: number; z: number }, out: TileId[]): number;
};

export type LeafSet = {
  /** maximum number of leaves that fit in the buffers */
  capacity: number;
  /** number of valid leaf entries in this frame */
  count: number;

  space: Uint8Array;
  level: Uint8Array;
  x: Int32Array;
  y: Int32Array;
};

export function allocLeafSet(capacity: number): LeafSet {
  return {
    capacity,
    count: 0,
    space: new Uint8Array(capacity),
    level: new Uint8Array(capacity),
    x: new Int32Array(capacity),
    y: new Int32Array(capacity),
  };
}

export function resetLeafSet(leaves: LeafSet): void {
  leaves.count = 0;
}

export type SeamTable = {
  /** maximum number of leaves the table can describe */
  capacity: number;
  /** number of leaves described (typically equals leaves.count) */
  count: number;
  /** fixed stride per leaf, in u32 entries */
  stride: 8;
  /**
   * neighbors in leaf-list index space
   * layout: neighbors[leafIndex * 8 + edge*2 + slot]
   * edge order: LEFT, RIGHT, TOP, BOTTOM
   * slot: 0..1 (at most 2 neighbors per edge under 2:1 balance)
   */
  neighbors: Uint32Array;
};

export function allocSeamTable(capacity: number): SeamTable {
  return {
    capacity,
    count: 0,
    stride: 8,
    neighbors: new Uint32Array(capacity * 8),
  };
}

export function resetSeamTable(seams: SeamTable): void {
  seams.count = 0;
}

export type LodMode = "distance" | "screen";

/**
 * How subdivision decisions are made. A discriminated union so each mode only
 * carries (and requires) its own thresholds.
 * - `distance` (default): split when the camera is within `distanceFactor × r`.
 * - `screen`: split when the projected pixel radius exceeds `targetPixels`.
 */
export type LodCriteria =
  | { mode?: "distance"; distanceFactor?: number }
  | {
      mode: "screen";
      /** Screen-space projection factor = screenHeight / (2*tan(fovY/2)). */
      projectionFactor: number;
      /** Target pixel radius/size threshold for screen-space refinement. */
      targetPixels: number;
    };

/**
 * Per-tile elevation range provider: previous-frame world-space displacement
 * min/max (already scaled by `elevationScale`). Returns false when no data is
 * available yet. Allocation-free via the `out` scratch.
 */
export type TileElevationRangeFn = (tile: TileId, out: ElevationRangeOut) => boolean;

/**
 * Column-major world-to-clip matrix, matching Three.js `Matrix4.elements`.
 * Stored as plain mutable data so culling code does not depend on Three.
 */
export type ViewProjectionMatrix = {
  readonly length: number;
  [index: number]: number;
};

export type UpdateParams = {
  cameraOrigin: { x: number; y: number; z: number };
  viewProjectionMatrix?: ViewProjectionMatrix;

  tileElevationRange?: TileElevationRangeFn;
} & LodCriteria;

export type QuadtreeConfig = {
  maxNodes: number;
  maxLevel: number;
};
