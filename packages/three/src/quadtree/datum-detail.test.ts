import { lookupSpatialIndexRaw } from "./spatialIndex";
import { describe, expect, it } from "vitest";
import { createState } from "./state";
import { update } from "./update";
import { createCubeSphereTopology } from "./topology/cubeSphere";
import { createTorusTopology } from "./topology/torus";
import { createInfiniteFlatTopology } from "./topology/infiniteFlat";
import { type LeafSet, type Topology, type Dir } from "./types";

// Do not use the fixed-width seam table as the oracle: it can omit a neighbor
// when the input is already too unbalanced to represent.
function assertBalanced(topology: Topology, leaves: LeafSet) {
  const keys = new Set<string>();
  for (let i = 0; i < leaves.count; i++)
    keys.add([leaves.space[i], leaves.level[i], leaves.x[i], leaves.y[i]].join("/"));
  const neighbor = { space: 0, level: 0, x: 0, y: 0 };
  for (let i = 0; i < leaves.count; i++) {
    const tile = { space: leaves.space[i], level: leaves.level[i], x: leaves.x[i], y: leaves.y[i] };
    for (let dir = 0; dir < 4; dir++) {
      if (!topology.neighborSameLevel(tile, dir as Dir, neighbor)) continue;
      for (let level = tile.level - 1; level >= 0; level--) {
        const scale = 2 ** (tile.level - level);
        if (
          keys.has(
            [
              neighbor.space,
              level,
              Math.floor(neighbor.x / scale),
              Math.floor(neighbor.y / scale),
            ].join("/"),
          )
        ) {
          expect(tile.level - level).toBeLessThanOrEqual(1);
          break;
        }
      }
    }
  }
}

function localLevel(
  topology: Topology,
  leaves: LeafSet,
  position: { x: number; y: number; z: number },
) {
  const key = { space: 0, u: 0, v: 0, dirX: 0, dirY: 0, dirZ: 0 };
  expect(
    topology.projection.cpu
      .createSurfaceOps()!
      .positionToKey(position.x, position.y, position.z, key),
  ).toBe(true);
  const base = topology.projection.baseResolution ?? { u: 1, v: 1 };
  for (let i = 0; i < leaves.count; i++) {
    const scale = 2 ** leaves.level[i];
    if (
      leaves.space[i] === key.space &&
      leaves.x[i] === Math.floor(key.u * base.u * scale) &&
      leaves.y[i] === Math.floor(key.v * base.v * scale)
    )
      return leaves.level[i];
  }
  throw new Error("Camera tile missing");
}

