import { Vector3 } from "three";
import type { StorageBufferAttribute } from "three/webgpu";
import { describe, expect, it } from "vitest";
import {
  directionToFace,
  directionToFaceUV,
  directionToLatLong,
  faceUVToCube,
  latLongToDirection,
  type Vec3Mutable,
} from "../quadtree";
import { createSpatialIndex, insertSpatialIndexRaw } from "../quadtree/spatialIndex";
import { createCpuTerrainCache, type TerrainQueryConfig } from "./cpu-terrain-cache";

describe("cube-sphere inverse math", () => {
  it("selects the dominant-axis face for each cardinal direction", () => {
    expect(directionToFace([1, 0, 0])).toBe(0);
    expect(directionToFace([-1, 0, 0])).toBe(1);
    expect(directionToFace([0, 1, 0])).toBe(2);
    expect(directionToFace([0, -1, 0])).toBe(3);
    expect(directionToFace([0, 0, 1])).toBe(4);
    expect(directionToFace([0, 0, -1])).toBe(5);
  });

  it("round-trips direction -> (face, u, v) -> direction", () => {
    const samples: Vec3Mutable[] = [
      [0.3, 0.2, 0.9],
      [-0.7, 0.1, 0.5],
      [0.2, 0.95, -0.1],
      [0.1, -0.8, 0.4],
      [-0.4, -0.3, -0.85],
    ];
    const uv: [number, number] = [0, 0];
    const cube: Vec3Mutable = [0, 0, 0];
    for (const s of samples) {
      const len = Math.hypot(s[0], s[1], s[2]);
      const dir: Vec3Mutable = [s[0] / len, s[1] / len, s[2] / len];
      const face = directionToFace(dir);
      directionToFaceUV(face, dir, uv);
      expect(uv[0]).toBeGreaterThanOrEqual(0);
      expect(uv[0]).toBeLessThanOrEqual(1);
      expect(uv[1]).toBeGreaterThanOrEqual(0);
      expect(uv[1]).toBeLessThanOrEqual(1);
      faceUVToCube(face, uv[0], uv[1], cube);
      const cl = Math.hypot(cube[0], cube[1], cube[2]);
      expect(cube[0] / cl).toBeCloseTo(dir[0], 5);
      expect(cube[1] / cl).toBeCloseTo(dir[1], 5);
      expect(cube[2] / cl).toBeCloseTo(dir[2], 5);
    }
  });

  it("round-trips lat/long <-> direction (degrees)", () => {
    const out: Vec3Mutable = [0, 0, 0];
    for (const [lat, lon] of [
      [0, 0],
      [45, 90],
      [-30, -120],
      [80, 10],
    ]) {
      latLongToDirection(lat, lon, out);
      expect(Math.hypot(out[0], out[1], out[2])).toBeCloseTo(1, 6);
      const recovered = directionToLatLong(out);
      expect(recovered.latitude).toBeCloseTo(lat, 4);
      expect(recovered.longitude).toBeCloseTo(lon, 4);
    }
  });

  it("lat=0, lon=0 points along +Z", () => {
    const out: Vec3Mutable = [0, 0, 0];
    latLongToDirection(0, 0, out);
    expect(out[0]).toBeCloseTo(0, 6);
    expect(out[1]).toBeCloseTo(0, 6);
    expect(out[2]).toBeCloseTo(1, 6);
  });
});

describe("cube-sphere CPU sampling", () => {
  const innerTileSegments = 2;
  const radius = 1000;
  const elevationScale = 2;
  const height = 10;

  const config: TerrainQueryConfig = {
    rootSize: 256,
    originX: 0,
    originY: 0,
    originZ: 0,
    innerTileSegments,
    elevationScale,
    maxLevel: 4,
    projection: "cubeSphere",
    radius,
  };

  /** Build a cache with one flat-height leaf on the +Z face (space 4). */
  async function seededCache() {
    const maxNodes = 4;
    const cache = createCpuTerrainCache(maxNodes, config);

    const index = createSpatialIndex(maxNodes);
    // +Z face root tile -> leaf index 0.
    insertSpatialIndexRaw(index, 4, 0, 0, 0, 0);

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
    // Allow the fire-and-forget readback promise chain to resolve.
    await new Promise((resolve) => setTimeout(resolve, 0));
    return cache;
  }

  it("samples radial elevation and position for a direction", async () => {
    const cache = await seededCache();
    const sample = cache.sampleTerrainByDirection(new Vector3(0, 0, 1));
    expect(sample.valid).toBe(true);
    expect(sample.elevation).toBeCloseTo(height * elevationScale, 4);
    expect(sample.position.length()).toBeCloseTo(radius + height * elevationScale, 3);
    // Flat (constant) height -> normal points radially outward (+Z here).
    expect(sample.normal.z).toBeGreaterThan(0.99);
  });

  it("resolves the same point via lat/long and position", async () => {
    const cache = await seededCache();
    const byLatLong = cache.sampleTerrainByLatLong(0, 0); // -> +Z
    expect(byLatLong.valid).toBe(true);
    expect(byLatLong.elevation).toBeCloseTo(height * elevationScale, 4);

    const onSurface = new Vector3(0, 0, radius + 500);
    const byPosition = cache.sampleTerrainByPosition(onSurface);
    expect(byPosition.valid).toBe(true);
    expect(byPosition.position.z).toBeCloseTo(radius + height * elevationScale, 3);
  });

  it("reports the face index as the tile space", async () => {
    const cache = await seededCache();
    const tile = cache.getTileByDirection(new Vector3(0, 0, 1));
    expect(tile).not.toBeNull();
    expect(tile?.space).toBe(4);
    expect(tile?.level).toBe(0);
  });

  it("returns null for flat queries on a cube-sphere surface", async () => {
    const cache = await seededCache();
    expect(cache.getElevation(0, 0)).toBeNull();
  });
});
