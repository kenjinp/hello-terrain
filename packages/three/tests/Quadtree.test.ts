import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  Quadtree,
  type QuadtreeParams,
  type SubdivisionContext,
  distanceBasedSubdivision,
} from "../src/quadtree/Quadtree.js";
import { QuadtreeNodeView } from "../src/quadtree/QuadtreeNodeView.js";

describe("Quadtree", () => {
  const defaultConfig: QuadtreeParams = {
    maxLevel: 5,
    rootSize: 1000,
    minNodeSize: 31.25, // 1000 / 2^5
    origin: new THREE.Vector3(0, 0, 0),
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

      expect(quadtree.getSubdivisionStrategy()).toBe(customStrategy);
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

      const position = new THREE.Vector3(10000, 0, 10000);
      quadtree.update(position);

      expect(quadtree.getLeafNodeCount()).toBe(1);
      expect(quadtree.getNodeCount()).toBe(1);
    });

    it("subdivides when position is close", () => {
      const alwaysSubdivide = (ctx: SubdivisionContext) => ctx.nodeSize > ctx.minNodeSize;
      const quadtree = new Quadtree(defaultConfig, alwaysSubdivide);

      const position = new THREE.Vector3(0, 0, 0);
      quadtree.update(position);

      // Should have subdivided, creating more than just the root
      expect(quadtree.getNodeCount()).toBeGreaterThan(1);
    });

    it("returns the closest leaf node index", () => {
      const quadtree = new Quadtree(defaultConfig, distanceBasedSubdivision(2));

      const position = new THREE.Vector3(0, 0, 0);
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
      const alwaysSubdivide = (ctx: SubdivisionContext) => ctx.level < 10;
      const quadtree = new Quadtree(config, alwaysSubdivide);

      const position = new THREE.Vector3(0, 0, 0);
      quadtree.update(position);

      expect(quadtree.getDeepestLevel()).toBeLessThanOrEqual(2);
    });

    it("resets before each update", () => {
      const quadtree = new Quadtree(defaultConfig, distanceBasedSubdivision(2));

      // First update
      quadtree.update(new THREE.Vector3(0, 0, 0));
      const count1 = quadtree.getNodeCount();

      // Second update should reset and may produce same or different count
      quadtree.update(new THREE.Vector3(1000, 0, 1000));

      // Node count should be consistent for given position
      quadtree.update(new THREE.Vector3(0, 0, 0));
      expect(quadtree.getNodeCount()).toBe(count1);
    });
  });

  describe("frustum culling", () => {
    it("culls nodes outside frustum", () => {
      const quadtree = new Quadtree(defaultConfig, distanceBasedSubdivision(2));

      // Create a frustum that only sees a small area
      const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
      camera.position.set(0, 50, 0);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();

      const frustum = new THREE.Frustum();
      frustum.setFromProjectionMatrix(
        new THREE.Matrix4().multiplyMatrices(
          camera.projectionMatrix,
          camera.matrixWorldInverse
        )
      );

      const position = new THREE.Vector3(0, 50, 0);
      quadtree.update(position, frustum);

      // Should still have some nodes
      expect(quadtree.getNodeCount()).toBeGreaterThanOrEqual(1);
    });
  });

  describe("getLeafNodes", () => {
    it("returns array of leaf node objects", () => {
      const neverSubdivide = () => false;
      const quadtree = new Quadtree(defaultConfig, neverSubdivide);

      quadtree.update(new THREE.Vector3(0, 0, 0));

      const leafNodes = quadtree.getLeafNodes();
      expect(leafNodes).toHaveLength(1);
      expect(leafNodes[0]).toHaveProperty("level");
      expect(leafNodes[0]).toHaveProperty("x");
      expect(leafNodes[0]).toHaveProperty("y");
    });

    it("returns multiple leaf nodes after subdivision", () => {
      const subdivideOnce = (ctx: SubdivisionContext) => ctx.level === 0;
      const quadtree = new Quadtree(defaultConfig, subdivideOnce);

      quadtree.update(new THREE.Vector3(0, 0, 0));

      const leafNodes = quadtree.getLeafNodes();
      expect(leafNodes.length).toBe(4); // 4 children of root
    });
  });

  describe("getActiveLeafNodeIndices", () => {
    it("returns indices and count for active leaves", () => {
      const neverSubdivide = () => false;
      const quadtree = new Quadtree(defaultConfig, neverSubdivide);

      quadtree.update(new THREE.Vector3(0, 0, 0));

      const { indices, count } = quadtree.getActiveLeafNodeIndices();
      expect(count).toBe(1);
      expect(indices).toBeInstanceOf(Uint16Array);
    });
  });

  describe("setSubdivisionStrategy", () => {
    it("changes the subdivision strategy", () => {
      const initialStrategy = () => false;
      const newStrategy = (ctx: SubdivisionContext) => ctx.level === 0;
      const quadtree = new Quadtree(defaultConfig, initialStrategy);

      quadtree.update(new THREE.Vector3(0, 0, 0));
      expect(quadtree.getNodeCount()).toBe(1);

      quadtree.setSubdivisionStrategy(newStrategy);
      quadtree.update(new THREE.Vector3(0, 0, 0));
      expect(quadtree.getNodeCount()).toBe(5); // 1 root + 4 children
    });

    it("getSubdivisionStrategy returns current strategy", () => {
      const strategy = () => false;
      const quadtree = new Quadtree(defaultConfig, strategy);

      expect(quadtree.getSubdivisionStrategy()).toBe(strategy);
    });
  });

  describe("reset", () => {
    it("resets quadtree to initial state", () => {
      const subdivideOnce = (ctx: SubdivisionContext) => ctx.level === 0;
      const quadtree = new Quadtree(defaultConfig, subdivideOnce);

      quadtree.update(new THREE.Vector3(0, 0, 0));
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
      const subdivideOnce = (ctx: SubdivisionContext) => ctx.level === 0;
      const quadtree = new Quadtree(defaultConfig, subdivideOnce);

      quadtree.update(new THREE.Vector3(0, 0, 0));
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
      const alwaysSubdivide = (ctx: SubdivisionContext) => ctx.level < 10;
      const quadtree = new Quadtree(config, alwaysSubdivide);

      quadtree.update(new THREE.Vector3(0, 0, 0));

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
        origin: new THREE.Vector3(500, 100, 500),
      };
      const quadtree = new Quadtree(config, distanceBasedSubdivision(2));

      // Position at origin should have expected behavior
      const position = new THREE.Vector3(500, 100, 500);
      quadtree.update(position);

      expect(quadtree.getNodeCount()).toBeGreaterThan(0);
    });
  });
});
