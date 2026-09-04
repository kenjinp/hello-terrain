"use client";

import { ExamplesCanvas } from "@/components/ExamplesCanvas";
import { FpsDebug } from "@/components/FpsDebug";
import {
  tileColorsLevaControl,
  tileInstanceColorNode,
} from "@/examples/terrain/tileInstanceColor";
import { RunTimingBars } from "@/components/RunTimingBars";
import { TerrainTileDebug } from "@/components/TerrainTileDebug";
import {
  elevationFn,
  elevationScale,
  innerTileSegments,
  maxLevel,
  maxNodes,
  positionNodeTask,
  quadtreeUpdate,
  rootSize,
  skirtScale,
  TerrainGeometry,
  terrainGraph,
  TerrainMesh,
  terrainTasks,
  type ElevationCallback,
  type LeafSet,
  type TerrainGraph,
  type TerrainTileBounds,
  type UpdateParams,
} from "@hello-terrain/three";
import { OrbitControls } from "@react-three/drei";
import { Canvas, extend, useFrame } from "@react-three/fiber";
import { useControls, useCreateStore } from "leva";
import { useEffect, useMemo, useRef } from "react";
import type { WebGPURendererParameters } from "three/src/renderers/webgpu/WebGPURenderer.js";
import {
  cos,
  dot,
  float,
  floor,
  Fn,
  fract,
  Loop,
  max,
  mix,
  normalize,
  normalWorld,
  sin,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";

extend(THREE as any);
extend({ TerrainGeometry, TerrainMesh });

type LevaStore = ReturnType<typeof useCreateStore>;

const randomGradient = Fn(([p]: [any]) => {
  const angle = fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)).mul(Math.PI * 2);
  return vec2(cos(angle), sin(angle));
});

const perlinNoise = Fn(([p]: [any]) => {
  const i = floor(p).toVar();
  const f = fract(p).toVar();
  const u = f.mul(f).mul(float(3).sub(f.mul(2)));
  const g00 = randomGradient(i);
  const g10 = randomGradient(i.add(vec2(1, 0)));
  const g01 = randomGradient(i.add(vec2(0, 1)));
  const g11 = randomGradient(i.add(vec2(1, 1)));
  const d00 = dot(g00, f);
  const d10 = dot(g10, f.sub(vec2(1, 0)));
  const d01 = dot(g01, f.sub(vec2(0, 1)));
  const d11 = dot(g11, f.sub(vec2(1, 1)));
  return mix(mix(d00, d10, u.x), mix(d01, d11, u.x), u.y).add(0.5);
});

const fbm = Fn(([pos_immutable]: [any]) => {
  const p = vec2(pos_immutable).toVar();
  const total = float(0).toVar();
  const amp = float(0.5).toVar();
  const freq = float(1).toVar();
  Loop(6, () => {
    total.addAssign(perlinNoise(p.mul(freq)).mul(amp));
    freq.mulAssign(2.03);
    amp.mulAssign(0.5);
  });
  return total;
});

const VERTICES_PER_BOX = 24;
const FLOATS_PER_BOX = VERTICES_PER_BOX * 3;

function writeBoxEdges(
  out: Float32Array,
  offset: number,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
) {
  let i = offset;
  const edge = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
    out[i++] = x0;
    out[i++] = y0;
    out[i++] = z0;
    out[i++] = x1;
    out[i++] = y1;
    out[i++] = z1;
  };
  edge(minX, minY, minZ, maxX, minY, minZ);
  edge(maxX, minY, minZ, maxX, minY, maxZ);
  edge(maxX, minY, maxZ, minX, minY, maxZ);
  edge(minX, minY, maxZ, minX, minY, minZ);
  edge(minX, maxY, minZ, maxX, maxY, minZ);
  edge(maxX, maxY, minZ, maxX, maxY, maxZ);
  edge(maxX, maxY, maxZ, minX, maxY, maxZ);
  edge(minX, maxY, maxZ, minX, maxY, minZ);
  edge(minX, minY, minZ, minX, maxY, minZ);
  edge(maxX, minY, minZ, maxX, maxY, minZ);
  edge(maxX, minY, maxZ, maxX, maxY, maxZ);
  edge(minX, minY, maxZ, minX, maxY, maxZ);
}

