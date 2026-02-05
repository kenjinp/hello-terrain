import { describe, expect, it } from "vitest";
import { U32_EMPTY } from "./types.js";
import { allocNode, beginFrame, createNodeStore, ensureChildren } from "./nodeStore.js";

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

