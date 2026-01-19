import { describe, expect, it } from "vitest";
import {
  QuadtreeNodeView,
  EMPTY_SENTINEL_VALUE,
} from "../src/quadtree/QuadtreeNodeView.js";

describe("QuadtreeNodeView", () => {
  describe("construction", () => {
    it("creates buffers with correct sizes", () => {
      const maxNodes = 100;
      const view = new QuadtreeNodeView(maxNodes);

      expect(view.getMaxNodeCount()).toBe(maxNodes);

      const buffers = view.getBuffers();
      expect(buffers.childrenIndicesBuffer.length).toBe(maxNodes * 4);
      expect(buffers.neighborsIndicesBuffer.length).toBe(maxNodes * 4);
      expect(buffers.nodeBuffer.length).toBe(maxNodes * 4);
      expect(buffers.leafNodeMask.length).toBe(maxNodes);
    });

    it("initializes with sentinel values after construction", () => {
      const view = new QuadtreeNodeView(10);
      const buffers = view.getBuffers();

      // Children and neighbors should be filled with sentinel values
      for (let i = 0; i < buffers.childrenIndicesBuffer.length; i++) {
        expect(buffers.childrenIndicesBuffer[i]).toBe(EMPTY_SENTINEL_VALUE);
      }
      for (let i = 0; i < buffers.neighborsIndicesBuffer.length; i++) {
        expect(buffers.neighborsIndicesBuffer[i]).toBe(EMPTY_SENTINEL_VALUE);
      }
    });

    it("accepts pre-allocated buffers", () => {
      const maxNodes = 50;
      const childrenBuffer = new Uint16Array(maxNodes * 4);
      const neighborsBuffer = new Uint16Array(maxNodes * 4);
      const nodeBuffer = new Int32Array(maxNodes * 4);
      const leafMask = new Uint8Array(maxNodes);
      const leafCount = new Uint16Array(1);

      const view = new QuadtreeNodeView(
        maxNodes,
        childrenBuffer,
        neighborsBuffer,
        nodeBuffer,
        leafMask,
        leafCount
      );

      const buffers = view.getBuffers();
      expect(buffers.childrenIndicesBuffer).toBe(childrenBuffer);
      expect(buffers.neighborsIndicesBuffer).toBe(neighborsBuffer);
      expect(buffers.nodeBuffer).toBe(nodeBuffer);
      expect(buffers.leafNodeMask).toBe(leafMask);
    });
  });

  describe("level/x/y getters and setters", () => {
    it("sets and gets level correctly", () => {
      const view = new QuadtreeNodeView(10);

      view.setLevel(0, 5);
      view.setLevel(1, 3);
      view.setLevel(9, 7);

      expect(view.getLevel(0)).toBe(5);
      expect(view.getLevel(1)).toBe(3);
      expect(view.getLevel(9)).toBe(7);
    });

    it("sets and gets x correctly", () => {
      const view = new QuadtreeNodeView(10);

      view.setX(0, 10);
      view.setX(1, 20);
      view.setX(9, 30);

      expect(view.getX(0)).toBe(10);
      expect(view.getX(1)).toBe(20);
      expect(view.getX(9)).toBe(30);
    });

    it("sets and gets y correctly", () => {
      const view = new QuadtreeNodeView(10);

      view.setY(0, 100);
      view.setY(1, 200);
      view.setY(9, 300);

      expect(view.getY(0)).toBe(100);
      expect(view.getY(1)).toBe(200);
      expect(view.getY(9)).toBe(300);
    });

    it("stores level, x, y independently per node", () => {
      const view = new QuadtreeNodeView(10);

      // Set values for node 0
      view.setLevel(0, 1);
      view.setX(0, 2);
      view.setY(0, 3);

      // Set values for node 1
      view.setLevel(1, 4);
      view.setX(1, 5);
      view.setY(1, 6);

      // Verify they don't interfere
      expect(view.getLevel(0)).toBe(1);
      expect(view.getX(0)).toBe(2);
      expect(view.getY(0)).toBe(3);
      expect(view.getLevel(1)).toBe(4);
      expect(view.getX(1)).toBe(5);
      expect(view.getY(1)).toBe(6);
    });
  });

  describe("leaf node management", () => {
    it("initially all nodes are not leaves", () => {
      const view = new QuadtreeNodeView(10);

      for (let i = 0; i < 10; i++) {
        expect(view.getLeaf(i)).toBe(false);
      }
      expect(view.getLeafNodeCount()).toBe(0);
    });

    it("sets and gets leaf status", () => {
      const view = new QuadtreeNodeView(10);

      view.setLeaf(0, true);
      view.setLeaf(5, true);

      expect(view.getLeaf(0)).toBe(true);
      expect(view.getLeaf(5)).toBe(true);
      expect(view.getLeaf(1)).toBe(false);
    });

    it("tracks leaf node count correctly", () => {
      const view = new QuadtreeNodeView(10);

      view.setLeaf(0, true);
      expect(view.getLeafNodeCount()).toBe(1);

      view.setLeaf(1, true);
      expect(view.getLeafNodeCount()).toBe(2);

      view.setLeaf(0, false);
      expect(view.getLeafNodeCount()).toBe(1);

      view.setLeaf(1, false);
      expect(view.getLeafNodeCount()).toBe(0);
    });

    it("does not double-count when setting leaf to same value", () => {
      const view = new QuadtreeNodeView(10);

      view.setLeaf(0, true);
      view.setLeaf(0, true);
      expect(view.getLeafNodeCount()).toBe(1);

      view.setLeaf(0, false);
      view.setLeaf(0, false);
      expect(view.getLeafNodeCount()).toBe(0);
    });

    it("clears children when setting node as leaf", () => {
      const view = new QuadtreeNodeView(10);

      // Set some children
      view.setChildren(0, [1, 2, 3, 4]);

      // Mark as leaf should clear children
      view.setLeaf(0, true);

      const children = view.getChildren(0);
      expect(children).toEqual([
        EMPTY_SENTINEL_VALUE,
        EMPTY_SENTINEL_VALUE,
        EMPTY_SENTINEL_VALUE,
        EMPTY_SENTINEL_VALUE,
      ]);
    });

    it("tracks active leaf indices correctly", () => {
      const view = new QuadtreeNodeView(10);

      view.setLeaf(2, true);
      view.setLeaf(5, true);
      view.setLeaf(7, true);

      const { indices, count } = view.getActiveLeafNodeIndices();
      expect(count).toBe(3);

      const activeIndices = Array.from(indices.slice(0, count));
      expect(activeIndices).toContain(2);
      expect(activeIndices).toContain(5);
      expect(activeIndices).toContain(7);
    });
  });

  describe("children management", () => {
    it("sets and gets children correctly", () => {
      const view = new QuadtreeNodeView(10);

      view.setChildren(0, [1, 2, 3, 4]);
      view.setChildren(5, [6, 7, 8, 9]);

      expect(view.getChildren(0)).toEqual([1, 2, 3, 4]);
      expect(view.getChildren(5)).toEqual([6, 7, 8, 9]);
    });

    it("handles sentinel values for missing children", () => {
      const view = new QuadtreeNodeView(10);

      view.setChildren(0, [
        1,
        EMPTY_SENTINEL_VALUE,
        3,
        EMPTY_SENTINEL_VALUE,
      ]);

      const children = view.getChildren(0);
      expect(children[0]).toBe(1);
      expect(children[1]).toBe(EMPTY_SENTINEL_VALUE);
      expect(children[2]).toBe(3);
      expect(children[3]).toBe(EMPTY_SENTINEL_VALUE);
    });
  });

  describe("neighbors management", () => {
    it("sets and gets neighbors correctly", () => {
      const view = new QuadtreeNodeView(10);

      view.setNeighbors(0, [1, 2, 3, 4]); // [left, right, top, bottom]
      view.setNeighbors(5, [6, 7, 8, 9]);

      expect(view.getNeighbors(0)).toEqual([1, 2, 3, 4]);
      expect(view.getNeighbors(5)).toEqual([6, 7, 8, 9]);
    });

    it("handles sentinel values for missing neighbors", () => {
      const view = new QuadtreeNodeView(10);

      view.setNeighbors(0, [
        EMPTY_SENTINEL_VALUE,
        2,
        EMPTY_SENTINEL_VALUE,
        4,
      ]);

      const neighbors = view.getNeighbors(0);
      expect(neighbors[0]).toBe(EMPTY_SENTINEL_VALUE);
      expect(neighbors[1]).toBe(2);
      expect(neighbors[2]).toBe(EMPTY_SENTINEL_VALUE);
      expect(neighbors[3]).toBe(4);
    });
  });

  describe("clear", () => {
    it("resets all buffers to initial state", () => {
      const view = new QuadtreeNodeView(10);

      // Set various values
      view.setLevel(0, 5);
      view.setX(0, 10);
      view.setY(0, 20);
      view.setLeaf(0, true);
      view.setLeaf(1, true);
      view.setChildren(0, [1, 2, 3, 4]);
      view.setNeighbors(0, [5, 6, 7, 8]);

      // Clear
      view.clear();

      // Verify reset
      expect(view.getLevel(0)).toBe(0);
      expect(view.getX(0)).toBe(0);
      expect(view.getY(0)).toBe(0);
      expect(view.getLeaf(0)).toBe(false);
      expect(view.getLeafNodeCount()).toBe(0);
      expect(view.getChildren(0)).toEqual([
        EMPTY_SENTINEL_VALUE,
        EMPTY_SENTINEL_VALUE,
        EMPTY_SENTINEL_VALUE,
        EMPTY_SENTINEL_VALUE,
      ]);
      expect(view.getNeighbors(0)).toEqual([
        EMPTY_SENTINEL_VALUE,
        EMPTY_SENTINEL_VALUE,
        EMPTY_SENTINEL_VALUE,
        EMPTY_SENTINEL_VALUE,
      ]);
    });
  });

  describe("destroy", () => {
    it("replaces buffers with zero-length arrays", () => {
      const view = new QuadtreeNodeView(10);

      view.destroy();

      expect(view.getMaxNodeCount()).toBe(0);
      const buffers = view.getBuffers();
      expect(buffers.childrenIndicesBuffer.length).toBe(0);
      expect(buffers.neighborsIndicesBuffer.length).toBe(0);
      expect(buffers.nodeBuffer.length).toBe(0);
      expect(buffers.leafNodeMask.length).toBe(0);
    });
  });

  describe("clone", () => {
    it("creates a new view with the same buffer references", () => {
      const view = new QuadtreeNodeView(10);
      const cloned = view.clone();

      // Should share the same underlying buffers (same reference)
      expect(cloned.getMaxNodeCount()).toBe(view.getMaxNodeCount());
      expect(cloned.getBuffers().nodeBuffer).toBe(view.getBuffers().nodeBuffer);
      expect(cloned.getBuffers().childrenIndicesBuffer).toBe(view.getBuffers().childrenIndicesBuffer);
      expect(cloned.getBuffers().neighborsIndicesBuffer).toBe(view.getBuffers().neighborsIndicesBuffer);
      expect(cloned.getBuffers().leafNodeMask).toBe(view.getBuffers().leafNodeMask);
    });

    it("shares buffer data between original and clone", () => {
      const view = new QuadtreeNodeView(10);
      const cloned = view.clone();

      // After clone (which clears), set values on original
      view.setLevel(0, 5);
      view.setX(0, 10);

      // Clone should see the changes since they share buffers
      expect(cloned.getLevel(0)).toBe(5);
      expect(cloned.getX(0)).toBe(10);

      // Modifying clone should also affect original
      cloned.setLevel(0, 7);
      expect(view.getLevel(0)).toBe(7);
    });
  });
});
