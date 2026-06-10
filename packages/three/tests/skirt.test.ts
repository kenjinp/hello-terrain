import { describe, expect, it } from "vitest";
import { int } from "three/tsl";
import { isSkirtVertex, isSkirtUV } from "../src/tsl/skirt.js";

describe("skirt TSL nodes", () => {
  describe("isSkirtVertex", () => {
    it("is exported and callable", () => {
      expect(isSkirtVertex).toBeTypeOf("function");
    });

    it("returns a node when called with a number", () => {
      const node = isSkirtVertex(8);
      expect(node).toBeDefined();
      expect(node).toHaveProperty("isNode", true);
    });

    it("accepts a TSL int node as input", () => {
      const segmentsNode = int(8);
      const node = isSkirtVertex(segmentsNode);
      expect(node).toBeDefined();
      expect(node).toHaveProperty("isNode", true);
    });
  });

  describe("isSkirtUV", () => {
    it("is exported and callable", () => {
      expect(isSkirtUV).toBeTypeOf("function");
    });

    it("returns a node when called with a number", () => {
      const node = isSkirtUV(8);
      expect(node).toBeDefined();
      expect(node).toHaveProperty("isNode", true);
    });

    it("accepts a TSL int node as input", () => {
      const segmentsNode = int(8);
      const node = isSkirtUV(segmentsNode);
      expect(node).toBeDefined();
      expect(node).toHaveProperty("isNode", true);
    });
  });

  describe("node structure validation", () => {
    it("isSkirtVertex and isSkirtUV produce distinct nodes", () => {
      const vertexNode = isSkirtVertex(4);
      const uvNode = isSkirtUV(4);

      // They should be different node instances
      expect(vertexNode).not.toBe(uvNode);
    });

    it("nodes can be composed in boolean expressions", () => {
      const vertexNode = isSkirtVertex(4);
      const uvNode = isSkirtUV(4);

      // Test that nodes support boolean operations (TSL nodes are chainable)
      const andNode = vertexNode.and(uvNode);
      const orNode = vertexNode.or(uvNode);
      const notNode = vertexNode.not();

      expect(andNode).toBeDefined();
      expect(orNode).toBeDefined();
      expect(notNode).toBeDefined();
    });
  });
});
