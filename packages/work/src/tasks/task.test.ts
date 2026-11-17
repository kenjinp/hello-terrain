import { describe, expect, expectTypeOf, it } from "vitest";
import { param } from "../param/param";
import { task } from "./task";
import { TASK_DEF, type Getter, type TaskContext, type TaskRef } from "./task.types";

describe("task()", () => {
  it("exposes kind + id + name", () => {
    const t = task(() => 123);
    expect(t.kind).toBe("task");
    expect(typeof t.id).toBe("string");
    expect(t.id.length).toBeGreaterThan(0);
    expect(t.name).toBeUndefined();
  });

  it("supports displayName()", () => {
    const t = task(() => 1);
    t.displayName("My Task");
    expect(t.name).toBe("My Task");
  });

  it("supports fluent configuration and stores options under TASK_DEF", () => {
    const t = task(() => 1)
      .lane("gpu")
      .cache("none")
      .tags(["render", "frame"])
      .displayName("Draw");

    const def = (t as any)[TASK_DEF] as { options: Record<string, unknown> };
    expect(def.options.lane).toBe("gpu");
    expect(def.options.cache).toBe("none");
    expect(def.options.tags).toEqual(["render", "frame"]);
    expect(t.name).toBe("Draw");
  });

  it("stores the compute function under TASK_DEF", async () => {
    const p = param(41);

    const t = task((get, work) => work(() => get(p) + 1));

    const def = (t as any)[TASK_DEF] as {
      compute: (get: Getter, work: (fn: () => unknown) => unknown, ctx: TaskContext) => unknown;
    };

    const get: Getter = <T>(ref: any) => {
      if (ref.kind === "param") return ref.get() as T;
      throw new Error("unexpected");
    };

    const ctx: TaskContext = {
      lane: "cpu",
      signal: new AbortController().signal,
      now: () => 0,
      scope: { use: (value) => value, adopt: (value) => value, defer: () => {} },
      teardownPrevious: async () => {},
    };
    expect(await def.compute(get, (fn: any) => fn(), ctx)).toBe(42);
  });

  it("has one teardown, which must be a function", () => {
    const t = task(() => ({ close() {} })).teardown((value) => value.close());
    expect(() => t.teardown(() => {})).toThrow(/already called/);
    expect(() => task(() => 1).teardown(undefined as any)).toThrow(TypeError);
  });

  it("types the previous value passed to work()", () => {
    const sync = task((_get, work) =>
      work((prev: { id: number } | undefined) => prev ?? { id: 1 }),
    );
    expectTypeOf(sync).toExtend<TaskRef<{ id: number }>>();

    const async = task((_get, work) =>
      work(async (prev: { id: number } | undefined) => prev ?? { id: 1 }),
    );
    expectTypeOf(async).toExtend<TaskRef<{ id: number }>>();

    // A previous value of another type than the one returned is refused.
    task((_get, work) =>
      // @ts-expect-error prev is a number here, not a string
      work((prev: string | undefined) => (prev ? 1 : 2)),
    );
  });

  it("preserves output typing for the TS server/linter", () => {
    const a = task(() => ({ someValue: 123 }));

    expectTypeOf(a).toExtend<TaskRef<{ someValue: number }>>();
    type AOut = typeof a extends TaskRef<infer T> ? T : never;
    expectTypeOf<AOut>().toEqualTypeOf<{ someValue: number }>();
  });
});
