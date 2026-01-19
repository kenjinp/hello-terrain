import { bench, group, run, summary } from "mitata";
import { Quadtree } from "../src/quadtree/Quadtree";
import { QuadtreeNodeView } from "../src/quadtree/QuadtreeNodeView";
import {
  computeScreenSpaceInfo,
  distanceBasedSubdivision,
  screenSpaceSubdivision,
} from "../src/quadtree/subdivision-strategies";

// Common config for benchmarks
const defaultConfig = {
  maxLevel: 8,
  rootSize: 1000,
  minNodeSize: 1,
  origin: { x: 0, y: 0, z: 0 },
  maxNodes: 4096,
};

const largeConfig = {
  maxLevel: 12,
  rootSize: 10000,
  minNodeSize: 1,
  origin: { x: 0, y: 0, z: 0 },
  maxNodes: 16384,
};

// Pre-create instances for reuse tests
let quadtree: Quadtree;
let largeQuadtree: Quadtree;
let reusableNodeView: QuadtreeNodeView;

// Test positions
const centerPosition = { x: 0, y: 10, z: 0 };
const edgePosition = { x: 450, y: 10, z: 450 };
const farPosition = { x: 1000, y: 500, z: 1000 };
const movingPositions = Array.from({ length: 100 }, (_, i) => ({
  x: Math.sin(i * 0.1) * 400,
  y: 10 + Math.cos(i * 0.05) * 50,
  z: Math.cos(i * 0.1) * 400,
}));

// ============================================================
// Construction Benchmarks
// ============================================================
summary(() => {
  group("Construction", () => {
    bench("new Quadtree (default config, 4096 nodes)", () => {
      const qt = new Quadtree(defaultConfig);
      qt.destroy();
    });

    bench("new Quadtree (large config, 16384 nodes)", () => {
      const qt = new Quadtree(largeConfig);
      qt.destroy();
    });

    bench("new Quadtree with custom strategy", () => {
      const qt = new Quadtree(defaultConfig, distanceBasedSubdivision(3));
      qt.destroy();
    });

    bench("new QuadtreeNodeView (4096 nodes)", () => {
      const view = new QuadtreeNodeView(4096);
      view.destroy();
    });

    bench("new QuadtreeNodeView (16384 nodes)", () => {
      const view = new QuadtreeNodeView(16384);
      view.destroy();
    });
  });
});

// ============================================================
// Update Benchmarks (main subdivision logic)
// ============================================================
summary(() => {
  group("Update (subdivision)", () => {
    // Setup for this group
    quadtree = new Quadtree(defaultConfig);
    largeQuadtree = new Quadtree(largeConfig);

    bench("update() from center (high subdivision)", () => {
      quadtree.update(centerPosition);
    });

    bench("update() from edge", () => {
      quadtree.update(edgePosition);
    });

    bench("update() from far (minimal subdivision)", () => {
      quadtree.update(farPosition);
    });

    bench("update() large config from center", () => {
      largeQuadtree.update(centerPosition);
    });
  });
});

// ============================================================
// Sequential Updates (simulating camera movement)
// ============================================================
group("Sequential updates (movement simulation)", () => {
  quadtree = new Quadtree(defaultConfig);

  bench("100 sequential updates (circular path)", () => {
    for (const pos of movingPositions) {
      quadtree.update(pos);
    }
  });
});

// ============================================================
// Buffer Reuse Benchmarks
// ============================================================
summary(() => {
  group("Buffer reuse patterns", () => {
    reusableNodeView = new QuadtreeNodeView(defaultConfig.maxNodes);
    quadtree = new Quadtree(defaultConfig);

    bench("new Quadtree (fresh buffers) + update + destroy", () => {
      const qt = new Quadtree(defaultConfig);
      qt.update(centerPosition);
      qt.destroy();
    });

    bench("new Quadtree (reused NodeView) + update", () => {
      const qt = new Quadtree(defaultConfig, distanceBasedSubdivision(2), reusableNodeView);
      qt.update(centerPosition);
      // Don't destroy - we're reusing the NodeView
    });

    bench("reset() + update() (no allocation)", () => {
      quadtree.reset();
      quadtree.update(centerPosition);
    });
  });
});

