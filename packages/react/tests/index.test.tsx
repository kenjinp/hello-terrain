// @vitest-environment jsdom

import { render, renderHook, screen } from "@testing-library/react";
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
    radius: "radius",
    rootSize: "rootSize",
    skirtScale: "skirtScale",
    topology: "topology",
    terrainFieldFilter: "terrainFieldFilter",
    terrainReadbackEnabled: { id: "terrainReadbackEnabled" },
    terrainReadbackIntervalMs: { id: "terrainReadbackIntervalMs" },
  };
});

import type { TerrainHandle, TerrainOptions } from "../src/index.js";
import { Terrain, TerrainProvider, useTerrainContext } from "../src/index.js";
import { useTerrainParams } from "../src/useTerrainParams.js";

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

describe("useTerrainParams readback options", () => {
  function createGraph() {
    return {
      set: vi.fn(),
      reset: vi.fn(),
    } as unknown as TerrainHandle["graph"];
  }

  function calledParamIds(fn: ReturnType<typeof vi.fn>) {
    return fn.mock.calls.map(([ref]) => (ref as { id: string }).id);
  }

  it("maps terrainReadback / terrainReadbackIntervalMs onto the core params", () => {
    const graph = createGraph();
    renderHook(() =>
      useTerrainParams(graph, { terrainReadback: false, terrainReadbackIntervalMs: 250 }),
    );

    const set = graph.set as unknown as ReturnType<typeof vi.fn>;
    const enabledCall = set.mock.calls.find(
      ([ref]) => (ref as { id: string }).id === "terrainReadbackEnabled",
    );
    const intervalCall = set.mock.calls.find(
      ([ref]) => (ref as { id: string }).id === "terrainReadbackIntervalMs",
    );
    expect(enabledCall).toBeDefined();
    expect(intervalCall).toBeDefined();
    expect((enabledCall![1] as () => boolean)()).toBe(false);
    expect((intervalCall![1] as () => number)()).toBe(250);
  });

  it("leaves the readback params untouched when the options are omitted", () => {
    const graph = createGraph();
    renderHook(() => useTerrainParams(graph, {}));

    const set = graph.set as unknown as ReturnType<typeof vi.fn>;
    const reset = graph.reset as unknown as ReturnType<typeof vi.fn>;
    expect(calledParamIds(set)).not.toContain("terrainReadbackEnabled");
    expect(calledParamIds(set)).not.toContain("terrainReadbackIntervalMs");
    expect(reset).not.toHaveBeenCalled();
  });

  it("resets owned readback params when the options go back to undefined", () => {
    const graph = createGraph();
    const initialProps: TerrainOptions = { terrainReadback: false, terrainReadbackIntervalMs: 100 };
    const { rerender } = renderHook((options: TerrainOptions) => useTerrainParams(graph, options), {
      initialProps,
    });

    rerender({});

    const reset = graph.reset as unknown as ReturnType<typeof vi.fn>;
    expect(calledParamIds(reset)).toEqual(
      expect.arrayContaining(["terrainReadbackEnabled", "terrainReadbackIntervalMs"]),
    );
  });
});
