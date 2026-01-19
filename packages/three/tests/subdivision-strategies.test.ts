import { describe, expect, it } from "vitest";
import {
  Quadtree,
  type ShouldSubdivideContext,
  computeScreenSpaceInfo,
  distanceBasedSubdivision,
  screenSpaceSubdivision,
} from "../src/quadtree/Quadtree.js";

// Helper to create a ShouldSubdivideContext tuple
// [quadtree, distance, level, nodeSize, minNodeSize, rootSize, nodeX, nodeY, minX, minY, worldX, worldY]
function makeContext(
  distance: number,
  level: number,
  nodeSize: number,
  minNodeSize: number,
  rootSize: number,
): ShouldSubdivideContext {
  // Use null as mock quadtree since these strategies don't use it
  return [
    null as unknown as Quadtree,
    distance,
    level,
    nodeSize,
    minNodeSize,
    rootSize,
    0,
    0,
    0,
    0,
    0,
    0,
  ];
}

describe("Subdivision Strategies", () => {
  describe("distanceBasedSubdivision", () => {
    it("returns a function", () => {
      const strategy = distanceBasedSubdivision();
      expect(typeof strategy).toBe("function");
    });

    it("subdivides when distance is less than nodeSize * factor", () => {
      const strategy = distanceBasedSubdivision(2);

      const context = makeContext(50, 0, 100, 10, 1000);

      // distance (50) < nodeSize (100) * factor (2) = 200, should subdivide
      expect(strategy(...context)).toBe(true);
    });

    it("does not subdivide when distance exceeds threshold", () => {
      const strategy = distanceBasedSubdivision(2);

      const context = makeContext(250, 0, 100, 10, 1000);

      // distance (250) >= nodeSize (100) * factor (2) = 200, should not subdivide
      expect(strategy(...context)).toBe(false);
    });

    it("does not subdivide when nodeSize is at minimum", () => {
      const strategy = distanceBasedSubdivision(2);

      const context = makeContext(1, 5, 10, 10, 1000);

      // nodeSize <= minNodeSize, should not subdivide regardless of distance
      expect(strategy(...context)).toBe(false);
    });

    it("uses default factor of 2", () => {
      const strategy = distanceBasedSubdivision();

      const contextClose = makeContext(150, 0, 100, 10, 1000);
      const contextFar = makeContext(250, 0, 100, 10, 1000);

      expect(strategy(...contextClose)).toBe(true);
      expect(strategy(...contextFar)).toBe(false);
    });

    it("respects custom factor", () => {
      const strategy = distanceBasedSubdivision(4);

      const context = makeContext(350, 0, 100, 10, 1000);

      // distance (350) < nodeSize (100) * factor (4) = 400, should subdivide
      expect(strategy(...context)).toBe(true);
    });
  });

  describe("screenSpaceSubdivision", () => {
    it("returns a function", () => {
      const strategy = screenSpaceSubdivision({
        getScreenSpaceInfo: () => null,
      });
      expect(typeof strategy).toBe("function");
    });

    it("falls back to distance-based when screenSpaceInfo is null", () => {
      const strategy = screenSpaceSubdivision({
        getScreenSpaceInfo: () => null,
      });

      const contextClose = makeContext(50, 0, 100, 10, 1000);
      const contextFar = makeContext(250, 0, 100, 10, 1000);

      // Falls back to distance < nodeSize * 2
      expect(strategy(...contextClose)).toBe(true);
      expect(strategy(...contextFar)).toBe(false);
    });

    it("does not subdivide when nodeSize is at minimum", () => {
      const strategy = screenSpaceSubdivision({
        getScreenSpaceInfo: () => ({ projectionFactor: 1000, screenHeight: 1080 }),
      });

      const context = makeContext(1, 5, 10, 10, 1000);

      expect(strategy(...context)).toBe(false);
    });

    it("subdivides based on screen-space triangle size", () => {
      const strategy = screenSpaceSubdivision({
        targetTrianglePixels: 6,
        tileSegments: 10,
        getScreenSpaceInfo: () => ({ projectionFactor: 1000, screenHeight: 1080 }),
      });

      // At distance 100, nodeSize 100, projectionFactor 1000:
      // tileScreenSize = (100 / 100) * 1000 = 1000 pixels
      // triangleScreenSize = 1000 / 10 = 100 pixels
      // 100 > 6, should subdivide
      const contextClose = makeContext(100, 0, 100, 10, 1000);

      expect(strategy(...contextClose)).toBe(true);

      // At distance 10000:
      // tileScreenSize = (100 / 10000) * 1000 = 10 pixels
      // triangleScreenSize = 10 / 10 = 1 pixel
      // 1 < 6, should not subdivide
      const contextFar = makeContext(10000, 0, 100, 10, 1000);

      expect(strategy(...contextFar)).toBe(false);
    });

    it("handles very small distances without division by zero", () => {
      const strategy = screenSpaceSubdivision({
        getScreenSpaceInfo: () => ({ projectionFactor: 1000, screenHeight: 1080 }),
      });

      const context = makeContext(0, 0, 100, 10, 1000);

      // Should not throw, uses safe distance of 0.001
      expect(() => strategy(...context)).not.toThrow();
      expect(strategy(...context)).toBe(true);
    });
  });

  describe("computeScreenSpaceInfo", () => {
    it("computes projection factor correctly", () => {
      const fovY = Math.PI / 4; // 45 degrees
      const screenHeight = 1080;

      const info = computeScreenSpaceInfo(fovY, screenHeight);

      // projectionFactor = screenHeight / (2 * tan(fovY / 2))
      // = 1080 / (2 * tan(PI/8))
      const expected = screenHeight / (2 * Math.tan(fovY / 2));
      expect(info.projectionFactor).toBeCloseTo(expected, 6);
      expect(info.screenHeight).toBe(screenHeight);
    });

    it("returns higher projection factor for narrower FOV", () => {
      const screenHeight = 1080;

      const narrowFov = computeScreenSpaceInfo(Math.PI / 6, screenHeight); // 30 degrees
      const wideFov = computeScreenSpaceInfo(Math.PI / 3, screenHeight); // 60 degrees

      expect(narrowFov.projectionFactor).toBeGreaterThan(wideFov.projectionFactor);
    });
  });
});
