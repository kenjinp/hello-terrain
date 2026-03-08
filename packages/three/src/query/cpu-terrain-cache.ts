import { Vector3 } from "three";
import type { StorageBufferAttribute, WebGPURenderer } from "three/webgpu";
import type { SpatialIndex } from "../quadtree";
import { createSpatialIndex, U32_EMPTY } from "../quadtree";
import { lookupSpatialIndexRaw } from "../quadtree/spatialIndex";
import type {
  ElevationRange,
  TerrainElevationSample,
  TerrainSample,
  TerrainSampleBatch,
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
};

type TileLookupResult = {
  found: boolean;
  leafIndex: number;
  level: number;
  tileX: number;
  tileY: number;
  tileSize: number;
  localU: number;
  localV: number;
};

type RendererReadback = WebGPURenderer & {
  getArrayBufferAsync?: (
    attribute: StorageBufferAttribute,
  ) => Promise<ArrayBuffer>;
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
}

function cloneSpatialIndex(target: SpatialIndex, source: SpatialIndex): void {
  if (target.size !== source.size) {
    throw new Error(
      `SpatialIndex size mismatch (target=${target.size}, source=${source.size}).`,
    );
  }
  target.mask = source.mask;
  target.stampGen = source.stampGen;
  target.stamp.set(source.stamp);
  target.keysSpace.set(source.keysSpace);
  target.keysLevel.set(source.keysLevel);
  target.keysX.set(source.keysX);
  target.keysY.set(source.keysY);
  target.values.set(source.values);
}
/**
 * Spatial index snapshot consistency contract:
 * - GPU elevation/bounds readback completes asynchronously.
 * - Quadtree/index state can mutate before readback completion.
 * - CPU query snapshots must pair elevation/bounds with the matching index generation.
 *
 * Therefore we clone the source index into the cache back-buffer before scheduling
 * async readback. This copy is required for correctness unless the quadtree/index
 * itself provides immutable frame snapshots.
 */

function tileLocalToFieldUV(localCoord: number, innerSegments: number): number {
  const edge = innerSegments + 3;
  return (localCoord * innerSegments + 1.5) / edge;
}

