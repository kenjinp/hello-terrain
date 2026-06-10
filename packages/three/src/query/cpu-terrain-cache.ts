import { Vector3 } from "three";
import type { StorageBufferAttribute, WebGPURenderer } from "three/webgpu";
import type { SpatialIndex } from "../quadtree";
import { CUBE_FACES, latLongToDirection } from "../quadtree";
import type { SurfaceProjection } from "../quadtree";
import { tileLocalToFieldUVNumber } from "../gpu/tile";
import {
  type ElevationGradient,
  type ElevationGridShape,
  elevationGradientAt,
  sampleGridBilinear,
} from "./elevation-field-sampling";
import {
  type TileLookupResult,
  lookupTile,
  lookupTileForDirection,
} from "./tile-lookup";
import {
  type TerrainSnapshotState,
  createTerrainSnapshotState,
  triggerSnapshotReadback,
} from "./terrain-snapshot";
import type {
  ElevationRange,
  TerrainElevationSample,
  TerrainSample,
  TerrainSampleBatch,
  TerrainSurfaceSample,
  TerrainSurfaceSampleBatch,
  TerrainTile,
  TerrainTileBounds,
} from "./types";

type TerrainQueryConfig = {
  rootSize: number;
  originX: number;
  originY: number;
  originZ: number;
  innerTileSegments: number;
  elevationScale: number;
  maxLevel: number;
  /** Surface projection; `cubeSphere` enables the direction/lat-long queries. */
  projection: SurfaceProjection;
  /** Sphere radius in world units (cube-sphere projection only). */
  radius: number;
};

export interface CpuTerrainCache {
  readonly generation: number;
  readonly ready: boolean;
  updateConfig(config: TerrainQueryConfig): void;
  triggerReadback(
    renderer: WebGPURenderer,
    attribute: StorageBufferAttribute,
    spatialIndex: SpatialIndex,
    boundsAttribute?: StorageBufferAttribute,
    activeLeafCount?: number,
  ): void;
  getElevation(worldX: number, worldZ: number): number | null;
  getNormal(worldX: number, worldZ: number): Vector3 | null;
  getTile(worldX: number, worldZ: number): TerrainTile | null;
  getTileBounds(worldX: number, worldZ: number): TerrainTileBounds | null;
  getGlobalElevationRange(): ElevationRange | null;
  sampleTerrainBatch(positions: Float32Array): TerrainSampleBatch;
  sampleTerrain(worldX: number, worldZ: number): TerrainSample;

  getElevationByDirection(direction: Vector3): number | null;
  getElevationByPosition(position: Vector3): number | null;
  getElevationByLatLong(latitudeDeg: number, longitudeDeg: number): number | null;
  getNormalByDirection(direction: Vector3): Vector3 | null;
  getNormalByPosition(position: Vector3): Vector3 | null;
  getNormalByLatLong(latitudeDeg: number, longitudeDeg: number): Vector3 | null;
  sampleTerrainByDirection(direction: Vector3): TerrainSurfaceSample;
  sampleTerrainByPosition(position: Vector3): TerrainSurfaceSample;
  sampleTerrainByLatLong(latitudeDeg: number, longitudeDeg: number): TerrainSurfaceSample;
  getTileByDirection(direction: Vector3): TerrainTile | null;
  getTileByPosition(position: Vector3): TerrainTile | null;
  getTileByLatLong(latitudeDeg: number, longitudeDeg: number): TerrainTile | null;
  getTileBoundsByDirection(direction: Vector3): TerrainTileBounds | null;
  getTileBoundsByPosition(position: Vector3): TerrainTileBounds | null;
  getTileBoundsByLatLong(latitudeDeg: number, longitudeDeg: number): TerrainTileBounds | null;
  sampleTerrainBatchByDirection(directions: Float32Array): TerrainSurfaceSampleBatch;
}

