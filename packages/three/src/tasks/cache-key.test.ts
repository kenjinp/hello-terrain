import { describe, expect, it } from "vitest";
import { createCubeSphereTopology } from "../quadtree/topology/cubeSphere.js";
import {
  createTerrainQueryShapeKey,
  createTileSlotShapeKey,
} from "./cache-key.js";

describe("tasks/cache-key", () => {
  it("varies query and slot cache keys by topology geometry identity", () => {
    const small = createCubeSphereTopology({ radius: 1000 });
    const large = createCubeSphereTopology({ radius: 4000 });

    expect(small.projection.kind).toBe(large.projection.kind);
    expect(createTerrainQueryShapeKey(small, 4098, 61, 18)).not.toBe(
      createTerrainQueryShapeKey(large, 4098, 61, 18),
    );
    expect(createTileSlotShapeKey(small, 4098)).not.toBe(createTileSlotShapeKey(large, 4098));
  });

  it("varies query cache shape keys by max level", () => {
    const topology = createCubeSphereTopology({ radius: 1000 });

    expect(createTerrainQueryShapeKey(topology, 4098, 61, 12)).not.toBe(
      createTerrainQueryShapeKey(topology, 4098, 61, 18),
    );
  });

});