// ============================================================
// Query Operations
// ============================================================
summary(() => {
  group("Query operations", () => {
    // Setup with a subdivided tree
    quadtree = new Quadtree(defaultConfig);
    quadtree.update(centerPosition);

    bench("getNodeCount()", () => {
      quadtree.getNodeCount();
    });

    bench("getLeafNodeCount()", () => {
      quadtree.getLeafNodeCount();
    });

    bench("getDeepestLevel()", () => {
      quadtree.getDeepestLevel();
    });

    bench("getActiveLeafNodeIndices() (zero-copy)", () => {
      quadtree.getActiveLeafNodeIndices();
    });

    bench("getLeafNodes() (allocates array)", () => {
      quadtree.getLeafNodes();
    });

    bench("getConfig()", () => {
      quadtree.getConfig();
    });
  });
});

// ============================================================
// NodeView Direct Operations
// ============================================================
summary(() => {
  group("QuadtreeNodeView operations", () => {
    const nodeView = new QuadtreeNodeView(4096);

    bench("getLevel()", () => {
      nodeView.getLevel(0);
    });

    bench("setLevel()", () => {
      nodeView.setLevel(0, 5);
    });

    bench("getX() + getY()", () => {
      nodeView.getX(0);
      nodeView.getY(0);
    });

    bench("getChildren()", () => {
      nodeView.getChildren(0);
    });

    bench("setChildren()", () => {
      nodeView.setChildren(0, [1, 2, 3, 4]);
    });

    bench("getNeighbors()", () => {
      nodeView.getNeighbors(0);
    });

    bench("setNeighbors()", () => {
      nodeView.setNeighbors(0, [1, 2, 3, 4]);
    });

    bench("getLeaf()", () => {
      nodeView.getLeaf(0);
    });

    bench("setLeaf(true)", () => {
      nodeView.setLeaf(0, true);
    });

    bench("clear()", () => {
      nodeView.clear();
    });
  });
});

// ============================================================
// Subdivision Strategy Benchmarks
// ============================================================
summary(() => {
  group("Subdivision strategies", () => {
    // Create a quadtree instance for strategy benchmarks
    const strategyQuadtree = new Quadtree(defaultConfig);

    const distanceStrategy = distanceBasedSubdivision(2);
    const screenStrategy = screenSpaceSubdivision({
      targetTrianglePixels: 6,
      tileSegments: 13,
      getScreenSpaceInfo: () => computeScreenSpaceInfo(Math.PI / 3, 1080),
    });

    // Context: [quadtree, distance, level, nodeSize, minNodeSize, rootSize, nodeX, nodeY, minX, minY, worldX, worldY]
    const closeContext: Parameters<typeof distanceStrategy> = [
      strategyQuadtree,
      50,
      3,
      125,
      1,
      1000,
      4,
      4,
      -437.5,
      -437.5,
      -375,
      -375,
    ];
    const farContext: Parameters<typeof distanceStrategy> = [
      strategyQuadtree,
      500,
      1,
      500,
      1,
      1000,
      1,
      1,
      -250,
      -250,
      0,
      0,
    ];

    bench("distanceBasedSubdivision (close)", () => {
      distanceStrategy(...closeContext);
    });

    bench("distanceBasedSubdivision (far)", () => {
      distanceStrategy(...farContext);
    });

    bench("screenSpaceSubdivision (close)", () => {
      screenStrategy(...closeContext);
    });

    bench("screenSpaceSubdivision (far)", () => {
      screenStrategy(...farContext);
    });

    bench("computeScreenSpaceInfo()", () => {
      computeScreenSpaceInfo(Math.PI / 3, 1080);
    });
  });
});

// ============================================================
// Memory-related benchmarks
// ============================================================
group("Memory patterns", () => {
  bench("create + update + destroy cycle", () => {
    const qt = new Quadtree(defaultConfig);
    qt.update(centerPosition);
    qt.destroy();
  });

  bench("NodeView clone()", () => {
    const view = new QuadtreeNodeView(4096);
    view.clone();
    view.destroy();
  });

  bench("getBuffers() (zero-copy access)", () => {
    const view = new QuadtreeNodeView(4096);
    view.getBuffers();
    view.destroy();
  });
});

// Run all benchmarks
await run();
