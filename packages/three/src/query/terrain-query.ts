import type {
  ElevationRange,
  TerrainQuery,
  TerrainSample,
  TerrainSampleBatch,
  TerrainSurfaceQuery,
  TerrainTile,
  TerrainTileBounds,
} from "./types";
import type { CpuTerrainCache } from "./cpu-terrain-cache";

/** Flat (heightfield) query, keyed on world XZ. */
export function createTerrainQuery(cache: CpuTerrainCache): TerrainQuery {
  return {
    get generation() {
      return cache.generation;
    },
    getElevation(worldX: number, worldZ: number): number | null {
      return cache.getElevation(worldX, worldZ);
    },
    getNormal(worldX: number, worldZ: number) {
      return cache.getNormal(worldX, worldZ);
    },
    getTile(worldX: number, worldZ: number): TerrainTile | null {
      return cache.getTile(worldX, worldZ);
    },
    getTileBounds(worldX: number, worldZ: number): TerrainTileBounds | null {
      return cache.getTileBounds(worldX, worldZ);
    },
    getGlobalElevationRange(): ElevationRange | null {
      return cache.getGlobalElevationRange();
    },
    sampleTerrain(worldX: number, worldZ: number): TerrainSample {
      return cache.sampleTerrain(worldX, worldZ);
    },
    sampleTerrainBatch(positions: Float32Array): TerrainSampleBatch {
      return cache.sampleTerrainBatch(positions);
    },
  };
}

/**
 * Generic closed-surface query, keyed on a world position projected onto the
 * surface. Cube-sphere extends this with direction/lat-long keys.
 */
export function createTerrainSurfaceQuery(cache: CpuTerrainCache): TerrainSurfaceQuery {
  return {
    get generation() {
      return cache.generation;
    },
    getElevationByPosition(position) {
      return cache.getElevationBySurfacePosition(position.x, position.y, position.z);
    },
    getNormalByPosition(position) {
      return cache.getNormalBySurfacePosition(position.x, position.y, position.z);
    },
    sampleTerrainByPosition(position) {
      return cache.sampleSurfaceByPosition(position.x, position.y, position.z);
    },
    getTileByPosition(position) {
      return cache.getTileBySurfacePosition(position.x, position.y, position.z);
    },
    getTileBoundsByPosition(position) {
      return cache.getTileBoundsBySurfacePosition(position.x, position.y, position.z);
    },
    sampleTerrainBatchByPosition(positions) {
      return cache.sampleSurfaceBatchByPosition(positions);
    },
  };
}
