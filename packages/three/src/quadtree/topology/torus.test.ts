import { describe, expect, it } from "vitest";
import { Dir, type TileId } from "../types.js";
import { createState } from "../state.js";
import { update } from "../update.js";
import { createTorusTopology } from "./torus.js";
import {
  type TorusSurfaceParams,
  type Vec3Mutable,
  positionToTorusParams,
  torusOutwardNormal,
  torusUVToPoint,
  wrap01,
} from "./torusInverse.js";

describe("torus inverse math", () => {
  const majorRadius = 1000;
  const minorRadius = 300;
  const center = { x: 5, y: -7, z: 11 };

  it("round-trips (u, v) -> point -> (u, v)", () => {
    const point: Vec3Mutable = [0, 0, 0];
    const params: TorusSurfaceParams = { u: 0, v: 0, tubeDistance: 0 };
    const samples: Array<[number, number]> = [
      [0.0, 0.0],
      [0.13, 0.42],
      [0.5, 0.5],
      [0.77, 0.25],
      [0.99, 0.9],
    ];
    for (const [u, v] of samples) {
      torusUVToPoint(u, v, majorRadius, minorRadius, 0, center, point);
      positionToTorusParams(point[0], point[1], point[2], majorRadius, center, params);
      expect(params.u).toBeCloseTo(u, 5);
      expect(params.v).toBeCloseTo(v, 5);
      // The point lies exactly on the base tube.
      expect(params.tubeDistance).toBeCloseTo(minorRadius, 4);
    }
  });

  it("recovers radial displacement as tubeDistance - minorRadius", () => {
    const point: Vec3Mutable = [0, 0, 0];
    const params: TorusSurfaceParams = { u: 0, v: 0, tubeDistance: 0 };
    const displacement = 42;
    torusUVToPoint(0.3, 0.6, majorRadius, minorRadius, displacement, center, point);
    positionToTorusParams(point[0], point[1], point[2], majorRadius, center, params);
    expect(params.tubeDistance - minorRadius).toBeCloseTo(displacement, 4);
  });

  it("produces unit outward normals aligned with finite differences", () => {
    const normal: Vec3Mutable = [0, 0, 0];
    const a: Vec3Mutable = [0, 0, 0];
    const b: Vec3Mutable = [0, 0, 0];
    const u = 0.2;
    const v = 0.35;
    torusOutwardNormal(u, v, normal);
    expect(Math.hypot(normal[0], normal[1], normal[2])).toBeCloseTo(1, 6);

    // A small outward step should increase the tube distance.
    const zero = { x: 0, y: 0, z: 0 };
    torusUVToPoint(u, v, majorRadius, minorRadius, 0, zero, a);
    b[0] = a[0] + normal[0];
    b[1] = a[1] + normal[1];
    b[2] = a[2] + normal[2];
    const params: TorusSurfaceParams = { u: 0, v: 0, tubeDistance: 0 };
    positionToTorusParams(b[0], b[1], b[2], majorRadius, zero, params);
    expect(params.tubeDistance).toBeGreaterThan(minorRadius);
  });

  it("wraps fractional values into [0, 1)", () => {
    expect(wrap01(1.25)).toBeCloseTo(0.25, 6);
    expect(wrap01(-0.25)).toBeCloseTo(0.75, 6);
    expect(wrap01(2.0)).toBeCloseTo(0, 6);
  });
});

