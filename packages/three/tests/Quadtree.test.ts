import { describe, expect, it } from "vitest";
import {
  Quadtree,
  type QuadtreeParams,
  type ShouldSubdivideContext,
  distanceBasedSubdivision,
} from "../src/quadtree/Quadtree.js";
import { QuadtreeNodeView } from "../src/quadtree/QuadtreeNodeView.js";

describe("Quadtree", () => {
  const defaultConfig: QuadtreeParams = {
    maxLevel: 5,
    rootSize: 1000,
    minNodeSize: 31.25, // 1000 / 2^5
    origin: { x: 0, y: 0, z: 0 },
    maxNodes: 1000,
  };

  describe("construction", () => {
    it("creates a quadtree with default subdivision strategy", () => {
      const quadtree = new Quadtree(defaultConfig);

      expect(quadtree.getConfig()).toBe(defaultConfig);
      expect(quadtree.getNodeCount()).toBe(1); // Root node
      expect(quadtree.getDeepestLevel()).toBe(0);
    });

    it("creates a quadtree with custom subdivision strategy", () => {
      const customStrategy = () => false;
      const quadtree = new Quadtree(defaultConfig, customStrategy);

      expect(quadtree.subdivisionStrategy).toBe(customStrategy);
    });

    it("creates a quadtree with pre-allocated node view", () => {
      const nodeView = new QuadtreeNodeView(500);
      const quadtree = new Quadtree(defaultConfig, undefined, nodeView);

      expect(quadtree.getNodeView()).toBe(nodeView);
    });

    it("initializes with root as a non-leaf", () => {
      const quadtree = new Quadtree(defaultConfig);

      // Root is created but not marked as leaf until update
      expect(quadtree.getLeafNodeCount()).toBe(0);
    });
  });

  describe("update", () => {
    it("marks root as leaf when position is far", () => {
      const neverSubdivide = () => false;
      const quadtree = new Quadtree(defaultConfig, neverSubdivide);

      const position = { x: 10000, y: 0, z: 10000 };
      quadtree.update(position);

      expect(quadtree.getLeafNodeCount()).toBe(1);
      expect(quadtree.getNodeCount()).toBe(1);
    });

    it("subdivides when position is close", () => {
      // ShouldSubdivideContext tuple: [quadtree, distance, level, nodeSize, minNodeSize, rootSize, ...]
      const alwaysSubdivide = (...ctx: ShouldSubdivideContext) => ctx[3] > ctx[4];
      const quadtree = new Quadtree(defaultConfig, alwaysSubdivide);

      const position = { x: 0, y: 0, z: 0 };
      quadtree.update(position);

      // Should have subdivided, creating more than just the root
      expect(quadtree.getNodeCount()).toBeGreaterThan(1);
    });

    it("returns the closest leaf node index", () => {
      const quadtree = new Quadtree(defaultConfig, distanceBasedSubdivision(2));

      const position = { x: 0, y: 0, z: 0 };
      const leafIndex = quadtree.update(position);

      expect(leafIndex).toBeGreaterThanOrEqual(0);
      expect(quadtree.getNodeView().getLeaf(leafIndex)).toBe(true);
    });

    it("respects maxLevel constraint", () => {
      const config: QuadtreeParams = {
        ...defaultConfig,
        maxLevel: 2,
        minNodeSize: 1, // Allow subdivision to happen
      };
      // ShouldSubdivideContext tuple: [quadtree, distance, level, nodeSize, minNodeSize, rootSize, ...]
      const alwaysSubdivide = (...ctx: ShouldSubdivideContext) => ctx[2] < 10;
      const quadtree = new Quadtree(config, alwaysSubdivide);

      const position = { x: 0, y: 0, z: 0 };
      quadtree.update(position);

      expect(quadtree.getDeepestLevel()).toBeLessThanOrEqual(2);
    });

    it("resets before each update", () => {
      const quadtree = new Quadtree(defaultConfig, distanceBasedSubdivision(2));

      // First update
      quadtree.update({ x: 0, y: 0, z: 0 });
      const count1 = quadtree.getNodeCount();

      // Second update should reset and may produce same or different count
      quadtree.update({ x: 1000, y: 0, z: 1000 });

      // Node count should be consistent for given position
      quadtree.update({ x: 0, y: 0, z: 0 });
      expect(quadtree.getNodeCount()).toBe(count1);
    });
  });

  describe("getLeafNodes", () => {
    it("returns array of leaf node objects", () => {
      const neverSubdivide = () => false;
      const quadtree = new Quadtree(defaultConfig, neverSubdivide);

      quadtree.update({ x: 0, y: 0, z: 0 });

      const leafNodes = quadtree.getLeafNodes();
      expect(leafNodes).toHaveLength(1);
      expect(leafNodes[0]).toHaveProperty("level");
      expect(leafNodes[0]).toHaveProperty("x");
      expect(leafNodes[0]).toHaveProperty("y");
    });

    it("returns multiple leaf nodes after subdivision", () => {
      // ShouldSubdivideContext tuple: [quadtree, distance, level, nodeSize, minNodeSize, rootSize, ...]
      const subdivideOnce = (...ctx: ShouldSubdivideContext) => ctx[2] === 0;
      const quadtree = new Quadtree(defaultConfig, subdivideOnce);

      quadtree.update({ x: 0, y: 0, z: 0 });

      const leafNodes = quadtree.getLeafNodes();
      expect(leafNodes.length).toBe(4); // 4 children of root
    });
  });

  describe("getActiveLeafNodeIndices", () => {
    it("returns indices and count for active leaves", () => {
      const neverSubdivide = () => false;
      const quadtree = new Quadtree(defaultConfig, neverSubdivide);

      quadtree.update({ x: 0, y: 0, z: 0 });

      const { indices, count } = quadtree.getActiveLeafNodeIndices();
      expect(count).toBe(1);
      expect(indices).toBeInstanceOf(Uint16Array);
    });
  });

  describe("subdivisionStrategy", () => {
    it("changes the subdivision strategy", () => {
      const initialStrategy = () => false;
      // ShouldSubdivideContext tuple: [quadtree, distance, level, nodeSize, minNodeSize, rootSize, ...]
      const newStrategy = (...ctx: ShouldSubdivideContext) => ctx[2] === 0;
      const quadtree = new Quadtree(defaultConfig, initialStrategy);

      quadtree.update({ x: 0, y: 0, z: 0 });
      expect(quadtree.getNodeCount()).toBe(1);

      quadtree.subdivisionStrategy = newStrategy;
      quadtree.update({ x: 0, y: 0, z: 0 });
      expect(quadtree.getNodeCount()).toBe(5); // 1 root + 4 children
    });

    it("subdivisionStrategy property returns current strategy", () => {
      const strategy = () => false;
      const quadtree = new Quadtree(defaultConfig, strategy);

      expect(quadtree.subdivisionStrategy).toBe(strategy);
    });
  });

  describe("reset", () => {
    it("resets quadtree to initial state", () => {
      // ShouldSubdivideContext tuple: [quadtree, distance, level, nodeSize, minNodeSize, rootSize, ...]
      const subdivideOnce = (...ctx: ShouldSubdivideContext) => ctx[2] === 0;
      const quadtree = new Quadtree(defaultConfig, subdivideOnce);

      quadtree.update({ x: 0, y: 0, z: 0 });
      expect(quadtree.getNodeCount()).toBeGreaterThan(1);

      quadtree.reset();
      expect(quadtree.getNodeCount()).toBe(1);
      expect(quadtree.getDeepestLevel()).toBe(0);
    });
  });

  describe("destroy", () => {
    it("releases resources", () => {
      const quadtree = new Quadtree(defaultConfig);

      quadtree.destroy();

      expect(quadtree.getNodeCount()).toBe(0);
      expect(quadtree.getDeepestLevel()).toBe(0);
    });
  });

  describe("setConfig", () => {
    it("updates configuration without reset", () => {
      const quadtree = new Quadtree(defaultConfig);

      const newConfig: QuadtreeParams = {
        ...defaultConfig,
        rootSize: 2000,
      };

      quadtree.setConfig(newConfig);
      expect(quadtree.getConfig()).toBe(newConfig);
    });

    it("resets when reset flag is true", () => {
      // ShouldSubdivideContext tuple: [quadtree, distance, level, nodeSize, minNodeSize, rootSize, ...]
      const subdivideOnce = (...ctx: ShouldSubdivideContext) => ctx[2] === 0;
      const quadtree = new Quadtree(defaultConfig, subdivideOnce);

      quadtree.update({ x: 0, y: 0, z: 0 });
      expect(quadtree.getNodeCount()).toBeGreaterThan(1);

      const newConfig: QuadtreeParams = {
        ...defaultConfig,
        rootSize: 2000,
      };

      quadtree.setConfig(newConfig, true);
      expect(quadtree.getNodeCount()).toBe(1);
    });
  });

  describe("maxNodes constraint", () => {
    it("gracefully caps subdivision when maxNodes is reached", () => {
      const config: QuadtreeParams = {
        ...defaultConfig,
        maxNodes: 10,
        minNodeSize: 1,
      };
      // ShouldSubdivideContext tuple: [quadtree, distance, level, nodeSize, minNodeSize, rootSize, ...]
      const alwaysSubdivide = (...ctx: ShouldSubdivideContext) => ctx[2] < 10;
      const quadtree = new Quadtree(config, alwaysSubdivide);

      quadtree.update({ x: 0, y: 0, z: 0 });

      // Should not exceed maxNodes
      expect(quadtree.getNodeCount()).toBeLessThanOrEqual(10);
      // Should still have valid leaf nodes
      expect(quadtree.getLeafNodeCount()).toBeGreaterThan(0);
    });
  });

  describe("origin offset", () => {
    it("respects custom origin", () => {
      const config: QuadtreeParams = {
        ...defaultConfig,
        origin: { x: 500, y: 100, z: 500 },
      };
      const quadtree = new Quadtree(config, distanceBasedSubdivision(2));

      // Position at origin should have expected behavior
      const position = { x: 500, y: 100, z: 500 };
      quadtree.update(position);

      expect(quadtree.getNodeCount()).toBeGreaterThan(0);
    });
  });

  describe("custom strategies", () => {
    it("can access quadtree config and nodeView from strategy", () => {
      // Track calls to verify strategy receives quadtree
      let configAccessed = false;
      let nodeViewAccessed = false;

      const customStrategy = (
        qt: InstanceType<typeof Quadtree>,
        distance: number,
        level: number,
        nodeSize: number,
        minNodeSize: number,
      ) => {
        // Access config from quadtree
        const config = qt.getConfig();
        if (config.rootSize === 1000) {
          configAccessed = true;
        }

        // Access nodeView from quadtree
        const nodeView = qt.getNodeView();
        if (nodeView) {
          nodeViewAccessed = true;
        }

        // Simple subdivision logic
        return distance < nodeSize * 2 && nodeSize > minNodeSize;
      };

      const quadtree = new Quadtree(defaultConfig, customStrategy);
      quadtree.update({ x: 0, y: 0, z: 0 });

      expect(configAccessed).toBe(true);
      expect(nodeViewAccessed).toBe(true);
    });

    it("can implement frustum culling with closure pattern", () => {
      // Simulate a simple frustum check using a bounding box
      // In real usage, you'd use THREE.Frustum and THREE.Box3
      interface SimpleFrustum {
        containsPoint: (x: number, z: number) => boolean;
      }

      // Create a frustum that only includes nodes where x > 0 and z > 0
      const mockFrustum: SimpleFrustum = {
        containsPoint: (x: number, z: number) => x > 0 && z > 0,
      };

      // Factory function that creates a strategy with frustum access via closure
      function createFrustumCullingStrategy(frustum: SimpleFrustum, baseFactor: number) {
        return (
          qt: InstanceType<typeof Quadtree>,
          distance: number,
          level: number,
          nodeSize: number,
          minNodeSize: number,
          _rootSize: number,
          _nodeX: number,
          _nodeY: number,
          _minX: number,
          _minY: number,
          worldX: number,
          worldY: number,
        ) => {
          // Check if node center is in frustum
          if (!frustum.containsPoint(worldX, worldY)) {
            // Node is outside frustum, don't subdivide
            return false;
          }

          // Normal distance-based subdivision for nodes in frustum
          if (nodeSize <= minNodeSize) {
            return false;
          }
          return distance < nodeSize * baseFactor;
        };
      }

      const strategy = createFrustumCullingStrategy(mockFrustum, 2);
      const quadtree = new Quadtree(defaultConfig, strategy);

      // Position in the positive quadrant (inside mock frustum)
      quadtree.update({ x: 100, y: 0, z: 100 });

      // Should have some nodes since we're inside the frustum
      expect(quadtree.getNodeCount()).toBeGreaterThan(0);
      expect(quadtree.getLeafNodeCount()).toBeGreaterThan(0);
    });

    it("receives all context parameters", () => {
      // Verify all parameters are passed correctly
      const receivedParams: number[] = [];

      const inspectingStrategy = (
        _qt: InstanceType<typeof Quadtree>,
        distance: number,
        level: number,
        nodeSize: number,
        minNodeSize: number,
        rootSize: number,
        nodeX: number,
        nodeY: number,
        minX: number,
        minY: number,
        worldX: number,
        worldY: number,
      ) => {
        // Only record root node params
        if (level === 0) {
          receivedParams.push(
            distance,
            level,
            nodeSize,
            minNodeSize,
            rootSize,
            nodeX,
            nodeY,
            minX,
            minY,
            worldX,
            worldY,
          );
        }
        return false; // Don't subdivide
      };

      const quadtree = new Quadtree(defaultConfig, inspectingStrategy);
      quadtree.update({ x: 0, y: 0, z: 0 });

      // Check we received all 11 numeric parameters
      expect(receivedParams.length).toBe(11);

      // Verify some expected values for root node
      const [distance, level, nodeSize, minNodeSize, rootSize, nodeX, nodeY] = receivedParams;
      expect(level).toBe(0);
      expect(nodeSize).toBe(defaultConfig.rootSize);
      expect(minNodeSize).toBe(defaultConfig.minNodeSize);
      expect(rootSize).toBe(defaultConfig.rootSize);
      expect(nodeX).toBe(0);
      expect(nodeY).toBe(0);
      expect(distance).toBeGreaterThanOrEqual(0);
    });
  });
});
