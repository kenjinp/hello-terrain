import { describe, expect, it } from "vitest";
import { U32_EMPTY } from "./types.js";
import {
  allocNode,
  allocNodeRaw,
  beginFrame,
  createNodeStore,
  ensureChildren,
} from "./nodeStore.js";

describe("quadtree/nodeStore", () => {
  it("allocates nodes and children contiguously", () => {
    const store = createNodeStore(16, 1);
    beginFrame(store);

    const root = store.nodesUsed;
    expect(root).toBe(0);

    const rootId = allocNode(store, { space: 0, level: 0, x: 0, y: 0 });
    expect(rootId).toBe(0);

    const childBase = ensureChildren(store, rootId);
    expect(childBase).toBe(1);
    expect(store.firstChild[rootId]).toBe(1);

    // children are [1..4]
    expect(store.level[1]).toBe(1);
    expect(store.level[2]).toBe(1);
    expect(store.level[3]).toBe(1);
    expect(store.level[4]).toBe(1);

    // top-left child
    expect(store.x[1]).toBe(0);
    expect(store.y[1]).toBe(0);
    // top-right child
    expect(store.x[2]).toBe(1);
    expect(store.y[2]).toBe(0);
    // bottom-left child
    expect(store.x[3]).toBe(0);
    expect(store.y[3]).toBe(1);
    // bottom-right child
    expect(store.x[4]).toBe(1);
    expect(store.y[4]).toBe(1);
  });

  it("allocNodeRaw matches allocNode", () => {
    const store = createNodeStore(16, 2);
    beginFrame(store);

    const a = allocNode(store, { space: 1, level: 3, x: -5, y: 7 });
    const b = allocNodeRaw(store, 1, 3, -5, 7);
    expect(a).toBe(0);
    expect(b).toBe(1);

    for (const field of ["gen", "space", "level", "x", "y", "firstChild", "flags"] as const) {
      expect(store[field][b]).toBe(store[field][a]);
    }
    expect(store.firstChild[b]).toBe(U32_EMPTY);
    expect(store.x[b]).toBe(-5);
    expect(store.y[b]).toBe(7);
  });

  it("splits parents with negative coordinates into 4 contiguous children", () => {
    const store = createNodeStore(16, 1);
    beginFrame(store);

    // Infinite-flat roots can sit at negative tile coords.
    const parentId = allocNode(store, { space: 0, level: 2, x: -1, y: -3 });
    const childBase = ensureChildren(store, parentId);
    expect(childBase).toBe(1);
    expect(store.nodesUsed).toBe(5);

    // Parent x=-1 -> children x in {-2, -1}; y=-3 -> {-6, -5}.
    const expected: [number, number][] = [
      [-2, -6],
      [-1, -6],
      [-2, -5],
      [-1, -5],
    ];
    for (let i = 0; i < 4; i++) {
      const id = childBase + i;
      expect(store.level[id]).toBe(3);
      expect(store.space[id]).toBe(0);
      expect(store.x[id]).toBe(expected[i][0]);
      expect(store.y[id]).toBe(expected[i][1]);
      expect(store.firstChild[id]).toBe(U32_EMPTY);
    }

    // Idempotent: a second call returns the same children without allocating.
    expect(ensureChildren(store, parentId)).toBe(childBase);
    expect(store.nodesUsed).toBe(5);
  });

  it("refuses to allocate children when out of capacity", () => {
    const store = createNodeStore(4, 1);
    beginFrame(store);

    const rootId = allocNode(store, { space: 0, level: 0, x: 0, y: 0 });
    expect(rootId).toBe(0);

    const childBase = ensureChildren(store, rootId);
    expect(childBase).toBe(U32_EMPTY);
    expect(store.firstChild[rootId]).toBe(U32_EMPTY);
  });
});

