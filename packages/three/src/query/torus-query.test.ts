import { Ray, Vector3 } from "three";
import type { StorageBufferAttribute } from "three/webgpu";
import { describe, expect, it } from "vitest";
import {
  createSpatialIndex,
  insertSpatialIndexRaw,
} from "../quadtree/spatialIndex";
import { createTorusProjection } from "../projection/torus";
import { torusRaycast, type TorusRaycastParams } from "./cpu-raycast";
import {
  createCpuTerrainCache,
  type TerrainQueryConfig,
} from "./cpu-terrain-cache";

describe("torus CPU sampling", () => {
  const innerTileSegments = 2;
  const majorRadius = 1000;
  const minorRadius = 300;
  const baseU = Math.max(1, Math.round(majorRadius / minorRadius));
  const baseV = 1;
  const elevationScale = 2;
  const height = 10;
  const outerSurface = majorRadius + minorRadius + height * elevationScale;

  const config: TerrainQueryConfig = {
    rootSize: 256,
    originX: 0,
    originY: 0,
    originZ: 0,
    innerTileSegments,
    elevationScale,
    maxLevel: 4,
    radius: majorRadius + minorRadius,
    baseU,
    baseV,
  };

  const projection = createTorusProjection({
    majorRadius,
    minorRadius,
    center: { x: 0, y: 0, z: 0 },
    baseU,
    baseV,
  });

  /** Build a cache + surface query with one flat-height root leaf. */
  async function seededCache() {
    const maxNodes = 4;
    const cache = createCpuTerrainCache(
      maxNodes,
      config,
      projection.cpu.createSurfaceOps(),
    );
    const { surfaceQuery } = projection.cpu.createRuntimeQueries(cache);
    if (!surfaceQuery) throw new Error("expected a surface query");

    const index = createSpatialIndex(maxNodes);
    insertSpatialIndexRaw(index, 0, 0, 0, 0, 0);

    const edge = innerTileSegments + 3;
    const verticesPerNode = edge * edge;
    const elevation = new Float32Array(maxNodes * verticesPerNode);
    for (let i = 0; i < verticesPerNode; i += 1) elevation[i] = height;

    const renderer = {
      getArrayBufferAsync: async () => elevation.buffer,
    } as unknown as Parameters<typeof cache.triggerReadback>[0];

    cache.triggerReadback(
      renderer,
      {} as unknown as StorageBufferAttribute,
      index,
      undefined,
      1,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { cache, surfaceQuery };
  }

  it("samples displaced elevation and position for a world point", async () => {
    const { surfaceQuery } = await seededCache();
    // A point above the outer equator at +Z (u = 0, v = 0).
    const sample = surfaceQuery.sampleTerrainByPosition(
      new Vector3(0, 0, 2000),
    );
    expect(sample.valid).toBe(true);
    expect(sample.elevation).toBeCloseTo(height * elevationScale, 4);
    expect(sample.position.z).toBeCloseTo(outerSurface, 3);
    // Flat (constant) height -> normal points radially outward (+Z here).
    expect(sample.normal.z).toBeGreaterThan(0.99);
  });

  it("returns elevation by position", async () => {
    const { surfaceQuery } = await seededCache();
    expect(
      surfaceQuery.getElevationByPosition(new Vector3(0, 0, 2000)),
    ).toBeCloseTo(height * elevationScale, 4);
  });

  it("exposes a surface sampler for the torus", async () => {
    const { cache } = await seededCache();
    expect(cache.hasSurface).toBe(true);
  });

  it("raycasts onto the displaced torus surface", async () => {
    const { surfaceQuery } = await seededCache();
    const params: TorusRaycastParams = {
      centerX: 0,
      centerY: 0,
      centerZ: 0,
      majorRadius,
      minorRadius,
      outerRadius: outerSurface + 5,
    };

    // Ray from far out on +Z aimed at the torus center.
    const ray = new Ray(
      new Vector3(0, 0, outerSurface * 2),
      new Vector3(0, 0, -1),
    );
    const hit = torusRaycast(surfaceQuery, ray, params);

    expect(hit).not.toBeNull();
    expect(hit?.position.z).toBeCloseTo(outerSurface, 0);
    expect(hit?.normal.z).toBeGreaterThan(0.9);
  });
});
