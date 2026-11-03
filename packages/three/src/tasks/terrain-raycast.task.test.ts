import { TASK_DEF, type Getter, type NodeRef } from "@hello-terrain/work";
import { Ray, Vector3 } from "three";
import { expect, it } from "vitest";
import { createFlatProjection } from "../projection/flat";
import type { ElevationRange, TerrainQuery } from "../query/types";
import { elevationScale, origin, rootSize } from "./params";
import { topologyTask } from "./quadtree.task";
import { terrainQueryTask } from "./terrain-query.task";
import { terrainRaycastTask } from "./terrain-raycast.task";

it("picks newly completed negative-elevation snapshots without rebuilding the raycaster", async () => {
  let range: ElevationRange | null = null;
  let elevation = 0;
  const normal = new Vector3(0, 1, 0);
  const sample = () => ({ elevation, normal, valid: range !== null, hole: false,
    textureControl: null, textureBase: null, textureOverlay: null, textureBlend: null });
  const query: TerrainQuery = {
    getElevation: () => range ? elevation : null,
    getNormal: () => range ? normal : null,
    getTile: () => null,
    getTileBounds: () => null,
    getGlobalElevationRange: () => range,
    sampleTerrain: sample,
    sampleTerrainBatch: () => { throw new Error("Batch queries are not used by picking"); },
    generation: 0,
  };
  const inputs = new Map<string, unknown>([
    [terrainQueryTask.id, { query, surfaceQuery: null, sphereQuery: null }],
    [rootSize.id, 20], [origin.id, { x: 0, y: 0, z: 0 }], [elevationScale.id, 1],
    [topologyTask.id, { projection: createFlatProjection() }],
  ]);
  const get: Getter = <T>(ref: NodeRef<T>) => {
    if (!inputs.has(ref.id)) throw new Error("Unexpected dependency");
    return inputs.get(ref.id) as T;
  };
  const raycast = await terrainRaycastTask[TASK_DEF].compute(get, fn => fn(), {
    lane: "cpu", signal: new AbortController().signal, now: () => 0,
  });
  const ray = new Ray(new Vector3(0, 30, 0), new Vector3(0, -1, 0));
  expect(raycast.pick(ray)).toBeNull();
  elevation = -10; range = { min: -13, max: -7 };
  expect(raycast.pick(ray)?.position.y).toBeCloseTo(-10, 3);
  expect(raycast.pick(ray)?.distance).toBeCloseTo(40, 3);
  elevation = -30; range = { min: -32, max: -28 };
  expect(raycast.pick(ray)?.position.y).toBeCloseTo(-30, 3);
  expect(raycast.pick(ray)?.distance).toBeCloseTo(60, 3);
});
