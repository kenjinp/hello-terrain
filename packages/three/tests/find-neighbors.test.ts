import { beforeEach, describe, expect, it } from "vitest";
import {
  SpatialIndex,
  buildSpatialIndex,
  computeNeighborPosition,
  decodeKey,
  encodeKey,
} from "../src/quadtree/find-neighbors";
import {
  Direction,
  Quadtree,
  type QuadtreeParams,
  type ShouldSubdivideContext,
} from "../src/quadtree/Quadtree";
import { EMPTY_SENTINEL_VALUE, QuadtreeNodeView } from "../src/quadtree/QuadtreeNodeView";

describe("find-neighbors", () => {
  describe("encodeKey / decodeKey", () => {
    it("encodes and decodes level, x, y correctly", () => {
      const testCases = [
        { level: 0, x: 0, y: 0 },
        { level: 5, x: 10, y: 15 },
        { level: 31, x: 8191, y: 8191 }, // Max values
        { level: 3, x: 7, y: 7 },
        { level: 10, x: 512, y: 256 },
      ];

      for (const { level, x, y } of testCases) {
        const key = encodeKey(level, x, y);
        const decoded = decodeKey(key);
        expect(decoded.level).toBe(level);
        expect(decoded.x).toBe(x);
        expect(decoded.y).toBe(y);
      }
    });

    it("produces unique keys for different inputs", () => {
      const keys = new Set<number>();
      for (let level = 0; level < 5; level++) {
        for (let x = 0; x < 10; x++) {
          for (let y = 0; y < 10; y++) {
            const key = encodeKey(level, x, y);
            expect(keys.has(key)).toBe(false);
            keys.add(key);
          }
        }
      }
    });
  });

  describe("SpatialIndex", () => {
    let spatialIndex: SpatialIndex;

    beforeEach(() => {
      spatialIndex = new SpatialIndex(100);
    });

    it("inserts and looks up nodes correctly", () => {
      spatialIndex.insert(0, 0, 0, 0);
      spatialIndex.insert(1, 0, 0, 1);
      spatialIndex.insert(1, 1, 0, 2);
      spatialIndex.insert(1, 0, 1, 3);
      spatialIndex.insert(1, 1, 1, 4);

      expect(spatialIndex.lookup(0, 0, 0)).toBe(0);
      expect(spatialIndex.lookup(1, 0, 0)).toBe(1);
      expect(spatialIndex.lookup(1, 1, 0)).toBe(2);
      expect(spatialIndex.lookup(1, 0, 1)).toBe(3);
      expect(spatialIndex.lookup(1, 1, 1)).toBe(4);
    });

    it("returns EMPTY_SENTINEL_VALUE for missing nodes", () => {
      spatialIndex.insert(0, 0, 0, 0);
      expect(spatialIndex.lookup(1, 5, 5)).toBe(EMPTY_SENTINEL_VALUE);
      expect(spatialIndex.lookup(10, 0, 0)).toBe(EMPTY_SENTINEL_VALUE);
    });

    it("has() returns correct boolean", () => {
      spatialIndex.insert(0, 0, 0, 0);
      expect(spatialIndex.has(0, 0, 0)).toBe(true);
      expect(spatialIndex.has(1, 0, 0)).toBe(false);
    });

    it("tracks count correctly", () => {
      expect(spatialIndex.getCount()).toBe(0);
      spatialIndex.insert(0, 0, 0, 0);
      expect(spatialIndex.getCount()).toBe(1);
      spatialIndex.insert(1, 0, 0, 1);
      expect(spatialIndex.getCount()).toBe(2);
    });

    it("clear() removes all entries", () => {
      spatialIndex.insert(0, 0, 0, 0);
      spatialIndex.insert(1, 0, 0, 1);
      expect(spatialIndex.getCount()).toBe(2);

      spatialIndex.clear();
      expect(spatialIndex.getCount()).toBe(0);
      expect(spatialIndex.lookup(0, 0, 0)).toBe(EMPTY_SENTINEL_VALUE);
    });

    it("handles hash collisions via linear probing", () => {
      // Insert many nodes to force collisions
      for (let i = 0; i < 50; i++) {
        spatialIndex.insert(0, i, 0, i);
      }

      // All should be retrievable
      for (let i = 0; i < 50; i++) {
        expect(spatialIndex.lookup(0, i, 0)).toBe(i);
      }
    });

    it("getBuffers() returns typed arrays", () => {
      const buffers = spatialIndex.getBuffers();
      expect(buffers.keys).toBeInstanceOf(Uint32Array);
      expect(buffers.values).toBeInstanceOf(Uint16Array);
    });
  });

  describe("computeNeighborPosition", () => {
    it("computes LEFT neighbor correctly", () => {
      expect(computeNeighborPosition(2, 1, 1, Direction.LEFT)).toEqual([2, 0, 1]);
      expect(computeNeighborPosition(3, 5, 3, Direction.LEFT)).toEqual([3, 4, 3]);
    });

    it("computes RIGHT neighbor correctly", () => {
      expect(computeNeighborPosition(2, 1, 1, Direction.RIGHT)).toEqual([2, 2, 1]);
      expect(computeNeighborPosition(3, 5, 3, Direction.RIGHT)).toEqual([3, 6, 3]);
    });

    it("computes TOP neighbor correctly", () => {
      expect(computeNeighborPosition(2, 1, 1, Direction.TOP)).toEqual([2, 1, 0]);
      expect(computeNeighborPosition(3, 5, 3, Direction.TOP)).toEqual([3, 5, 2]);
    });

    it("computes BOTTOM neighbor correctly", () => {
      expect(computeNeighborPosition(2, 1, 1, Direction.BOTTOM)).toEqual([2, 1, 2]);
      expect(computeNeighborPosition(3, 5, 3, Direction.BOTTOM)).toEqual([3, 5, 4]);
    });

    it("returns null for negative coordinates (left boundary)", () => {
      expect(computeNeighborPosition(2, 0, 1, Direction.LEFT)).toBeNull();
    });

    it("returns null for negative coordinates (top boundary)", () => {
      expect(computeNeighborPosition(2, 1, 0, Direction.TOP)).toBeNull();
    });

    it("returns null for coordinates exceeding max (right boundary)", () => {
      // At level 2, max coordinate is 3 (2^2 - 1)
      expect(computeNeighborPosition(2, 3, 1, Direction.RIGHT)).toBeNull();
    });

    it("returns null for coordinates exceeding max (bottom boundary)", () => {
      // At level 2, max coordinate is 3 (2^2 - 1)
      expect(computeNeighborPosition(2, 1, 3, Direction.BOTTOM)).toBeNull();
    });
  });

  describe("Quadtree neighbor finding integration", () => {
    const defaultConfig: QuadtreeParams = {
      maxLevel: 5,
      rootSize: 1000,
      minNodeSize: 31.25,
      origin: { x: 0, y: 0, z: 0 },
      maxNodes: 1000,
    };

    describe("same-level neighbors", () => {
      it("finds sibling neighbors after one subdivision", () => {
        // Subdivide root once to get 4 children
        const subdivideOnce = (...ctx: ShouldSubdivideContext) => ctx[2] === 0;
        const quadtree = new Quadtree(defaultConfig, subdivideOnce);
        quadtree.update({ x: 0, y: 0, z: 0 });

        // After subdivision, we have:
        // Child 0: (1, 0, 0) - top-left
        // Child 1: (1, 1, 0) - top-right
        // Child 2: (1, 0, 1) - bottom-left
        // Child 3: (1, 1, 1) - bottom-right

        // Node 1 (top-left) should have node 2 (top-right) as RIGHT neighbor
        const rightNeighbor = quadtree.findNeighbor(1, Direction.RIGHT);
        expect(rightNeighbor).toBe(2);

        // Node 1 (top-left) should have node 3 (bottom-left) as BOTTOM neighbor
        const bottomNeighbor = quadtree.findNeighbor(1, Direction.BOTTOM);
        expect(bottomNeighbor).toBe(3);

        // Node 1 (top-left) should have no LEFT neighbor (boundary)
        const leftNeighbor = quadtree.findNeighbor(1, Direction.LEFT);
        expect(leftNeighbor).toBe(EMPTY_SENTINEL_VALUE);

        // Node 1 (top-left) should have no TOP neighbor (boundary)
        const topNeighbor = quadtree.findNeighbor(1, Direction.TOP);
        expect(topNeighbor).toBe(EMPTY_SENTINEL_VALUE);
      });
    });

    describe("coarser neighbors (larger tiles)", () => {
      it("finds coarser neighbor when querying finer node", () => {
        // Subdivide only the top-left quadrant
        const subdivideTopLeft = (...ctx: ShouldSubdivideContext) => {
          const [, , level, , , , nodeX, nodeY] = ctx;
          // Subdivide root, then only subdivide child at (0, 0)
          if (level === 0) return true;
          if (level === 1 && nodeX === 0 && nodeY === 0) return true;
          return false;
        };

        const quadtree = new Quadtree(defaultConfig, subdivideTopLeft);
        quadtree.update({ x: -400, y: 0, z: -400 }); // Near top-left corner

        // Now we should have:
        // Root (0) subdivided into 4 children
        // Child at (0,0) subdivided further into 4 grandchildren
        // Other 3 children remain as leaves

        // A grandchild at level 2 on the right edge of the top-left quadrant
        // should have a coarser neighbor (level 1) to its right
        const spatialIndex = quadtree.getSpatialIndex();
        const nodeView = quadtree.getNodeView();

        // Find a level-2 node on the right edge of top-left quadrant
        // That would be (level=2, x=1, y=0) or (level=2, x=1, y=1)
        const level2RightNode = spatialIndex.lookup(2, 1, 0);
        if (level2RightNode !== EMPTY_SENTINEL_VALUE && nodeView.getLeaf(level2RightNode)) {
          // Its RIGHT neighbor should be the level-1 node at (1, 0)
          const rightNeighbor = quadtree.findNeighbor(level2RightNode, Direction.RIGHT);
          // This should be a single coarser node
          expect(typeof rightNeighbor).toBe("number");
          if (typeof rightNeighbor === "number" && rightNeighbor !== EMPTY_SENTINEL_VALUE) {
            expect(nodeView.getLevel(rightNeighbor)).toBe(1);
          }
        }
      });
    });

    describe("finer neighbors (smaller tiles)", () => {
      it("finds multiple finer neighbors when neighbor has children", () => {
        // Create asymmetric subdivision: right side more subdivided than left
        const subdivideRight = (...ctx: ShouldSubdivideContext) => {
          const [, , level, , , , nodeX] = ctx;
          // Subdivide root
          if (level === 0) return true;
          // Subdivide right children (x=1) at level 1
          if (level === 1 && nodeX === 1) return true;
          return false;
        };

        const quadtree = new Quadtree(defaultConfig, subdivideRight);
        quadtree.update({ x: 400, y: 0, z: 0 }); // Near right side

        // Now left side has level-1 leaves, right side has level-2 leaves

        const spatialIndex = quadtree.getSpatialIndex();
        const nodeView = quadtree.getNodeView();

        // Find the level-1 leaf on the left side (x=0, y=0)
        const leftNode = spatialIndex.lookup(1, 0, 0);
        if (leftNode !== EMPTY_SENTINEL_VALUE && nodeView.getLeaf(leftNode)) {
          // Its RIGHT neighbor should be multiple level-2 nodes
          const rightNeighbor = quadtree.findNeighbor(leftNode, Direction.RIGHT);
          // Should be an array of finer neighbors
          expect(Array.isArray(rightNeighbor)).toBe(true);
          if (Array.isArray(rightNeighbor)) {
            expect(rightNeighbor.length).toBeGreaterThan(0);
            // All should be leaves at level 2
            for (const idx of rightNeighbor) {
              expect(nodeView.getLeaf(idx)).toBe(true);
              expect(nodeView.getLevel(idx)).toBe(2);
            }
          }
        }
      });
    });

    describe("boundary conditions", () => {
      it("returns EMPTY_SENTINEL_VALUE for all boundary edges of root", () => {
        const neverSubdivide = () => false;
        const quadtree = new Quadtree(defaultConfig, neverSubdivide);
        quadtree.update({ x: 0, y: 0, z: 0 });

        // Root node (index 0) should have no neighbors
        expect(quadtree.findNeighbor(0, Direction.LEFT)).toBe(EMPTY_SENTINEL_VALUE);
        expect(quadtree.findNeighbor(0, Direction.RIGHT)).toBe(EMPTY_SENTINEL_VALUE);
        expect(quadtree.findNeighbor(0, Direction.TOP)).toBe(EMPTY_SENTINEL_VALUE);
        expect(quadtree.findNeighbor(0, Direction.BOTTOM)).toBe(EMPTY_SENTINEL_VALUE);
      });

      it("correctly identifies boundary nodes after subdivision", () => {
        const subdivideOnce = (...ctx: ShouldSubdivideContext) => ctx[2] === 0;
        const quadtree = new Quadtree(defaultConfig, subdivideOnce);
        quadtree.update({ x: 0, y: 0, z: 0 });

        // Top-left child (node 1) should have no LEFT or TOP neighbors
        expect(quadtree.findNeighbor(1, Direction.LEFT)).toBe(EMPTY_SENTINEL_VALUE);
        expect(quadtree.findNeighbor(1, Direction.TOP)).toBe(EMPTY_SENTINEL_VALUE);

        // Bottom-right child (node 4) should have no RIGHT or BOTTOM neighbors
        expect(quadtree.findNeighbor(4, Direction.RIGHT)).toBe(EMPTY_SENTINEL_VALUE);
        expect(quadtree.findNeighbor(4, Direction.BOTTOM)).toBe(EMPTY_SENTINEL_VALUE);
      });
    });

    describe("findAllNeighbors", () => {
      it("returns all four neighbors at once", () => {
        const subdivideOnce = (...ctx: ShouldSubdivideContext) => ctx[2] === 0;
        const quadtree = new Quadtree(defaultConfig, subdivideOnce);
        quadtree.update({ x: 0, y: 0, z: 0 });

        // Check center-ish node (top-right, node 2)
        const neighbors = quadtree.findAllNeighbors(2);

        expect(neighbors).toHaveProperty("left");
        expect(neighbors).toHaveProperty("right");
        expect(neighbors).toHaveProperty("top");
        expect(neighbors).toHaveProperty("bottom");

        // Node 2 (top-right) should have:
        // - LEFT: node 1 (top-left)
        // - RIGHT: boundary
        // - TOP: boundary
        // - BOTTOM: node 4 (bottom-right)
        expect(neighbors.left).toBe(1);
        expect(neighbors.right).toBe(EMPTY_SENTINEL_VALUE);
        expect(neighbors.top).toBe(EMPTY_SENTINEL_VALUE);
        expect(neighbors.bottom).toBe(4);
      });
    });

    describe("spatial index lazy building", () => {
      it("builds spatial index on first neighbor query", () => {
        const quadtree = new Quadtree(defaultConfig, () => false);
        quadtree.update({ x: 0, y: 0, z: 0 });

        // First call to findNeighbor should build the index
        quadtree.findNeighbor(0, Direction.LEFT);

        // Spatial index should be populated
        const spatialIndex = quadtree.getSpatialIndex();
        expect(spatialIndex.getCount()).toBeGreaterThan(0);
      });

      it("rebuilds spatial index after update", () => {
        const subdivideOnce = (...ctx: ShouldSubdivideContext) => ctx[2] === 0;
        const quadtree = new Quadtree(defaultConfig, subdivideOnce);

        quadtree.update({ x: 0, y: 0, z: 0 });
        quadtree.findNeighbor(1, Direction.RIGHT); // Build index

        const countBefore = quadtree.getSpatialIndex().getCount();

        // Update with different subdivision
        quadtree.subdivisionStrategy = () => false;
        quadtree.update({ x: 0, y: 0, z: 0 });

        // Force rebuild
        quadtree.findNeighbor(0, Direction.LEFT);
        const countAfter = quadtree.getSpatialIndex().getCount();

        // Should have fewer nodes (no subdivision)
        expect(countAfter).toBeLessThan(countBefore);
      });
    });
  });

  describe("buildSpatialIndex", () => {
    it("builds index from NodeView", () => {
      const nodeView = new QuadtreeNodeView(10);

      // Manually set up some nodes
      nodeView.setLevel(0, 0);
      nodeView.setX(0, 0);
      nodeView.setY(0, 0);

      nodeView.setLevel(1, 1);
      nodeView.setX(1, 0);
      nodeView.setY(1, 0);

      nodeView.setLevel(2, 1);
      nodeView.setX(2, 1);
      nodeView.setY(2, 0);

      const spatialIndex = buildSpatialIndex(nodeView, 3);

      expect(spatialIndex.lookup(0, 0, 0)).toBe(0);
      expect(spatialIndex.lookup(1, 0, 0)).toBe(1);
      expect(spatialIndex.lookup(1, 1, 0)).toBe(2);
    });
  });
});
