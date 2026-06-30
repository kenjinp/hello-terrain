// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { terrainMeshInstances } = vi.hoisted(() => ({
  terrainMeshInstances: [] as Array<{
    geometry: { dispose: ReturnType<typeof vi.fn> };
    instanceMatrix: { needsUpdate: boolean };
    count: number;
    terrainRaycast: unknown;
    innerTileSegments: number;
    maxNodes: number;
  }>,
}));

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

    constructor() {
      terrainMeshInstances.push(this);
    }
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
    leafGpuBuffer: "leafGpuBuffer",
    quadtreeUpdate: "quadtreeUpdate",
    positionNode: "positionNode",
    terrainQuery: "terrainQuery",
    terrainRaycast: "terrainRaycast",
    updateUniforms: "updateUniforms",
    visibleLeafSet: "visibleLeafSet",
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

import { useFrame } from "@react-three/fiber";
import { terrainTasks } from "@hello-terrain/three";
import type { TerrainHandle } from "../src/index.js";
import { Terrain, TerrainProvider, useTerrainContext } from "../src/index.js";

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
    ...overrides,
  };
}

describe("@hello-terrain/react", () => {
  beforeEach(() => {
    terrainMeshInstances.length = 0;
    vi.mocked(useFrame).mockClear();
  });

  it("provides terrain context values", () => {
    const terrain = createTerrainHandle({
      positionNode: { id: 1 } as never,
    });

    function Consumer() {
      const value = useTerrainContext();
      return <div>{String(value.ready)}</div>;
    }

    render(
      <TerrainProvider value={terrain}>
        <Consumer />
      </TerrainProvider>,
    );

    expect(screen.getByText("true")).toBeTruthy();
  });

  it("throws when context is missing", () => {
    function Consumer() {
      useTerrainContext();
      return null;
    }

    expect(() => render(<Consumer />)).toThrow(
      "useTerrainContext must be used within a TerrainProvider",
    );
  });

  it("passes terrain nodes to render-prop children", () => {
    const terrain = createTerrainHandle({
      ready: true,
      positionNode: { id: 123 } as never,
    });

    render(
      <Terrain terrain={terrain}>
        {({ positionNode }) => (
          <div data-testid="node-value">{positionNode ? String(positionNode.id) : "missing"}</div>
        )}
      </Terrain>,
    );

    expect(screen.getByTestId("node-value").textContent).toBe("123");
  });

  it("syncs mesh instance count from the visible GPU draw count", () => {
    const peek = vi.fn((task) => {
      if (task === terrainTasks.leafGpuBuffer) return { count: 3 };
      if (task === terrainTasks.visibleLeafSet) return { leaves: { count: 17 } };
      return undefined;
    });
    const terrain = createTerrainHandle({
      graph: {
        ...createTerrainHandle().graph,
        peek,
      } as TerrainHandle["graph"],
      ready: true,
      positionNode: { id: 456 } as never,
    });

    render(
      <Terrain terrain={terrain} maxNodes={32}>
        {({ positionNode }) => <div data-testid="node-value">{String(positionNode?.id)}</div>}
      </Terrain>,
    );

    const frame = vi.mocked(useFrame).mock.calls.at(-1)?.[0];
    expect(frame).toBeTypeOf("function");
    frame?.({} as never);

    const mesh = terrainMeshInstances.at(-1);
    expect(mesh?.count).toBe(3);
    expect(mesh?.instanceMatrix.needsUpdate).toBe(true);
    expect(peek).toHaveBeenCalledWith(terrainTasks.leafGpuBuffer);
    expect(peek).not.toHaveBeenCalledWith(terrainTasks.visibleLeafSet);
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
