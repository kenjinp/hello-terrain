import { buildLeafIndex, type SpatialIndex } from "../quadtree/leafIndex";
import type { LeafSet } from "../quadtree";
import { worldToTile } from "./worldToTile";
import type {
  TerrainNormal,
  TerrainQuery,
  TerrainReadbackCache,
  TerrainSample,
} from "./types";

export interface TerrainQueryParams {
  rootOrigin: { x: number; z: number };
  rootSize: number;
  innerTileSegments: number;
  elevationScale: number;
  maxLevel: number;
}

type SampleChannels = { elevation: number; nx: number; nz: number };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function reconstructNormal(nx: number, nz: number): TerrainNormal {
  const nnx = clamp(nx, -1, 1);
  const nnz = clamp(nz, -1, 1);
  const yy = Math.sqrt(Math.max(0, 1 - nnx * nnx - nnz * nnz));
  return { x: nnx, y: yy, z: nnz };
}

export function createTerrainQuery(
  leafSet: LeafSet,
  cache: TerrainReadbackCache,
  params: TerrainQueryParams,
  existingIndex?: SpatialIndex,
): TerrainQuery {
  const edgeVertexCount = params.innerTileSegments + 3;
  const leafIndex = buildLeafIndex(leafSet, existingIndex);

  const readChannel = (
    leafIdx: number,
    texelX: number,
    texelY: number,
    channel: 0 | 1 | 2 | 3,
  ): number => {
    const tileStride = edgeVertexCount * edgeVertexCount * 4;
    const tileBase = leafIdx * tileStride;
    const texelBase = (texelY * edgeVertexCount + texelX) * 4;
    return cache.data[tileBase + texelBase + channel] ?? 0;
  };

  const bilerp = (
    c00: number,
    c10: number,
    c01: number,
    c11: number,
    tx: number,
    ty: number,
  ): number => {
    const a = c00 + (c10 - c00) * tx;
    const b = c01 + (c11 - c01) * tx;
    return a + (b - a) * ty;
  };

  const sampleChannelsAt = (
    leafIdx: number,
    tileLocalU: number,
    tileLocalV: number,
  ): SampleChannels => {
    const inner = params.innerTileSegments;
    const x = tileLocalU * inner + 1;
    const y = tileLocalV * inner + 1;

    const x0 = clamp(Math.floor(x), 0, edgeVertexCount - 1);
    const y0 = clamp(Math.floor(y), 0, edgeVertexCount - 1);
    const x1 = clamp(x0 + 1, 0, edgeVertexCount - 1);
    const y1 = clamp(y0 + 1, 0, edgeVertexCount - 1);
    const tx = clamp(x - x0, 0, 1);
    const ty = clamp(y - y0, 0, 1);

    const h00 = readChannel(leafIdx, x0, y0, 0);
    const h10 = readChannel(leafIdx, x1, y0, 0);
    const h01 = readChannel(leafIdx, x0, y1, 0);
    const h11 = readChannel(leafIdx, x1, y1, 0);

    const nx00 = readChannel(leafIdx, x0, y0, 1);
    const nx10 = readChannel(leafIdx, x1, y0, 1);
    const nx01 = readChannel(leafIdx, x0, y1, 1);
    const nx11 = readChannel(leafIdx, x1, y1, 1);

    const nz00 = readChannel(leafIdx, x0, y0, 2);
    const nz10 = readChannel(leafIdx, x1, y0, 2);
    const nz01 = readChannel(leafIdx, x0, y1, 2);
    const nz11 = readChannel(leafIdx, x1, y1, 2);

    return {
      elevation: bilerp(h00, h10, h01, h11, tx, ty),
      nx: bilerp(nx00, nx10, nx01, nx11, tx, ty),
      nz: bilerp(nz00, nz10, nz01, nz11, tx, ty),
    };
  };

  const sample = (worldX: number, worldZ: number): TerrainSample | null => {
    const hit = worldToTile({
      worldX,
      worldZ,
      leafSet,
      leafIndex,
      rootOrigin: params.rootOrigin,
      rootSize: params.rootSize,
      innerTileSegments: params.innerTileSegments,
      maxLevel: params.maxLevel,
    });
    if (!hit) return null;

    const channel = sampleChannelsAt(hit.leafIndex, hit.tileLocalU, hit.tileLocalV);
    return {
      elevation: channel.elevation * params.elevationScale,
      normal: reconstructNormal(channel.nx, channel.nz),
    };
  };

  const sampleBatch: TerrainQuery["sampleBatch"] = (
    positions,
    outElevations,
    outNormals,
    outValid,
  ) => {
    if (outValid) outValid.fill(0);

    const queryCount = Math.min(Math.floor(positions.length / 2), outElevations.length);
    const resolved: Array<{ i: number; leafIndex: number; u: number; v: number }> = [];

    for (let i = 0; i < queryCount; i += 1) {
      const x = positions[i * 2] ?? 0;
      const z = positions[i * 2 + 1] ?? 0;
      const hit = worldToTile({
        worldX: x,
        worldZ: z,
        leafSet,
        leafIndex,
        rootOrigin: params.rootOrigin,
        rootSize: params.rootSize,
        innerTileSegments: params.innerTileSegments,
        maxLevel: params.maxLevel,
      });
      if (!hit) {
        outElevations[i] = 0;
        if (outNormals && outNormals.length >= (i + 1) * 3) {
          outNormals[i * 3] = 0;
          outNormals[i * 3 + 1] = 0;
          outNormals[i * 3 + 2] = 0;
        }
        if (outValid && outValid.length > i) outValid[i] = 0;
        continue;
      }
      resolved.push({ i, leafIndex: hit.leafIndex, u: hit.tileLocalU, v: hit.tileLocalV });
    }

    resolved.sort((a, b) => a.leafIndex - b.leafIndex);

    let hits = 0;
    for (const entry of resolved) {
      const sampled = sampleChannelsAt(entry.leafIndex, entry.u, entry.v);
      outElevations[entry.i] = sampled.elevation * params.elevationScale;
      if (outNormals && outNormals.length >= (entry.i + 1) * 3) {
        const n = reconstructNormal(sampled.nx, sampled.nz);
        outNormals[entry.i * 3] = n.x;
        outNormals[entry.i * 3 + 1] = n.y;
        outNormals[entry.i * 3 + 2] = n.z;
      }
      if (outValid && outValid.length > entry.i) outValid[entry.i] = 1;
      hits += 1;
    }

    return hits;
  };

  return {
    getElevation(worldX, worldZ) {
      return sample(worldX, worldZ)?.elevation ?? null;
    },
    getNormal(worldX, worldZ) {
      return sample(worldX, worldZ)?.normal ?? null;
    },
    sample,
    sampleAtRootUV(u, v) {
      const worldX = params.rootOrigin.x + (u - 0.5) * params.rootSize;
      const worldZ = params.rootOrigin.z + (0.5 - v) * params.rootSize;
      return sample(worldX, worldZ);
    },
    sampleBatch,
  };
}
