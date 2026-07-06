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

  it("runs cache: once only once and freezes downstream", async () => {
    const g = graph();
    const p = param(1).displayName("p");
    let callsA = 0;
    let callsB = 0;

    const a = task((get, work) => {
      const pv = get(p);
      return work(() => {
        callsA += 1;
        return pv + 1;
      });
    })
      .cache("once")
      .displayName("a");

    const b = task((get, work) => {
      const av = get(a);
      return work(() => {
        callsB += 1;
        return av + 1;
      });
    }).displayName("b");

    g.add(a);
    g.add(b);

    await g.run({ targets: [b] });
    expect(g.get(b)).toBe(3);
    expect(callsA).toBe(1);
    expect(callsB).toBe(1);

    p.set(() => 41);
    const r2 = await g.run({ targets: [b] });
    expect(g.get(b)).toBe(3);
    expect(callsA).toBe(1);
    expect(callsB).toBe(1);
    expect(r2.taskCount).toBe(0);
    expect(r2.cacheHits).toBeGreaterThanOrEqual(1);
  });

  it("allows cache: none tasks to be used as dependencies within a run", async () => {
    const g = graph();
    let callsA = 0;
    let callsB = 0;

    const a = task((_get, work) =>
      work(() => {
        callsA += 1;
        return callsA;
      }),
    )
      .cache("none")
      .displayName("a");

    const b = task((get, work) => {
      const av = get(a);
      return work(() => {
        callsB += 1;
        return av + 1;
      });
    }).displayName("b");

    g.add(a);
    g.add(b);

    await g.run({ targets: [b] });
    expect(g.get(b)).toBe(2);
    expect(callsA).toBe(1);
    expect(callsB).toBe(1);

    await g.run({ targets: [b] });
    expect(g.get(b)).toBe(3);
    expect(callsA).toBe(2);
    expect(callsB).toBe(2);
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

  it("caches the value of task", async () => {
    const g = graph();
    const p = param(1);

    let calls = 0;
    const t = task((get, _work) => {
      const pv = get(p);
      calls += 1;
      return pv + 1;
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

  it("uses the return value of task()", async () => {
    const g = graph();
    const p = param(1);

    let calls = 0;
    const t = task((get, _work) => {
      const pv = get(p);
      calls += 1;
      return pv + 1;
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

  it("does not use work if not returned", async () => {
    const g = graph();
    const p = param(1);

    let calls = 0;
    const t = task((get, work) => {
      const pv = get(p);
      work(() => {
        calls += 1;
        return pv + 1;
      });
    });

    g.add(t);
    await g.run();
    expect(g.get(t)).toBe(undefined);
    expect(calls).toBe(1);
  });

  it("executes work() at most once per task per compute", async () => {
    const g = graph();
    let workRuns = 0;

    const t = task((_get, work) => {
      const a = work(() => {
        workRuns += 1;
        return 1;
      });
      // Second work() call should throw.
      void work(() => {
        workRuns += 1;
        return 2;
      });
      return a;
    })
      .cache("none")
      .displayName("t");

    g.add(t);

    const r1 = await g.run({ targets: [t] });
    expect(r1.status).toBe("error");
    expect(() => g.get(t)).toThrow(/no computed value/i);
    expect(workRuns).toBe(1);
  });

  it("supports async work() callbacks (await work(async () => ...))", async () => {
    const g = graph();
    const p = param(1).displayName("p");

    const t = task(async (get, work) => {
      // Dependencies must be read before calling work().
      const pv = get(p);

      const out = await work(async () => {
        // Simulate async work.
        await Promise.resolve();
        return pv + 1;
      });

      return out;
    }).displayName("t");

    g.add(t);

    const report = await g.run({ targets: [t] });
    expect(report.status).toBe("ok");
    expect(g.get(t)).toBe(2);
  });

  it("does not throttle tasks when laneConcurrency is omitted", async () => {
    const deferred = () => {
      let resolve!: () => void;
      const promise = new Promise<void>((r) => {
        resolve = r;
      });
      return { promise, resolve };
    };

    const g = graph();
    let active = 0;
    let maxActive = 0;

    const d1 = deferred();
    const d2 = deferred();
    const d3 = deferred();

    const mkTask = (d: { promise: Promise<void> }, name: string) =>
      task((_get, work) =>
        work(() => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          return d.promise.finally(() => {
            active -= 1;
          });
        }),
      )
        .lane("cpu")
        .displayName(name);

    const t1 = mkTask(d1, "t1");
    const t2 = mkTask(d2, "t2");
    const t3 = mkTask(d3, "t3");

    g.add(t1);
    g.add(t2);
    g.add(t3);

    const runPromise = g.run({ targets: [t1, t2, t3] });

    // Let tasks start.
    await Promise.resolve();
    await Promise.resolve();

    expect(maxActive).toBe(3);

    d1.resolve();
    d2.resolve();
    d3.resolve();

    const report = await runPromise;
    expect(report.status).toBe("ok");
    expect(maxActive).toBe(3);
  });

  it("does not throttle tasks when laneConcurrency is an empty object", async () => {
    const deferred = () => {
      let resolve!: () => void;
      const promise = new Promise<void>((r) => {
        resolve = r;
      });
      return { promise, resolve };
    };

    const g = graph();
    let active = 0;
    let maxActive = 0;

    const d1 = deferred();
    const d2 = deferred();
    const d3 = deferred();

    const mkTask = (d: { promise: Promise<void> }, name: string) =>
      task((_get, work) =>
        work(() => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          return d.promise.finally(() => {
            active -= 1;
          });
        }),
      )
        .lane("cpu")
        .displayName(name);

    const t1 = mkTask(d1, "t1");
    const t2 = mkTask(d2, "t2");
    const t3 = mkTask(d3, "t3");

    g.add(t1);
    g.add(t2);
    g.add(t3);

    const runPromise = g.run({ targets: [t1, t2, t3], laneConcurrency: {} });

    // Let tasks start.
    await Promise.resolve();
    await Promise.resolve();

    expect(maxActive).toBe(3);

    d1.resolve();
    d2.resolve();
    d3.resolve();

    const report = await runPromise;
    expect(report.status).toBe("ok");
    expect(maxActive).toBe(3);
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

  it("cancels via AbortSignal and does not start downstream tasks", async () => {
    const g = graph();

    const waitForAbort = (signal: AbortSignal) =>
      new Promise<void>((resolve) => {
        if (signal.aborted) return resolve();
        signal.addEventListener("abort", () => resolve(), { once: true });
      });

    const deferred = <T>() => {
      let resolve!: (value: T) => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    };

    const abortErr = new Error("abort");
    const mode = param<"warmup" | "abort">("warmup").displayName("mode");

    const started = deferred<void>();
    const t1 = task((get, work, ctx) => {
      const m = get(mode);
      return work(async () => {
        if (m === "warmup") return 1;
        started.resolve();
        await waitForAbort(ctx.signal);
        throw ctx.signal.reason ?? abortErr;
      });
    })
      .cache("none")
      .displayName("t1");

    let t2WorkCalls = 0;
    const t2 = task((get, work) => {
      const v1 = get(t1);
      return work(() => {
        t2WorkCalls += 1;
        return v1 + 1;
      });
    })
      .cache("none")
      .displayName("t2");

    g.add(t1);
    g.add(t2);

    // Warm up once to ensure we exercise the compiled scheduler on the next run.
    const warmup = await g.run({ targets: [t1, t2] });
    expect(warmup.status).toBe("ok");
    expect(g.get(t1)).toBe(1);
    expect(g.get(t2)).toBe(2);

    t2WorkCalls = 0;
    mode.set(() => "abort");

    const ac = new AbortController();
    const runPromise = g.run({
      targets: [t2],
      signal: ac.signal,
    });

    await started.promise;
    ac.abort(abortErr);

    const report = await runPromise;

    expect(report.status).toBe("cancelled");
    expect(t2WorkCalls).toBe(0);
    expect(() => g.get(t1)).toThrow(/no computed value/i);
    // Downstream never started, so its previous (warmup) value remains.
    expect(g.get(t2)).toBe(2);
  });

  it("emits graph events (run/task/cacheHit/error) via on()", async () => {
    const g = graph();
    const allEvents: any[] = [];
    const taskEvents: any[] = [];
    const cacheHitEvents: any[] = [];
    const errorEvents: any[] = [];

    const unsubAll = g.on((e) => allEvents.push(e));
    const unsubTask = g.on("task:*", (e) => taskEvents.push(e));
    const unsubCacheHit = g.on("task:cacheHit", (e) => cacheHitEvents.push(e));
    const unsubError = g.on("task:error", (e) => errorEvents.push(e));

    const ok = task(() => 1).displayName("ok");
    g.add(ok);

    const r1 = await g.run({ targets: [ok] });
    expect(r1.status).toBe("ok");

    // Basic shape + ordering for a successful run.
    expect(allEvents[0]?.type).toBe("run:start");
    expect(
      allEvents.some((e) => e.type === "task:start" && e.taskId === ok.id),
    ).toBe(true);
    expect(
      allEvents.some((e) => e.type === "task:finish" && e.taskId === ok.id),
    ).toBe(true);
    expect(allEvents[allEvents.length - 1]?.type).toBe("run:finish");

    const runId1 = allEvents[0].runId;
    expect(allEvents.every((e) => e.runId === runId1)).toBe(true);

    expect(taskEvents.map((e) => e.type)).toEqual([
      "task:start",
      "task:finish",
    ]);
    expect(cacheHitEvents.length).toBe(0);
    expect(errorEvents.length).toBe(0);

    // Second run should cache-hit the memo task (no task:start/finish).
    allEvents.length = 0;
    taskEvents.length = 0;
    cacheHitEvents.length = 0;
    errorEvents.length = 0;
    const r2 = await g.run({ targets: [ok] });
    expect(r2.status).toBe("ok");
    expect(allEvents.map((e) => e.type)).toEqual([
      "run:start",
      "task:cacheHit",
      "run:finish",
    ]);
    expect(allEvents[0].runId).toBe(allEvents[1].runId);
    expect(taskEvents.map((e) => e.type)).toEqual(["task:cacheHit"]);
    expect(cacheHitEvents.map((e) => e.type)).toEqual(["task:cacheHit"]);
    expect(errorEvents.length).toBe(0);

    // Error case should emit task:error and run:finish status=error.
    allEvents.length = 0;
    taskEvents.length = 0;
    cacheHitEvents.length = 0;
    errorEvents.length = 0;
    const boom = new Error("boom");
    const bad = task(() => {
      throw boom;
    }).displayName("bad");
    g.add(bad);

    const r3 = await g.run({ targets: [bad] });
    expect(r3.status).toBe("error");

    expect(allEvents[0]?.type).toBe("run:start");
    expect(
      allEvents.some((e) => e.type === "task:start" && e.taskId === bad.id),
    ).toBe(true);
    const errEvent = allEvents.find(
      (e) => e.type === "task:error" && e.taskId === bad.id,
    );
    expect(errEvent).toBeTruthy();
    expect(errEvent.error).toBe(boom);
    expect(allEvents[allEvents.length - 1]).toMatchObject({
      type: "run:finish",
      status: "error",
    });

    expect(taskEvents.map((e) => e.type)).toEqual(["task:start", "task:error"]);
    expect(cacheHitEvents.length).toBe(0);
    expect(errorEvents.length).toBe(1);
    expect(errorEvents[0].error).toBe(boom);

    // Unsubscribe should stop future delivery.
    unsubAll();
    unsubTask();
    unsubCacheHit();
    unsubError();
    allEvents.length = 0;
    taskEvents.length = 0;
    cacheHitEvents.length = 0;
    errorEvents.length = 0;
    await g.run({ targets: [ok] });
    expect(allEvents.length).toBe(0);
    expect(taskEvents.length).toBe(0);
    expect(cacheHitEvents.length).toBe(0);
    expect(errorEvents.length).toBe(0);
  });

  it("inspect() exports nodes + edges for visualization", async () => {
    const g = graph();
    const p = param(1).displayName("p");

    const a = task((get, work) => {
      const pv = get(p);
      return work(() => pv + 1);
    }).displayName("a");

    const b = task((get, work) => {
      const av = get(a);
      return work(() => av + 1);
    }).displayName("b");

    g.add(a);
    g.add(b);

    await g.run({ targets: [b] });

    const inspected = g.inspect();
    expect(
      inspected.nodes.some((n) => n.kind === "task" && n.id === a.id),
    ).toBe(true);
    expect(
      inspected.nodes.some((n) => n.kind === "task" && n.id === b.id),
    ).toBe(true);
    expect(
      inspected.nodes.some((n) => n.kind === "param" && n.id === p.id),
    ).toBe(true);

    expect(
      inspected.edges.some(
        (e) => e.from === p.id && e.to === a.id && e.kind === "param",
      ),
    ).toBe(true);
    expect(
      inspected.edges.some(
        (e) => e.from === a.id && e.to === b.id && e.kind === "task",
      ),
    ).toBe(true);
  });

  it("does not recompile DAG when only values change", async () => {
    const g = graph();
    const p = param(1).displayName("p");

    const t = task((get, work) => {
      const pv = get(p);
      return work(() => pv + 1);
    }).displayName("t");

    g.add(t);

    // Run once to discover deps; run again to ensure topo is compiled after structure settles.
    await g.run({ targets: [t] });

    const before = g.inspect({ includeRuntime: true }).meta!;
    p.set((prev) => prev + 1);
    await g.run({ targets: [t] });
    const after = g.inspect({ includeRuntime: true }).meta!;

    expect(after.compileCount).toBe(before.compileCount);
  });

  it("recompiles DAG when a task's deps set changes", async () => {
    const g = graph();
    const toggle = param(false).displayName("toggle");
    const p1 = param(1).displayName("p1");
    const p2 = param(10).displayName("p2");

    const t = task((get, work) => {
      const on = get(toggle);
      const v = on ? get(p2) : get(p1);
      return work(() => v);
    }).displayName("t");

    g.add(t);

    await g.run({ targets: [t] });

    const before = g.inspect({ includeRuntime: true }).meta!;

    toggle.set(() => true);
    await g.run({ targets: [t] }); // deps change during this run

    // Next run should trigger a recompile due to structureVersion bump.
    await g.run({ targets: [t] });
    const after = g.inspect({ includeRuntime: true }).meta!;

    expect(after.compileCount).toBeGreaterThan(before.compileCount);
  });

  it("dispose() unsubscribes and clears graph state", async () => {
    const g = graph();
    const p = param(1);
    const t = task((get, work) => {
      const pv = get(p);
      return work(() => pv + 1);
    });
    g.add(t);
    await g.run({ targets: [t] });

    expect(() => (g as any).dispose()).not.toThrow();

    // After dispose, inspect should show an empty graph.
    const inspected = g.inspect();
    expect(inspected.nodes.length).toBe(0);
    expect(inspected.edges.length).toBe(0);
  });

  describe("graph.set()", () => {
    it("accepts a direct value when taking ownership", async () => {
      const p = param(100);
      const t = task((get, work) => {
        const pv = get(p);
        return work(() => pv);
      });

      const g = graph().add(t).set(p, 42);
      await g.run({ targets: [t] });

      expect(g.get(t)).toBe(42);
      // Module-scope param is untouched.
      expect(p.get()).toBe(100);
    });

    it("takes ownership and task reads the bound value, not the module-scope default", async () => {
      const p = param(100);
      const t = task((get, work) => {
        const pv = get(p);
        return work(() => pv);
      });

      const g = graph()
        .add(t)
        .set(p, () => 42);
      await g.run({ targets: [t] });

      expect(g.get(t)).toBe(42);
      // Module-scope param is untouched.
      expect(p.get()).toBe(100);
    });

    it("subsequent set() calls update the graph-local value", async () => {
      const p = param(0);
      const t = task((get, work) => {
        const pv = get(p);
        return work(() => pv);
      });

      const g = graph()
        .add(t)
        .set(p, () => 1);
      await g.run({ targets: [t] });
      expect(g.get(t)).toBe(1);

      g.set(p, () => 2);
      await g.run({ targets: [t] });
      expect(g.get(t)).toBe(2);
    });

    it("supports mixing direct values and callback updaters", async () => {
      const p = param(0);
      const t = task((get, work) => {
        const pv = get(p);
        return work(() => pv);
      });

      const g = graph().add(t).set(p, 2);
      g.set(p, (prev) => prev * 3);
      await g.run({ targets: [t] });
      expect(g.get(t)).toBe(6);
    });

    it("isolates two graphs sharing the same param token", async () => {
      const p = param(0);
      const t = task((get, work) => {
        const pv = get(p);
        return work(() => pv);
      });

      const g1 = graph()
        .add(t)
        .set(p, () => 10);
      const g2 = graph()
        .add(t)
        .set(p, () => 20);

      await g1.run({ targets: [t] });
      await g2.run({ targets: [t] });

      expect(g1.get(t)).toBe(10);
      expect(g2.get(t)).toBe(20);
    });

    it("takes over ownership from an existing subscription-based param", async () => {
      const p = param(1);
      let calls = 0;
      const t = task((get, work) => {
        const pv = get(p);
        return work(() => {
          calls += 1;
          return pv;
        });
      });

      const g = graph();
      g.add(t);

      // First run: param is auto-registered with external subscription.
      await g.run({ targets: [t] });
      expect(g.get(t)).toBe(1);
      expect(calls).toBe(1);

      // External set should dirty the graph (subscription is active).
      p.set(() => 2);
      await g.run({ targets: [t] });
      expect(g.get(t)).toBe(2);
      expect(calls).toBe(2);

      // Now take ownership via graph.set(). This detaches the subscription.
      g.set(p, () => 99);
      await g.run({ targets: [t] });
      expect(g.get(t)).toBe(99);
      expect(calls).toBe(3);

      // External p.set() should NOT affect the graph anymore.
      const callsBefore = calls;
      p.set(() => 999);
      await g.run({ targets: [t] });
      // Task should still see 99 (the graph-local value).
      expect(g.get(t)).toBe(99);
      // Task should not have recomputed since p.set() is detached.
      expect(calls).toBe(callsBefore);
    });

    it("emits param:set event on each graph.set() call", () => {
      const p = param(0);
      const g = graph();
      const events: any[] = [];

      g.on("param:set", (e) => events.push(e));
      g.set(p, () => 1);
      g.set(p, () => 2);

      expect(events.length).toBe(2);
      expect(events[0]!.type).toBe("param:set");
      expect(events[0]!.paramId).toBe(p.id);
      expect(events[1]!.paramId).toBe(p.id);
    });

    it("param:* wildcard subscription receives param:set events", () => {
      const p = param(0);
      const g = graph();
      const events: any[] = [];

      g.on("param:*", (e) => events.push(e));
      g.set(p, () => 5);

      expect(events.length).toBe(1);
      expect(events[0]!.type).toBe("param:set");
    });

    it("marks downstream tasks dirty after set()", async () => {
      const p = param(10);
      let calls = 0;
      const t = task((get, work) => {
        const pv = get(p);
        return work(() => {
          calls += 1;
          return pv * 2;
        });
      });

      const g = graph()
        .add(t)
        .set(p, () => 10);
      await g.run({ targets: [t] });
      expect(g.get(t)).toBe(20);
      expect(calls).toBe(1);

      // set() should dirty t, causing recomputation.
      g.set(p, () => 15);
      await g.run({ targets: [t] });
      expect(g.get(t)).toBe(30);
      expect(calls).toBe(2);
    });

    it("does not throw after dispose()", () => {
      const p = param(0);
      const g = graph();
      g.set(p, () => 1);
      g.dispose();

      // After dispose, set should still not throw — it just re-registers.
      expect(() => g.set(p, () => 2)).not.toThrow();
    });

    it("is chainable (fluent API)", () => {
      const p = param(0);
      const q = param("hello");
      const t = task((get, work) => {
        const pv = get(p);
        return work(() => pv);
      });

      const g = graph()
        .add(t)
        .set(p, () => 1)
        .set(q, () => "world");

      // Verify the chain returned the graph.
      expect(g).toBeDefined();
      expect(typeof g.run).toBe("function");
    });

    it("set() callback receives the previous bound value", async () => {
      const p = param(0);
      const t = task((get, work) => {
        const pv = get(p);
        return work(() => pv);
      });

      const g = graph()
        .add(t)
        .set(p, () => 10);

      // Increment using prev.
      g.set(p, (prev) => prev + 5);
      await g.run({ targets: [t] });
      expect(g.get(t)).toBe(15);
    });
  });

  describe("graph.reset()", () => {
    it("resets a graph-owned param to its owned baseline", async () => {
      const p = param(100);
      const t = task((get, work) => {
        const pv = get(p);
        return work(() => pv);
      });

      const g = graph().add(t).set(p, 20);
      g.set(p, 40);
      g.reset(p);
      await g.run({ targets: [t] });

      expect(g.get(t)).toBe(100);
      expect(p.get()).toBe(100);
    });

    it("resets all graph-owned params when called without arguments", async () => {
      const a = param(1);
      const b = param(2);
      const t = task((get, work) => {
        const av = get(a);
        const bv = get(b);
        return work(() => av + bv);
      });

      const g = graph().add(t).set(a, 10).set(b, 20);
      g.set(a, 30).set(b, 40);
      g.reset();
      await g.run({ targets: [t] });

      expect(g.get(t)).toBe(3);
    });

    it("throws when resetting a param unknown to the graph", () => {
      const p = param(1);
      const g = graph();
      expect(() => g.reset(p)).toThrow(`Requested Unknown Node Id: ${p.id}`);
    });

    it("does not mutate subscription-only params when resetting all", async () => {
      const p = param(1);
      const t = task((get, work) => {
        const pv = get(p);
        return work(() => pv);
      });

      const g = graph().add(t);
      await g.run({ targets: [t] });
      p.set(5);
      g.reset();
      await g.run({ targets: [t] });

      expect(p.get()).toBe(5);
      expect(g.get(t)).toBe(5);
    });

    it("marks downstream tasks dirty and emits param:set on reset", async () => {
      const p = param(2);
      let calls = 0;
      const events: any[] = [];
      const t = task((get, work) => {
        const pv = get(p);
        return work(() => {
          calls += 1;
          return pv * 2;
        });
      });

      const g = graph().add(t).set(p, 5);
      g.on("param:set", (e) => events.push(e));
      await g.run({ targets: [t] });

      g.reset(p);
      await g.run({ targets: [t] });

      expect(g.get(t)).toBe(4);
      expect(calls).toBe(2);
      expect(events.length).toBe(1);
      expect(events[0]!.type).toBe("param:set");
      expect(events[0]!.paramId).toBe(p.id);
    });

    it("is chainable (fluent API)", async () => {
      const p = param(1);
      const t = task((get, work) => {
        const pv = get(p);
        return work(() => pv);
      });

      const g = graph().add(t).set(p, 10).reset(p);
      await g.run({ targets: [t] });

      expect(g.get(t)).toBe(1);
    });
  });

  describe("param equals gating via graph.set()", () => {
    it("skips version bump and downstream invalidation when equals reports no change", async () => {
      const p = param(0, { equals: (a, b) => a === b });
      let calls = 0;
      const t = task((get, work) => {
        const pv = get(p);
        return work(() => {
          calls += 1;
          return pv;
        });
      });

      const g = graph().add(t).set(p, 1);
      await g.run({ targets: [t] });
      expect(g.get(t)).toBe(1);
      expect(calls).toBe(1);

      g.set(p, 1);
      const report = await g.run({ targets: [t] });
      expect(g.get(t)).toBe(1);
      expect(calls).toBe(1);
      expect(report.taskCount).toBe(0);
      expect(report.cacheHits).toBeGreaterThanOrEqual(1);
    });

    it("still invalidates downstream tasks when equals reports a change", async () => {
      const p = param(0, { equals: (a, b) => a === b });
      let calls = 0;
      const t = task((get, work) => {
        const pv = get(p);
        return work(() => {
          calls += 1;
          return pv;
        });
      });

      const g = graph().add(t).set(p, 1);
      await g.run({ targets: [t] });

      g.set(p, 2);
      await g.run({ targets: [t] });

      expect(g.get(t)).toBe(2);
      expect(calls).toBe(2);
    });
  });

  describe("run() preemption and coalescing", () => {
    it("returns the in-flight promise when targets are still clean", async () => {
      let started = 0;
      let finished = 0;

      const slow = task(async (_get, work, ctx) =>
        work(async () => {
          started += 1;
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => resolve(), 30);
            ctx.signal.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                reject(ctx.signal.reason ?? new Error("aborted"));
              },
              { once: true },
            );
          });
          finished += 1;
          return "done";
        }),
      ).displayName("slow");

      const g = graph().add(slow);
      const first = g.run({ targets: [slow] });
      const second = g.run({ targets: [slow] });

      expect(second).toBe(first);

      const report = await second;
      expect(report.status).toBe("ok");
      expect(g.get(slow)).toBe("done");
      expect(started).toBe(1);
      expect(finished).toBe(1);
    });

    it("preempts an in-flight run when inputs become dirty", async () => {
      const p = param(1, { equals: (a, b) => a === b });
      let started = 0;
      let finished = 0;
      const seen: number[] = [];

      const slow = task(async (get, work, ctx) => {
        const pv = get(p);
        return work(async () => {
          started += 1;
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => resolve(), 50);
            ctx.signal.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                reject(ctx.signal.reason ?? new Error("aborted"));
              },
              { once: true },
            );
          });
          finished += 1;
          seen.push(pv);
          return pv;
        });
      }).displayName("slow");

      const g = graph().add(slow).set(p, 1);
      const first = g.run({ targets: [slow] });

      await new Promise((resolve) => setTimeout(resolve, 5));
      g.set(p, 2);
      const second = g.run({ targets: [slow] });

      expect(second).not.toBe(first);

      await expect(first).resolves.toMatchObject({ status: "cancelled" });
      const report = await second;
      expect(report.status).toBe("ok");
      expect(g.get(slow)).toBe(2);
      expect(seen).toEqual([2]);
      expect(started).toBe(2);
      expect(finished).toBe(1);
    });
  });

  describe("task disposer()", () => {
    it("invokes the disposer with the cached value on graph.dispose()", async () => {
      const g = graph();
      const disposed: Array<{ id: number }> = [];
      const resource = task((_get, work) => work(() => ({ id: 42 })))
        .displayName("resource")
        .disposer((value) => disposed.push(value));
      g.add(resource);

      await g.run({ targets: [resource] });
      expect(disposed).toEqual([]);

      g.dispose();
      expect(disposed).toEqual([{ id: 42 }]);
    });

    it("does not invoke the disposer on re-execution (prev-value cleanup is the task's job)", async () => {
      const g = graph();
      const p = param(1);
      const disposed: number[] = [];
      const prevSeen: Array<number | undefined> = [];
      const resource = task((get, work) => {
        const pv = get(p);
        return work((prev?: number) => {
          prevSeen.push(prev);
          return pv;
        });
      })
        .displayName("resource")
        .disposer((value) => disposed.push(value));
      g.add(resource);

      await g.run({ targets: [resource] });
      g.set(p, 2);
      await g.run({ targets: [resource] });

      // Re-run replaced the value but did not call the disposer; the task saw
      // the previous value and could have released it itself.
      expect(disposed).toEqual([]);
      expect(prevSeen).toEqual([undefined, 1]);

      g.dispose();
      expect(disposed).toEqual([2]);
    });

    it("does not invoke the disposer for tasks that never produced a value", async () => {
      const g = graph();
      const disposed: unknown[] = [];
      const resource = task((_get, work) => work(() => "value"))
        .displayName("never-ran")
        .disposer((value) => disposed.push(value));
      g.add(resource);

      g.dispose();
      expect(disposed).toEqual([]);
    });
  });
});
