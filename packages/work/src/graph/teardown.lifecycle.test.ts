// Regressions from the design review: each one was a reproduced defect in an earlier iteration.
import { describe, expect, it, vi } from "vitest";
import { graph, param, task, type TaskContext } from "../index";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("teardown: lifecycle", () => {
  it("effect-style task (returns undefined): the previous cleanup runs when it recomputes", async () => {
    const key = param(0);
    let active = 0;
    const sub = task((get, work, ctx) => {
      get(key);
      return work(() => {
        active += 1;
        ctx.scope.defer(() => void (active -= 1));
      });
    });
    const g = graph().add(sub);
    await g.run();
    for (let i = 1; i <= 3; i++) {
      g.set(key, i);
      await g.run();
      await g.settled();
    }
    expect(active).toBe(1);
  });

  it("dispose during a run that returns prev: the value is torn down exactly once", async () => {
    const key = param(0);
    const closes: number[] = [];
    const conn = task(async (get, work) => {
      get(key);
      await sleep(5);
      return work((prev: { id: number } | undefined) => prev ?? { id: 1 });
    }).teardown((v) => void closes.push(v.id));
    const g = graph().add(conn);
    await g.run();
    g.set(key, 1);
    const running = g.run();
    await sleep(1);
    await g.dispose();
    await running;
    expect(closes).toEqual([1]);
  });

  it("a failed dependent keeps its old value: the dependency it was built on stays open", async () => {
    const key = param(0);
    const repoTeardownSawPoolOpen: boolean[] = [];
    let heldRepo: any;
    const pool = task((get, work) => {
      get(key);
      return work(() => ({ open: true }));
    }).teardown((v) => void (v.open = false));
    const repo = task((get, work) => {
      const k = get(key);
      const p = get(pool);
      if (k === 1) throw new Error("bad");
      return work(() => (heldRepo = { pool: p }));
    }).teardown((v: any) => void repoTeardownSawPoolOpen.push(v.pool.open));
    const g = graph().add(pool).add(repo);
    await g.run();
    const repo1 = heldRepo;

    g.set(key, 1);
    await g.run(); // pool replaced, repo fails and keeps repo1 (live, handed to work(prev) later)
    await g.settled();
    const poolOpenWhileRepo1Live = repo1.pool.open;

    g.set(key, 2);
    await g.run();
    await g.settled();
    expect({ poolOpenWhileRepo1Live, repoTeardownSawPoolOpen }).toEqual({
      poolOpenWhileRepo1Live: true,
      repoTeardownSawPoolOpen: [true],
    });
  });

  it("a dependency dropped in the replacing run: the old dependent is still torn down first", async () => {
    const k = param(0);
    const useA = param(true);
    const log: string[] = [];
    const A = task((get, work) => {
      get(k);
      return work(() => ({ open: true }));
    }).teardown((v) => {
      v.open = false;
      log.push("a");
    });
    const B = task((get, work) => {
      get(k);
      const a = get(useA) ? get(A) : undefined;
      return work(() => ({ a }));
    }).teardown((v) => void log.push(v.a ? `b(a.open=${v.a.open})` : "b"));
    const g = graph().add(A).add(B);
    await g.run();
    g.set(k, 1);
    g.set(useA, false);
    await g.run();
    await g.settled();
    expect(log).toEqual(["b(a.open=true)", "a"]);
  });

  it("dispose while a run is active: values retired by that run keep dependents-first order", async () => {
    const k = param(0);
    const log: string[] = [];
    const mk = (name: string, dep?: any) =>
      task((get, work) => {
        get(k);
        if (dep) get(dep);
        return work(() => ({ name }));
      }).teardown(() => void log.push(name));
    const a = mk("a");
    const b = mk("b", a);
    const c = mk("c", b);
    const slow = task(async (get) => {
      get(k);
      get(c);
      await sleep(10);
      return 1;
    });
    const g = graph().add(a).add(b).add(c).add(slow);
    await g.run();
    g.set(k, 1);
    const running = g.run();
    await sleep(2);
    await g.dispose();
    await running;
    // The invariant is dependents-first within a generation; the two chains are independent
    // and may interleave. At every point no more b's than c's and no more a's than b's have
    // been torn down.
    const seen = { a: 0, b: 0, c: 0 };
    let ordered = true;
    for (const name of log) {
      seen[name as keyof typeof seen] += 1;
      if (seen.b > seen.c || seen.a > seen.b) ordered = false;
    }
    expect({ ordered, seen }).toEqual({ ordered: true, seen: { a: 2, b: 2, c: 2 } });
  });

  it("overlapping runs: a dependent that read the old value is not left clean on it", async () => {
    const url = param(0);
    const query = param(0);
    const conn = task((get, work) => {
      get(url);
      return work(() => ({ open: true }));
    }).teardown((v) => void (v.open = false));
    const report = task(async (get) => {
      get(query);
      const c = get(conn);
      await sleep(5);
      return { conn: c };
    });
    const g = graph().add(conn).add(report);
    await g.run();

    g.set(query, 1);
    const slow = g.run({ targets: [report] });
    await sleep(1);
    g.set(url, 1);
    await g.run({ targets: [conn] });
    await slow;
    await g.settled();
    const second = await g.run(); // notices that report was built on the retired conn
    expect({ taskCount: second.taskCount, reportConnOpen: g.get(report).conn.open }).toEqual({
      taskCount: 1,
      reportConnOpen: true,
    });
  });

  it("a ctx kept past its execution cannot reach the task's current value", async () => {
    let saved: TaskContext | undefined;
    const t = task((_get, work, ctx) => {
      saved = ctx;
      return work(() => ({ open: true }));
    }).teardown((v) => void (v.open = false));
    const g = graph().add(t);
    await g.run();

    await expect(saved!.teardownPrevious()).rejects.toThrow(/after it finished/);
    expect(() => saved!.scope.defer(() => {})).toThrow(/after it finished/);
    const info = g.inspect({ includeRuntime: true }).nodes.find((n) => n.kind === "task") as any;
    expect({ value: g.get(t), state: info.state }).toEqual({ value: { open: true }, state: "ready" });
  });

  it("a dependency is not torn down while an older generation of its dependent still is", async () => {
    const ka = param(0);
    const kb = param(0);
    const sawAOpen: boolean[] = [];
    let builds = 0;
    const A = task((get, work) => {
      get(ka);
      return work(() => ({ open: true }));
    }).teardown((v) => void (v.open = false));
    const B = task((get, work) => {
      get(kb);
      const a = get(A);
      return work(() => ({ a, delay: builds++ === 0 ? 30 : 0 }));
    }).teardown(async (v) => {
      await sleep(v.delay);
      sawAOpen.push(v.a.open); // a real teardown would flush through `a` here
    });
    const g = graph().add(A).add(B);
    await g.run();
    g.set(kb, 1);
    await g.run(); // B1 retired; its teardown takes 30 ms
    g.set(ka, 1);
    await g.run(); // A1 and B2 retired in a second batch
    await g.settled();
    expect(sawAOpen).toEqual([true, true]);
  });

  it("discovery retry: what an attempt registered before a missing dependency is undone", async () => {
    let open = 0;
    let executions = 0;
    const reasons: string[] = [];
    const dep = task(() => 1);
    const t = task((get, work, ctx) => {
      executions += 1;
      open += 1;
      ctx.scope.defer((info) => {
        open -= 1;
        reasons.push(info.reason);
      });
      get(dep);
      return work(() => ({}));
    });
    const g = graph().add(t);
    await g.run();
    await g.settled();
    expect({ executions, open, reasons }).toEqual({ executions: 2, open: 1, reasons: ["failed"] });
  });

  it("cache:'once' dependent: the value it was built on is not torn down under it", async () => {
    const key = param(0);
    const conn = task((get, work) => {
      get(key);
      return work(() => ({ open: true }));
    }).teardown((v) => void (v.open = false));
    const session = task((get, work) => {
      const c = get(conn);
      return work(() => ({ conn: c }));
    }).cache("once");
    const g = graph().add(conn).add(session);
    await g.run();
    g.set(key, 1);
    await g.run();
    await g.settled();
    expect(g.get(session).conn.open).toBe(true);
  });
});

