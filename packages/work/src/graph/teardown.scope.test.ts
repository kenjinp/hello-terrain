import { describe, expect, it } from "vitest";
import { graph, param, task } from "../index";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("teardown: ctx.scope", () => {
  it("runs entries newest first, after the task's own teardown", async () => {
    const order: string[] = [];
    const key = param(0);
    const session = task((get, work, ctx) => {
      const k = get(key);
      return work(() => {
        ctx.scope.defer((info) => void order.push(`deferred ${k} ${info.reason}`));
        const socket = ctx.scope.adopt({ name: `socket ${k}` }, (s) => void order.push(s.name));
        const timer = ctx.scope.use({ [Symbol.dispose]: () => void order.push(`timer ${k}`) });
        return { socket, timer };
      });
    }).teardown(() => void order.push("value"));
    const g = graph().add(session);
    await g.run();
    g.set(key, 1);
    await g.run();
    await g.settled();
    expect(order).toEqual(["value", "timer 0", "socket 0", "deferred 0 replaced"]);
  });

  it("works without a .teardown(fn), destructured, and waits for async entries", async () => {
    const order: string[] = [];
    const session = task((_get, work, { scope: { adopt, defer } }) =>
      work(() => {
        defer(async () => {
          await sleep(2);
          order.push("deferred");
        });
        return adopt({ open: true }, (value) => {
          value.open = false;
          order.push("adopted");
        });
      }),
    );
    const g = graph().add(session);
    await g.run();
    const value = g.get(session);
    await g.dispose();
    expect(order).toEqual(["adopted", "deferred"]);
    expect(value.open).toBe(false);
  });

  it("runs the entries of an execution that throws, with the error", async () => {
    const seen: unknown[] = [];
    const events: string[] = [];
    const handle = { open: true };
    const session = task((_get, work, ctx) =>
      work(() => {
        ctx.scope.adopt(handle, (h, info) => {
          h.open = false;
          seen.push([info.reason, info.reason === "failed" && (info.error as Error).message]);
        });
        throw new Error("second handle failed");
      }),
    );
    const g = graph().add(session);
    g.on("teardown:finish", (e) => events.push(e.reason));
    const report = await g.run();
    await g.settled();
    expect(report.status).toBe("error");
    expect(handle.open).toBe(false);
    expect(seen).toEqual([["failed", "second handle failed"]]);
    expect(events).toEqual(["failed"]);
  });

  it("registers the same object once, also when the value is carried over", async () => {
    let closes = 0;
    const key = param(0);
    const handle = { close: () => void (closes += 1) };
    const disposable = { [Symbol.dispose]: () => void (closes += 10) };
    const session = task((get, work, ctx) => {
      get(key);
      return work((prev: { handle: typeof handle } | undefined) => {
        ctx.scope.adopt(handle, (h) => h.close());
        ctx.scope.adopt(handle, (h) => h.close());
        ctx.scope.use(disposable);
        ctx.scope.use(disposable);
        return prev ?? { handle };
      });
    });
    const g = graph().add(session);
    await g.run();
    for (let i = 1; i <= 3; i++) {
      g.set(key, i);
      await g.run();
    }
    await g.settled();
    expect(closes).toBe(0);
    await g.dispose();
    expect(closes).toBe(11);
  });

  it("use() passes null and undefined through and refuses what is not disposable", async () => {
    const errors: unknown[] = [];
    const ok = task((_get, work, ctx) =>
      work(() => [ctx.scope.use(null), ctx.scope.use(undefined)]),
    );
    const bad = task((_get, work, ctx) => work(() => ctx.scope.use({} as any)));
    const g = graph().add(ok).add(bad);
    g.on("task:error", (e) => errors.push(e.error));
    await g.run();
    expect(g.get(ok)).toEqual([null, undefined]);
    expect(errors[0]).toBeInstanceOf(TypeError);
  });
});
