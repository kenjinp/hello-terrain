# @hello-terrain/three

Realtime web terrain engine for vast virtual worlds. Built for [three.js](https://threejs.org/) WebGPU.

## Features

- Quadtree-based variable LOD for flat, infinite-flat, cube-sphere, and torus terrain
- GPU-evaluated TSL elevation functions and derived terrain normals
- Custom appearance through three.js node materials
- Composable compute stage plugins
- Procedural/authored uint material controls, packed texture arrays, and hole-aware rendering

Core texturing provides `textureFn`, runtime/prepacked texture sets, UV/vertical projection, detiling, and height blending. CPU hole/material queries require opt-in `textureReadback`; without it, CPU queries and rays remain geometric. See the [texturing contract](https://hello-terrain.kenny.wtf/docs/core/nodes/texturing) and [runnable examples](https://hello-terrain.kenny.wtf/examples/materials/procedural-texturing). Triplanar/hex/bombing quality methods, painting tools, overlays, caches, and wetness remain planned. No Terrain3D file compatibility or physics-collision integration is implied.

## Requirements

`three` `0.183.0` or newer, rendered with `WebGPURenderer` from `three/webgpu`.

## Quick Start

### React Three Fiber

React Three Fiber 10 (the default `Canvas` renders with `WebGPURenderer`):

```jsx
import { useRef, useMemo, useEffect } from "react";
import { Canvas, extend, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { float, Fn, vec2 } from "three/tsl";
import {
  terrainGraph,
  TerrainGeometry,
  TerrainMesh,
  innerTileSegments,
  elevationScale,
  elevationFn,
  quadtreeUpdate,
  quadtreeUpdateTask,
  positionNodeTask,
  voronoiCells,
} from "@hello-terrain/three";
import { task } from "@hello-terrain/work";

extend({ TerrainGeometry, TerrainMesh });

function Terrain({ graph }) {
  const meshRef = useRef(null);
  const materialRef = useRef(null);

  // Define the elevation function (runs on the GPU)
  useEffect(() => {
    graph.set(elevationFn, () => ({ worldPosition }) => {
      return voronoiCells({
        scale: float(1),
        facet: 0,
        seed: 0,
        uv: vec2(worldPosition.x, worldPosition.z).mul(0.5),
      }).mul(0.5);
    });
    graph.set(elevationScale, () => 10);
  }, [graph]);

  // Apply position node to the material when graph produces it
  useEffect(() => {
    graph.add(
      task((get, work) => {
        const positionNode = get(positionNodeTask);
        const leafSet = get(quadtreeUpdateTask);
        return work(() => {
          const mesh = meshRef.current;
          const material = materialRef.current;
          if (mesh && leafSet?.count !== undefined) mesh.count = leafSet.count;
          if (material && positionNode) {
            material.positionNode = positionNode;
            material.needsUpdate = true;
          }
        });
      }).displayName("applyPositionNodeTask"),
    );
  }, [graph]);

  // Update camera and run the graph each frame
  useFrame(async ({ camera, renderer }) => {
    graph.set(quadtreeUpdate, (prev) => {
      prev.cameraOrigin.x = camera.position.x;
      prev.cameraOrigin.y = camera.position.y;
      prev.cameraOrigin.z = camera.position.z;
      return prev;
    });
    await graph.run({ resources: { renderer } });
  });

  return (
    <terrainMesh ref={meshRef} innerTileSegments={innerTileSegments.get()} maxNodes={1024}>
      <meshStandardNodeMaterial ref={materialRef} />
    </terrainMesh>
  );
}

export default function App() {
  const graph = useMemo(() => terrainGraph(), []);
  return (
    <Canvas renderer={{ antialias: true }} camera={{ position: [0, 30, 60] }}>
      <ambientLight intensity={0.5} />
      <directionalLight position={[1, 1, 1]} />
      <Terrain graph={graph} />
      <OrbitControls />
    </Canvas>
  );
}
```

### Vanilla Three.js

```js
import * as THREE from "three/webgpu";
import { float, vec2 } from "three/tsl";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  terrainGraph,
  TerrainMesh,
  innerTileSegments,
  elevationScale,
  elevationFn,
  quadtreeUpdate,
  quadtreeUpdateTask,
  positionNodeTask,
  voronoiCells,
} from "@hello-terrain/three";
import { task } from "@hello-terrain/work";

// Renderer
const renderer = new THREE.WebGPURenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);
await renderer.init();

// Scene & camera
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100000);
camera.position.set(0, 30, 60);
const controls = new OrbitControls(camera, renderer.domElement);

// Terrain
const material = new THREE.MeshStandardNodeMaterial();
const mesh = new TerrainMesh({ innerTileSegments: innerTileSegments.get(), maxNodes: 1024, material });
scene.add(mesh);
scene.add(new THREE.AmbientLight(0xffffff, 0.5));
scene.add(new THREE.DirectionalLight(0xffffff, 1));

// Task graph
const graph = terrainGraph();

graph.set(elevationFn, () => ({ worldPosition }) => {
  return voronoiCells({
    scale: float(1),
    facet: 0,
    seed: 0,
    uv: vec2(worldPosition.x, worldPosition.z).mul(0.5),
  }).mul(0.5);
});
graph.set(elevationScale, () => 10);

// Apply graph outputs to the mesh
graph.add(
  task((get, work) => {
    const positionNode = get(positionNodeTask);
    const leafSet = get(quadtreeUpdateTask);
    return work(() => {
      if (leafSet?.count !== undefined) mesh.count = leafSet.count;
      if (positionNode) {
        material.positionNode = positionNode;
        material.needsUpdate = true;
      }
    });
  }).displayName("applyPositionNodeTask"),
);

// Render loop
renderer.setAnimationLoop(async () => {
  controls.update();
  graph.set(quadtreeUpdate, (prev) => {
    prev.cameraOrigin.x = camera.position.x;
    prev.cameraOrigin.y = camera.position.y;
    prev.cameraOrigin.z = camera.position.z;
    return prev;
  });
  await graph.run({ resources: { renderer } });
  renderer.render(scene, camera);
});
```

## Documentation

1. Read the [Introduction](http://hello-terrain.kenny.wtf/docs) to understand the architecture.
2. Read the [Installation](http://hello-terrain.kenny.wtf/docs/installation) guide.
3. Browse the [Examples](http://hello-terrain.kenny.wtf/examples).
4. Join the [Discord](https://discord.gg/HgTd2B828n) for support.
