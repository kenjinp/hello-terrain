import { Vector3 } from "three";
import type { StorageBufferAttribute, WebGPURenderer } from "three/webgpu";
import type { SpatialIndex } from "../quadtree/spatialIndex";
import {
  TILE_BOUNDS_FLOATS_PER_TILE,
  TILE_BOUNDS_LOD_MAX_OFFSET,
  TILE_BOUNDS_LOD_MIN_OFFSET,
} from "../gpu/terrainFieldStorage";
import type { CpuSurfaceOps, SurfaceKey } from "../projection/types";
import { tileLocalToFieldUVNumber } from "../gpu/tile";
import {
  type ElevationGradient,
  type ElevationGridShape,
  elevationGradientAt,
  sampleGridBilinear,
} from "./elevation-field-sampling";
import {
  lookupTileElevationRange,
} from "./tile-elevation-pyramid";
import {
  type TileLookupConfig,
  type TileLookupResult,
  lookupTile,
  lookupTileByFaceUV,
} from "./tile-lookup";
import {
  type TerrainSnapshotState,
  createTerrainSnapshotState,
  disposeSnapshotReadback,
  triggerSnapshotReadback,
} from "./terrain-snapshot";
import type {
  ElevationRange,
  TerrainSample,
  TerrainSampleBatch,
  TerrainSurfaceSample,
  TerrainSurfaceSampleBatch,
  TerrainTile,
  TerrainTileBounds,
} from "./types";

type TerrainElevationSample = {
  elevation: number;
  valid: boolean;
};

export type TerrainQueryConfig = {
  rootSize: number;
  originX: number;
  originY: number;
  originZ: number;
  innerTileSegments: number;
  elevationScale: number;
  maxLevel: number;
  /** Representative surface radius (curved projections only). */
  radius: number;
  /** Level-0 tile count along u before LOD subdivision (defaults to 1). */
  baseU?: number;
  /** Level-0 tile count along v before LOD subdivision (defaults to 1). */
  baseV?: number;
};

export interface CpuTerrainCache {
  readonly generation: number;
  readonly ready: boolean;
  updateConfig(config: TerrainQueryConfig): void;
  /**
   * Schedule an async GPU→CPU readback into the back buffers. Returns `true`
   * when a readback was actually scheduled (false when one is pending, the
   * renderer cannot read back, or the spatial index has not changed).
   */
  triggerReadback(
    renderer: WebGPURenderer,
    attribute: StorageBufferAttribute,
    spatialIndex: SpatialIndex,
    boundsAttribute?: StorageBufferAttribute,
    activeLeafCount?: number,
  ): boolean;
  /** Release GPU readback staging buffers owned by this cache. */
  dispose(): void;

  // ── Flat (heightfield) sampling, keyed on world XZ ──────────────────────
  getElevation(worldX: number, worldZ: number): number | null;
  getNormal(worldX: number, worldZ: number): Vector3 | null;
  getTile(worldX: number, worldZ: number): TerrainTile | null;
  getTileBounds(worldX: number, worldZ: number): TerrainTileBounds | null;
  getGlobalElevationRange(): ElevationRange | null;
  sampleTerrainBatch(positions: Float32Array): TerrainSampleBatch;
  sampleTerrain(worldX: number, worldZ: number): TerrainSample;

  // ── Generic closed-surface sampling, keyed on a world position ──────────
  /** True when the active projection supplies surface ops. */
  readonly hasSurface: boolean;
  /**
   * Swap the projection surface ops (CPU position/normal math). Used when the
   * surface geometry changes (e.g. cube-sphere radius/center) without changing
   * the buffer shape, so picks/queries stay in sync without reallocating.
   */
  setSurfaceOps(surfaceOps: CpuSurfaceOps | null): void;
  sampleSurfaceByPosition(px: number, py: number, pz: number): TerrainSurfaceSample;
  getElevationBySurfacePosition(px: number, py: number, pz: number): number | null;
  getNormalBySurfacePosition(px: number, py: number, pz: number): Vector3 | null;
  getTileBySurfacePosition(px: number, py: number, pz: number): TerrainTile | null;
  getTileBoundsBySurfacePosition(px: number, py: number, pz: number): TerrainTileBounds | null;
  sampleSurfaceBatchByPosition(positions: Float32Array): TerrainSurfaceSampleBatch;

  /**
   * Previous-frame raw elevation min/max for a tile (unscaled field values).
   * Returns false when no snapshot data is available for the tile.
   */
  getTileElevationRange(
    space: number,
    level: number,
    x: number,
    y: number,
    out: { min: number; max: number },
  ): boolean;
}

