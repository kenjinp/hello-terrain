"use client";

import { Quadtree, type QuadtreeParams } from "@hello-terrain/three";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Vector3 } from "three";

// Color palette for different LOD levels - matching the 3D scene
const LEVEL_COLORS = [
  "#4a90d9", // Level 0 - blue
  "#50c878", // Level 1 - green
  "#ffd700", // Level 2 - gold
  "#ff8c00", // Level 3 - orange
  "#ff6347", // Level 4 - tomato
  "#da70d6", // Level 5 - orchid
  "#00ced1", // Level 6 - dark turquoise
  "#ff69b4", // Level 7+ - hot pink
];

// Neighbor direction labels
const NEIGHBOR_LABELS = ["Left", "Right", "Top", "Bottom"] as const;
const NEIGHBOR_COLORS = ["#e74c3c", "#3498db", "#2ecc71", "#9b59b6"] as const;

interface NodeRect {
  index: number;
  level: number;
  x: number;
  y: number;
  worldX: number;
  worldY: number;
  size: number;
  neighbors: [number, number, number, number];
  isLeaf: boolean;
}

interface HoveredInfo {
  node: NodeRect;
  neighbors: (NodeRect | null)[];
}

const EMPTY_SENTINEL = 0xffff;

export default function QuadtreeCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 600, height: 600 });
  const [hoveredInfo, setHoveredInfo] = useState<HoveredInfo | null>(null);
  const [nodeCount, setNodeCount] = useState(1);
  const [leafCount, setLeafCount] = useState(1);
  const [maxLevel, setMaxLevel] = useState(6);

  // Quadtree configuration
  const origin = useMemo(() => new Vector3(0, 0, 0), []);
  const config: QuadtreeParams = useMemo(
    () => ({
      maxLevel,
      rootSize: 1,
      minNodeSize: 1 / (1 << maxLevel),
      origin,
      maxNodes: 4096,
    }),
    [maxLevel, origin],
  );

  // Create quadtree - we'll manually control subdivision
  const quadtreeRef = useRef<Quadtree | null>(null);
  const [version, setVersion] = useState(0);

  // Initialize quadtree
  useEffect(() => {
    quadtreeRef.current = new Quadtree(config, () => false); // Never auto-subdivide
    setVersion((v) => v + 1);
    return () => {
      quadtreeRef.current?.destroy();
    };
  }, [config]);

  // Get all nodes as rectangles
  const getNodeRects = useCallback((): NodeRect[] => {
    const quadtree = quadtreeRef.current;
    if (!quadtree) return [];

    const nodeView = quadtree.getNodeView();
    const nodeCount = quadtree.getNodeCount();
    const rects: NodeRect[] = [];

    for (let i = 0; i < nodeCount; i++) {
      const level = nodeView.getLevel(i);
      const x = nodeView.getX(i);
      const y = nodeView.getY(i);
      const size = config.rootSize / (1 << level);
      const neighbors = nodeView.getNeighbors(i);
      const isLeaf = nodeView.getLeaf(i);

      // Calculate world position (top-left corner)
      const worldX = x * size - 0.5 * config.rootSize;
      const worldY = y * size - 0.5 * config.rootSize;

      rects.push({
        index: i,
        level,
        x,
        y,
        worldX,
        worldY,
        size,
        neighbors,
        isLeaf,
      });
    }

    return rects;
  }, [config.rootSize]);

  // Convert world coords to canvas coords
  const worldToCanvas = useCallback(
    (wx: number, wy: number): [number, number] => {
      const padding = 40;
      const drawSize = Math.min(canvasSize.width, canvasSize.height) - padding * 2;
      const offsetX = (canvasSize.width - drawSize) / 2;
      const offsetY = (canvasSize.height - drawSize) / 2;

      const cx = offsetX + ((wx + 0.5) / config.rootSize) * drawSize;
      const cy = offsetY + ((wy + 0.5) / config.rootSize) * drawSize;
      return [cx, cy];
    },
    [canvasSize, config.rootSize],
  );

  // Convert canvas coords to world coords
  const canvasToWorld = useCallback(
    (cx: number, cy: number): [number, number] => {
      const padding = 40;
      const drawSize = Math.min(canvasSize.width, canvasSize.height) - padding * 2;
      const offsetX = (canvasSize.width - drawSize) / 2;
      const offsetY = (canvasSize.height - drawSize) / 2;

      const wx = ((cx - offsetX) / drawSize) * config.rootSize - 0.5;
      const wy = ((cy - offsetY) / drawSize) * config.rootSize - 0.5;
      return [wx, wy];
    },
    [canvasSize, config.rootSize],
  );

  // Find node at world position
  const findNodeAt = useCallback((wx: number, wy: number, nodes: NodeRect[]): NodeRect | null => {
    // Find the deepest leaf node containing this point
    let best: NodeRect | null = null;

    for (const node of nodes) {
      if (!node.isLeaf) continue;

      const minX = node.worldX;
      const maxX = node.worldX + node.size;
      const minY = node.worldY;
      const maxY = node.worldY + node.size;

      if (wx >= minX && wx < maxX && wy >= minY && wy < maxY) {
        if (!best || node.level > best.level) {
          best = node;
        }
      }
    }

    return best;
  }, []);

  // Subdivide at a world position - subdivides based on distance to click
  const subdivideAtPosition = useCallback((worldX: number, worldZ: number) => {
    const quadtree = quadtreeRef.current;
    if (!quadtree) return;

    // Set a distance-based strategy that subdivides nodes close to the click position
    // Subdivides when: distance < nodeSize * factor
    const factor = 2;
    quadtree.subdivisionStrategy = (_qt, distance, _level, nodeSize, minNodeSize) => {
      // Don't subdivide below minimum node size
      if (nodeSize <= minNodeSize) return false;
      // Subdivide if close enough to the click position
      return distance < nodeSize * factor;
    };

    // Update with the click position - this will subdivide based on distance
    const position = new Vector3(worldX, 0, worldZ);
    quadtree.update(position);

    // Reset strategy to never subdivide (for future hover interactions)
    quadtree.subdivisionStrategy = () => false;

    setVersion((v) => v + 1);
  }, []);

  // Handle resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setCanvasSize({ width, height });
      }
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

  // Draw the quadtree
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const nodes = getNodeRects();
    const padding = 40;
    const drawSize = Math.min(canvasSize.width, canvasSize.height) - padding * 2;

    // Clear canvas
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, canvasSize.width, canvasSize.height);

    // Draw each leaf node
    for (const node of nodes) {
      if (!node.isLeaf) continue;

      const [x, y] = worldToCanvas(node.worldX, node.worldY);
      const size = (node.size / config.rootSize) * drawSize;

      // Fill with level color
      const colorIndex = Math.min(node.level, LEVEL_COLORS.length - 1);
      ctx.fillStyle = LEVEL_COLORS[colorIndex];
      ctx.globalAlpha = 0.7;
      ctx.fillRect(x, y, size, size);
      ctx.globalAlpha = 1;

      // Draw border
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, size, size);

      // Draw node index in center
      ctx.fillStyle = "#ffffff";
      ctx.font = `${Math.min(12, size / 3)}px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const label = `${node.index}`;
      ctx.fillText(label, x + size / 2, y + size / 2);
    }

    // Highlight hovered node and its neighbors
    if (hoveredInfo) {
      const { node, neighbors } = hoveredInfo;

      // Draw neighbor highlights first
      for (let i = 0; i < 4; i++) {
        const neighbor = neighbors[i];
        if (neighbor) {
          const [nx, ny] = worldToCanvas(neighbor.worldX, neighbor.worldY);
          const nsize = (neighbor.size / config.rootSize) * drawSize;

          ctx.strokeStyle = NEIGHBOR_COLORS[i];
          ctx.lineWidth = 3;
          ctx.strokeRect(nx + 2, ny + 2, nsize - 4, nsize - 4);

          // Draw direction indicator
          ctx.fillStyle = NEIGHBOR_COLORS[i];
          ctx.font = "bold 10px monospace";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(NEIGHBOR_LABELS[i][0], nx + nsize / 2, ny + 10);
        }
      }

      // Highlight the hovered node
      const [hx, hy] = worldToCanvas(node.worldX, node.worldY);
      const hsize = (node.size / config.rootSize) * drawSize;

      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 3;
      ctx.strokeRect(hx + 1, hy + 1, hsize - 2, hsize - 2);

      // Draw filled background for index
      ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
      ctx.fillRect(hx + hsize / 2 - 15, hy + hsize / 2 - 10, 30, 20);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 14px monospace";
      ctx.fillText(`${node.index}`, hx + hsize / 2, hy + hsize / 2);
    }

    // Update counts
    setNodeCount(nodes.length);
    setLeafCount(nodes.filter((n) => n.isLeaf).length);
  }, [canvasSize, version, hoveredInfo, worldToCanvas, getNodeRects, config.rootSize]);

  // Handle mouse move
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const [wx, wy] = canvasToWorld(cx, cy);

      const nodes = getNodeRects();
      const node = findNodeAt(wx, wy, nodes);

      if (node) {
        // Find neighbor nodes
        const neighborNodes = node.neighbors.map((neighborIndex) => {
          if (neighborIndex === EMPTY_SENTINEL) return null;
          return nodes.find((n) => n.index === neighborIndex) ?? null;
        });

        setHoveredInfo({ node, neighbors: neighborNodes });
      } else {
        setHoveredInfo(null);
      }
    },
    [canvasToWorld, getNodeRects, findNodeAt],
  );

  // Handle click - subdivide at click position all the way to maxLevel
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const [wx, wy] = canvasToWorld(cx, cy);

      // Check if click is within bounds
      if (wx >= -0.5 && wx < 0.5 && wy >= -0.5 && wy < 0.5) {
        subdivideAtPosition(wx, wy);
      }
    },
    [canvasToWorld, subdivideAtPosition],
  );

  // Reset quadtree
  const handleReset = useCallback(() => {
    quadtreeRef.current?.reset();
    // After reset, mark root as leaf
    const nodeView = quadtreeRef.current?.getNodeView();
    if (nodeView) {
      nodeView.setLeaf(0, true);
    }
    setVersion((v) => v + 1);
    setHoveredInfo(null);
  }, []);

  // Initialize root as leaf
  useEffect(() => {
    const nodeView = quadtreeRef.current?.getNodeView();
    if (nodeView) {
      nodeView.setLeaf(0, true);
      setVersion((v) => v + 1);
    }
  }, [config]);

  return (
    <div className="relative w-full h-full bg-[#1a1a2e]">
      <div ref={containerRef} className="absolute inset-0">
        <canvas
          ref={canvasRef}
          width={canvasSize.width}
          height={canvasSize.height}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoveredInfo(null)}
          onClick={handleClick}
          className="cursor-pointer"
        />
      </div>

      {/* Controls */}
      <div className="absolute top-3 left-3 bg-fd-background/80 backdrop-blur-md text-white px-3 py-2 rounded text-xs font-mono space-y-2 pointer-events-auto">
        <div>Nodes: {nodeCount}</div>
        <div>Leaves: {leafCount}</div>
        <div className="flex items-center gap-2">
          <label htmlFor="max-level">Max Level:</label>
          <select
            id="max-level"
            value={maxLevel}
            onChange={(e) => setMaxLevel(Number(e.target.value))}
            className="bg-fd-background/50 border border-white/20 rounded px-1 py-0.5"
          >
            {[3, 4, 5, 6, 7, 8].map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={handleReset}
          className="bg-fd-primary/80 hover:bg-fd-primary px-2 py-1 rounded text-xs"
        >
          Reset
        </button>
      </div>

      {/* Hovered node info */}
      {hoveredInfo && (
        <div className="absolute top-3 right-3 bg-fd-background/80 backdrop-blur-md text-white px-3 py-2 rounded text-xs font-mono pointer-events-none min-w-[180px]">
          <div className="font-bold mb-2 text-sm">Node {hoveredInfo.node.index}</div>
          <div>Level: {hoveredInfo.node.level}</div>
          <div>
            Grid: ({hoveredInfo.node.x}, {hoveredInfo.node.y})
          </div>
          <div className="mt-2 font-bold">Neighbors</div>
          <div className="space-y-1">
            {NEIGHBOR_LABELS.map((label, i) => {
              const neighborIdx = hoveredInfo.node.neighbors[i];
              const hasNeighbor = neighborIdx !== EMPTY_SENTINEL;
              return (
                <div key={label} className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-sm"
                    style={{ backgroundColor: NEIGHBOR_COLORS[i] }}
                  />
                  <span>
                    [{i}] {label}:{" "}
                    {hasNeighbor ? (
                      <span className="text-white">{neighborIdx}</span>
                    ) : (
                      <span className="text-gray-500">none</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Level color legend */}
      <div className="absolute bottom-3 left-3 bg-fd-background/80 backdrop-blur-md text-white px-3 py-2 rounded text-[11px] font-mono pointer-events-none">
        <div className="mb-1 font-bold">LOD Levels</div>
        {LEVEL_COLORS.slice(0, maxLevel + 1).map((color, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: color }} />
            <span>Level {i}</span>
          </div>
        ))}
      </div>

      {/* Instructions */}
      <div className="absolute bottom-3 right-3 bg-fd-background/80 backdrop-blur-md text-white px-3 py-2 rounded text-xs font-mono pointer-events-none text-right">
        <div>Click to subdivide</div>
        <div>Hover to see neighbors</div>
      </div>
    </div>
  );
}