const MAX_BOXES = 1024;

function makeBoxGeo() {
  const geo = new THREE.BufferGeometry();
  const attr = new THREE.BufferAttribute(new Float32Array(MAX_BOXES * FLOATS_PER_BOX), 3);
  attr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("position", attr);
  geo.setDrawRange(0, 0);
  return geo;
}

function TileBoundsViz({ g, currentRootSize }: { g: TerrainGraph; currentRootSize: number }) {
  const geo = useMemo(makeBoxGeo, []);

  useFrame(() => {
    const leafSet = g.peek(terrainTasks.quadtreeUpdate) as LeafSet | undefined;
    const terrainQuery = g.peek(terrainTasks.terrainQuery)?.query;

    if (!leafSet || !terrainQuery) {
      geo.setDrawRange(0, 0);
      return;
    }

    const count = leafSet.count;
    // This example keeps terrain origin at the default (0, 0, 0).
    const originX = 0;
    const originZ = 0;
    let attr = geo.getAttribute("position") as THREE.BufferAttribute;
    let positions = attr.array as Float32Array;
    const floatsNeeded = count * FLOATS_PER_BOX;
    if (positions.length < floatsNeeded) {
      positions = new Float32Array(Math.max(floatsNeeded, MAX_BOXES * FLOATS_PER_BOX));
      attr = new THREE.BufferAttribute(positions, 3);
      attr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute("position", attr);
    }

    const halfRoot = currentRootSize * 0.5;
    let vertexCount = 0;

    for (let i = 0; i < count; i++) {
      const level = leafSet.level[i]!;
      const tx = leafSet.x[i]!;
      const ty = leafSet.y[i]!;
      const tileSize = currentRootSize / 2 ** level;
      const tileMinX = originX + tx * tileSize - halfRoot;
      const tileMinZ = originZ + ty * tileSize - halfRoot;
      const centerX = tileMinX + tileSize * 0.5;
      const centerZ = tileMinZ + tileSize * 0.5;

      const bounds: TerrainTileBounds | null = terrainQuery.getTileBounds(centerX, centerZ);
      if (!bounds) continue;

      writeBoxEdges(
        positions,
        vertexCount * 3,
        tileMinX,
        bounds.minElevation,
        tileMinZ,
        tileMinX + tileSize,
        bounds.maxElevation,
        tileMinZ + tileSize,
      );
      vertexCount += VERTICES_PER_BOX;
    }

    attr.needsUpdate = true;
    geo.setDrawRange(0, vertexCount);
  });

  return (
    <lineSegments args={[geo]} frustumCulled={false}>
      <lineBasicMaterial color={"red"} transparent />
    </lineSegments>
  );
}

