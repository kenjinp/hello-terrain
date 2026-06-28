import { graph } from "@hello-terrain/work";
import { describe, expect, it } from "vitest";
import { elevationScale, quadtreeUpdate } from "./params.js";
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

    g.set(quadtreeUpdate, {
      cameraOrigin: { x: 10, y: 20, z: 30 },
      mode: "distance",
      distanceFactor: 1.5,
    });
    const afterCameraUpdate = await readFieldContentEpoch(g);
    expect(afterCameraUpdate).toBe(first);

    g.set(elevationScale, 2);
    const afterFieldUpdate = await readFieldContentEpoch(g);
    expect(afterFieldUpdate).toBe(first + 1);
  });
});
