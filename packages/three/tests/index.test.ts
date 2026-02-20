import { describe, expect, it } from "vitest";
import { TerrainGeometry, terrainTasks } from "../src/index.js";

describe("@hello-terrain/three public API", () => {
  it("exports TerrainGeometry", () => {
    expect(TerrainGeometry).toBeTypeOf("function");
  });

  it("can construct a TerrainGeometry instance", () => {
    const g = new TerrainGeometry(1);
    expect(g.getAttribute("position").count).toBeGreaterThan(0);
    expect(g.getIndex()).not.toBeNull();
  });

  it("exposes gpuBatchQuery task", () => {
    expect(terrainTasks.gpuBatchQuery).toBeDefined();
    expect(terrainTasks.gpuBatchQuery.kind).toBe("task");
  });
});
