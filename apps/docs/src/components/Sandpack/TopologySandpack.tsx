"use client";

import { useState } from "react";
import { Sandpack } from "./Sandpack";

// Patch EventTarget.dispatchEvent so three.js's plain-object events
// (e.g. {type:'dispose'}) work in Sandpack's CJS bundler environment.
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
  background: #0b0e14;
}
`;

type TopologyExample = {
  /** Topology factory imported from @hello-terrain/three. */
  factory: string;
  /** The `create*Topology({...})` expression assigned to the topology prop. */
  topologyExpr: string;
  /** Extra useTerrain options (one per line, already indented). */
  terrainOptions: string;
  /** Body of the elevation callback (returns a TSL float node). */
  elevation: string;
  /** Camera `x, y, z` start position. */
  camera: string;
  /** Camera near plane. */
  near: number;
  /** Camera far plane. */
  far: number;
};

function buildAppCode(opts: TopologyExample): string {
  return `import { useMemo } from "react";
import { Canvas, extend } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three/webgpu";
import { float, vec2, Fn, Loop, dot, floor, fract, mix, sin, cos } from "three/tsl";
import { Terrain, useTerrain } from "@hello-terrain/react";
import { ${opts.factory} } from "@hello-terrain/three";
import type { ElevationCallback } from "@hello-terrain/three";

// Register the full three/webgpu namespace so R3F instantiates lights, meshes,
// and node materials from the SAME three module as the WebGPU renderer. With a
// partial extend, R3F builds AmbientLight/DirectionalLight from its default
// (core three) catalogue, the renderer's node-lights registry can't match them
// ("Light node not found for AmbientLight"), and the terrain renders unlit.
extend(THREE as any);

// ── TSL Perlin / fBm elevation ─────────────────────────────
const randomGradient = Fn(([p]) => {
  const angle = fract(
    sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)
  ).mul(Math.PI * 2);
  return vec2(cos(angle), sin(angle));
});

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

const fbm = Fn(([pos]) => {
  const p = vec2(pos).toVar();
  const total = float(0).toVar();
  const amp = float(0.5).toVar();
  const freq = float(1).toVar();
  Loop(5, () => {
    total.addAssign(perlinNoise(p.mul(freq)).mul(amp));
    freq.mulAssign(2.03);
    amp.mulAssign(0.5);
  });
  return total;
});

// ── Scene ──────────────────────────────────────────────────

function Scene() {
  const topology = useMemo(() => ${opts.topologyExpr}, []);
  const elevation = useMemo<ElevationCallback>(() => {
    return ({ worldPosition }) => {
${opts.elevation}
    };
  }, []);

  const terrain = useTerrain({
    topology,
${opts.terrainOptions}    elevation,
  });

  return (
    <Terrain terrain={terrain} innerTileSegments={13} maxNodes={512}>
      {({ positionNode }) => (
        <meshStandardNodeMaterial positionNode={positionNode} />
      )}
    </Terrain>
  );
}

export default function App() {
  return (
    <Canvas
      style={{ width: "100vw", height: "100vh" }}
      gl={async (props) => {
        props.alpha = true;
        props.antialias = true;
        const renderer = new THREE.WebGPURenderer(props);
        await renderer.init();
        return renderer;
      }}
      camera={{ position: [${opts.camera}], near: ${opts.near}, far: ${opts.far} }}
      dpr={[1, 1]}
      performance={{ min: 0.5 }}
    >
      <ambientLight intensity={0.15} />
      <directionalLight intensity={1} position={[1, 1, 1]} />
      <Scene />
      <OrbitControls makeDefault />
    </Canvas>
  );
}
`;
}

const COMMON_DEPENDENCIES = {
  three: "0.182.0",
  "@react-three/fiber": "9.5.0",
  "@react-three/drei": "10.7.7",
  "@hello-terrain/react": "0.0.0-alpha.11",
  "@hello-terrain/three": "0.0.0-alpha.11",
  "@hello-terrain/work": "0.3.0",
};

function TopologySandpack({ code }: { code: string }) {
  return (
    <Sandpack
      template="react-ts"
      showFileExplorer
      showLineNumbers
      editorHeight={500}
      activeFile="/App.tsx"
      dependencies={COMMON_DEPENDENCIES}
      files={{
        "/setup.ts": { code: SETUP_CODE, hidden: true },
        "/index.tsx": { code: INDEX_CODE, hidden: true },
        "/styles.css": { code: STYLES_CODE, hidden: true },
        "/App.tsx": code,
      }}
    />
  );
}

const FLAT_CODE = buildAppCode({
  factory: "createFlatTopology",
  topologyExpr: `createFlatTopology({
        rootSize: 256,
        origin: { x: 0, y: 0, z: 0 },
        maxHeight: 40,
      })`,
  terrainOptions: `    maxLevel: 10,
    maxNodes: 512,
    innerTileSegments: 13,
    elevationScale: 40,
    skirtScale: 8,
