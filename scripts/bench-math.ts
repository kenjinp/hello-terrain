import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { cpus } from "node:os";
const root = resolve(process.argv[2] ?? "../..");
const load = (path: string) => import(pathToFileURL(resolve(root, "packages/three/src", path)).href);
const { cubeSphereDatum } = await load("runtime/precision.ts");
const { createCubeSphereTopology } = await load("quadtree/topology/cubeSphere.ts");
const { createState } = await load("quadtree/state.ts");
const { update } = await load("quadtree/update.ts");
const { createTerrainRuntime } = await load("runtime/runtime.ts");
const runtime = createTerrainRuntime({
  resolve: (c: unknown) => c, equal: () => true,
  produce: async () => ({ render: 0, retire: async () => {}, snapshot: async () => ({
    sample: (point: number[], revision: unknown) => ({ status: "available", revision,
      elevation: -1, position: [point[0], -1, point[2]], normal: [0, 1, 0],
      sampleSpacing: 1, tile: { space: 0, level: 0, x: 0, y: 0 } }), dispose() {},
  }) }), dispose: async () => {},
}, {}, { readback: "on-change" });
await runtime.update({ position: [0, 10, 0] });
const rayOrigin = [0, 10, 0], rayDirection = [1, 0, 0];
const radius = 6371007.1809;
const topology = createCubeSphereTopology({ radius });
const out = [0, 0, 0], bounds = { cx: 0, cy: 0, cz: 0, r: 0 };
const tile = { space: 0, level: 10, x: 0, y: 0 };
const cameraOrigin = { x: radius + 1, y: 0, z: 0 };
const range = { min: -8500, max: 10000 };
const state = createState({ maxNodes: 1024, maxLevel: 14 }, topology);
let checksum = 0;
const cases = {
  raycast: { iterations: 2000, run() {
    const hit = runtime.query.raycast(rayOrigin, rayDirection, { far: 100, maxSteps: 256 });
    if (hit.status !== "incomplete" || hit.reason !== "work-budget") throw new Error("Expected work-budget result");
    checksum++;
  } },
  datum: { iterations: 200000, run(i: number) {
    cubeSphereDatum(out, i % 6, (i % 1024) / 1024, ((i * 17) % 1024) / 1024, radius);
    checksum += out[0];
  } },
  tileBounds: { iterations: 100000, run(i: number) {
    tile.space = i % 6; tile.x = i % 1024; tile.y = (i * 17) % 1024;
    topology.tileBounds(tile, cameraOrigin, bounds, range); checksum += bounds.r;
  } },
  selection: { iterations: 90, run(i: number) {
    const altitude = [1000000, 100000, 10000, 1000, 100, 30, 1, 10000, 1][i % 9];
    const length = Math.hypot(1.25, 0.35, 1.25);
    const leaves = update(state, topology, {
      cameraOrigin: { x: 1.25 / length * (radius + altitude), y: .35 / length * (radius + altitude), z: 1.25 / length * (radius + altitude) },
      distanceFactor: 4,
      tileElevationRange: (_: unknown, out: { min: number; max: number }) => { out.min = -8500; out.max = 10000; return true; },
    });
    checksum += leaves.count;
  } },
};
const results = {};
for (const [name, test] of Object.entries(cases)) {
  for (let i = 0; i < test.iterations; i++) test.run(i);
  const samples = [];
  for (let block = 0; block < 9; block++) {
    const start = performance.now();
    for (let i = 0; i < test.iterations; i++) test.run(i);
    samples.push((performance.now() - start) / test.iterations);
  }
  results[name] = { millisecondsPerOperation: samples };
}
await runtime.dispose();
console.log(JSON.stringify({ root, node: process.version, cpu: cpus()[0]?.model, results, checksum }));
