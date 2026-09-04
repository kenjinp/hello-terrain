import { bench, group, run, summary } from "mitata";
import {
  createFlatTopology,
  createInfiniteFlatTopology,
  createState,
  update,
  type UpdateParams,
} from "../src/quadtree";

const cfg = { maxNodes: 8192, maxLevel: 10 };
const rootSize = 1000;
const origin = { x: 0, y: 0, z: 0 };

const flat = createFlatTopology({ rootSize, origin });
const infinite = createInfiniteFlatTopology({ rootSize, origin, rootGridRadius: 1 });

const distance = (x: number, y: number, z: number): UpdateParams => ({
  cameraOrigin: { x, y, z },
  mode: "distance",
  distanceFactor: 2,
});

// 1080p, 60deg vertical FOV: screenHeight / (2 * tan(fov / 2)).
const projectionFactor = 1080 / (2 * Math.tan(Math.PI / 6));
const screen = (x: number, y: number, z: number): UpdateParams => ({
  cameraOrigin: { x, y, z },
  mode: "screen",
  projectionFactor,
  targetPixels: 64,
});

// Circular camera path for the movement benchmark.
const path = Array.from({ length: 100 }, (_, i) =>
  distance(Math.sin(i * 0.1) * 400, 10 + Math.cos(i * 0.05) * 50, Math.cos(i * 0.1) * 400),
);

summary(() => {
  group("update() — flat topology, distance mode", () => {
    const state = createState(cfg, flat);
    bench("camera at center (deep subdivision)", () => update(state, flat, distance(0, 10, 0)));
    bench("camera at edge", () => update(state, flat, distance(450, 10, 450)));
    bench("camera far away (shallow)", () => update(state, flat, distance(1000, 500, 1000)));
  });
});

summary(() => {
  group("update() — LOD criteria", () => {
    const distanceState = createState(cfg, flat);
    const screenState = createState(cfg, flat);
    bench("distance mode", () => update(distanceState, flat, distance(0, 10, 0)));
    bench("screen mode", () => update(screenState, flat, screen(0, 10, 0)));
  });
});

group("update() — infinite flat, 100-step camera path", () => {
  const state = createState(cfg, infinite);
  bench("100 sequential updates (circular path)", () => {
    for (const params of path) update(state, infinite, params);
  });
});

await run();
