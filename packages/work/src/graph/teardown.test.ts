import { describe, expect, it } from "vitest";
import { dispose, graph, param, task } from "../index";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Res = { id: number; open: boolean };

function pool() {
  const all: Res[] = [];
  const log: string[] = [];
  return {
    all,
    log,
    open: (): Res => {
      const r = { id: all.length + 1, open: true };
      all.push(r);
      return r;
    },
    close: (r: Res) => {
      r.open = false;
      log.push(`close ${r.id}`);
    },
    live: () => all.filter((r) => r.open).length,
  };
}

describe("teardown: value replaced", () => {
  it("tears down the old value after the run, once the replacement exists", async () => {
    const p = pool();
    const seen: unknown[] = [];
    const key = param(0);
    const conn = task((get, work) => {
      get(key);
      return work(() => p.open());
    }).teardown((value, info) => {
      seen.push([value.id, info.reason, p.live()]);
      p.close(value);
    });
    const g = graph().add(conn);

    await g.run();
    expect(p.live()).toBe(1);

    g.set(key, 1);
    await g.run();
    await g.settled();

    expect(seen).toEqual([[1, "replaced", 2]]);
    expect(g.get(conn).id).toBe(2);
    expect(p.live()).toBe(1);
  });

  it("does nothing on a cache hit or when the task returns the same value", async () => {
    const p = pool();
    const key = param(0);
    const conn = task((get, work) => {
      get(key);
      return work((prev: Res | undefined) => prev ?? p.open());
    }).teardown(p.close);
    const g = graph().add(conn);

    await g.run();
    await g.run();
    g.set(key, 1);
    await g.run();
    await g.settled();

    expect(p.log).toEqual([]);
    expect(p.all.length).toBe(1);
  });

  it("does not make the run wait for an async teardown; settled() does", async () => {
    const p = pool();
    const key = param(0);
    const conn = task((get, work) => {
      get(key);
      return work(() => p.open());
    }).teardown(async (value) => {
      await sleep(5);
      p.close(value);
    });
    const g = graph().add(conn);
    await g.run();
    g.set(key, 1);
    await g.run();

    expect(p.live()).toBe(2);
    expect(g.inspect({ includeRuntime: true }).meta?.teardown).toMatchObject({ pending: 1 });
    await g.settled();
    expect(p.live()).toBe(1);
    expect(g.inspect({ includeRuntime: true }).meta?.teardown).toEqual({
      pending: 0,
      held: 0,
      completed: 1,
      failed: 0,
    });
  });

  it("keeps the old value when the recompute fails, then retires it on the next success", async () => {
    const p = pool();
    const key = param(0);
    const conn = task((get, work) => {
      const k = get(key);
      if (k === 1) throw new Error("bad config");
      return work(() => p.open());
    }).teardown(p.close);
    const g = graph().add(conn);
    await g.run();

    g.set(key, 1);
    const failed = await g.run();
    await g.settled();
    expect(failed.status).not.toBe("ok");
    expect(p.log).toEqual([]);
    // The old value stays live and is passed to work(prev), though peek() hides it while the
    // task is in error.
    expect(p.all[0].open).toBe(true);
    expect(g.peek(conn)).toBeUndefined();

    g.set(key, 2);
    await g.run();
    await g.settled();
    expect(p.log).toEqual(["close 1"]);
  });

  it("holds teardown back until every overlapping run has finished", async () => {
    const p = pool();
    const url = param(0);
    const query = param(0);
    let usedClosed = 0;
    const conn = task((get, work) => {
      get(url);
      return work(() => p.open());
    }).teardown(p.close);
    const report = task(async (get) => {
      get(query);
      const c = get(conn);
      await sleep(5);
      if (!c.open) usedClosed += 1;
      return c.id;
    });
    const g = graph().add(conn).add(report);
    await g.run();

    g.set(query, 1);
    const slow = g.run({ targets: [report] });
    await sleep(1);
    g.set(url, 1);
    await g.run({ targets: [conn] });
    expect(p.live()).toBe(2);

    await slow;
    await g.settled();
    expect(usedClosed).toBe(0);
    // `report` was built on the first connection and has not been recomputed, so it still
    // holds it.
    expect(p.live()).toBe(2);

    await g.run();
    await g.settled();
    expect(p.live()).toBe(1);
  });
});

describe("teardown: errors", () => {
  it("isolates a throwing teardown and reports it as an event", async () => {
    const p = pool();
    const errors: unknown[] = [];
    const key = param(0);
    const bad = task((get, work) => {
      get(key);
      return work(() => p.open());
    }).teardown(() => {
      throw new Error("close failed");
    });
    const good = task((get, work) => {
      get(key);
      return work(() => p.open());
    }).teardown(p.close);
    const g = graph().add(bad).add(good);
    g.on("teardown:error", (e) => errors.push([(e.error as Error).message, e.reason, e.taskId]));
    await g.run();

    g.set(key, 1);
    const report = await g.run();
    await g.settled();

    expect(report.status).toBe("ok");
    expect(errors).toEqual([["close failed", "replaced", bad.id]]);
    expect(p.log.length).toBe(1);
    expect(g.inspect({ includeRuntime: true }).meta?.teardown).toMatchObject({ failed: 1 });
  });

  it("reports finished teardowns under teardown:*, without touching task:* listeners", async () => {
    const key = param(0);
    const taskEvents: string[] = [];
    const teardownEvents: string[] = [];
    const conn = task((get, work) => {
      get(key);
      return work(() => ({}));
    }).teardown(() => {});
    const g = graph().add(conn);
    g.on("task:*", (e) => taskEvents.push(e.runId && e.type));
    g.on("teardown:*", (e) => teardownEvents.push(`${e.type} ${e.reason}`));
    await g.run();
    g.set(key, 1);
    await g.run();
    await g.settled();

    expect(teardownEvents).toEqual(["teardown:finish replaced"]);
    expect(taskEvents.every((type) => type.startsWith("task:"))).toBe(true);
  });
});

