import { describe, expect, it } from "vitest";
import { graph, param, task } from "../index.js";

describe("graph()", () => {
  it("runs a single task and exposes its value via get()", async () => {
    const g = graph();
    const a = task(() => 1).displayName("a");
    g.add(a);

    const report = await g.run({ targets: [a] });
    expect(report.status).toBe("ok");
    expect(g.get(a)).toBe(1);
  });

  it("computes implicit dependencies and memo-caches when clean", async () => {
    const g = graph();

    const p = param(1).displayName("p");
    let callsA = 0;
    let callsB = 0;

    const a = task((get, work) => {
      const pv = get(p);

      return work(() => {
        callsA += 1;
        return pv;
      });
    }).displayName("a");

    const b = task((get, work) => {
      const av = get(a);
      return work(() => {
        callsB += 1;
        return { result: av + 1 };
      });
    }).displayName("b");

    g.add(a);
    g.add(b);

    await g.run({ targets: [b] });
    expect(g.get(b).result).toBe(2);
    expect(callsA).toBe(1);
    expect(callsB).toBe(1);

    const r2 = await g.run({ targets: [b] });
    expect(r2.status).toBe("ok");
    expect(g.get(b).result).toBe(2);
    expect(callsA).toBe(1);
    expect(callsB).toBe(1);
    expect(r2.taskCount).toBe(0);
    expect(r2.cacheHits).toBeGreaterThanOrEqual(1);
  });

  it("recomputes and invalidates memo-caching when an input becomes dirty", async () => {
    const g = graph();

    const p = param(10).displayName("p");
    let callsA = 0;
    let callsB = 0;

    const a = task((get, work) => {
      const pv = get(p);
      return work(() => {
        callsA += 1;
        return pv * 2;
      });
    }).displayName("a");

    const b = task((get, work) => {
      const av = get(a);
      return work(() => {
        callsB += 1;
        return av + 1;
      });
    }).displayName("b");

    g.add(a);
    g.add(b);

    // Initial run: both should compute.
    await g.run({ targets: [b] });
    expect(g.get(b)).toBe(21); // (10 * 2) + 1
    expect(callsA).toBe(1);
    expect(callsB).toBe(1);

    // Run again: memo-cache should hit, no recomputation.
    const r2 = await g.run({ targets: [b] });
    expect(g.get(b)).toBe(21);
    expect(callsA).toBe(1);
    expect(callsB).toBe(1);
    expect(r2.taskCount).toBe(0);

    // Now change the param, dirtying only what's affected.
    p.set((prev) => prev + 5);

    // Now run: both 'a' and 'b' should recompute.
    const r3 = await g.run({ targets: [b] });
    expect(g.get(b)).toBe(31); // (15 * 2) + 1
    expect(callsA).toBe(2);
    expect(callsB).toBe(2);
    expect(r3.taskCount).toBe(2);
    expect(r3.cacheHits).toBe(0);
  });

  it("respects cache: none by recomputing on each run", async () => {
    const g = graph();
    let calls = 0;

    const a = task(() => {
      calls += 1;
      return calls;
    })
      .cache("none")
      .displayName("a");

    g.add(a);

    await g.run({ targets: [a] });
    expect(g.get(a)).toBe(1);

    await g.run({ targets: [a] });
    expect(g.get(a)).toBe(2);
  });

  it("invalidates downstream tasks when a param changes", async () => {
    const g = graph();
    const p = param(1).displayName("p");

    let calls = 0;
    const t = task((get, work) => {
      const pv = get(p);
      return work(() => {
        calls += 1;
        return pv + 1;
      });
    });

    g.add(t);

    await g.run();
    expect(g.get(t)).toBe(2);
    expect(calls).toBe(1);

    p.set(() => 41);
    await g.run();
    expect(g.get(t)).toBe(42);
    expect(calls).toBe(2);
  });

  it("executes work() at most once per task per compute", async () => {
    const g = graph();
    let workRuns = 0;

    const t = task((_get, work) => {
      const a = work(() => {
        workRuns += 1;
        return 1;
      });
      const b = work(() => {
        workRuns += 1;
        return 2;
      });
      return a + b;
    })
      .cache("none")
      .displayName("t");

    g.add(t);

    await g.run({ targets: [t] });
    // `work()` only executes the first callback; subsequent calls return the first value.
    expect(g.get(t)).toBe(2);
    expect(workRuns).toBe(1);

    await g.run({ targets: [t] });
    expect(g.get(t)).toBe(2);
    expect(workRuns).toBe(2);
  });

  it("respects lanes and laneConcurrency", async () => {
    const deferred = () => {
      let resolve!: () => void;
      const promise = new Promise<void>((r) => {
        resolve = r;
      });
      return { promise, resolve };
    };

    // Same-lane concurrency cap: only 1 "cpu" task should run at once.
    {
      const g = graph();
      let active = 0;
      let maxActive = 0;

      const d1 = deferred();
      const d2 = deferred();
      const d3 = deferred();

      const t1 = task((_get, work) =>
        work(() => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          return d1.promise.finally(() => {
            active -= 1;
          });
        }),
      )
        .lane("cpu")
        .displayName("t1");

      const t2 = task((_get, work) =>
        work(() => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          return d2.promise.finally(() => {
            active -= 1;
          });
        }),
      )
        .lane("cpu")
        .displayName("t2");

      const t3 = task((_get, work) =>
        work(() => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          return d3.promise.finally(() => {
            active -= 1;
          });
        }),
      )
        .lane("cpu")
        .displayName("t3");

      g.add(t1);
      g.add(t2);
      g.add(t3);

      const runPromise = g.run({
        targets: [t1, t2, t3],
        laneConcurrency: { cpu: 1 },
      });

      // Let tasks attempt to start.
      await Promise.resolve();
      await Promise.resolve();

      expect(maxActive).toBe(1);

      d1.resolve();
      await Promise.resolve();
      d2.resolve();
      await Promise.resolve();
      d3.resolve();

      const report = await runPromise;
      expect(report.status).toBe("ok");
      expect(maxActive).toBe(1);
    }

    // Cross-lane concurrency: cpu + io should be able to run simultaneously with 1 permit each.
    {
      const g = graph();
      let active = 0;
      let maxActive = 0;

      const dCpu = deferred();
      const dIo = deferred();

      const cpuTask = task((_get, work) =>
        work(() => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          return dCpu.promise.finally(() => {
            active -= 1;
          });
        }),
      )
        .lane("cpu")
        .displayName("cpuTask");

      const ioTask = task((_get, work) =>
        work(() => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          return dIo.promise.finally(() => {
            active -= 1;
          });
        }),
      )
        .lane("io")
        .displayName("ioTask");

      g.add(cpuTask);
      g.add(ioTask);

      const runPromise = g.run({
        targets: [cpuTask, ioTask],
        laneConcurrency: { cpu: 1, io: 1 },
      });

      await Promise.resolve();
      await Promise.resolve();

      expect(maxActive).toBe(2);

      dCpu.resolve();
      dIo.resolve();

      const report = await runPromise;
      expect(report.status).toBe("ok");
      expect(maxActive).toBe(2);
    }
  });

  it("emits graph events (run/task/cacheHit/error) via on()", async () => {
    const g = graph();
    const events: any[] = [];
    const unsub = g.on((e) => events.push(e));

    const ok = task(() => 1).displayName("ok");
    g.add(ok);

    const r1 = await g.run({ targets: [ok] });
    expect(r1.status).toBe("ok");

    // Basic shape + ordering for a successful run.
    expect(events[0]?.type).toBe("run:start");
    expect(events.some((e) => e.type === "task:start" && e.taskId === ok.id)).toBe(true);
    expect(events.some((e) => e.type === "task:finish" && e.taskId === ok.id)).toBe(true);
    expect(events[events.length - 1]?.type).toBe("run:finish");

    const runId1 = events[0].runId;
    expect(events.every((e) => e.runId === runId1)).toBe(true);

    // Second run should cache-hit the memo task (no task:start/finish).
    events.length = 0;
    const r2 = await g.run({ targets: [ok] });
    expect(r2.status).toBe("ok");
    expect(events.map((e) => e.type)).toEqual(["run:start", "task:cacheHit", "run:finish"]);
    expect(events[0].runId).toBe(events[1].runId);

    // Error case should emit task:error and run:finish status=error.
    events.length = 0;
    const boom = new Error("boom");
    const bad = task(() => {
      throw boom;
    }).displayName("bad");
    g.add(bad);

    const r3 = await g.run({ targets: [bad] });
    expect(r3.status).toBe("error");

    expect(events[0]?.type).toBe("run:start");
    expect(events.some((e) => e.type === "task:start" && e.taskId === bad.id)).toBe(true);
    const errEvent = events.find((e) => e.type === "task:error" && e.taskId === bad.id);
    expect(errEvent).toBeTruthy();
    expect(errEvent.error).toBe(boom);
    expect(events[events.length - 1]).toMatchObject({ type: "run:finish", status: "error" });

    // Unsubscribe should stop future delivery.
    unsub();
    events.length = 0;
    await g.run({ targets: [ok] });
    expect(events.length).toBe(0);
  });
});
