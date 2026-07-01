import { graph } from "@hello-terrain/work";
import { describe, expect, it } from "vitest";
import { createInitialCameraView, readCameraView } from "./cameraView.js";
import { elevationScale, cameraView } from "./params.js";
import { terrainFieldContentEpochTask } from "./quadtree.task.js";

async function readFieldContentEpoch(g: ReturnType<typeof graph>) {
  await g.run({ targets: [terrainFieldContentEpochTask] });
  return g.get(terrainFieldContentEpochTask);
}

describe("tasks/quadtree", () => {
  it("advances field content epoch only for field-affecting dependency changes", async () => {
    const g = graph();
    g.add(terrainFieldContentEpochTask);

    const first = await readFieldContentEpoch(g);

    g.set(cameraView, {
      cameraOrigin: { x: 10, y: 20, z: 30 },
      viewProjectionMatrix: Array.from({ length: 16 }, (_, i) => i),
    });
    const afterCameraUpdate = await readFieldContentEpoch(g);
    expect(afterCameraUpdate).toBe(first);

    g.set(elevationScale, 2);
    const afterFieldUpdate = await readFieldContentEpoch(g);
    expect(afterFieldUpdate).toBe(first + 1);
  });

  it("exports readCameraView helper for consumer loops", () => {
    const out = createInitialCameraView();
    expect(out.cameraOrigin).toEqual({ x: 0, y: 0, z: 0 });
    expect(out.viewProjectionMatrix.length).toBe(16);
    expect(typeof readCameraView).toBe("function");
  });
});
