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

    const ctx: TaskContext = { lane: "cpu", signal: new AbortController().signal, now: () => 0 };
    expect(await def.compute(get, (fn: any) => fn(), ctx)).toBe(42);
  });

  it("preserves output typing for the TS server/linter", () => {
    const a = task(() => ({ someValue: 123 }));

    expectTypeOf(a).toExtend<TaskRef<{ someValue: number }>>();
    type AOut = typeof a extends TaskRef<infer T> ? T : never;
    expectTypeOf<AOut>().toEqualTypeOf<{ someValue: number }>();
  });
});
