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
import { Canvas, extend, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three/webgpu";
import {
  float, vec2, vec3, vec4, Fn, Loop,
  normalize, max, dot, normalWorld,
  floor, fract, mix, sin, cos,
} from "three/tsl";
import {
  terrainGraph,
  TerrainGeometry,
  TerrainMesh,
  innerTileSegments,
  elevationScale,
  elevationFn,
  quadtreeUpdate,
  positionNodeTask,
  visibleLeafSetTask,
  writeUpdateParamsFromCamera,
} from "@hello-terrain/three";
import { task } from "@hello-terrain/work";
import type { ElevationCallback, UpdateParams } from "@hello-terrain/three";

extend({
  TerrainGeometry,
  TerrainMesh,
  MeshBasicNodeMaterial: THREE.MeshBasicNodeMaterial,
});

// ── TSL noise helpers ──────────────────────────────────────

// Pseudo-random gradient from a 2D lattice point
const randomGradient = Fn(([p]) => {
  const angle = fract(
    sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)
  ).mul(Math.PI * 2);
  return vec2(cos(angle), sin(angle));
});

// Classic 2D Perlin noise
const perlinNoise = Fn(([p]) => {
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

// Fractal Brownian Motion — 6 octaves of Perlin noise using TSL Loop
const fbm = Fn(([pos_immutable]) => {
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

  useEffect(() => {
    const elevation: ElevationCallback = ({ worldPosition }) => {
      const p = vec2(worldPosition.x, worldPosition.z).mul(float(0.05));
      return fbm(p).sub(float(0.3));
    };

    graph.set(elevationFn, () => elevation);
    graph.set(elevationScale, () => 15);
  }, [graph]);

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

  useFrame(async ({ camera, gl }) => {
    graph.set(quadtreeUpdate, (prev: UpdateParams) => {
      return writeUpdateParamsFromCamera(prev, camera);
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

export function FbmTerrainSandpack() {
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
