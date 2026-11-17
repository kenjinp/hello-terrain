// ctx.teardownPrevious() takes the values of every dependent away. These tests cover how the
// run that is in progress brings them back.
import { describe, expect, it } from "vitest";
import { graph, param, task } from "../index";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Port = { key: number; open: boolean };

function setup(options?: { delayMs?: number }) {
  const log: string[] = [];
  const k = param(0);
  const port = task(async (get, work, ctx) => {
    const key = get(k);
    if (options?.delayMs) await sleep(options.delayMs);
    await ctx.teardownPrevious();
    return work((): Port => ({ key, open: true }));
  }).teardown((v, info) => {
    v.open = false;
    log.push(`close port ${v.key} ${info.reason}`);
  });
  return { log, k, port };
}

describe("teardown: teardownPrevious re-schedules dependents", () => {
  it("recomputes dependents the run had skipped as clean (cache: 'once')", async () => {
    const { log, k, port } = setup();
    const server = task((get, work) => {
      const bound = get(port);
      return work(() => ({ bound }));
    })
      .cache("once")
      .teardown((v, info) => void log.push(`stop server ${v.bound.key} ${info.reason}`));
    const client = task((get) => ({ server: get(server) }));
    const g = graph().add(port).add(server).add(client);
    await g.run();

    g.set(k, 1);
    const report = await g.run();
    await g.settled();

    expect(report).toMatchObject({ status: "ok", taskCount: 3 });
    expect(log).toEqual(["stop server 0 released", "close port 0 released"]);
    expect(g.get(client).server.bound).toEqual({ key: 1, open: true });
  });

  it("recomputes a dependent that had already finished in the same run", async () => {
    const { log, k, port } = setup({ delayMs: 5 });
    const q = param(0);
    // Reads the port, but is clean with regard to it when the run starts: a "once" task sits
    // in between. It runs because of `q` and finishes before the port releases.
    const pinned = task((get) => get(port)).cache("once");
    const early = task((get, work) => {
      const bound = get(pinned);
      const n = get(q);
      return work(() => ({ bound, n }));
    }).teardown((v, info) => void log.push(`drop early ${v.bound.key}/${v.n} ${info.reason}`));
    const g = graph().add(port).add(pinned).add(early);
    await g.run();

    g.set(k, 1);
    g.set(q, 1);
    const report = await g.run();
    await g.settled();

    expect(report.status).toBe("ok");
    expect(g.get(early)).toEqual({ bound: { key: 1, open: true }, n: 1 });
    // Both values of `early` were built on port 0, the one the run had just replaced too, so
    // both go before the port does.
    expect(log).toEqual([
      "drop early 0/1 released",
      "drop early 0/0 replaced",
      "close port 0 released",
    ]);
  });

  it("leaves dependents outside the run's targets without a value until they run again", async () => {
    const { k, port } = setup();
    const server = task((get, work) => {
      const bound = get(port);
      return work(() => ({ bound }));
    }).teardown(() => {});
    const g = graph().add(port).add(server);
    await g.run();

    g.set(k, 1);
    await g.run({ targets: [port] });
    expect(g.peek(server)).toBeUndefined();

    await g.run();
    expect(g.get(server).bound).toEqual({ key: 1, open: true });
    await g.dispose();
  });

  it("brings dependents back in a discovery run", async () => {
    const { log, k, port } = setup({ delayMs: 5 });
    const server = task((get, work) => {
      const bound = get(port);
      return work(() => ({ bound }));
    })
      .cache("once")
      .teardown((v, info) => void log.push(`stop server ${v.bound.key} ${info.reason}`));
    const g = graph().add(port).add(server);
    await g.run();

    // A task the graph has not seen yet makes the next run discover dependencies as it goes.
    const client = task((get, work) => {
      const s = get(server);
      return work(() => ({ server: s }));
    }).teardown((v, info) => void log.push(`drop client ${v.server.bound.key} ${info.reason}`));
    g.add(client);
    g.set(k, 1);
    const report = await g.run();
    await g.settled();

    expect(report.status).toBe("ok");
    expect(g.get(client).server.bound).toEqual({ key: 1, open: true });
    expect(log).toEqual([
      "drop client 0 released",
      "stop server 0 released",
      "close port 0 released",
    ]);
  });

  it("throws away a result that an overlapping run built on the released value", async () => {
    const { log, k, port } = setup();
    const q = param(0);
    let executions = 0;
    const reader = task(async (get, work) => {
      get(q);
      const bound = get(port);
      executions += 1;
      await sleep(10);
      return work(() => ({ bound }));
    }).teardown((v, info) => void log.push(`drop reader ${v.bound.key} ${info.reason}`));
    const g = graph().add(port).add(reader);
    await g.run();
    expect(executions).toBe(1);

    g.set(q, 1);
    const slow = g.run({ targets: [reader] }); // reads port 0 and is still computing...
    await sleep(1);
    g.set(k, 1);
    await g.run({ targets: [port] }); // ...when the port is released and reopened
    const report = await slow;
    await g.settled();

    expect(report.status).toBe("ok");
    expect(executions).toBe(3);
    expect(g.get(reader).bound).toEqual({ key: 1, open: true });
    expect(log).toEqual([
      "drop reader 0 released", // the value from the first run
      "close port 0 released",
      "drop reader 0 released", // the result that was built on port 0 meanwhile
    ]);
  });
});
