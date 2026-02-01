import { describe, expect, it, vi } from "vitest";
import { param } from "./param";

describe("param()", () => {
  it("exposes kind + id + get()", () => {
    const p = param(123);
    expect(p.kind).toBe("param");
    expect(typeof p.id).toBe("string");
    expect(p.id.length).toBeGreaterThan(0);
    expect(p.get()).toBe(123);
  });

  it("generates unique ids per param", () => {
    const a = param(1);
    const b = param(1);
    expect(a.id).not.toBe(b.id);
  });

  it("set() applies the callback and updates get()", () => {
    const p = param(1);
    p.set((prev) => prev + 1);
    expect(p.get()).toBe(2);
  });

  it("set() notifies subscribers with (next, prev)", () => {
    const p = param(10);
    const sub = vi.fn<(next: number, prev: number) => void>();
    p.subscribe(sub);

    p.set((prev) => prev + 5);

    expect(sub).toHaveBeenCalledTimes(1);
    expect(sub).toHaveBeenCalledWith(15, 10);
  });

  it("unsubscribe() stops notifications", () => {
    const p = param(0);
    const sub = vi.fn<(next: number, prev: number) => void>();
    const unsubscribe = p.subscribe(sub);

    p.set((prev) => prev + 1);
    unsubscribe();
    p.set((prev) => prev + 1);

    expect(sub).toHaveBeenCalledTimes(1);
    expect(sub).toHaveBeenCalledWith(1, 0);
  });

  it("supports multiple subscribers", () => {
    const p = param("a");
    const sub1 = vi.fn<(next: string, prev: string) => void>();
    const sub2 = vi.fn<(next: string, prev: string) => void>();
    p.subscribe(sub1);
    p.subscribe(sub2);

    p.set((prev) => `${prev}b`);

    expect(sub1).toHaveBeenCalledWith("ab", "a");
    expect(sub2).toHaveBeenCalledWith("ab", "a");
  });

  it("displayName() updates the exposed name", () => {
    const p = param(1);
    expect(p.name).toBeUndefined();
    p.displayName("My Param");
    expect(p.name).toBe("My Param");
  });
});
