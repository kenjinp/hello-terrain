import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const [baseline, candidate] = process.argv.slice(2);
if (!baseline || !candidate) throw new Error("Supply baseline and candidate checkout paths");
async function load(root: string) {
  const module = (path: string) => import(pathToFileURL(resolve(root, "packages/three/src", path)).href);
  return { ...await module("quadtree/topology/cubeSphere.ts"), ...await module("quadtree/state.ts"), ...await module("quadtree/update.ts") };
}
const a = await load(baseline), b = await load(candidate);
let boundsChecked = 0, neighborsChecked = 0, layoutsChecked = 0, maxBoundsError = 0;
for (const radius of [1, 1000, 6371007.1809]) {
  const ta = a.createCubeSphereTopology({ radius }), tb = b.createCubeSphereTopology({ radius });
  const origin = { x: radius + 1, y: .5, z: -1 };
  for (let level = 0; level <= 14; level++) {
    const n = 2 ** level;
    for (let space = 0; space < 6; space++) for (const x of [0, Math.floor(n / 2), n - 1]) for (const y of [0, Math.floor(n / 2), n - 1]) {
      const tile = { space, level, x, y };
      for (const range of [undefined, { min: -radius * .001, max: radius * .002 }]) {
        const ba = { cx: 0, cy: 0, cz: 0, r: 0 }, bb = { ...ba };
        ta.tileBounds(tile, origin, ba, range); tb.tileBounds(tile, origin, bb, range);
        for (const key of Object.keys(ba)) {
          const error = Math.abs(ba[key] - bb[key]);
          maxBoundsError = Math.max(maxBoundsError, error);
          assert.equal(bb[key], ba[key], `bounds ${key}: ${error}`);
        }
        boundsChecked++;
      }
      for (let dir = 0; dir < 4; dir++) {
        const na = { ...tile }, nb = { ...tile };
        assert.equal(ta.neighborSameLevel(tile, dir, na), tb.neighborSameLevel(tile, dir, nb));
        assert.deepEqual(na, nb); neighborsChecked++;
      }
    }
  }
  const sa = a.createState({ maxNodes: 1024, maxLevel: 14 }, ta), sb = b.createState({ maxNodes: 1024, maxLevel: 14 }, tb);
  for (const altitude of [1000000, 100000, 10000, 1000, 100, 30, 1, 10000, 1]) {
    const length = Math.hypot(1.25, .35, 1.25);
    const config = {
      cameraOrigin: { x: 1.25 / length * (radius + altitude), y: .35 / length * (radius + altitude), z: 1.25 / length * (radius + altitude) },
      distanceFactor: 4,
      tileElevationRange: (_: unknown, out: { min: number; max: number }) => { out.min = -radius * .001; out.max = radius * .002; return true; },
    };
    const la = a.update(sa, ta, config), lb = b.update(sb, tb, config);
    assert.equal(la.count, lb.count);
    for (const key of ["space", "level", "x", "y"]) assert.deepEqual(la[key].slice(0, la.count), lb[key].slice(0, lb.count));
    layoutsChecked++;
  }
}
console.log(JSON.stringify({ boundsChecked, neighborsChecked, layoutsChecked, maxBoundsError }));
