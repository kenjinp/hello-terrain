# @hello-terrain/three

Realtime web terrain engine for vast virtual worlds. Built for [three.js](https://threejs.org/) WebGPU.

## Features

- Performant variable LOD system for huge (earth-scale!) open worlds
- Elevation manipulation, terrain holes, texture painting, overlays, colors, and wetness
- TSL-based elevation and texture assignment nodes
- Composable compute stage plugins

## Quick Start

### React Three Fiber

```jsx
import { useRef, useMemo, useEffect } from "react";
import { Canvas, extend, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three/webgpu";
import { float, Fn, vec2 } from "three/tsl";
import {
  terrainGraph,
  TerrainGeometry,
  TerrainMesh,
  innerTileSegments,
  elevationScale,
  elevationFn,
  cameraView,
  createInitialCameraView,
  readCameraView,
  quadtreeUpdateTask,
  positionNodeTask,
  voronoiCells,
} from "@hello-terrain/three";
import { task } from "@hello-terrain/work";

extend(THREE);
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
  const cameraScratch = useMemo(() => createInitialCameraView(), []);
  useFrame(async ({ camera, gl }) => {
    graph.set(cameraView, readCameraView(camera, cameraScratch));
    await graph.run({ resources: { renderer: gl } });
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
    <Canvas
      gl={async (props) => {
        const renderer = new THREE.WebGPURenderer({ ...props, antialias: true });
        await renderer.init();
        return renderer;
      }}
      camera={{ position: [0, 30, 60] }}
    >
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
  cameraView,
  createInitialCameraView,
  readCameraView,
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
const cameraScratch = createInitialCameraView();
renderer.setAnimationLoop(async () => {
  controls.update();
  graph.set(cameraView, readCameraView(camera, cameraScratch));
  await graph.run({ resources: { renderer } });
  renderer.render(scene, camera);
});
```

## Documentation

1. Read the [Introduction](http://hello-terrain.kenny.wtf/docs) to understand the architecture.
2. Read the [Installation](http://hello-terrain.kenny.wtf/docs/installation) guide.
3. Browse the [Examples](http://hello-terrain.kenny.wtf/examples).
4. Join the [Discord](https://discord.gg/HgTd2B828n) for support.
