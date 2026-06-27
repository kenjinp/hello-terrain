import { describe, expect, it } from "vitest";
import { allocLeafSet } from "./types.js";
import { createCubeSphereTopology } from "./topology/cubeSphere.js";
import { createFlatTopology } from "./topology/flat.js";
import { createTorusTopology } from "./topology/torus.js";
import { computeTileVisibility } from "./visibility.js";

describe("quadtree/visibility", () => {
  it("culls cube-sphere root tiles behind the horizon", () => {
    const topology = createCubeSphereTopology({ radius: 1000 });
    const leaves = allocLeafSet(6);
    leaves.count = topology.rootTiles(
      { x: 0, y: 0, z: 0 },
      Array.from({ length: 6 }, (_, index) => ({
        space: index,
        level: 0,
        x: 0,
        y: 0,
      })),
    );
    for (let i = 0; i < leaves.count; i += 1) {
      leaves.space[i] = i;
      leaves.level[i] = 0;
      leaves.x[i] = 0;
      leaves.y[i] = 0;
    }

    const visibility = computeTileVisibility({
      leaves,
      topology,
      cameraOrigin: { x: 0, y: 0, z: 1200 },
      guardBandFactor: 1,
    });

    expect(visibility.telemetry.candidateCount).toBe(6);
    expect(visibility.telemetry.visibleCount).toBeGreaterThan(0);
    expect(visibility.telemetry.visibleCount).toBeLessThan(6);
    expect(visibility.telemetry.horizonCulledCount).toBeGreaterThan(0);
    expect(visibility.telemetry.visibleRatio).toBeLessThan(1);
  });

  it("culls tiles outside the supplied view-projection frustum", () => {
    const topology = createFlatTopology({
      rootSize: 1,
      origin: { x: 0, y: 0, z: 0 },
    });
    const leaves = allocLeafSet(2);
    leaves.count = 2;
    leaves.level[0] = 0;
    leaves.x[0] = 0;
    leaves.y[0] = 0;
    leaves.level[1] = 0;
    leaves.x[1] = 3;
    leaves.y[1] = 0;

    const visibility = computeTileVisibility({
      leaves,
      topology,
      cameraOrigin: { x: 0, y: 0, z: 0 },
      viewProjectionMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      guardBandFactor: 1,
    });

    expect(visibility.telemetry.candidateCount).toBe(2);
    expect(visibility.telemetry.visibleCount).toBe(1);
    expect(visibility.telemetry.frustumCulledCount).toBe(1);
    expect(visibility.visibleCandidateIndices[0]).toBe(0);
  });

  it("uses injected projection horizon occlusion without checking projection kind", () => {
    const topology = createFlatTopology({
      rootSize: 1,
      origin: { x: 0, y: 0, z: 0 },
    });
    topology.projection.cpu.isTileBehindHorizon = () => true;

    const leaves = allocLeafSet(1);
    leaves.count = 1;

    const visibility = computeTileVisibility({
      leaves,
      topology,
      cameraOrigin: { x: 0, y: 0, z: 0 },
      guardBandFactor: 1,
    });

    expect(visibility.telemetry.candidateCount).toBe(1);
    expect(visibility.telemetry.visibleCount).toBe(0);
    expect(visibility.telemetry.horizonCulledCount).toBe(1);
    expect(visibility.telemetry.unculledCount).toBe(0);
  });

  it("leaves torus unculled when projection does not provide horizon occlusion", () => {
    const topology = createTorusTopology({ majorRadius: 1000, minorRadius: 250 });
    const leaves = allocLeafSet(topology.maxRootCount);
    const roots = Array.from({ length: topology.maxRootCount }, () => ({
      space: 0,
      level: 0,
      x: 0,
      y: 0,
    }));
    leaves.count = topology.rootTiles({ x: 0, y: 0, z: 0 }, roots);
    for (let i = 0; i < leaves.count; i += 1) {
      const root = roots[i]!;
      leaves.space[i] = root.space;
      leaves.level[i] = root.level;
      leaves.x[i] = root.x;
      leaves.y[i] = root.y;
    }

    const visibility = computeTileVisibility({
      leaves,
      topology,
      cameraOrigin: { x: 0, y: 0, z: 1600 },
      guardBandFactor: 1,
    });

    expect(visibility.telemetry.horizonCulledCount).toBe(0);
    expect(visibility.telemetry.unculledCount).toBe(leaves.count);
    expect(visibility.telemetry.visibleCount).toBe(leaves.count);
  });
});
