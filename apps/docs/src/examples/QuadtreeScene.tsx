"use client";

import {
  distanceBasedSubdivision,
  isSkirtUV,
  isSkirtVertex,
  type NeighborResult,
  Quadtree,
  type QuadtreeParams,
  TerrainGeometry,
} from "@hello-terrain/three";
import { OrbitControls } from "@react-three/drei";
import { Canvas, extend, useFrame, useThree } from "@react-three/fiber";
import { useControls } from "leva";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WebGPURendererParameters } from "three/src/renderers/webgpu/WebGPURenderer.js";
import {
  abs,
  attribute,
  float,
  Fn,
  fract,
  fwidth,
  max,
  min,
  positionLocal,
  select,
  smoothstep,
  uniform,
  uv,
  vec3,
} from "three/tsl";
import * as THREE from "three/webgpu";

extend(THREE as any);
extend({ TerrainGeometry });

// Color palette for different LOD levels - hex strings for CSS
const LEVEL_COLORS_HEX = [
  "#4a90d9", // Level 0 - blue
  "#50c878", // Level 1 - green
  "#ffd700", // Level 2 - gold
  "#ff8c00", // Level 3 - orange
  "#ff6347", // Level 4 - tomato
  "#da70d6", // Level 5 - orchid
  "#00ced1", // Level 6 - dark turquoise
  "#ff69b4", // Level 7+ - hot pink
];

// THREE.Color versions for GPU
const LEVEL_COLORS = LEVEL_COLORS_HEX.map((hex) => new THREE.Color(hex));

// Highlight colors for hovered tile and neighbors
const HIGHLIGHT_COLOR = new THREE.Color("#ffffff");
const NEIGHBOR_COLORS = {
  left: new THREE.Color("#e74c3c"), // Red
  right: new THREE.Color("#3498db"), // Blue
  top: new THREE.Color("#2ecc71"), // Green
  bottom: new THREE.Color("#9b59b6"), // Purple
};

// Blend factor for highlights (0 = full base color, 1 = full highlight color)
const HIGHLIGHT_BLEND = 1;

interface TileInfo {
  count: number;
  deepestLevel: number;
}

interface HoverInfo {
  nodeIndex: number;
  neighbors: NeighborResult;
}

interface QuadtreeTerrainProps {
  onTileInfoUpdate: (info: TileInfo) => void;
  onHoverUpdate: (info: HoverInfo | null) => void;
}

