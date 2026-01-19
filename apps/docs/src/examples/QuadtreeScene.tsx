"use client";

import {
  distanceBasedSubdivision,
  isSkirtUV,
  isSkirtVertex,
  Quadtree,
  type QuadtreeParams,
  TerrainGeometry,
} from "@hello-terrain/three";
import { OrbitControls } from "@react-three/drei";
import { Canvas, extend, useFrame, useThree } from "@react-three/fiber";
import { useControls } from "leva";
import { useEffect, useMemo, useRef, useState } from "react";
import type { WebGPURendererParameters } from "three/src/renderers/webgpu/WebGPURenderer.js";
import {
  abs,
  float,
  Fn,
  fract,
  fwidth,
  max,
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

interface TileInfo {
  count: number;
  deepestLevel: number;
}

interface QuadtreeTerrainProps {
  onTileInfoUpdate: (info: TileInfo) => void;
}

const QuadtreeTerrain = ({ onTileInfoUpdate }: QuadtreeTerrainProps) => {
  const { camera } = useThree();
  const instancedMeshRef = useRef<THREE.InstancedMesh>(null);
  const tempMatrix = useRef(new THREE.Matrix4());
  const tempColor = useRef(new THREE.Color());

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

  // Position node for skirt vertices
  const positionNode = useMemo(() => {
    return Fn(() => {
      const wp = positionLocal;
      return select(isSkirtVertex(segments), vec3(wp.x, uniforms.uSkirtLength.negate(), wp.z), wp);
    })();
  }, [uniforms]);

  // Color node showing grid lines with pixel-perfect anti-aliasing
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
      const finalColor = tileColor
        .mul(float(1).sub(gridIntensity))
        .add(gridColor.mul(gridIntensity));
      return select(uniforms.uShowGrid, finalColor, tileColor);
    })();
  }, [uniforms]);

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
    const leaves = quadtree.getLeafNodes();
    const mesh = instancedMeshRef.current;

    if (!mesh) return;

    const config = quadtree.getConfig();

    // Update instance matrices and colors
    leaves.forEach((leaf, index) => {
      const nodeSize = config.rootSize / (1 << leaf.level);
      const worldX = config.origin.x + (leaf.x * nodeSize - 0.5 * config.rootSize) + nodeSize * 0.5;
      const worldZ = config.origin.z + (leaf.y * nodeSize - 0.5 * config.rootSize) + nodeSize * 0.5;

      // Create transform matrix
      // Scale X and Z by nodeSize, but keep Y at 1 so skirt length is consistent
      tempMatrix.current.identity();
      tempMatrix.current.makeScale(nodeSize, 1, nodeSize);
      tempMatrix.current.setPosition(worldX, 0, worldZ);

      mesh.setMatrixAt(index, tempMatrix.current);

      // Set color based on LOD level
      const colorIndex = Math.min(leaf.level, LEVEL_COLORS.length - 1);
      tempColor.current.copy(LEVEL_COLORS[colorIndex]);
      mesh.setColorAt(index, tempColor.current);
    });

    mesh.count = leaves.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }

    // Update info display
    onTileInfoUpdate({
      count: leaves.length,
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

const QuadtreeScene = () => {
  const [tileInfo, setTileInfo] = useState<TileInfo>({ count: 0, deepestLevel: 0 });
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
        <QuadtreeTerrain onTileInfoUpdate={setTileInfo} />
        <OrbitControls makeDefault target={[0, 0, 0]} />
      </Canvas>

      {/* Info overlay - positioned in top-left */}
      <div className="absolute top-3 left-3 bg-fd-background/50 backdrop-blur-md text-white px-3 py-2 rounded text-xs font-mono whitespace-nowrap pointer-events-none">
        <div>Tiles: {tileInfo.count}</div>
        <div>Deepest Level: {tileInfo.deepestLevel}</div>
      </div>

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
    </div>
  );
};

export default QuadtreeScene;