describe("teardown: listeners and signals", () => {
  it("a throwing teardown:finish listener does not stop later teardowns", async () => {
    const key = param(0);
    let closed = 0;
    const conn = task((get, work) => {
      get(key);
      return work(() => ({}));
    }).teardown(async () => {
      await sleep(1);
      closed += 1;
    });
    const g = graph().add(conn);
    let thrown = false;
    g.on("teardown:finish", () => {
      if (thrown) return;
      thrown = true;
      throw new Error("listener bug");
    });
    await g.run();

    let settledRejected = false;
    for (let i = 1; i <= 3; i++) {
      g.set(key, i);
      await g.run();
      await Promise.race([g.settled(), sleep(30)]).catch(() => void (settledRejected = true));
    }
    const stats = g.inspect({ includeRuntime: true }).meta?.teardown;
    expect({ closed, settledRejected, pending: stats?.pending }).toEqual({
      closed: 3,
      settledRejected: false,
      pending: 0,
    });
  });

  it("a throwing run:finish listener does not leave the run registered as active", async () => {
    const key = param(0);
    let closed = 0;
    const conn = task((get, work) => {
      get(key);
      return work(() => ({}));
    }).teardown(() => void (closed += 1));
    const g = graph().add(conn);
    await g.run();
    const off = g.on("run:finish", () => {
      throw new Error("listener bug");
    });
    g.set(key, 1);
    await g.run().catch(() => {});
    off();
    g.set(key, 2);
    await g.run();
    const settled = await Promise.race([
      g.settled().then(() => "settled"),
      sleep(50).then(() => "hung"),
    ]);
    expect({ settled, closed }).toEqual({ settled: "settled", closed: 2 });
  });

  it("a run removes its listener from the caller's abort signal when it ends", async () => {
    const key = param(0);
    const t = task((get) => get(key));
    const g = graph().add(t);
    const controller = new AbortController();
    const added = vi.spyOn(controller.signal, "addEventListener");
    const removed = vi.spyOn(controller.signal, "removeEventListener");

    for (let i = 1; i <= 3; i++) {
      g.set(key, i);
      await g.run({ signal: controller.signal });
    }
    expect(added).toHaveBeenCalledTimes(3);
    expect(removed).toHaveBeenCalledTimes(3);
    expect(removed.mock.calls.map((call) => call[1])).toEqual(
      added.mock.calls.map((call) => call[1]),
    );
  });
});