describe("capacity-limited datum detail", () => {
  const radius = 6371007.1809;
  const minor = radius / Math.sqrt(3 * Math.PI);
  const major = 3 * minor;
  const length = Math.hypot(1.25, 0.35, 1.25);
  for (const shape of ["sphere", "torus"] as const) {
    it(
      shape +
        " keeps local ground detail and complete 2:1 neighbors at the existing 1024-node budget",
      () => {
        const topology =
          shape === "sphere"
            ? createCubeSphereTopology({ radius })
            : createTorusTopology({ majorRadius: major, minorRadius: minor });
        const state = createState({ maxNodes: 1024, maxLevel: 14 }, topology);
        for (const altitude of [1000000, 100000, 10000, 1000, 100, 30, 1, 10000, 1]) {
          const cameraOrigin =
            shape === "sphere"
              ? {
                  x: (1.25 / length) * (radius + altitude),
                  y: (0.35 / length) * (radius + altitude),
                  z: (1.25 / length) * (radius + altitude),
                }
              : { x: major + minor + altitude, y: 0, z: 0 };
          const leaves = update(state, topology, {
            cameraOrigin,
            distanceFactor: 4,
            tileElevationRange: (_tile, out) => {
              out.min = -8500;
              out.max = 10000;
              return true;
            },
          });
          expect(state.store.nodesUsed).toBeLessThanOrEqual(1024);
          assertBalanced(topology, leaves);
          for (let i = 0; i < leaves.count; i++) {
            expect(
              lookupSpatialIndexRaw(
                state.leafIndex,
                leaves.space[i],
                leaves.level[i],
                leaves.x[i],
                leaves.y[i],
              ),
            ).toBe(i);
          }
          const level = localLevel(topology, leaves, cameraOrigin);
          if (altitude <= 1000) expect(level).toBe(14);
        }
      },
    );
  }
  it("keeps negative infinite roots balanced under tiny and saturated budgets", () => {
    const topology = createInfiniteFlatTopology({ rootSize: 1000, origin: { x: 0, y: 0, z: 0 } });
    for (const capacity of [9, 13, 25, 64, 128]) {
      const state = createState({ maxNodes: capacity, maxLevel: 14 }, topology);
      for (const x of [-1500, -500, -499, 0, 499]) {
        const leaves = update(state, topology, {
          cameraOrigin: { x, y: 1, z: -550 },
          distanceFactor: 4,
        });
        assertBalanced(topology, leaves);
        expect(state.store.nodesUsed).toBeLessThanOrEqual(capacity);
      }
    }
  });
  it("balances deterministic saturated screen-space views across sphere faces and torus wraps", () => {
    for (const topology of [
      createCubeSphereTopology({ radius }),
      createTorusTopology({ majorRadius: major, minorRadius: minor }),
    ]) {
      for (const maxNodes of [topology.maxRootCount, 32, 128, 1024]) {
        const state = createState({ maxNodes, maxLevel: 14 }, topology);
        for (const cameraOrigin of [
          { x: radius, y: radius, z: radius },
          { x: -radius, y: 1, z: 0 },
          { x: 0, y: 1, z: -radius },
        ]) {
          const params = {
            cameraOrigin,
            mode: "screen" as const,
            projectionFactor: 600,
            targetPixels: 16,
          };
          const leaves = update(state, topology, params);
          assertBalanced(topology, leaves);
          const snapshot = Array.from({ length: leaves.count }, (_, i) => [
            leaves.space[i],
            leaves.level[i],
            leaves.x[i],
            leaves.y[i],
          ]);
          const area = new Float64Array(topology.spaceCount);
          for (let i = 0; i < leaves.count; i++) area[leaves.space[i]] += 4 ** -leaves.level[i];
          expect(Array.from(area).reduce((a, b) => a + b, 0)).toBeCloseTo(
            topology.maxRootCount,
            10,
          );
          update(state, topology, params);
          expect(
            Array.from({ length: leaves.count }, (_, i) => [
              leaves.space[i],
              leaves.level[i],
              leaves.x[i],
              leaves.y[i],
            ]),
          ).toEqual(snapshot);
        }
      }
    }
  });
  it("supports meter-scale samples at 30m actual terrain clearance with a level-18 scene cap", () => {
    for (const topology of [
      createCubeSphereTopology({ radius }),
      createTorusTopology({ majorRadius: major, minorRadius: minor }),
    ]) {
      const state = createState({ maxNodes: 1024, maxLevel: 18 }, topology);
      const cameraOrigin =
        topology.projection.kind === "cubeSphere"
          ? {
              x: (1.25 / length) * (radius + 930),
              y: (0.35 / length) * (radius + 930),
              z: (1.25 / length) * (radius + 930),
            }
          : { x: major + minor + 930, y: 0, z: 0 };
      const leaves = update(state, topology, {
        cameraOrigin,
        distanceFactor: 4,
        tileElevationRange: (_tile, out) => {
          out.min = 900;
          out.max = 900;
          return true;
        },
      });
      assertBalanced(topology, leaves);
      expect(localLevel(topology, leaves, cameraOrigin)).toBe(18);
      expect(state.store.nodesUsed).toBeLessThanOrEqual(1024);
    }
  });
});
