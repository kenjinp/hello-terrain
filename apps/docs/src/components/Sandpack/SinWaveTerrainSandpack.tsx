"use client";

import { Sandpack } from "./Sandpack";

// Patch EventTarget.dispatchEvent so three.js's plain-object events
// (e.g. {type:'dispose'}) work in Sandpack's CJS bundler environment
// where three.js classes extend native EventTarget.
const SETUP_CODE = `
// Patch EventTarget.dispatchEvent for three.js CJS compat
const _dispatch = EventTarget.prototype.dispatchEvent;
EventTarget.prototype.dispatchEvent = function (event) {
  if (event && !(event instanceof Event) && event.type) {
    const e = new Event(event.type);
    for (const k of Object.keys(event)) {
      if (k !== "type") {
        try { e[k] = event[k]; } catch {}
      }
    }
    return _dispatch.call(this, e);
  }
  return _dispatch.call(this, event);
};

export {};
`;

const INDEX_CODE = `
import "./setup";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

const root = createRoot(document.getElementById("root")!);
root.render(
  <StrictMode>
    <App />
  </StrictMode>
);
`;

const STYLES_CODE = `html, body, #root {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #111;
}
`;

const APP_CODE = `import { useRef, useMemo, useEffect } from "react";
import { Canvas, extend, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three/webgpu";
import {
  float, vec2, vec3, vec4, Fn,
  normalize, max, dot, normalWorld,
} from "three/tsl";
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
} from "@hello-terrain/three";
import { task } from "@hello-terrain/work";
import type { ElevationCallback, UpdateParams } from "@hello-terrain/three";

// Extend R3F's catalogue with WebGPU-only and custom classes
extend({
  TerrainGeometry,
  TerrainMesh,
  MeshBasicNodeMaterial: THREE.MeshBasicNodeMaterial,
});

function SceneSetup() {
  const { scene } = useThree();
  useEffect(() => {
    scene.background = new THREE.Color("#292929");
  }, [scene]);
  return null;
}

function Terrain({ graph }) {
  const meshRef = useRef(null);
  const materialRef = useRef(null);
  const materialReadyRef = useRef(false);

  // Define the sin-wave elevation function (runs on GPU via TSL)
  useEffect(() => {
    const elevation: ElevationCallback = ({ worldPosition }) => {
      const frequency = float(0.3);
      const pos = vec2(worldPosition.x, worldPosition.z).mul(frequency);
      return pos.x.sin().add(pos.y.sin()).mul(float(0.5));
    };

    // attach the elevation function to the graph
    graph.set(elevationFn, () => elevation);

    // scale the elevation
    graph.set(elevationScale, () => 5);
  }, [graph]);

  // Apply position node + TSL lighting to the material
  useEffect(() => {
    graph.add(
      task((get, work) => {
        const positionNode = get(positionNodeTask);
        const leafSet = get(quadtreeUpdateTask);
        return work(() => {
          const mesh = meshRef.current;
          const material = materialRef.current;
          if (mesh && leafSet?.count !== undefined) {
            mesh.count = leafSet.count;
          }
          if (material && positionNode) {
            material.positionNode = positionNode;

            // Compute lighting entirely in TSL — bypasses the scene
            // this is only necessary when having multiple sandpack scenes
            if (!materialReadyRef.current) {
              material.outputNode = Fn(() => {
                const baseColor = vec3(0.87, 0.57, 0.29);
                const lightDir = normalize(vec3(0.5, 0.8, 0.3));
                const ambient = float(0.3);
                const diff = max(dot(normalWorld, lightDir), float(0));
                return vec4(
                  baseColor.mul(ambient.add(diff.mul(float(0.7)))),
                  float(1)
                );
              })();
              materialReadyRef.current = true;
            }

            material.needsUpdate = true;
          }
        });
      }).displayName("applyPositionNodeTask"),
    );
  }, [graph]);

  // Update camera position and run the graph each frame
  useFrame(async ({ camera, gl }) => {
    graph.set(quadtreeUpdate, (prev: UpdateParams) => {
      prev.cameraOrigin.x = camera.position.x;
      prev.cameraOrigin.y = camera.position.y;
      prev.cameraOrigin.z = camera.position.z;
      return prev;
    });
    await graph.run({ resources: { renderer: gl } });
  });

  return (
    <terrainMesh
      ref={meshRef}
      innerTileSegments={innerTileSegments.get()}
      maxNodes={1024}
    >
      <meshBasicNodeMaterial ref={materialRef} />
    </terrainMesh>
  );
}

export default function App() {
  const graph = useMemo(() => terrainGraph(), []);

  return (
    <Canvas
      style={{ width: "100vw", height: "100vh" }}
      gl={async (props) => {
        const renderer = new THREE.WebGPURenderer({
          ...props,
          antialias: true,
        });
        await renderer.init();
        return renderer;
      }}
      camera={{ position: [0, 30, 60] }}
    >
      <SceneSetup />
      <Terrain graph={graph} />
      <OrbitControls />
    </Canvas>
  );
}
`;

export function SinWaveTerrainSandpack() {
  return (
    <Sandpack
      template="react-ts"
      showFileExplorer
      showLineNumbers
      editorHeight={500}
      activeFile="/App.tsx"
      dependencies={{
        three: "0.182.0",
        "@react-three/fiber": "9.5.0",
        "@react-three/drei": "10.7.7",
        "@hello-terrain/three": "0.0.0-alpha.6",
        "@hello-terrain/work": "0.1.1",
      }}
      files={{
        "/setup.ts": { code: SETUP_CODE, hidden: true },
        "/index.tsx": { code: INDEX_CODE, hidden: true },
        "/styles.css": { code: STYLES_CODE, hidden: true },
        "/App.tsx": APP_CODE,
      }}
    />
  );
}
