# @hello-terrain/react

React bindings for Hello Terrain, built for [react-three/fiber](https://r3f.docs.pmnd.rs/) and WebGPU.

`@hello-terrain/react` uses the instance-owned terrain runtime from `@hello-terrain/three` with a React-first API:

- `Terrain` renders the terrain mesh and connects node materials
- `useTerrain()` creates and owns a `TerrainHandle`
- `TerrainProvider` and `useTerrainContext()` share terrain state with sibling systems
- `terrain.controller`, `terrain.status`, and `terrain.binding` expose configuration, publication, and scene queries

## Installation

```bash
pnpm add @hello-terrain/react @react-three/fiber three react react-dom
```

`@hello-terrain/react` depends on WebGPU and expects a `three/webgpu` renderer.

## Basic Example

```tsx
import { Terrain } from "@hello-terrain/react";
import { Canvas } from "@react-three/fiber";
import type { WebGPURendererParameters } from "three/src/renderers/webgpu/WebGPURenderer.js";
import { float } from "three/tsl";
import * as THREE from "three/webgpu";

const elevation = () => float(0);

export function App() {
  return (
    <Canvas
      gl={async (props) => {
        const renderer = new THREE.WebGPURenderer(
          props as WebGPURendererParameters,
        );
        await renderer.init();
        return renderer;
      }}
      camera={{ position: [0, 30, 60] }}
    >
      <ambientLight intensity={0.15} />
      <directionalLight intensity={1} position={[1, 1, 1]} />

      <Terrain rootSize={1024} maxLevel={6} elevation={elevation}>
        {({ positionNode }) => (
          <meshStandardNodeMaterial positionNode={positionNode} />
        )}
      </Terrain>
    </Canvas>
  );
}
```

## When To Use `useTerrain()`

Use `Terrain` by itself for the smallest setup. Reach for `useTerrain()` when you want to:

- reuse the same terrain handle across multiple components
- sample through `terrain.controller.query` or `terrain.binding.sampleWorld`
- share terrain state with sibling systems like controllers or cameras
- observe render/query revisions and coordinate managed input edits

## Public API

- `Terrain`
- `useTerrain`
- `TerrainProvider`
- `useTerrainContext`
- `TerrainHandle`
- `TerrainOptions`
- `TerrainMaterialContext` (from `@hello-terrain/three`)

## Docs

- [Introduction](https://hello-terrain.kenny.wtf/docs)
- [Installation](https://hello-terrain.kenny.wtf/docs/installation)
- [React Overview](https://hello-terrain.kenny.wtf/docs/react)
- [Examples](https://hello-terrain.kenny.wtf/examples)

## Support

For support, join the [Discord server](https://discord.gg/HgTd2B828n).