const QuadtreeTerrain = ({ onTileInfoUpdate, onHoverUpdate }: QuadtreeTerrainProps) => {
  const { camera, pointer } = useThree();
  const instancedMeshRef = useRef<THREE.InstancedMesh>(null);
  const tempMatrix = useRef(new THREE.Matrix4());
  const tempColor = useRef(new THREE.Color());
  const raycaster = useRef(new THREE.Raycaster());
  const hoverInfoRef = useRef<HoverInfo | null>(null);
  const leafIndexToNodeIndexRef = useRef<Map<number, number>>(new Map());
  const borderColorAttrRef = useRef<THREE.InstancedBufferAttribute | null>(null);

  const controls = useControls("Quadtree", {
    rootSize: {
      value: 16,
      min: 4,
      max: 64,
      step: 4,
      label: "Root Size",
    },
    maxLevel: {
      value: 5,
      min: 1,
      max: 8,
      step: 1,
      label: "Max Level",
    },
    subdivisionFactor: {
      value: 1.5,
      min: 0.5,
      max: 4,
      step: 0.1,
      label: "Subdivision Factor",
    },
    showGrid: {
      value: true,
      label: "Show Grid Lines",
    },
    animateCamera: {
      value: false,
      label: "Animate Camera",
    },
    skirtLength: {
      value: 0.15,
      min: 0,
      max: 0.5,
      step: 0.05,
      label: "Skirt Length",
    },
    wireframe: {
      value: false,
      label: "Wireframe",
    },
  });

  const segments = 8; // Inner segments for TerrainGeometry
  const maxNodes = 4096;

  // Create quadtree with current config
  const quadtree = useMemo(() => {
    const config: QuadtreeParams = {
      maxLevel: controls.maxLevel,
      rootSize: controls.rootSize,
      minNodeSize: controls.rootSize / (1 << controls.maxLevel),
      origin: new THREE.Vector3(0, 0, 0),
      maxNodes,
    };
    return new Quadtree(config, distanceBasedSubdivision(controls.subdivisionFactor));
  }, [controls.rootSize, controls.maxLevel, controls.subdivisionFactor]);

  // Shader uniforms
  const uniforms = useMemo(
    () => ({
      uSkirtLength: uniform(controls.skirtLength).setName("uSkirtLength"),
      uSegments: uniform(segments).setName("uSegments"),
      uShowGrid: uniform(controls.showGrid).setName("uShowGrid"),
    }),
    [],
  );

  // Create border color attribute buffer for neighbor highlighting
  const borderColorBuffer = useMemo(() => {
    const buffer = new Float32Array(maxNodes * 3); // RGB per instance
    const attr = new THREE.InstancedBufferAttribute(buffer, 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    return attr;
  }, []);

  // Position node for skirt vertices
  const positionNode = useMemo(() => {
    return Fn(() => {
      const wp = positionLocal;
      return select(isSkirtVertex(segments), vec3(wp.x, uniforms.uSkirtLength.negate(), wp.z), wp);
    })();
  }, [uniforms]);

  // Color node showing grid lines with pixel-perfect anti-aliasing and neighbor borders
  const colorNode = useMemo(() => {
    return Fn(() => {
      const uvCoord = uv();
      // Grid lines based on inner segments
      // With extendUV=true, UVs span [0,1] across (segments+3) vertices
      // Inner grid starts at 1/(segments+2) and ends at 1 - 1/(segments+2)
      const totalEdge = float(segments + 2);
      const uvStep = float(1).div(totalEdge);

      // Remap UV to inner grid space [0,1]
      const innerU = uvCoord.x.sub(uvStep).div(float(1).sub(uvStep.mul(2)));
      const innerV = uvCoord.y.sub(uvStep).div(float(1).sub(uvStep.mul(2)));

      // Scale to grid coordinates (0 to segments)
      const gridU = innerU.mul(segments);
      const gridV = innerV.mul(segments);

      // Distance to nearest grid line (0 at line, 0.5 at center of cell)
      const distU = abs(fract(gridU).sub(0.5));
      const distV = abs(fract(gridV).sub(0.5));

      // Use fwidth for pixel-perfect line width (typically 1-2 pixels)
      const lineWidthPixels = float(1);
      const fwU = fwidth(gridU).mul(lineWidthPixels);
      const fwV = fwidth(gridV).mul(lineWidthPixels);

      // Smoothstep for anti-aliased edges - 1 at grid lines, 0 at cell center
      const lineU = smoothstep(float(0.5).sub(fwU), float(0.5), distU);
      const lineV = smoothstep(float(0.5).sub(fwV), float(0.5), distV);
      const gridIntensity = max(lineU, lineV);

      // Instance color will be set per-instance, blend grid lines on top
      // Paint skirt faces darker
      const baseColor = vec3(1, 1, 1);
      const skirtColor = vec3(0.6, 0.6, 0.6);
      const gridColor = vec3(0.15, 0.15, 0.15);

      const tileColor = select(isSkirtUV(segments), skirtColor, baseColor);
      const colorWithGrid = tileColor
        .mul(float(1).sub(gridIntensity))
        .add(gridColor.mul(gridIntensity));
      const colorWithoutGrid = tileColor;

      // Border rendering for neighbor highlighting
      // Read border color from instance attribute (RGB, black = no border)
      const borderColorAttr = attribute("borderColor", "vec3");

      // Border width in UV space (about 1.5 grid cells wide)
      const borderWidth = float(0.25).div(float(segments));

      // Check if we're in the inner area (not skirt) - skirt UVs are outside [uvStep, 1-uvStep]
      const isInnerArea = uvCoord.x
        .greaterThan(uvStep)
        .and(uvCoord.x.lessThan(float(1).sub(uvStep)))
        .and(uvCoord.y.greaterThan(uvStep))
        .and(uvCoord.y.lessThan(float(1).sub(uvStep)));

      // Distance from inner edges (normalized to inner area)
      const distFromLeft = innerU;
      const distFromRight = float(1).sub(innerU);
      const distFromBottom = innerV;
      const distFromTop = float(1).sub(innerV);

      // Minimum distance from any edge
      const minEdgeDist = min(min(distFromLeft, distFromRight), min(distFromBottom, distFromTop));

      // Anti-aliased border using fwidth
      const borderFw = fwidth(minEdgeDist).mul(1.5);
      const borderIntensity = smoothstep(borderWidth.add(borderFw), borderWidth, minEdgeDist);

      // Check if border color is set (not black)
      const hasBorder = borderColorAttr.x
        .add(borderColorAttr.y)
        .add(borderColorAttr.z)
        .greaterThan(0.01);

      // Apply border only in inner area where border color is set
      const shouldShowBorder = isInnerArea.and(hasBorder);
      const borderMix = select(shouldShowBorder, borderIntensity, float(0));

      // Final composition: base tile -> grid lines -> border on top
      const withGrid = select(uniforms.uShowGrid, colorWithGrid, colorWithoutGrid);
      const finalColor = withGrid.mul(float(1).sub(borderMix)).add(borderColorAttr.mul(borderMix));

      return finalColor;
    })();
  }, [uniforms]);

  // Helper to check if a node index is a neighbor
  const getNeighborDirection = useCallback(
    (nodeIndex: number, neighbors: NeighborResult): keyof typeof NEIGHBOR_COLORS | null => {
      for (const [dir, neighbor] of Object.entries(neighbors) as [
        keyof NeighborResult,
        number | number[],
      ][]) {
        if (Array.isArray(neighbor)) {
          if (neighbor.includes(nodeIndex)) return dir;
        } else if (neighbor === nodeIndex) {
          return dir;
        }
      }
      return null;
    },
    [],
  );

  // Set up border color attribute on geometry
  useEffect(() => {
    const mesh = instancedMeshRef.current;
    if (mesh && mesh.geometry) {
      mesh.geometry.setAttribute("borderColor", borderColorBuffer);
      borderColorAttrRef.current = borderColorBuffer;
    }
  }, [borderColorBuffer]);

  // Update uniforms
  useFrame((state) => {
    uniforms.uSkirtLength.value = controls.skirtLength;
    uniforms.uShowGrid.value = controls.showGrid;

    // Animate camera in a circle if enabled
    if (controls.animateCamera) {
      const t = state.clock.elapsedTime * 0.3;
      const radius = controls.rootSize * 0.6;
      camera.position.x = Math.sin(t) * radius;
      camera.position.z = Math.cos(t) * radius;
      camera.position.y = controls.rootSize * 0.4;
      camera.lookAt(0, 0, 0);
    }

    // Update quadtree
    quadtree.update(camera.position);

    // Get leaf nodes and update instances
    const { indices: leafIndices, count: leafCount } = quadtree.getActiveLeafNodeIndices();
    const nodeView = quadtree.getNodeView();
    const mesh = instancedMeshRef.current;

    if (!mesh) return;

    const config = quadtree.getConfig();

    // Build mapping from instance index to node index
    leafIndexToNodeIndexRef.current.clear();
    for (let i = 0; i < leafCount; i++) {
      leafIndexToNodeIndexRef.current.set(i, leafIndices[i]);
    }

    // FIRST: Update all instance matrices (before raycasting!)
    for (let i = 0; i < leafCount; i++) {
      const nodeIndex = leafIndices[i];
      const level = nodeView.getLevel(nodeIndex);
      const x = nodeView.getX(nodeIndex);
      const y = nodeView.getY(nodeIndex);

      const nodeSize = config.rootSize / (1 << level);
      const worldX = config.origin.x + (x * nodeSize - 0.5 * config.rootSize) + nodeSize * 0.5;
      const worldZ = config.origin.z + (y * nodeSize - 0.5 * config.rootSize) + nodeSize * 0.5;

      // Create transform matrix
      // Scale X and Z by nodeSize, but keep Y at 1 so skirt length is consistent
      tempMatrix.current.identity();
      tempMatrix.current.makeScale(nodeSize, 1, nodeSize);
      tempMatrix.current.setPosition(worldX, 0, worldZ);

      mesh.setMatrixAt(i, tempMatrix.current);
    }

    mesh.count = leafCount;
    mesh.instanceMatrix.needsUpdate = true;

    // Update bounding sphere for raycasting to work properly
    mesh.computeBoundingSphere();

    // NOW raycast against updated matrices
    raycaster.current.setFromCamera(pointer, camera);
    const intersects = raycaster.current.intersectObject(mesh);
    let newHoverInfo: HoverInfo | null = null;

    if (intersects.length > 0 && intersects[0].instanceId !== undefined) {
      const instanceId = intersects[0].instanceId;
      const nodeIndex = leafIndexToNodeIndexRef.current.get(instanceId);
      if (nodeIndex !== undefined) {
        const neighbors = quadtree.findAllNeighbors(nodeIndex);
        newHoverInfo = { nodeIndex, neighbors };
      }
    }

    // Update hover state if changed
    if (newHoverInfo?.nodeIndex !== hoverInfoRef.current?.nodeIndex) {
      hoverInfoRef.current = newHoverInfo;
      onHoverUpdate(newHoverInfo);
    }

    // Update instance colors and border colors based on hover state
    const borderAttr = borderColorAttrRef.current;
    const borderArray = borderAttr?.array as Float32Array | undefined;

    for (let i = 0; i < leafCount; i++) {
      const nodeIndex = leafIndices[i];
      const level = nodeView.getLevel(nodeIndex);

      // Get base LOD color
      const colorIndex = Math.min(level, LEVEL_COLORS.length - 1);
      const baseColor = LEVEL_COLORS[colorIndex];

      // Determine color based on hover state
      const hoverInfo = hoverInfoRef.current;
      if (hoverInfo && nodeIndex === hoverInfo.nodeIndex) {
        // Hovered tile - blend white highlight with base color
        tempColor.current.copy(baseColor).lerp(HIGHLIGHT_COLOR, HIGHLIGHT_BLEND);
        // Clear border for hovered tile
        if (borderArray) {
          borderArray[i * 3] = 0;
          borderArray[i * 3 + 1] = 0;
          borderArray[i * 3 + 2] = 0;
        }
      } else if (hoverInfo) {
        // Check if this is a neighbor
        const neighborDir = getNeighborDirection(nodeIndex, hoverInfo.neighbors);
        if (neighborDir) {
          // Keep normal LOD color for neighbor tiles
          tempColor.current.copy(baseColor);
          // Set border color for neighbor tiles
          if (borderArray) {
            const neighborColor = NEIGHBOR_COLORS[neighborDir];
            borderArray[i * 3] = neighborColor.r;
            borderArray[i * 3 + 1] = neighborColor.g;
            borderArray[i * 3 + 2] = neighborColor.b;
          }
        } else {
          // Normal LOD color, clear border
          tempColor.current.copy(baseColor);
          if (borderArray) {
            borderArray[i * 3] = 0;
            borderArray[i * 3 + 1] = 0;
            borderArray[i * 3 + 2] = 0;
          }
        }
      } else {
        // No hover - normal LOD color, clear border
        tempColor.current.copy(baseColor);
        if (borderArray) {
          borderArray[i * 3] = 0;
          borderArray[i * 3 + 1] = 0;
          borderArray[i * 3 + 2] = 0;
        }
      }
      mesh.setColorAt(i, tempColor.current);
    }

    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }
    if (borderAttr) {
      borderAttr.needsUpdate = true;
    }

    // Update info display
    onTileInfoUpdate({
      count: leafCount,
      deepestLevel: quadtree.getDeepestLevel(),
    });
  });

  // Cleanup
  useEffect(() => {
    return () => {
      quadtree.destroy();
    };
  }, [quadtree]);

  return (
    <instancedMesh ref={instancedMeshRef} args={[undefined, undefined, maxNodes]}>
      <terrainGeometry args={[segments, true]} />
      <meshStandardNodeMaterial
        positionNode={positionNode}
        colorNode={colorNode}
        side={THREE.DoubleSide}
        flatShading
        wireframe={controls.wireframe}
      />
    </instancedMesh>
  );
};

