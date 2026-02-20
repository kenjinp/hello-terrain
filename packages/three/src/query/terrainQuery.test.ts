import { describe, expect, it } from "vitest";
import { allocLeafSet } from "../quadtree/types.js";
import { createTerrainQuery } from "./terrainQuery.js";
import type { TerrainReadbackCache } from "./types.js";

function makeSingleLeafSet() {
  const leaves = allocLeafSet(1);
  leaves.count = 1;
  leaves.space[0] = 0;
  leaves.level[0] = 0;
  leaves.x[0] = 0;
  leaves.y[0] = 0;
  return leaves;
}

function makeCache(edgeVertexCount: number, tileCount: number): TerrainReadbackCache {
  return {
    edgeVertexCount,
    tileCount,
    channels: 4,
    data: new Float32Array(edgeVertexCount * edgeVertexCount * tileCount * 4),
  };
}

describe("query/terrainQuery", () => {
  it("samples bilinearly and applies elevation scale", () => {
    const leaves = makeSingleLeafSet();
    const edge = 16;
    const cache = makeCache(edge, 1);

    for (let y = 0; y < edge; y += 1) {
      for (let x = 0; x < edge; x += 1) {
        const base = (y * edge + x) * 4;
        cache.data[base] = x + y; // elevation
        cache.data[base + 1] = 0; // nx
        cache.data[base + 2] = 0; // nz
        cache.data[base + 3] = 0;
      }
    }

    const query = createTerrainQuery(
      leaves,
      cache,
      {
        rootOrigin: { x: 0, z: 0 },
        rootSize: 100,
        innerTileSegments: 13,
        elevationScale: 2,
        maxLevel: 4,
      },
    );

    const sampled = query.sampleAtRootUV(0.5, 0.5);
    expect(sampled).not.toBeNull();
    expect(sampled?.elevation).toBeCloseTo(30); // bilerp(14,15,15,16) * 2
    expect(sampled?.normal.y).toBeCloseTo(1);
  });

  it("writes explicit validity mask for misses in batch output", () => {
    const leaves = makeSingleLeafSet();
    const edge = 16;
    const cache = makeCache(edge, 1);
    const query = createTerrainQuery(
      leaves,
      cache,
      {
        rootOrigin: { x: 0, z: 0 },
        rootSize: 10,
        innerTileSegments: 13,
        elevationScale: 1,
        maxLevel: 2,
      },
    );

    const positions = new Float32Array([0, 0, 1_000, 1_000]);
    const elevations = new Float32Array(2);
    const normals = new Float32Array(6);
    const valid = new Uint8Array(2);
    const hits = query.sampleBatch(positions, elevations, normals, valid);

    expect(hits).toBe(1);
    expect(valid[0]).toBe(1);
    expect(valid[1]).toBe(0);
    expect(elevations[1]).toBe(0);
    expect(normals[3]).toBe(0);
  });
});
