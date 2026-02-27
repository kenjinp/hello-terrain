import type {
  TerrainQuery,
  TerrainSample,
  TerrainSampleBatch,
  TerrainTile,
} from "./types";
import type { CpuTerrainCache } from "./cpu-terrain-cache";

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
    sampleTerrain(worldX: number, worldZ: number): TerrainSample {
      return cache.sampleTerrain(worldX, worldZ);
    },
    sampleTerrainBatch(positions: Float32Array): TerrainSampleBatch {
      return cache.sampleTerrainBatch(positions);
    },
  };
}
