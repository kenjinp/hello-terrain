import { createState } from "../src/quadtree/state";
import { update } from "../src/quadtree/update";
import { createFlatTopology } from "../src/quadtree/topology/flat";
import { createCubeSphereTopology } from "../src/quadtree/topology/cubeSphere";
import { createTorusTopology } from "../src/quadtree/topology/torus";
import { scenarioPartitionAssertions } from "./oracles";
import type { GymResult } from "./report";
import { cameraPose, type Scenario } from "./scenarios";

export function runCpu(scenario: Scenario): GymResult {
  if (scenario.id === "terrain-skirts" || scenario.id === "earth-precision" || scenario.id === "material-authoring") return {
    status: "unsupported", assertions: [], metrics: {}, samples: [],
    error: "This diagnostic requires production WebGPU compute/render; use --software on Linux",
  };
  const topology =
    scenario.shape === "cubeSphere"
      ? createCubeSphereTopology({ radius: scenario.radius })
      : scenario.shape === "torus"
        ? createTorusTopology({
            majorRadius: scenario.majorRadius,
            minorRadius: scenario.minorRadius,
          })
        : createFlatTopology({
            rootSize: scenario.rootSize,
            origin: { x: 0, y: 0, z: 0 },
          });
  const state = createState({ maxNodes: scenario.maxNodes, maxLevel: scenario.maxLevel }, topology);
  const assertions: GymResult["assertions"] = [];
  const samples: { step: number; leaves: number }[] = [];
  for (let step = 0; step < 16; step++) {
    const leaves = update(state, topology, {
      cameraOrigin: cameraPose(step / 15),
      mode: "distance",
      distanceFactor: 1.5,
    });
    const copy = Array.from({ length: leaves.count }, (_, i) => ({
      space: leaves.space[i],
      level: leaves.level[i],
      x: leaves.x[i],
      y: leaves.y[i],
    }));
    assertions.push(...scenarioPartitionAssertions(scenario, copy, `cpu-pose-${step}`));
    samples.push({ step, leaves: leaves.count });
  }
  return {
    status: assertions.every((a) => a.pass) ? "passed" : "failed",
    assertions,
    metrics: { maxLeaves: Math.max(...samples.map((s) => s.leaves)) },
    samples,
    capabilities: {
      coverage: `CPU ${scenario.shape} topology charts only; no shaders, rendering, queries or lifecycle exercised`,
    },
  };
}
