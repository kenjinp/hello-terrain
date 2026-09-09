import { expect, it } from "vitest";
import type { WebGPURenderer } from "three/webgpu";
import { terrainGraph, terrainTasks } from "./graph";
import { maxNodes, quadtreeUpdate } from "./params";

it("runs camera selection without evaluating GPU or shader targets and reuses its leaf allocation", async () => {
  const graph = terrainGraph();
  const events: string[] = [];
  graph.on((event) => {
    if (event.type === "task:start") events.push(event.taskId);
  });
  const resources = { renderer: {} as WebGPURenderer };
  graph.set(maxNodes, 64);
  graph.set(quadtreeUpdate, { cameraOrigin: { x: 0, y: 1000, z: 1000 } });
  expect((await graph.run({ targets: [terrainTasks.quadtreeUpdate], resources })).status).toBe(
    "ok",
  );
  const first = graph.peek(terrainTasks.quadtreeUpdate)!;
  graph.set(quadtreeUpdate, { cameraOrigin: { x: 1, y: 1000, z: 1000 } });
  expect((await graph.run({ targets: [terrainTasks.quadtreeUpdate], resources })).status).toBe(
    "ok",
  );
  expect(graph.peek(terrainTasks.quadtreeUpdate)).toBe(first);
  for (const task of [
    terrainTasks.leafGpuBuffer,
    terrainTasks.compileCompute,
    terrainTasks.executeCompute,
    terrainTasks.positionNode,
  ]) {
    expect(events).not.toContain(task.id);
    expect(graph.peek(task)).toBeUndefined();
  }
  graph.dispose();
});
