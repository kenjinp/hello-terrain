import { describe, expect, expectTypeOf, it } from "vitest";
import { graph, param, TASK_DEF } from "./index";
import { managed } from "./managed";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("managed()", () => {
  it("updates in place when it can and recreates when it cannot", async () => {
    const closed: number[] = [];
    const updates: unknown[] = [];
    let created = 0;
    const shape = param(1);
    const tuning = param(10);
    const cache = managed({
      inputs: (get) => ({ shape: get(shape), tuning: get(tuning) }),
      create: (inputs) => ({ id: (created += 1), ...inputs }),
      update: (current, next, prev) => {
        updates.push([prev.tuning, next.tuning]);
        if (next.shape !== prev.shape) return false;
        current.tuning = next.tuning;
        return true;
      },
      teardown: (value) => void closed.push(value.id),
    });
    const g = graph().add(cache);
    await g.run();

    g.set(tuning, 20);
    await g.run();
    g.set(tuning, 30);
    await g.run();
    await g.settled();
    expect(created).toBe(1);
    expect(g.get(cache).tuning).toBe(30);
    expect(closed).toEqual([]);
    // `prev` is what the value was last brought up to date with.
    expect(updates).toEqual([
      [10, 20],
      [20, 30],
    ]);

    g.set(shape, 2);
    await g.run();
    await g.settled();
    expect(created).toBe(2);
    expect(closed).toEqual([1]);

    await g.dispose();
    expect(closed).toEqual([1, 2]);
  });

  it("creates the new value before tearing the old one down, unless exclusive", async () => {
    for (const exclusive of [false, true]) {
      let live = 0;
      const liveAtCreate: number[] = [];
      const port = param(8080);
      const server = managed({
        inputs: (get) => get(port),
        create: (p) => {
          liveAtCreate.push(live);
          live += 1;
          return { port: p };
        },
        teardown: async () => {
          await sleep(2);
          live -= 1;
        },
        exclusive,
      });
      const g = graph().add(server);
      await g.run();
      g.set(port, 8081);
      await g.run();
      await g.settled();

      expect(liveAtCreate).toEqual(exclusive ? [0, 0] : [0, 1]);
      expect(g.get(server).port).toBe(8081);
      await g.dispose();
      expect(live).toBe(0);
    }
  });

  it("supports async create and update, and gives only create the scope", async () => {
    const log: string[] = [];
    const version = param(1);
    const major = param(1);
    const client = managed({
      inputs: (get) => ({ version: get(version), major: get(major) }),
      create: async (inputs, ctx) => {
        await sleep(1);
        ctx.scope.defer(() => void log.push(`scope ${inputs.major}`));
        return { ...inputs };
      },
      update: async (current, next, prev) => {
        await sleep(1);
        if (next.major !== prev.major) return false;
        current.version = next.version;
        return true;
      },
      teardown: (value) => void log.push(`teardown ${value.major}`),
    });
    const g = graph().add(client);
    await g.run();
    g.set(version, 2);
    await g.run();
    await g.settled();
    expect(g.get(client)).toEqual({ version: 2, major: 1 });
    expect(log).toEqual([]);

    g.set(major, 2);
    await g.run();
    await g.settled();
    expect(g.get(client)).toEqual({ version: 2, major: 2 });
    expect(log).toEqual(["teardown 1", "scope 1"]);
  });

  it("forwards task options and typed resources", async () => {
    const device = managed<{ name: string }, number, { prefix: string }, "gpu">(
      {
        inputs: () => 1,
        create: (n, ctx) => {
          expectTypeOf(ctx.resources).toEqualTypeOf<{ prefix: string } | undefined>();
          expectTypeOf(ctx.lane).toEqualTypeOf<"gpu">();
          return { name: `${ctx.resources?.prefix}-${n}-${ctx.lane}` };
        },
        teardown: () => {},
      },
      { lane: "gpu", cache: "once" },
    );
    expect(device[TASK_DEF].options).toMatchObject({ lane: "gpu", cache: "once" });

    const g = graph<{ prefix: string }, "gpu">().add(device);
    await g.run({ resources: { prefix: "dev" } });
    expect(g.get(device)).toEqual({ name: "dev-1-gpu" });
  });
});
