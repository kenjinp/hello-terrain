import { describe, expect, it } from "vitest";
import { semaphore } from "./semaphore";

describe("semaphore()", () => {
  it("acquires immediately when permits are available, and blocks when exhausted", async () => {
    const sem = semaphore(1);

    const release1 = await sem.acquire();

    let acquired2 = false;
    const p2 = sem.acquire().then((release) => {
      acquired2 = true;
      return release;
    });

    await Promise.resolve();
    expect(acquired2).toBe(false);

    release1();
    const release2 = await p2;
    expect(acquired2).toBe(true);
    release2();
  });

  it("allows up to N concurrent permits", async () => {
    const sem = semaphore(2);

    const release1 = await sem.acquire();
    const release2 = await sem.acquire();

    let acquired3 = false;
    const p3 = sem.acquire().then((release) => {
      acquired3 = true;
      return release;
    });

    await Promise.resolve();
    expect(acquired3).toBe(false);

    release1();
    const release3 = await p3;
    expect(acquired3).toBe(true);

    release2();
    release3();
  });

  it("serves waiters in FIFO order", async () => {
    const sem = semaphore(1);
    const release0 = await sem.acquire();

    const order: string[] = [];
    const p1 = sem.acquire().then((release) => {
      order.push("p1");
      return release;
    });
    const p2 = sem.acquire().then((release) => {
      order.push("p2");
      return release;
    });

    await Promise.resolve();
    expect(order).toEqual([]);

    release0();
    const release1 = await p1;
    expect(order).toEqual(["p1"]);

    release1();
    const release2 = await p2;
    expect(order).toEqual(["p1", "p2"]);
    release2();
  });

  it("floors permits and clamps to at least 1", async () => {
    const sem = semaphore(1.9);

    const release1 = await sem.acquire();

    let acquired2 = false;
    const p2 = sem.acquire().then((release) => {
      acquired2 = true;
      return release;
    });

    await Promise.resolve();
    expect(acquired2).toBe(false);

    release1();
    const release2 = await p2;
    expect(acquired2).toBe(true);
    release2();
  });

  it("treats NaN permits as 1", async () => {
    const sem = semaphore(Number.NaN);

    const release1 = await sem.acquire();

    let acquired2 = false;
    const p2 = sem.acquire().then((release) => {
      acquired2 = true;
      return release;
    });

    await Promise.resolve();
    expect(acquired2).toBe(false);

    release1();
    const release2 = await p2;
    expect(acquired2).toBe(true);
    release2();
  });
});

