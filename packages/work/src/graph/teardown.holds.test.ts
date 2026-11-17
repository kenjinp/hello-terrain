// What holds a retired value back: values built on it, overlapping runs and leases.
import { describe, expect, it } from "vitest";
import { graph, param, task, TeardownTimeoutError } from "../index";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Conn = { id: number; open: boolean };

function connections() {
  const all: Conn[] = [];
  return {
    all,
    open: (): Conn => {
      const c = { id: all.length + 1, open: true };
      all.push(c);
      return c;
    },
    close: (c: Conn) => void (c.open = false),
    live: () => all.filter((c) => c.open).length,
  };
}

describe("teardown: holds", () => {
  it("keeps a value alive through a plain value derived from it", async () => {
    const k = param(0);
    const log: string[] = [];
    const a = task((get, work) => {
      get(k);
      return work(() => ({ open: true }));
    }).teardown((v) => {
      v.open = false;
      log.push("a");
    });
    // No teardown of its own: it only passes `a` on.
    const handle = task((get) => get(a));
    const c = task((get, work) => {
      const h = get(handle);
      return work(() => ({ h }));
    }).teardown((v) => void log.push("c sees a open=" + v.h.open));
    const g = graph().add(a).add(handle).add(c);
    await g.run();
    g.set(k, 1);
    await g.run();
    await g.settled();
    expect(log).toEqual(["c sees a open=true", "a"]);
  });

  it("a stale dependent keeps what it was built on until it recomputes", async () => {
    const p = connections();
    const url = param(0);
    const conn = task((get, work) => {
      get(url);
      return work(() => p.open());
    }).teardown(p.close);
    const report = task((get) => ({ conn: get(conn) }));
    const g = graph().add(conn).add(report);
    await g.run();

    g.set(url, 1);
    await g.run({ targets: [conn] }); // report is not recomputed: it still points at conn 1
    await g.settled();
    expect(g.get(report).conn.open).toBe(true);
    expect(g.inspect({ includeRuntime: true }).meta?.teardown?.pending).toBe(1);

    await g.run();
    await g.settled();
    expect(p.all.map((c) => c.open)).toEqual([false, true]);
    expect(g.inspect({ includeRuntime: true }).meta?.teardown?.pending).toBe(0);
  });

  it("does not wait for the graph to go idle: only runs that started before the retirement pin it", async () => {
    const p = connections();
    const url = param(0);
    const ka = param(0);
    const kb = param(0);
    const conn = task((get, work) => {
      get(url);
      return work(() => p.open());
    }).teardown(p.close);
    const slowA = task(async (get) => {
      get(ka);
      await sleep(10);
      return 1;
    });
    const slowB = task(async (get) => {
      get(kb);
      await sleep(40);
      return 1;
    });
    const g = graph().add(conn).add(slowA).add(slowB);
    await g.run();

    g.set(ka, 1);
    const first = g.run({ targets: [slowA] });
    g.set(url, 1);
    await g.run({ targets: [conn] }); // retires conn 1 while `first` is active
    expect(p.live()).toBe(2);
    g.set(kb, 1);
    const second = g.run({ targets: [slowB] }); // started after the retirement: does not pin it

    await first;
    await sleep(1);
    expect(p.live()).toBe(1); // torn down although `second` is still running
    await second;
  });
});

describe("teardown: leases", () => {
  it("g.use() keeps a value alive while it is in use, across a recompute", async () => {
    const p = connections();
    const url = param(0);
    const conn = task((get, work) => {
      get(url);
      return work(() => p.open());
    }).teardown(p.close);
    const g = graph().add(conn);
    await g.run();

    const used = g.use(conn, async (c) => {
      await sleep(10);
      return c.open;
    });
    g.set(url, 1);
    await g.run();
    await g.settled(); // does not wait for the lease
    expect(p.live()).toBe(2);
    expect(g.inspect({ includeRuntime: true }).meta?.teardown).toMatchObject({
      pending: 1,
      held: 1,
    });

    expect(await used).toBe(true);
    await g.settled();
    expect(p.all.map((c) => c.open)).toEqual([false, true]);
  });

  it("dispose() aborts leases and waits for what they hold", async () => {
    const p = connections();
    const conn = task((_get, work) => work(() => p.open())).teardown(p.close);
    const g = graph().add(conn);
    await g.run();

    let openWhenAborted: boolean | undefined;
    const used = g.use(
      conn,
      (c, signal) =>
        new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => {
            openWhenAborted = c.open;
            setTimeout(resolve, 5);
          });
        }),
    );
    await g.dispose();
    await used;
    expect(openWhenAborted).toBe(true);
    expect(p.live()).toBe(0);
  });
});

