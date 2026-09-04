import { graph } from "@hello-terrain/work";
import { Ray, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import {
  createCubeSphereTopology,
  createFlatTopology,
  createInfiniteFlatTopology,
  createTorusTopology,
  type Topology,
} from "../quadtree";
import type { TerrainRaycastConfig } from "../query/types";
import { origin, radius, rootSize, topology } from "./params";
import { topologyTask } from "./quadtree.task";
import { terrainQueryTask } from "./terrain-query.task";
import { terrainRaycastTask } from "./terrain-raycast.task";
import { createUniformsTask, updateUniformsTask } from "./uniforms/uniforms.task";
import { resolveTerrainWorldConfig } from "./world-config";

const FALLBACK = { rootSize: 256, origin: { x: 1, y: 2, z: 3 }, radius: 1000 };

describe("resolveTerrainWorldConfig", () => {
  it("flat topology owns rootSize and origin; radius falls back to the param", () => {
    const topo = createFlatTopology({ rootSize: 4096, origin: { x: 10, y: 20, z: 30 } });
    const world = resolveTerrainWorldConfig(topo, FALLBACK);
    expect(world.rootSize).toBe(4096);
    expect(world.origin).toEqual({ x: 10, y: 20, z: 30 });
    expect(world.radius).toBe(FALLBACK.radius);
  });

  it("infinite flat topology owns rootSize and origin", () => {
    const topo = createInfiniteFlatTopology({ rootSize: 512, origin: { x: -5, y: 0, z: 5 } });
    const world = resolveTerrainWorldConfig(topo, FALLBACK);
    expect(world.rootSize).toBe(512);
    expect(world.origin).toEqual({ x: -5, y: 0, z: 5 });
  });

  it("cube-sphere topology owns radius and origin (= center); rootSize falls back", () => {
    const center = { x: 100, y: -50, z: 7 };
    const topo = createCubeSphereTopology({ radius: 6371000, center });
    const world = resolveTerrainWorldConfig(topo, FALLBACK);
    expect(world.radius).toBe(6371000);
    expect(world.origin).toEqual(center);
    expect(world.rootSize).toBe(FALLBACK.rootSize);
  });

  it("cube-sphere topology without an explicit center resolves origin to (0,0,0), not the param", () => {
    const topo = createCubeSphereTopology({ radius: 10 });
    const world = resolveTerrainWorldConfig(topo, FALLBACK);
    expect(world.origin).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("torus topology owns radius (major + minor) and origin (= center)", () => {
    const center = { x: 1, y: 1, z: 1 };
    const topo = createTorusTopology({ majorRadius: 1000, minorRadius: 360, center });
    const world = resolveTerrainWorldConfig(topo, FALLBACK);
    expect(world.radius).toBe(1360);
    expect(world.origin).toEqual(center);
    expect(world.rootSize).toBe(FALLBACK.rootSize);
  });

  it("falls back to projection.center when a custom topology omits origin", () => {
    const base = createCubeSphereTopology({ radius: 42, center: { x: 9, y: 8, z: 7 } });
    const custom = { ...base, origin: undefined };
    const world = resolveTerrainWorldConfig(custom, FALLBACK);
    expect(world.origin).toEqual({ x: 9, y: 8, z: 7 });
  });

  it("falls back to params when a custom topology carries no world config", () => {
    const base = createFlatTopology({ rootSize: 1, origin: { x: 0, y: 0, z: 0 } });
    const custom = { ...base, rootSize: undefined, origin: undefined };
    const world = resolveTerrainWorldConfig(custom, FALLBACK);
    expect(world).toEqual(FALLBACK);
  });
});

describe("terrain graph world config (topology as the single source of truth)", () => {
  it("uniforms take radius/origin from a cube-sphere topology even when the radius param differs", async () => {
    const center = { x: 12, y: 34, z: 56 };
    const planet = createCubeSphereTopology({ radius: 6371000, center });

    const g = graph()
      .add(topologyTask)
      .add(createUniformsTask)
      .add(updateUniformsTask)
      .set(topology, () => planet)
      // Deliberately stale legacy values: they must not win.
      .set(radius, 1000)
      .set(origin, () => ({ x: -1, y: -1, z: -1 }));

    const report = await g.run({ targets: [updateUniformsTask] });
    expect(report.status).toBe("ok");

    const uniforms = g.get(updateUniformsTask);
    expect(uniforms.uRadius.value).toBe(6371000);
    expect(uniforms.uRootOrigin.value.x).toBe(center.x);
    expect(uniforms.uRootOrigin.value.y).toBe(center.y);
    expect(uniforms.uRootOrigin.value.z).toBe(center.z);
    // Curved projections don't own rootSize: falls back to the param default.
    expect(uniforms.uRootSize.value).toBe(rootSize.get());

    g.dispose();
  });

  it("uniforms take rootSize/origin from an infinite flat topology, not the params", async () => {
    const infinite = createInfiniteFlatTopology({ rootSize: 8192, origin: { x: 5, y: 6, z: 7 } });

    const g = graph()
      .add(topologyTask)
      .add(createUniformsTask)
      .add(updateUniformsTask)
      .set(topology, () => infinite)
      .set(rootSize, 256)
      .set(origin, () => ({ x: 0, y: 0, z: 0 }));

    await g.run({ targets: [updateUniformsTask] });

    const uniforms = g.get(updateUniformsTask);
    expect(uniforms.uRootSize.value).toBe(8192);
    expect(uniforms.uRootOrigin.value.x).toBe(5);
    expect(uniforms.uRootOrigin.value.y).toBe(6);
    expect(uniforms.uRootOrigin.value.z).toBe(7);

    g.dispose();
  });

  it("default flat topology still follows the rootSize/origin params", async () => {
    const g = graph()
      .add(topologyTask)
      .add(createUniformsTask)
      .add(updateUniformsTask)
      .set(rootSize, 2048)
      .set(origin, () => ({ x: 3, y: 2, z: 1 }));

    await g.run({ targets: [updateUniformsTask] });
    let uniforms = g.get(updateUniformsTask);
    expect(uniforms.uRootSize.value).toBe(2048);
    expect(uniforms.uRootOrigin.value.x).toBe(3);

    // Param updates keep flowing through the default topology.
    g.set(rootSize, 512);
    await g.run({ targets: [updateUniformsTask] });
    uniforms = g.get(updateUniformsTask);
    expect(uniforms.uRootSize.value).toBe(512);

    g.dispose();
  });

  it("two graphs with different origins do not alias uRootOrigin", async () => {
    const a = graph()
      .add(topologyTask)
      .add(createUniformsTask)
      .add(updateUniformsTask)
      .set(topology, () => createCubeSphereTopology({ radius: 1, center: { x: 1, y: 0, z: 0 } }));
    const b = graph()
      .add(topologyTask)
      .add(createUniformsTask)
      .add(updateUniformsTask)
      .set(topology, () => createCubeSphereTopology({ radius: 2, center: { x: 2, y: 0, z: 0 } }));

    await a.run({ targets: [updateUniformsTask] });
    await b.run({ targets: [updateUniformsTask] });

    expect(a.get(updateUniformsTask).uRootOrigin.value.x).toBe(1);
    expect(b.get(updateUniformsTask).uRootOrigin.value.x).toBe(2);
    expect(a.get(updateUniformsTask).uRadius.value).toBe(1);
    expect(b.get(updateUniformsTask).uRadius.value).toBe(2);

    a.dispose();
    b.dispose();
  });

  it("CPU raycast config reads rootSize/origin from the topology, not the params", async () => {
    const base = createInfiniteFlatTopology({ rootSize: 4096, origin: { x: 10, y: 20, z: 30 } });
    // Custom topology whose projection captures the raycast config it is handed.
    let seen: TerrainRaycastConfig | null = null;
    const custom: Topology = {
      ...base,
      projection: {
        ...base.projection,
        cpu: {
          ...base.projection.cpu,
          raycast(ctx) {
            seen = ctx.config;
            return null;
          },
        },
      },
    };

    const g = graph()
      .add(topologyTask)
      .add(terrainQueryTask)
      .add(terrainRaycastTask)
      .set(topology, () => custom)
      // Deliberately stale legacy values: they must not win.
      .set(rootSize, 256)
      .set(origin, () => ({ x: -1, y: -1, z: -1 }));

    const report = await g.run({ targets: [terrainRaycastTask] });
    expect(report.status).toBe("ok");

    g.get(terrainRaycastTask).pick(new Ray(new Vector3(0, 100, 0), new Vector3(0, -1, 0)));
    expect(seen).not.toBeNull();
    const config = seen as unknown as TerrainRaycastConfig;
    expect(config.rootSize).toBe(4096);
    expect(config.originX).toBe(10);
    expect(config.originY).toBe(20);
    expect(config.originZ).toBe(30);
    // Flat surfaces have no projection center: it collapses onto the origin.
    expect(config.centerX).toBe(10);
    expect(config.centerZ).toBe(30);

    g.dispose();
  });
});
