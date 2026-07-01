"use client";

import { Sandpack } from "./Sandpack";

const SETUP_CODE = `
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
import { Canvas, extend, useFrame, useLoader, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three/webgpu";
import {
  float, vec2, vec3, vec4, Fn, texture,
  normalize, max, dot, normalWorld,
} from "three/tsl";
import { EXRLoader } from "three/examples/jsm/loaders/EXRLoader.js";
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
  positionNodeTask,
  visibleLeafSetTask,
} from "@hello-terrain/three";
import { task } from "@hello-terrain/work";
import type { ElevationCallback } from "@hello-terrain/three";

extend({
  TerrainGeometry,
  TerrainMesh,
  MeshBasicNodeMaterial: THREE.MeshBasicNodeMaterial,
});

// ── Scene ──────────────────────────────────────────────────

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

  // Load the EXR heightmap
  const heightmap = useLoader(
    EXRLoader,
    "https://hello-terrain.kenny.wtf/external/everest-2.exr",
  );
  heightmap.wrapS = heightmap.wrapT = THREE.ClampToEdgeWrapping;
  heightmap.minFilter = THREE.LinearFilter;
  heightmap.magFilter = THREE.LinearFilter;

  // Sample the heightmap in the elevation function using rootUV
  useEffect(() => {
    const elevation: ElevationCallback = ({ rootUV }) => {
      return texture(heightmap, rootUV).x;
    };

    graph.set(elevationFn, () => elevation);
    graph.set(elevationScale, () => 30);
  }, [graph, heightmap]);

  useEffect(() => {
    graph.add(
      task((get, work) => {
        const positionNode = get(positionNodeTask);
        const leafSet = get(visibleLeafSetTask).leaves;
        return work(() => {
          const mesh = meshRef.current;
          const material = materialRef.current;
          if (mesh && leafSet?.count !== undefined) {
            mesh.count = leafSet.count;
          }
          if (material && positionNode) {
            material.positionNode = positionNode;

            if (!materialReadyRef.current) {
              material.outputNode = Fn(() => {
                const baseColor = vec3(0.42, 0.55, 0.33);
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

  const cameraViewScratchRef = useRef(createInitialCameraView());

  useFrame(async ({ camera, gl }) => {
    graph.set(cameraView, readCameraView(camera, cameraViewScratchRef.current));
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

export function HeightmapTerrainSandpack() {
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
