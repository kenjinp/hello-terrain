import { Vector3 } from "three";
import type { StorageBufferAttribute, WebGPURenderer } from "three/webgpu";
import type { SpatialIndex } from "../quadtree";
import {
  type Vec3Mutable,
  directionToFaceUV,
  faceUVToCube,
  latLongToDirection,
} from "../quadtree";
import type { TopologyProjection } from "../quadtree";
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

type TerrainQueryConfig = {
  rootSize: number;
  originX: number;
  originY: number;
  originZ: number;
  innerTileSegments: number;
  elevationScale: number;
  maxLevel: number;
  /** Topology projection; `cubeSphere` enables the direction/lat-long queries. */
  projection: TopologyProjection;
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
  /** Release GPU readback staging buffers owned by this cache. */
  dispose(): void;
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
  // Cube-sphere normal scratch (allocation-free hot path).
  const normalDirScratch: Vec3Mutable = [0, 0, 0];
  const normalUvScratch: [number, number] = [0, 0];
  const normalCubeScratch: Vec3Mutable = [0, 0, 0];
  const posLeft: Vec3Mutable = [0, 0, 0];
  const posRight: Vec3Mutable = [0, 0, 0];
  const posUp: Vec3Mutable = [0, 0, 0];
  const posDown: Vec3Mutable = [0, 0, 0];

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

  /** World position on the displaced sphere for a face-local (u, v) + height. */
  const sphereNeighborPos = (
    face: number,
    u: number,
    v: number,
    height: number,
    out: Vec3Mutable,
  ): void => {
    faceUVToCube(face, u, v, normalCubeScratch);
    const len =
      Math.hypot(normalCubeScratch[0], normalCubeScratch[1], normalCubeScratch[2]) ||
      1;
    const r = (config.radius + height) / len;
    out[0] = normalCubeScratch[0] * r;
    out[1] = normalCubeScratch[1] * r;
    out[2] = normalCubeScratch[2] * r;
  };

  /**
   * World-space normal at a sphere sample, from the cross product of the
   * spanning tangents between the four cardinal neighbors on the displaced
   * sphere. This is metric- and curvature-correct and frame-independent, so it
   * stays continuous across cube-face seams.
   *
   * Mirrors: the TSL `createSphereNormalFromElevationField` in
   * `tasks/terrain-field.task.ts`.
   */
  const computeSphereNormal = (
    leafIndex: number,
    gx: number,
    gy: number,
    level: number,
    face: number,
    dirX: number,
    dirY: number,
    dirZ: number,
  ): Vector3 => {
    const scale = config.elevationScale;
    // Face-UV step that matches one elevation-field grid texel.
    const duv = 1 / (config.innerTileSegments * 2 ** level);

    normalDirScratch[0] = dirX;
    normalDirScratch[1] = dirY;
    normalDirScratch[2] = dirZ;
    directionToFaceUV(face, normalDirScratch, normalUvScratch);
    const u = normalUvScratch[0];
    const v = normalUvScratch[1];

    const hLeft =
      sampleGridBilinear(state.frontElevation, shape, leafIndex, gx - 1, gy) * scale;
    const hRight =
      sampleGridBilinear(state.frontElevation, shape, leafIndex, gx + 1, gy) * scale;
    const hUp =
      sampleGridBilinear(state.frontElevation, shape, leafIndex, gx, gy - 1) * scale;
    const hDown =
      sampleGridBilinear(state.frontElevation, shape, leafIndex, gx, gy + 1) * scale;

    sphereNeighborPos(face, u - duv, v, hLeft, posLeft);
    sphereNeighborPos(face, u + duv, v, hRight, posRight);
    sphereNeighborPos(face, u, v - duv, hUp, posUp);
    sphereNeighborPos(face, u, v + duv, hDown, posDown);

    const tux = posRight[0] - posLeft[0];
    const tuy = posRight[1] - posLeft[1];
    const tuz = posRight[2] - posLeft[2];
    const tvx = posDown[0] - posUp[0];
    const tvy = posDown[1] - posUp[1];
    const tvz = posDown[2] - posUp[2];

    let nx = tuy * tvz - tuz * tvy;
    let ny = tuz * tvx - tux * tvz;
    let nz = tux * tvy - tuy * tvx;
    // Orient radially outward.
    if (nx * dirX + ny * dirY + nz * dirZ < 0) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    return new Vector3(nx, ny, nz).normalize();
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
      lookup.level,
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