const EMPTY_SENTINEL = 0xffff;

// Helper to format neighbor value for display
const formatNeighbor = (value: number | number[]): string => {
  if (value === EMPTY_SENTINEL) return "none";
  if (Array.isArray(value)) return `[${value.join(", ")}]`;
  return String(value);
};

const QuadtreeScene = () => {
  const [tileInfo, setTileInfo] = useState<TileInfo>({ count: 0, deepestLevel: 0 });
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const maxLevel = useControls("Quadtree", {
    maxLevel: { value: 5, min: 1, max: 8, step: 1 },
  }).maxLevel;

  return (
    <div className="relative w-full h-full rounded overflow-hidden backdrop-blur-sm">
      <Canvas
        className="absolute inset-0 w-full h-full"
        shadows
        gl={async (props) => {
          props.alpha = true;
          props.antialias = true;
          const renderer = new THREE.WebGPURenderer(props as WebGPURendererParameters);

          renderer.logarithmicDepthBuffer = true;
          renderer.shadowMap.type = THREE.PCFSoftShadowMap;
          renderer.shadowMap.enabled = true;

          await renderer.init();
          return renderer;
        }}
        camera={{
          near: 0.1,
          far: 10000,
          position: [12, 10, 12],
          fov: 50,
        }}
        dpr={[1, 1]}
        performance={{ min: 0.5 }}
      >
        <ambientLight intensity={0.4} />
        <directionalLight intensity={0.8} position={[5, 10, 5]} />
        <QuadtreeTerrain onTileInfoUpdate={setTileInfo} onHoverUpdate={setHoverInfo} />
        <OrbitControls makeDefault target={[0, 0, 0]} />
      </Canvas>

      {/* Info overlay - positioned in top-left */}
      <div className="absolute top-3 left-3 bg-fd-background/50 backdrop-blur-md text-white px-3 py-2 rounded text-xs font-mono whitespace-nowrap pointer-events-none">
        <div>Tiles: {tileInfo.count}</div>
        <div>Deepest Level: {tileInfo.deepestLevel}</div>
      </div>

      {/* Hover info - positioned in bottom-left */}
      {hoverInfo && (
        <div className="absolute bottom-3 left-3 bg-fd-background/50 backdrop-blur-md text-white px-3 py-2 rounded text-xs font-mono pointer-events-none min-w-[160px]">
          <div className="font-bold mb-1">Node {hoverInfo.nodeIndex}</div>
          <div className="text-[11px] space-y-0.5">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: "#e74c3c" }} />
              <span>Left: {formatNeighbor(hoverInfo.neighbors.left)}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: "#3498db" }} />
              <span>Right: {formatNeighbor(hoverInfo.neighbors.right)}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: "#2ecc71" }} />
              <span>Top: {formatNeighbor(hoverInfo.neighbors.top)}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: "#9b59b6" }} />
              <span>Bottom: {formatNeighbor(hoverInfo.neighbors.bottom)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Level color legend - positioned in top-right */}
      <div className="absolute top-3 right-3 bg-fd-background/50 backdrop-blur-md text-white px-3 py-2 rounded text-[11px] font-mono pointer-events-none">
        <div className="mb-1 font-bold">LOD Levels</div>
        {LEVEL_COLORS_HEX.slice(0, maxLevel + 1).map((color, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: color }} />
            <span>Level {i}</span>
          </div>
        ))}
      </div>

      {/* Instructions - positioned in bottom-right */}
      <div className="absolute bottom-3 right-3 bg-fd-background/50 backdrop-blur-md text-white px-3 py-2 rounded text-xs font-mono pointer-events-none text-right">
        <div>Hover to see neighbors</div>
      </div>
    </div>
  );
};

export default QuadtreeScene;