export function createCpuTerrainCache(
  maxNodes: number,
  initialConfig: TerrainQueryConfig,
): CpuTerrainCache {
  let config = initialConfig;
  let edgeVertexCount = config.innerTileSegments + 3;
  let verticesPerNode = edgeVertexCount * edgeVertexCount;
  let totalElements = maxNodes * verticesPerNode;
  let frontElevation = new Float32Array(totalElements);
  let backElevation = new Float32Array(totalElements);
  let frontIndex = createSpatialIndex(maxNodes);
  let backIndex = createSpatialIndex(maxNodes);
  let frontTileBounds = new Float32Array(maxNodes * 2);
  let backTileBounds = new Float32Array(maxNodes * 2);
  let frontLeafCount = 0;
  let globalRange: ElevationRange | null = null;
  let hasSnapshot = false;
  let readbackPending = false;
  let generationCount = 0;
  let lastScheduledStampGen = -1;

  const readHeight = (leafIndex: number, ix: number, iy: number): number => {
    const base = leafIndex * verticesPerNode;
    return frontElevation[base + iy * edgeVertexCount + ix] ?? 0;
  };

  const sampleGridBilinear = (
    leafIndex: number,
    gx: number,
    gy: number,
  ): number => {
    const max = edgeVertexCount - 1;
    const x = Math.max(0, Math.min(max, gx));
    const y = Math.max(0, Math.min(max, gy));
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(max, x0 + 1);
    const y1 = Math.min(max, y0 + 1);
    const tx = x - x0;
    const ty = y - y0;
    const h00 = readHeight(leafIndex, x0, y0);
    const h10 = readHeight(leafIndex, x1, y0);
    const h01 = readHeight(leafIndex, x0, y1);
    const h11 = readHeight(leafIndex, x1, y1);
    const hx0 = h00 + (h10 - h00) * tx;
    const hx1 = h01 + (h11 - h01) * tx;
    return hx0 + (hx1 - hx0) * ty;
  };

  const computeNormal = (
    leafIndex: number,
    gx: number,
    gy: number,
    tileSize: number,
  ): Vector3 => {
    const hLeft = sampleGridBilinear(leafIndex, gx - 1, gy);
    const hRight = sampleGridBilinear(leafIndex, gx + 1, gy);
    const hUp = sampleGridBilinear(leafIndex, gx, gy - 1);
    const hDown = sampleGridBilinear(leafIndex, gx, gy + 1);
    const stepWorld = tileSize / config.innerTileSegments;
    const inv2Step = 0.5 / stepWorld;
    const dhdx = (hRight - hLeft) * config.elevationScale * inv2Step;
    const dhdz = (hDown - hUp) * config.elevationScale * inv2Step;
    return new Vector3(-dhdx, 1, -dhdz).normalize();
  };

  const lookupTile = (worldX: number, worldZ: number): TileLookupResult => {
    const halfRoot = config.rootSize * 0.5;
    for (let level = config.maxLevel; level >= 0; level -= 1) {
      const scale = 2 ** level;
      const tileSize = config.rootSize / scale;
      const tileX = Math.floor((worldX - config.originX + halfRoot) / tileSize);
      const tileY = Math.floor((worldZ - config.originZ + halfRoot) / tileSize);
      const leafIndex = lookupSpatialIndexRaw(
        frontIndex,
        0,
        level,
        tileX,
        tileY,
      );
      if (leafIndex !== U32_EMPTY) {
        const tileMinX = config.originX + tileX * tileSize - halfRoot;
        const tileMinZ = config.originZ + tileY * tileSize - halfRoot;
        return {
          found: true,
          leafIndex,
          level,
          tileX,
          tileY,
          tileSize,
          localU: (worldX - tileMinX) / tileSize,
          localV: (worldZ - tileMinZ) / tileSize,
        };
      }
    }
    return {
      found: false,
      leafIndex: -1,
      level: -1,
      tileX: -1,
      tileY: -1,
      tileSize: 0,
      localU: 0,
      localV: 0,
    };
  };

  const sampleFromLookup = (lookup: TileLookupResult): TerrainSample => {
    const fieldU = tileLocalToFieldUV(lookup.localU, config.innerTileSegments);
    const fieldV = tileLocalToFieldUV(lookup.localV, config.innerTileSegments);
    const gx = fieldU * (edgeVertexCount - 1);
    const gy = fieldV * (edgeVertexCount - 1);
    const height = sampleGridBilinear(lookup.leafIndex, gx, gy);
    const scaledHeight = config.originY + height * config.elevationScale;
    const normal = computeNormal(lookup.leafIndex, gx, gy, lookup.tileSize);
    return { elevation: scaledHeight, normal, valid: true };
  };

  const sampleElevationFromLookup = (lookup: TileLookupResult) => {
    const fieldU = tileLocalToFieldUV(lookup.localU, config.innerTileSegments);
    const fieldV = tileLocalToFieldUV(lookup.localV, config.innerTileSegments);
    const gx = fieldU * (edgeVertexCount - 1);
    const gy = fieldV * (edgeVertexCount - 1);
    const height = sampleGridBilinear(lookup.leafIndex, gx, gy);
    const scaledHeight = config.originY + height * config.elevationScale;
    return { elevation: scaledHeight, valid: true };
  };

  const sampleTerrain = (worldX: number, worldZ: number): TerrainSample => {
    if (!hasSnapshot) {
      return { elevation: 0, normal: new Vector3(0, 1, 0), valid: false };
    }
    const lookup = lookupTile(worldX, worldZ);
    if (!lookup.found) {
      return { elevation: 0, normal: new Vector3(0, 1, 0), valid: false };
    }
    return sampleFromLookup(lookup);
  };

  const getElevation = (
    worldX: number,
    worldZ: number,
  ): TerrainElevationSample => {
    if (!hasSnapshot) {
      return { elevation: 0, valid: false };
    }
    const lookup = lookupTile(worldX, worldZ);
    if (!lookup.found) {
      return { elevation: 0, valid: false };
    }
    return sampleElevationFromLookup(lookup);
  };

  const api: CpuTerrainCache = {
    get generation() {
      return generationCount;
    },
    get ready() {
      return hasSnapshot;
    },
    updateConfig(nextConfig) {
      config = nextConfig;
      edgeVertexCount = config.innerTileSegments + 3;
      verticesPerNode = edgeVertexCount * edgeVertexCount;
      totalElements = maxNodes * verticesPerNode;
    },
    triggerReadback(
      renderer,
      attribute,
      spatialIndex,
      boundsAttribute,
      activeLeafCount,
    ) {
      if (readbackPending) return;
      const withReadback = renderer as RendererReadback;
      if (!withReadback.getArrayBufferAsync) return;
      if (spatialIndex.stampGen === lastScheduledStampGen) return;

      cloneSpatialIndex(backIndex, spatialIndex);
      lastScheduledStampGen = spatialIndex.stampGen;

      const capturedLeafCount = activeLeafCount ?? 0;
      const capturedScale = config.elevationScale;
      const capturedOriginY = config.originY;

      readbackPending = true;
      const elevationPromise = withReadback.getArrayBufferAsync(attribute);
      const boundsPromise = boundsAttribute
        ? withReadback.getArrayBufferAsync(boundsAttribute)
        : null;

      const onComplete = (
        elevResult: ArrayBuffer,
        boundsResult: ArrayBuffer | null,
      ) => {
        const data = new Float32Array(elevResult);
        backElevation.fill(0);
        backElevation.set(data.subarray(0, totalElements));

        let boundsValid = capturedLeafCount === 0;
        if (boundsResult) {
          const rawBounds = new Float32Array(boundsResult);
          backTileBounds.fill(0);
          backTileBounds.set(rawBounds.subarray(0, capturedLeafCount * 2));
          for (let i = 0; i < capturedLeafCount; i += 1) {
            if ((rawBounds[i * 2 + 1] ?? 0) !== 0) {
              boundsValid = true;
              break;
            }
          }
        }

        const oldFrontElevation = frontElevation;
        const oldFrontIndex = frontIndex;
        frontElevation = backElevation;
        frontIndex = backIndex;
        frontLeafCount = capturedLeafCount;
        backElevation = oldFrontElevation;
        backIndex = oldFrontIndex;
        if (boundsResult && boundsValid) {
          const oldFrontBounds = frontTileBounds;
          frontTileBounds = backTileBounds;
          backTileBounds = oldFrontBounds;
        }

        if (boundsResult && boundsValid && capturedLeafCount > 0) {
          let gMin = Infinity;
          let gMax = -Infinity;
          for (let i = 0; i < capturedLeafCount; i++) {
            const rawMin = frontTileBounds[i * 2]!;
            const rawMax = frontTileBounds[i * 2 + 1]!;
            const a = capturedOriginY + rawMin * capturedScale;
            const b = capturedOriginY + rawMax * capturedScale;
            gMin = Math.min(gMin, a, b);
            gMax = Math.max(gMax, a, b);
          }
          globalRange = { min: gMin, max: gMax };
        }

        hasSnapshot = true;
        generationCount += 1;
      };

      if (boundsPromise) {
        Promise.all([elevationPromise, boundsPromise])
          .then(([elev, bounds]) => onComplete(elev, bounds))
          .finally(() => {
            readbackPending = false;
          });
      } else {
        elevationPromise
          .then((elev) => onComplete(elev, null))
          .finally(() => {
            readbackPending = false;
          });
      }
    },
    getElevation(worldX, worldZ) {
      const sample = getElevation(worldX, worldZ);
      return sample.valid ? sample.elevation : null;
    },
    getNormal(worldX, worldZ) {
      return sampleTerrain(worldX, worldZ).normal;
    },
    getTile(worldX, worldZ) {
      if (!hasSnapshot) return null;
      const lookup = lookupTile(worldX, worldZ);
      if (!lookup.found) return null;
      return {
        level: lookup.level,
        x: lookup.tileX,
        y: lookup.tileY,
        index: lookup.leafIndex,
      };
    },
    getTileBounds(worldX, worldZ) {
      if (!hasSnapshot) return null;
      const lookup = lookupTile(worldX, worldZ);
      if (!lookup.found || lookup.leafIndex >= frontLeafCount) return null;
      const rawMin = frontTileBounds[lookup.leafIndex * 2]!;
      const rawMax = frontTileBounds[lookup.leafIndex * 2 + 1]!;
      const a = config.originY + rawMin * config.elevationScale;
      const b = config.originY + rawMax * config.elevationScale;
      return {
        level: lookup.level,
        x: lookup.tileX,
        y: lookup.tileY,
        index: lookup.leafIndex,
        minElevation: Math.min(a, b),
        maxElevation: Math.max(a, b),
      };
    },
    getGlobalElevationRange() {
      return globalRange;
    },
    sampleTerrainBatch(positions) {
      const count = Math.floor(positions.length / 2);
      const elevations = new Float32Array(count);
      const normals = new Float32Array(count * 3);
      const valid = new Uint8Array(count);
      if (!hasSnapshot) {
        return { elevations, normals, valid, generation: generationCount };
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
            level: lastTile.level,
            tileX: lastTile.tileX,
            tileY: lastTile.tileY,
            tileSize: lastTile.tileSize,
            localU: (worldX - lastTile.tileMinX) / lastTile.tileSize,
            localV: (worldZ - lastTile.tileMinZ) / lastTile.tileSize,
          };
        } else {
          lookup = lookupTile(worldX, worldZ);
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

      return { elevations, normals, valid, generation: generationCount };
    },
    sampleTerrain,
  };

  return api;
}

export type { TerrainQueryConfig };