describe("quadtree/topology/torus", () => {
  const cfg = { majorRadius: 1000, minorRadius: 300 };
  const baseU = Math.max(1, Math.round(cfg.majorRadius / cfg.minorRadius));
  const baseV = 1;

  it("emits a baseU x baseV grid of level-0 root tiles", () => {
    const topology = createTorusTopology(cfg);
    const out: TileId[] = Array.from({ length: baseU * baseV }, () => ({
      space: -1,
      level: -1,
      x: -1,
      y: -1,
    }));
    const count = topology.rootTiles({ x: 0, y: 0, z: 0 }, out);
    expect(count).toBe(baseU * baseV);
    expect(topology.maxRootCount).toBe(baseU * baseV);
    for (let y = 0; y < baseV; y++) {
      for (let x = 0; x < baseU; x++) {
        expect(out[y * baseU + x]).toEqual({ space: 0, level: 0, x, y });
      }
    }
  });

  it("exposes the torus projection with anisotropic base resolution", () => {
    const topology = createTorusTopology(cfg);
    expect(topology.projection.kind).toBe("torus");
    expect(topology.projection.faceOutward).toBe(true);
    expect(topology.projection.baseResolution).toEqual({ u: baseU, v: baseV });
    expect(topology.radius).toBe(cfg.majorRadius + cfg.minorRadius);
    expect(topology.spaceCount).toBe(1);
  });

  it("wraps neighbors around both periodic axes", () => {
    const topology = createTorusTopology(cfg);
    const out: TileId = { space: 0, level: 0, x: 0, y: 0 };

    // Level 1: nU = baseU*2, nV = baseV*2 — stepping LEFT from x=0 wraps to nU-1.
    const nU1 = baseU * 2;
    const nV1 = baseV * 2;
    expect(topology.neighborSameLevel({ space: 0, level: 1, x: 0, y: 0 }, Dir.LEFT, out)).toBe(true);
    expect(out).toEqual({ space: 0, level: 1, x: nU1 - 1, y: 0 });

    // Stepping TOP from y=0 wraps to nV-1.
    expect(topology.neighborSameLevel({ space: 0, level: 1, x: 0, y: 0 }, Dir.TOP, out)).toBe(true);
    expect(out).toEqual({ space: 0, level: 1, x: 0, y: nV1 - 1 });

    // In-grid step stays in grid.
    expect(topology.neighborSameLevel({ space: 0, level: 2, x: 1, y: 1 }, Dir.RIGHT, out)).toBe(true);
    expect(out).toEqual({ space: 0, level: 2, x: 2, y: 1 });
  });

  it("expands bounds when an elevation range is provided", () => {
    const topology = createTorusTopology(cfg);
    const camera = { x: 0, y: 0, z: 0 };
    const datum = { cx: 0, cy: 0, cz: 0, r: 0 };
    const displaced = { cx: 0, cy: 0, cz: 0, r: 0 };

    topology.tileBounds({ space: 0, level: 2, x: 1, y: 0 }, camera, datum);
    topology.tileBounds(
      { space: 0, level: 2, x: 1, y: 0 },
      camera,
      displaced,
      { min: 0, max: 80 },
    );

    expect(displaced.r).toBeGreaterThan(datum.r);
    const datumDist = Math.hypot(datum.cx, datum.cy, datum.cz);
    const displacedDist = Math.hypot(displaced.cx, displaced.cy, displaced.cz);
    expect(displacedDist).toBeGreaterThanOrEqual(datumDist);
  });

  it("runs a full LOD update without throwing and respects the node budget", () => {
    const topology = createTorusTopology(cfg);
    const state = createState({ maxNodes: 8192, maxLevel: 8 }, topology);

    const leaves = update(state, topology, {
      cameraOrigin: { x: cfg.majorRadius + cfg.minorRadius + 50, y: 0, z: 0 },
      mode: "distance",
      distanceFactor: 1.0,
    });

    expect(leaves.count).toBeGreaterThan(1);
    expect(leaves.count).toBeLessThanOrEqual(leaves.capacity);

    for (let i = 0; i < leaves.count; i++) {
      const level = leaves.level[i]!;
      const levelScale = 1 << level;
      const nU = baseU * levelScale;
      const nV = baseV * levelScale;
      expect(leaves.space[i]).toBe(0);
      expect(leaves.x[i]).toBeGreaterThanOrEqual(0);
      expect(leaves.x[i]).toBeLessThan(nU);
      expect(leaves.y[i]).toBeGreaterThanOrEqual(0);
      expect(leaves.y[i]).toBeLessThan(nV);
    }
  });
});