`,
  elevation: `  const p = vec2(worldPosition.x, worldPosition.z).mul(float(0.02));
  return fbm(p).sub(float(0.3));`,
  camera: "0, 80, 150",
  near: 0.1,
  far: 5000,
});

const INFINITE_FLAT_CODE = buildAppCode({
  factory: "createInfiniteFlatTopology",
  topologyExpr: `createInfiniteFlatTopology({
        rootSize: 200,
        origin: { x: 0, y: 0, z: 0 },
        rootGridRadius: 1,
        maxHeight: 30,
      })`,
  // rootSize must match the topology's root size for the GPU projection.
  terrainOptions: `    rootSize: 200,
    maxLevel: 10,
    maxNodes: 512,
    innerTileSegments: 13,
    elevationScale: 30,
    skirtScale: 8,
`,
  elevation: `  const p = vec2(worldPosition.x, worldPosition.z).mul(float(0.015));
  return fbm(p).sub(float(0.3));`,
  camera: "0, 60, 110",
  near: 0.1,
  far: 50000,
});

const CUBE_SPHERE_CODE = buildAppCode({
  factory: "createCubeSphereTopology",
  topologyExpr: `createCubeSphereTopology({
        radius: 1000,
        center: { x: 0, y: 0, z: 0 },
        maxHeight: 50,
      })`,
  // radius drives the GPU sphere projection.
  terrainOptions: `    radius: 1000,
    maxLevel: 10,
    maxNodes: 512,
    innerTileSegments: 13,
    elevationScale: 50,
    skirtScale: 4,
`,
  elevation: `  // Cheap 3D-ish noise: average three planar fBm slices so the
  // planet has no visible seams or pole pinching.
  const s = float(0.004);
  const n = fbm(vec2(worldPosition.y, worldPosition.z).mul(s))
    .add(fbm(vec2(worldPosition.z, worldPosition.x).mul(s)))
    .add(fbm(vec2(worldPosition.x, worldPosition.y).mul(s)))
    .div(float(3));
  return n.sub(float(0.45));`,
  camera: "0, 1200, 2600",
  near: 1,
  far: 100000,
});

const TABS = [
  { id: "flat", label: "Bounded flat", code: FLAT_CODE },
  { id: "infinite", label: "Infinite flat", code: INFINITE_FLAT_CODE },
  { id: "cube-sphere", label: "Cube-sphere", code: CUBE_SPHERE_CODE },
] as const;

/**
 * Tabbed topology examples. Only the active tab's Sandpack is mounted, so the
 * page never holds more than one WebGPU canvas at a time — three live WebGPU
 * contexts crash Chrome. Switching tabs unmounts the previous scene (the `key`
 * forces a fresh mount) which releases its renderer.
 */
export function TopologySandpackTabs() {
  const [activeId, setActiveId] = useState<(typeof TABS)[number]["id"]>(TABS[0].id);
  const activeTab = TABS.find((tab) => tab.id === activeId) ?? TABS[0];

  return (
    <div className="not-prose my-6">
      <div role="tablist" className="flex flex-wrap gap-1 border-b border-fd-border">
        {TABS.map((tab) => {
          const isActive = tab.id === activeId;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveId(tab.id)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "border-fd-primary text-fd-foreground"
                  : "border-transparent text-fd-muted-foreground hover:text-fd-foreground"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <TopologySandpack key={activeTab.id} code={activeTab.code} />
    </div>
  );
}