describe("teardown: teardownPrevious cascades", () => {
  it("ctx.teardownPrevious() tears dependents down first and makes them recompute", async () => {
    const k = param(0);
    const log: string[] = [];
    const port = task(async (get, work, ctx) => {
      const key = get(k);
      await ctx.teardownPrevious();
      log.push("open port " + key);
      return work(() => ({ key }));
    }).teardown((v, info) => void log.push("close port " + v.key + " " + info.reason));
    const server = task((get, work) => {
      const bound = get(port);
      return work(() => ({ bound }));
    }).teardown((v, info) => void log.push("stop server " + v.bound.key + " " + info.reason));
    const g = graph().add(port).add(server);
    await g.run();
    g.set(k, 1);
    await g.run();
    await g.settled();
    expect(log).toEqual([
      "open port 0",
      "stop server 0 released",
      "close port 0 released",
      "open port 1",
    ]);
    expect(g.get(server).bound.key).toBe(1);
  });
});

describe("teardown: limits and scheduling", () => {
  it("gives up on a teardown that runs past timeoutMs and aborts its signal", async () => {
    const k = param(0);
    const errors: unknown[] = [];
    const log: string[] = [];
    let aborted = false;
    const dep = task((get, work) => {
      get(k);
      return work(() => ({}));
    }).teardown(() => void log.push("dep"));
    const stuck = task((get, work) => {
      get(dep);
      return work(() => ({}));
    }).teardown(
      (_v, info) =>
        new Promise<void>(() => {
          info.signal.addEventListener("abort", () => {
            aborted = true;
          });
        }),
    );
    const g = graph({ teardown: { timeoutMs: 10 } }).add(dep).add(stuck);
    g.on("teardown:error", (e) => errors.push(e.error));
    await g.run();
    g.set(k, 1);
    await g.run();
    await g.settled();
    expect(aborted).toBe(true);
    expect(errors[0]).toBeInstanceOf(TeardownTimeoutError);
    // What waited behind the stuck teardown still ran.
    expect(log).toEqual(["dep"]);
    expect(g.inspect({ includeRuntime: true }).meta?.teardown).toEqual({
      pending: 0,
      held: 0,
      completed: 1,
      failed: 1,
    });
  });

  it("starts teardowns when the schedule hook says so", async () => {
    const p = connections();
    const flushes: VoidFunction[] = [];
    const url = param(0);
    const conn = task((get, work) => {
      get(url);
      return work(() => p.open());
    }).teardown(p.close);
    const g = graph({ teardown: { schedule: (flush) => void flushes.push(flush) } }).add(conn);
    await g.run();
    g.set(url, 1);
    await g.run();
    await sleep(2);
    expect(p.live()).toBe(2);
    for (const flush of flushes) flush();
    await g.settled();
    expect(p.live()).toBe(1);
  });
});

describe("teardown: dispose reports failures", () => {
  it("finishes every teardown, then rejects with all the failures", async () => {
    const log: string[] = [];
    const a = task((_get, work) => work(() => ({}))).teardown(() => {
      log.push("a");
      throw new Error("a failed");
    });
    const b = task((get, work) => {
      get(a);
      return work(() => ({}));
    }).teardown(() => void log.push("b"));
    const c = task((_get, work) => work(() => ({}))).teardown(async () => {
      await sleep(2);
      log.push("c");
      throw new Error("c failed");
    });
    const g = graph().add(a).add(b).add(c);
    await g.run();
    const failure = await g.dispose().then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors.map((e: Error) => e.message).sort()).toEqual([
      "a failed",
      "c failed",
    ]);
    expect(log.indexOf("b")).toBeLessThan(log.indexOf("a"));
    expect(log).toContain("c");
  });
});
