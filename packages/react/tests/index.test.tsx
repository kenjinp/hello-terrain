// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@react-three/fiber", () => ({
  useFrame: vi.fn(),
}));

vi.mock("@hello-terrain/three", () => {
  class TerrainMesh {
    geometry = {
      dispose: vi.fn(),
    };
    instanceMatrix = {
      needsUpdate: false,
    };
    count = 0;
    terrainRaycast = null;
    innerTileSegments = 13;
    maxNodes = 1024;
  }

  const graph = {
    add: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    reset: vi.fn().mockReturnThis(),
    dispose: vi.fn(),
    run: vi.fn().mockResolvedValue({}),
    peek: vi.fn(),
  };

  const terrainTasks = {
    quadtreeUpdate: "quadtreeUpdate",
    positionNode: "positionNode",
    terrainQuery: "terrainQuery",
    terrainRaycast: "terrainRaycast",
  };

  return {
    TerrainMesh,
    terrainGraph: vi.fn(() => graph),
    terrainTasks,
    quadtreeUpdate: "quadtreeUpdateParam",
    elevationFn: "elevationFn",
    elevationScale: "elevationScale",
    innerTileSegments: "innerTileSegments",
    maxLevel: "maxLevel",
    maxNodes: "maxNodes",
    origin: "origin",
    rootSize: "rootSize",
    skirtScale: "skirtScale",
    topology: "topology",
    terrainFieldFilter: "terrainFieldFilter",
  };
});

import type { TerrainHandle } from "../src/index.js";
import { Terrain, useTerrainContext } from "../src/index.js";

function createTerrainHandle(overrides: Partial<TerrainHandle> = {}): TerrainHandle {
  return {
    graph: {
      on: vi.fn(),
      run: vi.fn(),
      dispose: vi.fn(),
      inspect: vi.fn(),
      get: vi.fn(),
      peek: vi.fn(),
      add: vi.fn(),
      set: vi.fn(),
      reset: vi.fn(),
    } as unknown as TerrainHandle["graph"],
    tasks: {} as TerrainHandle["tasks"],
    runtime: {
      query: null,
      surfaceQuery: null,
      sphereQuery: null,
      raycast: null,
    },
    ready: true,
    positionNode: null,
    texture: null,
    ...overrides,
  };
}

describe("@hello-terrain/react", () => {
  it("throws when context is missing", () => {
    function Consumer() {
      useTerrainContext();
      return null;
    }

    expect(() => render(<Consumer />)).toThrow(
      "useTerrainContext must be used within a TerrainProvider",
    );
  });

  it("does not render terrain children before nodes are ready", () => {
    const terrain = createTerrainHandle({
      ready: false,
      positionNode: null,
    });

    const view = render(
      <Terrain terrain={terrain}>
        {({ positionNode }) => <div data-testid="node-value">{String(positionNode != null)}</div>}
      </Terrain>,
    );

    expect(view.container.querySelector("[data-testid='node-value']")).toBeNull();
  });
});
