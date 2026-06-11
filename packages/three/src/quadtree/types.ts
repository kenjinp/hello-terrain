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

export type TopologyProjection = "flat" | "cubeSphere";

export type Topology = {
  spaceCount: number;
  /** maximum number of roots returned by `rootTiles` */
  maxRootCount: number;

  /**
   * GPU position/normal assembly projection. Defaults to `flat` when absent.
   * `cubeSphere` selects radial sphere mapping from cube faces.
   */
  projection?: TopologyProjection;

  /** Sphere radius in world units (cube-sphere projection only). */
  radius?: number;

  /**
   * Planet center in world space (cube-sphere projection only). Used to apply
   * the camera elevation offset along the radial up-direction during LOD.
   */
  center?: { x: number; y: number; z: number };

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
   */
  tileBounds(tile: TileId, cameraOrigin: { x: number; y: number; z: number }, out: TileBounds): void;

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

export type UpdateParams = {
  cameraOrigin: { x: number; y: number; z: number };

  /**
   * Terrain elevation beneath the camera (from the previous frame). During
   * refinement it offsets the camera toward the terrain surface so LOD distance
   * is measured relative to the surface rather than the datum:
   * - flat: subtracted from `cameraOrigin.y`.
   * - cube-sphere: subtracted along the radial up-direction from the planet center.
   */
  elevationAtCameraXZ?: number;

  /**
   * Controls how subdivision decisions are made.
   * `distance` is the initial focus; `screen` is supported for future parity.
   */
  mode?: LodMode;

  /**
   * Distance-based refinement threshold.
   * Interpretation is criteria-dependent; keep it stable across surfaces by using bounds.
   */
  distanceFactor?: number;

  /** Screen-space projection factor = screenHeight / (2*tan(fovY/2)) */
  projectionFactor?: number;

  /** Target pixel radius/size threshold for screen-space refinement */
  targetPixels?: number;

  /** Prevent flicker by separating split/merge thresholds (0..1 typical) */
  hysteresis?: number;
};

export type QuadtreeConfig = {
  maxNodes: number;
  maxLevel: number;
};

