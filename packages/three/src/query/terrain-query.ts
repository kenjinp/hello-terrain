import type {
  ElevationRange,
  TerrainQuery,
  TerrainSample,
  TerrainSampleBatch,
  TerrainSphereQuery,
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

/** Cube-sphere query, keyed on a direction / position / lat-long. */
export function createTerrainSphereQuery(cache: CpuTerrainCache): TerrainSphereQuery {
  return {
    get generation() {
      return cache.generation;
    },
    getElevationByDirection(direction) {
      return cache.getElevationByDirection(direction);
    },
    getElevationByPosition(position) {
      return cache.getElevationByPosition(position);
    },
    getElevationByLatLong(latitudeDeg, longitudeDeg) {
      return cache.getElevationByLatLong(latitudeDeg, longitudeDeg);
    },
    getNormalByDirection(direction) {
      return cache.getNormalByDirection(direction);
    },
    getNormalByPosition(position) {
      return cache.getNormalByPosition(position);
    },
    getNormalByLatLong(latitudeDeg, longitudeDeg) {
      return cache.getNormalByLatLong(latitudeDeg, longitudeDeg);
    },
    sampleTerrainByDirection(direction) {
      return cache.sampleTerrainByDirection(direction);
    },
    sampleTerrainByPosition(position) {
      return cache.sampleTerrainByPosition(position);
    },
    sampleTerrainByLatLong(latitudeDeg, longitudeDeg) {
      return cache.sampleTerrainByLatLong(latitudeDeg, longitudeDeg);
    },
    getTileByDirection(direction) {
      return cache.getTileByDirection(direction);
    },
    getTileByPosition(position) {
      return cache.getTileByPosition(position);
    },
    getTileByLatLong(latitudeDeg, longitudeDeg) {
      return cache.getTileByLatLong(latitudeDeg, longitudeDeg);
    },
    getTileBoundsByDirection(direction) {
      return cache.getTileBoundsByDirection(direction);
    },
    getTileBoundsByPosition(position) {
      return cache.getTileBoundsByPosition(position);
    },
    getTileBoundsByLatLong(latitudeDeg, longitudeDeg) {
      return cache.getTileBoundsByLatLong(latitudeDeg, longitudeDeg);
    },
    sampleTerrainBatchByDirection(directions) {
      return cache.sampleTerrainBatchByDirection(directions);
    },
  };
}