export function createCpuTerrainCache(
  maxNodes: number,
  initialConfig: TerrainQueryConfig,
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
    totalElements,
  );

  // Per-cache scratch (no module-scope state; the terrain may have many instances).
  const dirScratch: [number, number, number] = [0, 0, 0];
  const uvScratch: [number, number] = [0, 0];
  const llScratch: [number, number, number] = [0, 0, 0];
  const gridScratch = { gx: 0, gy: 0 };
  const gradientScratch: ElevationGradient = { dhdu: 0, dhdv: 0 };

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

  /**
   * World-space normal at a sphere sample, derived from the elevation-field
   * gradient rotated into the sphere tangent frame `(tu, dir, tv)`.
   *
   * Mirrors: the TSL `sphereTangentFrameNormal` in `nodes/cubeSphere.ts`
   * (used by the GPU `createTileLocalNormal` cube-sphere branch).
   */
  const computeSphereNormal = (
    leafIndex: number,
    gx: number,
    gy: number,
    tileSize: number,
    face: number,
    dirX: number,
    dirY: number,
    dirZ: number,
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

    const f = CUBE_FACES[face];
    const dDotR = dirX * f.right[0] + dirY * f.right[1] + dirZ * f.right[2];
    let tux = f.right[0] - dirX * dDotR;
    let tuy = f.right[1] - dirY * dDotR;
    let tuz = f.right[2] - dirZ * dDotR;
    const tuLen = Math.hypot(tux, tuy, tuz) || 1;
    tux /= tuLen;
    tuy /= tuLen;
    tuz /= tuLen;

    const dDotU = dirX * f.up[0] + dirY * f.up[1] + dirZ * f.up[2];
    let tvx = f.up[0] - dirX * dDotU;
    let tvy = f.up[1] - dirY * dDotU;
    let tvz = f.up[2] - dirZ * dDotU;
    const tvLen = Math.hypot(tvx, tvy, tvz) || 1;
    tvx /= tvLen;
    tvy /= tvLen;
    tvz /= tvLen;

    const nx = -dhdu;
    const ny = 1;
    const nz = -dhdv;
    return new Vector3(
      tux * nx + dirX * ny + tvx * nz,
      tuy * nx + dirY * ny + tvy * nz,
      tuz * nx + dirZ * ny + tvz * nz,
    ).normalize();
  };

  const sampleFromLookup = (lookup: TileLookupResult): TerrainSample => {
    const height = rawHeightFromLookup(lookup);
    const scaledHeight = config.originY + height * config.elevationScale;
    const normal = computeNormal(
      lookup.leafIndex,
      gridScratch.gx,
      gridScratch.gy,
      lookup.tileSize,
    );
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

  const getElevation = (
    worldX: number,
    worldZ: number,
  ): TerrainElevationSample => {
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

  // --- Cube-sphere queries -------------------------------------------------

  const invalidSurfaceSample = (
    dx: number,
    dy: number,
    dz: number,
  ): TerrainSurfaceSample => ({
    position: new Vector3(),
    normal: new Vector3(0, 1, 0),
    direction: new Vector3(dx, dy, dz),
    elevation: 0,
    valid: false,
  });

  const lookupDirection = (dx: number, dy: number, dz: number): TileLookupResult =>
    lookupTileForDirection(state.frontIndex, config, dx, dy, dz, dirScratch, uvScratch);

  const sampleSurfaceByDirection = (
    dx: number,
    dy: number,
    dz: number,
  ): TerrainSurfaceSample => {
    if (!state.hasSnapshot || config.projection !== "cubeSphere") {
      return invalidSurfaceSample(dx, dy, dz);
    }
    const len = Math.hypot(dx, dy, dz);
    if (len === 0) return invalidSurfaceSample(0, 0, 0);
    const nx = dx / len;
    const ny = dy / len;
    const nz = dz / len;
    const lookup = lookupDirection(nx, ny, nz);
    if (!lookup.found) return invalidSurfaceSample(nx, ny, nz);

    const height = rawHeightFromLookup(lookup);
    const elevation = height * config.elevationScale;
    const r = config.radius + elevation;
    const position = new Vector3(
      config.originX + nx * r,
      config.originY + ny * r,
      config.originZ + nz * r,
    );
    const normal = computeSphereNormal(
      lookup.leafIndex,
      gridScratch.gx,
      gridScratch.gy,
      lookup.tileSize,
      lookup.space,
      nx,
      ny,
      nz,
    );
    return {
      position,
      normal,
      direction: new Vector3(nx, ny, nz),
      elevation,
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
    const rawMin = state.frontTileBounds[lookup.leafIndex * 2]!;
    const rawMax = state.frontTileBounds[lookup.leafIndex * 2 + 1]!;
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

  const api: CpuTerrainCache = {
    get generation() {
      return state.generation;
    },
    get ready() {
      return state.hasSnapshot;
    },
    updateConfig(nextConfig) {
      config = nextConfig;
      shape.edgeVertexCount = config.innerTileSegments + 3;
      shape.verticesPerNode = shape.edgeVertexCount * shape.edgeVertexCount;
      totalElements = maxNodes * shape.verticesPerNode;
    },
    triggerReadback(
      renderer,
      attribute,
      spatialIndex,
      boundsAttribute,
      activeLeafCount,
    ) {
      triggerSnapshotReadback(state, renderer, attribute, spatialIndex, boundsAttribute, {
        activeLeafCount: activeLeafCount ?? 0,
        totalElements,
        elevationScale: config.elevationScale,
        originY: config.originY,
      });
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

    // --- Cube-sphere queries ---
    sampleTerrainByDirection(direction) {
      return sampleSurfaceByDirection(direction.x, direction.y, direction.z);
    },
    sampleTerrainByPosition(position) {
      return sampleSurfaceByDirection(
        position.x - config.originX,
        position.y - config.originY,
        position.z - config.originZ,
      );
    },
    sampleTerrainByLatLong(latitudeDeg, longitudeDeg) {
      latLongToDirection(latitudeDeg, longitudeDeg, llScratch);
      return sampleSurfaceByDirection(llScratch[0], llScratch[1], llScratch[2]);
    },
    getElevationByDirection(direction) {
      const sample = sampleSurfaceByDirection(direction.x, direction.y, direction.z);
      return sample.valid ? sample.elevation : null;
    },
    getElevationByPosition(position) {
      const sample = sampleSurfaceByDirection(
        position.x - config.originX,
        position.y - config.originY,
        position.z - config.originZ,
      );
      return sample.valid ? sample.elevation : null;
    },
    getElevationByLatLong(latitudeDeg, longitudeDeg) {
      latLongToDirection(latitudeDeg, longitudeDeg, llScratch);
      const sample = sampleSurfaceByDirection(llScratch[0], llScratch[1], llScratch[2]);
      return sample.valid ? sample.elevation : null;
    },
    getNormalByDirection(direction) {
      const sample = sampleSurfaceByDirection(direction.x, direction.y, direction.z);
      return sample.valid ? sample.normal : null;
    },
    getNormalByPosition(position) {
      const sample = sampleSurfaceByDirection(
        position.x - config.originX,
        position.y - config.originY,
        position.z - config.originZ,
      );
      return sample.valid ? sample.normal : null;
    },
    getNormalByLatLong(latitudeDeg, longitudeDeg) {
      latLongToDirection(latitudeDeg, longitudeDeg, llScratch);
      const sample = sampleSurfaceByDirection(llScratch[0], llScratch[1], llScratch[2]);
      return sample.valid ? sample.normal : null;
    },
    getTileByDirection(direction) {
      if (!state.hasSnapshot) return null;
      return tileFromLookup(lookupDirection(direction.x, direction.y, direction.z));
    },
    getTileByPosition(position) {
      if (!state.hasSnapshot) return null;
      return tileFromLookup(
        lookupDirection(
          position.x - config.originX,
          position.y - config.originY,
          position.z - config.originZ,
        ),
      );
    },
    getTileByLatLong(latitudeDeg, longitudeDeg) {
      if (!state.hasSnapshot) return null;
      latLongToDirection(latitudeDeg, longitudeDeg, llScratch);
      return tileFromLookup(lookupDirection(llScratch[0], llScratch[1], llScratch[2]));
    },
    getTileBoundsByDirection(direction) {
      if (!state.hasSnapshot) return null;
      return tileBoundsFromLookup(
        lookupDirection(direction.x, direction.y, direction.z),
        0,
      );
    },
    getTileBoundsByPosition(position) {
      if (!state.hasSnapshot) return null;
      return tileBoundsFromLookup(
        lookupDirection(
          position.x - config.originX,
          position.y - config.originY,
          position.z - config.originZ,
        ),
        0,
      );
    },
    getTileBoundsByLatLong(latitudeDeg, longitudeDeg) {
      if (!state.hasSnapshot) return null;
      latLongToDirection(latitudeDeg, longitudeDeg, llScratch);
      return tileBoundsFromLookup(
        lookupDirection(llScratch[0], llScratch[1], llScratch[2]),
        0,
      );
    },
    sampleTerrainBatchByDirection(directions) {
      const count = Math.floor(directions.length / 3);
      const positions = new Float32Array(count * 3);
      const normals = new Float32Array(count * 3);
      const elevations = new Float32Array(count);
      const valid = new Uint8Array(count);
      if (!state.hasSnapshot || config.projection !== "cubeSphere") {
        return { positions, normals, elevations, valid, generation: state.generation };
      }
      for (let i = 0; i < count; i += 1) {
        const sample = sampleSurfaceByDirection(
          directions[i * 3] ?? 0,
          directions[i * 3 + 1] ?? 0,
          directions[i * 3 + 2] ?? 0,
        );
        if (!sample.valid) {
          normals[i * 3 + 1] = 1;
          continue;
        }
        positions[i * 3] = sample.position.x;
        positions[i * 3 + 1] = sample.position.y;
        positions[i * 3 + 2] = sample.position.z;
        normals[i * 3] = sample.normal.x;
        normals[i * 3 + 1] = sample.normal.y;
        normals[i * 3 + 2] = sample.normal.z;
        elevations[i] = sample.elevation;
        valid[i] = 1;
      }
      return { positions, normals, elevations, valid, generation: state.generation };
    },
  };

  return api;
}

export type { TerrainQueryConfig };