describe("teardown: dispose", () => {
  it("tears down dependents before their dependencies and waits for async teardowns", async () => {
    const order: string[] = [];
    const make = (name: string, deps: any[]) =>
      task((get, work) => {
        for (const d of deps) get(d);
        return work(() => ({ name }));
      }).teardown(async (value, info) => {
        await sleep(2);
        order.push(`${value.name} ${info.reason}`);
      });
    const a = make("a", []);
    const b = make("b", [a]);
    const c = make("c", [b]);
    const g = graph().add(a).add(b).add(c);
    await g.run();

    await g.dispose();
    expect(order).toEqual(["c disposed", "b disposed", "a disposed"]);
  });

  it("tears down a value that arrives after dispose", async () => {
    const p = pool();
    const late = task(async () => {
      await sleep(5);
      return p.open();
    }).teardown(p.close);
    const g = graph().add(late);
    const running = g.run();
    await sleep(1);
    await g.dispose();
    await running;
    expect(p.all.length).toBe(1);
    expect(p.live()).toBe(0);
  });

  it("is what Symbol.asyncDispose calls, and leaves a graph that can be used again", async () => {
    const p = pool();
    const conn = task((_get, work) => work(() => p.open())).teardown(p.close);
    const g = graph().add(conn);
    await g.run();

    await g[Symbol.asyncDispose]();
    expect(p.live()).toBe(0);

    g.add(conn);
    await g.run();
    expect(p.live()).toBe(1);
    await g.dispose();
    expect(p.live()).toBe(0);
  });
});

describe("teardown: disposable protocol", () => {
  it("is opt-in: .teardown(dispose) calls Symbol.dispose or Symbol.asyncDispose", async () => {
    for (const optIn of [true, false]) {
      let disposed = 0;
      const key = param(0);
      const sync = task((get, work) => {
        get(key);
        return work(() => ({ [Symbol.dispose]: () => void (disposed += 1) }));
      });
      const async = task((get, work) => {
        get(key);
        return work(() => ({
          [Symbol.asyncDispose]: async () => {
            await sleep(1);
            disposed += 1;
          },
        }));
      });
      if (optIn) {
        sync.teardown(dispose);
        async.teardown(dispose);
      }
      const g = graph().add(sync).add(async);
      await g.run();
      g.set(key, 1);
      await g.run();
      await g.dispose();
      expect(disposed).toBe(optIn ? 4 : 0);
    }
  });

  it("dispose() ignores null and undefined and refuses anything else", () => {
    expect(dispose(null)).toBeUndefined();
    expect(dispose(undefined)).toBeUndefined();
    expect(() => dispose({} as any)).toThrow(TypeError);
  });
});

describe("teardown: values that cannot exist twice", () => {
  it("ctx.teardownPrevious() tears the old value down before the new one is created", async () => {
    const p = pool();
    const liveAtCreate: number[] = [];
    const key = param(0);
    const lock = task(async (get, work, ctx) => {
      get(key);
      await ctx.teardownPrevious();
      return work(() => {
        liveAtCreate.push(p.live());
        return p.open();
      });
    }).teardown(async (value) => {
      await sleep(2);
      p.close(value);
    });
    const g = graph().add(lock);
    await g.run();
    g.set(key, 1);
    await g.run();
    expect(liveAtCreate).toEqual([0, 0]);
    await g.dispose();
    expect(p.live()).toBe(0);
  });

  it("runs after validation, and work(prev) then sees undefined", async () => {
    const p = pool();
    const prevs: unknown[] = [];
    const reasons: string[] = [];
    const key = param(0);
    const lock = task(async (get, work, ctx) => {
      const k = get(key);
      if (k === 1) throw new Error("invalid");
      await ctx.teardownPrevious();
      // Asking twice does the work once.
      await ctx.teardownPrevious();
      return work((prev) => {
        prevs.push(prev);
        return p.open();
      });
    }).teardown((value, info) => {
      reasons.push(info.reason);
      p.close(value);
    });
    const g = graph().add(lock);
    await g.run();

    g.set(key, 1);
    await g.run();
    expect(p.live()).toBe(1);

    g.set(key, 2);
    await g.run();
    expect(prevs).toEqual([undefined, undefined]);
    expect(p.log).toEqual(["close 1"]);
    await g.dispose();
    expect(p.live()).toBe(0);
    expect(reasons).toEqual(["released", "disposed"]);
  });
});