function TileBoundsSceneImpl({ g, store }: { g: TerrainGraph; store: LevaStore }) {
  const meshRef = useRef<TerrainMesh | null>(null);
  const materialRef = useRef<THREE.MeshBasicNodeMaterial | null>(null);
  const lastPositionNodeRef = useRef<THREE.TSL.ShaderCallNodeInternal | null>(null);
  const lastCameraRef = useRef(new THREE.Vector3());

  const controls = useControls(
    "Terrain",
    {
      rootSize: {
        value: 1024,
        min: 64,
        max: 4096,
        step: 64,
        label: "root size",
      },
      elevationScale: {
        value: 15,
        min: 1,
        max: 100,
        step: 1,
        label: "elevation scale",
      },
      maxLevel: { value: 12, min: 2, max: 24, step: 2, label: "max level" },
      innerTileSegments: {
        value: 13,
        min: 3,
        max: 64,
        step: 1,
        label: "tile segments",
      },
      tileColors: tileColorsLevaControl,
    },
    { store },
  );

  useEffect(() => {
    g.set(maxNodes, 1024);
    g.set(skirtScale, 100);
  }, [g]);

  useEffect(() => {
    g.set(rootSize, () => controls.rootSize);
  }, [g, controls.rootSize]);

  useEffect(() => {
    g.set(elevationScale, () => controls.elevationScale);
    g.set(maxLevel, () => controls.maxLevel);
    g.set(innerTileSegments, () => controls.innerTileSegments);
  }, [g, controls.elevationScale, controls.maxLevel, controls.innerTileSegments]);

  useEffect(() => {
    const elevation: ElevationCallback = ({ worldPosition }) => {
      const p = vec2(worldPosition.x, worldPosition.z).mul(float(0.05));
      return fbm(p).sub(float(0.3));
    };
    g.set(elevationFn, () => elevation);
  }, [g]);

  const terrainColorNode = useMemo(
    () =>
      Fn(() => {
        const baseColor = vec3(0.38, 0.53, 0.36);
        const lightDir = normalize(vec3(0.5, 0.8, 0.3));
        const ambient = float(0.32);
        const diff = max(dot(normalWorld, lightDir), float(0));
        return vec4(baseColor.mul(ambient.add(diff.mul(0.68))), float(1));
      })(),
    [],
  );

  const colorNode = controls.tileColors ? tileInstanceColorNode : terrainColorNode;

  useFrame(async ({ camera, gl }) => {
    if (lastCameraRef.current.distanceToSquared(camera.position) >= 0.05 * 0.05) {
      g.set(quadtreeUpdate, (prev: UpdateParams) => ({
        ...prev,
        cameraOrigin: {
          x: camera.position.x,
          y: camera.position.y,
          z: camera.position.z,
        },
      }));
      lastCameraRef.current.copy(camera.position);
    }

    await g.run({
      resources: { renderer: gl as unknown as THREE.WebGPURenderer },
    });

    const mesh = meshRef.current;
    if (!mesh) return;

    const leaves = g.peek(terrainTasks.quadtreeUpdate) as LeafSet | undefined;
    if (leaves && mesh.count !== leaves.count) {
      mesh.count = leaves.count;
      mesh.instanceMatrix.needsUpdate = true;
    }

    const positionNode = g.peek(positionNodeTask);
    const material = materialRef.current;
    if (material && positionNode && positionNode !== lastPositionNodeRef.current) {
      material.positionNode = positionNode;
      material.needsUpdate = true;
      lastPositionNodeRef.current = positionNode;
    }
  });

  return (
    <>
      <terrainMesh ref={meshRef} innerTileSegments={controls.innerTileSegments} maxNodes={1024}>
        <meshBasicNodeMaterial ref={materialRef} colorNode={colorNode} />
      </terrainMesh>
      <TileBoundsViz g={g} currentRootSize={controls.rootSize} />
    </>
  );
}

export default function TileBoundsScene() {
  const store = useCreateStore();
  const g = useMemo(() => terrainGraph(), []);

  return (
    <ExamplesCanvas store={store}>
      <div className="pointer-events-none absolute z-10 bottom-2 left-2 right-2 md:left-auto md:bottom-4 md:right-4 md:max-w-xs flex flex-col gap-1.5">
        <RunTimingBars graph={g} />
        <div className="flex flex-row gap-1.5">
          <TerrainTileDebug graph={g} />
          <FpsDebug />
        </div>
      </div>
      <Canvas
        className="touch-none relative w-full h-full top-0 left-0"
        gl={async (props) => {
          props.alpha = true;
          props.antialias = true;
          const renderer = new THREE.WebGPURenderer(props as WebGPURendererParameters);
          await renderer.init();
          return renderer;
        }}
        camera={{ position: [0, 38, 70], near: 0.1, far: 4096 * 2 }}
        dpr={[1, 1]}
        performance={{ min: 0.5 }}
      >
        <ambientLight intensity={0.25} />
        <directionalLight intensity={1.1} position={[1, 1, 1]} />
        <TileBoundsSceneImpl g={g} store={store} />
        <OrbitControls makeDefault target={[0, 4, 0]} />
        <fog attach="fog" args={["#171720", 50, 512]} />
      </Canvas>
    </ExamplesCanvas>
  );
}