export function createCpuTerrainCache(
  maxNodes: number,
  initialConfig: TerrainQueryConfig,
  surfaceOps: CpuSurfaceOps | null,
): CpuTerrainCache {
  let config = initialConfig;
  const shape: ElevationGridShape = {
    edgeVertexCount: config.innerTileSegments + 3,
    verticesPerNode: 0,
  };
  shape.verticesPerNode = shape.edgeVertexCount * shape.edgeVertexCount;
  let totalElements = maxNodes * shape.verticesPerNode;

  const state: TerrainSnapshotState = createTerrainSnapshotState(
    maxNodes,
    initialConfig.maxLevel,
    totalElements,
  );

  // Per-cache scratch (no module-scope state; the terrain may have many instances).
  const gridScratch = { gx: 0, gy: 0 };
  const gradientScratch: ElevationGradient = { dhdu: 0, dhdv: 0 };
  const keyScratch: SurfaceKey = { space: 0, u: 0, v: 0, dirX: 0, dirY: 0, dirZ: 0 };

  const surfaceLookupConfig = (): TileLookupConfig => ({
    rootSize: config.rootSize,
    originX: config.originX,
    originZ: config.originZ,
    maxLevel: config.maxLevel,
    radius: config.radius,
    baseU: config.baseU,
    baseV: config.baseV,
  });

  /** Fractional grid coords for a lookup; writes/returns `gridScratch`. */
  const gridCoordsFromLookup = (lookup: TileLookupResult) => {
    const fieldU = tileLocalToFieldUVNumber(lookup.localU, config.innerTileSegments);
    const fieldV = tileLocalToFieldUVNumber(lookup.localV, config.innerTileSegments);
    gridScratch.gx = fieldU * (shape.edgeVertexCount - 1);
    gridScratch.gy = fieldV * (shape.edgeVertexCount - 1);
    return gridScratch;
  };

  /** Raw (unscaled) bilinear height for a lookup; leaves grid coords in `gridScratch`. */
  const rawHeightFromLookup = (lookup: TileLookupResult): number => {
    const g = gridCoordsFromLookup(lookup);
    return sampleGridBilinear(state.frontElevation, shape, lookup.leafIndex, g.gx, g.gy);
  };

  const computeNormal = (
    leafIndex: number,
    gx: number,
    gy: number,
    tileSize: number,
  ): Vector3 => {
    const stepWorld = tileSize / config.innerTileSegments;
    const { dhdu, dhdv } = elevationGradientAt(
      state.frontElevation,
      shape,
      leafIndex,
      gx,
      gy,
      stepWorld,
      config.elevationScale,
      gradientScratch,
    );
    return new Vector3(-dhdu, 1, -dhdv).normalize();
  };

  const sampleFromLookup = (lookup: TileLookupResult): TerrainSample => {
    const height = rawHeightFromLookup(lookup);
    const scaledHeight = config.originY + height * config.elevationScale;
    const normal = computeNormal(lookup.leafIndex, gridScratch.gx, gridScratch.gy, lookup.tileSize);
    return { elevation: scaledHeight, normal, valid: true };
  };

  const sampleTerrain = (worldX: number, worldZ: number): TerrainSample => {
    if (!state.hasSnapshot) {
      return { elevation: 0, normal: new Vector3(0, 1, 0), valid: false };
    }
    const lookup = lookupTile(state.frontIndex, config, worldX, worldZ);
    if (!lookup.found) {
      return { elevation: 0, normal: new Vector3(0, 1, 0), valid: false };
    }
    return sampleFromLookup(lookup);
  };

  const getElevation = (worldX: number, worldZ: number): TerrainElevationSample => {
    if (!state.hasSnapshot) {
      return { elevation: 0, valid: false };
    }
    const lookup = lookupTile(state.frontIndex, config, worldX, worldZ);
    if (!lookup.found) {
      return { elevation: 0, valid: false };
    }
    const height = rawHeightFromLookup(lookup);
    return {
      elevation: config.originY + height * config.elevationScale,
      valid: true,
    };
  };

  const tileFromLookup = (lookup: TileLookupResult): TerrainTile | null => {
    if (!lookup.found) return null;
    return {
      space: lookup.space,
      level: lookup.level,
      x: lookup.tileX,
      y: lookup.tileY,
      index: lookup.leafIndex,
    };
  };

  const tileBoundsFromLookup = (
    lookup: TileLookupResult,
    elevationBase: number,
  ): TerrainTileBounds | null => {
    if (!lookup.found || lookup.leafIndex >= state.frontLeafCount) return null;
    const rawMin =
      state.frontTileBounds[
        lookup.leafIndex * TILE_BOUNDS_FLOATS_PER_TILE + TILE_BOUNDS_LOD_MIN_OFFSET
      ]!;
    const rawMax =
      state.frontTileBounds[
        lookup.leafIndex * TILE_BOUNDS_FLOATS_PER_TILE + TILE_BOUNDS_LOD_MAX_OFFSET
      ]!;
    const a = elevationBase + rawMin * config.elevationScale;
    const b = elevationBase + rawMax * config.elevationScale;
    return {
      space: lookup.space,
      level: lookup.level,
      x: lookup.tileX,
      y: lookup.tileY,
      index: lookup.leafIndex,
      minElevation: Math.min(a, b),
      maxElevation: Math.max(a, b),
    };
  };

  // ── Generic surface sampling ──────────────────────────────────────────

  const invalidSurfaceSample = (dx: number, dy: number, dz: number): TerrainSurfaceSample => ({
    position: new Vector3(),
    normal: new Vector3(0, 1, 0),
    direction: new Vector3(dx, dy, dz),
    elevation: 0,
    valid: false,
  });

  const surfaceLookup = (px: number, py: number, pz: number): TileLookupResult => {
    if (!surfaceOps || !surfaceOps.positionToKey(px, py, pz, keyScratch)) {
      return { found: false } as TileLookupResult;
    }
    return lookupTileByFaceUV(
      state.frontIndex,
      surfaceLookupConfig(),
      keyScratch.space,
      keyScratch.u,
      keyScratch.v,
    );
  };

  const sampleSurfaceByPosition = (
    px: number,
    py: number,
    pz: number,
  ): TerrainSurfaceSample => {
    if (!state.hasSnapshot || !surfaceOps) return invalidSurfaceSample(0, 1, 0);
    if (!surfaceOps.positionToKey(px, py, pz, keyScratch)) {
      return invalidSurfaceSample(0, 1, 0);
    }
    const key = keyScratch;
    const lookup = lookupTileByFaceUV(
      state.frontIndex,
      surfaceLookupConfig(),
      key.space,
      key.u,
      key.v,
    );
    if (!lookup.found) return invalidSurfaceSample(key.dirX, key.dirY, key.dirZ);

    const height = rawHeightFromLookup(lookup);
    const elevation = height * config.elevationScale;
    const position = new Vector3();
    surfaceOps.surfacePosition(key, elevation, position);
    const normal = surfaceOps.surfaceNormal(key, {
      elevation: state.frontElevation,
      shape,
      leafIndex: lookup.leafIndex,
      gx: gridScratch.gx,
      gy: gridScratch.gy,
      innerTileSegments: config.innerTileSegments,
      elevationScale: config.elevationScale,
      level: lookup.level,
    });
    return {
      position,
      normal,
      direction: new Vector3(key.dirX, key.dirY, key.dirZ),
      elevation,
      valid: true,
    };
  };

  const api: CpuTerrainCache = {
    get generation() {
      return state.generation;
    },
    get ready() {
      return state.hasSnapshot;
    },
    get hasSurface() {
      return surfaceOps !== null;
    },
    setSurfaceOps(nextSurfaceOps) {
      surfaceOps = nextSurfaceOps;
    },
    updateConfig(nextConfig) {
      config = nextConfig;
      shape.edgeVertexCount = config.innerTileSegments + 3;
      shape.verticesPerNode = shape.edgeVertexCount * shape.edgeVertexCount;
      totalElements = maxNodes * shape.verticesPerNode;
    },
    triggerReadback(renderer, attribute, spatialIndex, boundsAttribute, activeLeafCount) {
      return triggerSnapshotReadback(state, renderer, attribute, spatialIndex, boundsAttribute, {
        activeLeafCount: activeLeafCount ?? 0,
        totalElements,
        verticesPerNode: shape.verticesPerNode,
        elevationScale: config.elevationScale,
        originY: config.originY,
      });
    },
    dispose() {
      disposeSnapshotReadback(state);
    },
    getElevation(worldX, worldZ) {
      const sample = getElevation(worldX, worldZ);
      return sample.valid ? sample.elevation : null;
    },
    getNormal(worldX, worldZ) {
      return sampleTerrain(worldX, worldZ).normal;
    },
    getTile(worldX, worldZ) {
      if (!state.hasSnapshot) return null;
      return tileFromLookup(lookupTile(state.frontIndex, config, worldX, worldZ));
    },
    getTileBounds(worldX, worldZ) {
      if (!state.hasSnapshot) return null;
      return tileBoundsFromLookup(
        lookupTile(state.frontIndex, config, worldX, worldZ),
        config.originY,
      );
    },
    getGlobalElevationRange() {
      return state.globalRange;
    },
    sampleTerrainBatch(positions) {
      const count = Math.floor(positions.length / 2);
      const elevations = new Float32Array(count);
      const normals = new Float32Array(count * 3);
      const valid = new Uint8Array(count);
      if (!state.hasSnapshot) {
        return { elevations, normals, valid, generation: state.generation };
      }

      let lastTile:
        | {
            leafIndex: number;
            level: number;
            tileX: number;
            tileY: number;
            tileSize: number;
            tileMinX: number;
            tileMinZ: number;
          }
        | undefined;
      for (let i = 0; i < count; i += 1) {
        const worldX = positions[i * 2] ?? 0;
        const worldZ = positions[i * 2 + 1] ?? 0;
        let lookup: TileLookupResult | undefined;
        if (
          lastTile &&
          worldX >= lastTile.tileMinX &&
          worldX <= lastTile.tileMinX + lastTile.tileSize &&
          worldZ >= lastTile.tileMinZ &&
          worldZ <= lastTile.tileMinZ + lastTile.tileSize
        ) {
          lookup = {
            found: true,
            leafIndex: lastTile.leafIndex,
            space: 0,
            level: lastTile.level,
            tileX: lastTile.tileX,
            tileY: lastTile.tileY,
            tileSize: lastTile.tileSize,
            localU: (worldX - lastTile.tileMinX) / lastTile.tileSize,
            localV: (worldZ - lastTile.tileMinZ) / lastTile.tileSize,
          };
        } else {
          lookup = lookupTile(state.frontIndex, config, worldX, worldZ);
          if (lookup.found) {
            lastTile = {
              leafIndex: lookup.leafIndex,
              level: lookup.level,
              tileX: lookup.tileX,
              tileY: lookup.tileY,
              tileSize: lookup.tileSize,
              tileMinX: worldX - lookup.localU * lookup.tileSize,
              tileMinZ: worldZ - lookup.localV * lookup.tileSize,
            };
          } else {
            lastTile = undefined;
          }
        }

        if (!lookup?.found) {
          normals[i * 3 + 1] = 1;
          continue;
        }

        const sample = sampleFromLookup(lookup);
        elevations[i] = sample.elevation;
        normals[i * 3] = sample.normal.x;
        normals[i * 3 + 1] = sample.normal.y;
        normals[i * 3 + 2] = sample.normal.z;
        valid[i] = 1;
      }

      return { elevations, normals, valid, generation: state.generation };
    },
    sampleTerrain,

    // ── Generic surface ──
    sampleSurfaceByPosition,
    getElevationBySurfacePosition(px, py, pz) {
      const sample = sampleSurfaceByPosition(px, py, pz);
      return sample.valid ? sample.elevation : null;
    },
    getNormalBySurfacePosition(px, py, pz) {
      const sample = sampleSurfaceByPosition(px, py, pz);
      return sample.valid ? sample.normal : null;
    },
    getTileBySurfacePosition(px, py, pz) {
      if (!state.hasSnapshot || !surfaceOps) return null;
      return tileFromLookup(surfaceLookup(px, py, pz));
    },
    getTileBoundsBySurfacePosition(px, py, pz) {
      if (!state.hasSnapshot || !surfaceOps) return null;
      return tileBoundsFromLookup(surfaceLookup(px, py, pz), 0);
    },
    sampleSurfaceBatchByPosition(positions) {
      const count = Math.floor(positions.length / 3);
      const outPositions = new Float32Array(count * 3);
      const normals = new Float32Array(count * 3);
      const elevations = new Float32Array(count);
      const valid = new Uint8Array(count);
      if (!state.hasSnapshot || !surfaceOps) {
        return { positions: outPositions, normals, elevations, valid, generation: state.generation };
      }
      for (let i = 0; i < count; i += 1) {
        const sample = sampleSurfaceByPosition(
          positions[i * 3] ?? 0,
          positions[i * 3 + 1] ?? 0,
          positions[i * 3 + 2] ?? 0,
        );
        if (!sample.valid) {
          normals[i * 3 + 1] = 1;
          continue;
        }
        outPositions[i * 3] = sample.position.x;
        outPositions[i * 3 + 1] = sample.position.y;
        outPositions[i * 3 + 2] = sample.position.z;
        normals[i * 3] = sample.normal.x;
        normals[i * 3 + 1] = sample.normal.y;
        normals[i * 3 + 2] = sample.normal.z;
        elevations[i] = sample.elevation;
        valid[i] = 1;
      }
      return { positions: outPositions, normals, elevations, valid, generation: state.generation };
    },
    getTileElevationRange(space, level, x, y, out) {
      if (!state.hasSnapshot) return false;
      return lookupTileElevationRange(state.elevationPyramid, space, level, x, y, out);
    },
  };

  return api;
}
