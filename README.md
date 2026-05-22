[![Discord Shield](https://img.shields.io/discord/900742295710728282?style=flat&colorA=000000&colorB=000000&label=&logo=discord&logoColor=ffffff)](https://discord.gg/HgTd2B828n)

[![Three.js](https://img.shields.io/badge/Three.js-000000?style=for-the-badge&logo=three.js&logoColor=white)](https://threejs.org/docs/) [![React-Three-Fiber](https://img.shields.io/badge/React--Three--Fiber-000000?style=for-the-badge&logo=react&logoColor=61DAFB)](https://docs.pmnd.rs/react-three-fiber) [![WebGPU](https://img.shields.io/badge/WebGPU-F34B7D?style=for-the-badge&logo=webgpu&logoColor=white&colorA=000000&colorB=000000)](https://threejs.org/docs/) [![npm version](https://img.shields.io/npm/v/@hello-terrain/three?style=for-the-badge&colorA=000000&colorB=000000&logo=hello-terrain/three&label=hello-terrain/three)](https://www.npmjs.com/package/@hello-terrain/three) [![npm version](https://img.shields.io/npm/v/@hello-terrain/react?style=for-the-badge&colorA=000000&colorB=000000&logo=hello-terrain/react&label=hello-terrain/react)](https://www.npmjs.com/package/@hello-terrain/react)



![A Quadtree Debug Scene using Hello-Terrain](https://kenny.wtf/hello-terrain.webp)

# hello-terrain

Realtime web terrain engine, for vast virtual worlds. Built for [three.js](https://threejs.org/) and [react-three/fiber](https://r3f.docs.pmnd.rs/getting-started/introduction).

## Features

- Performant variable LOD system for huge (earth-scale!) open worlds
- Elevation manipulation, terrain holes, texture painting, overlays, colors, and wetness
- TSL-based elevation and texture assignment nodes
- Composable compute stage plugins
- GPU render-side frustum culling with optional Hi-Z occlusion culling

## Getting Started

1. Read the [Introduction](http://hello-terrain.kenny.wtf/docs) to understand the architecture and see how it's used.

2. Read the [Installation](http://hello-terrain.kenny.wtf/docs/installation) instructions.

3. Review the [Examples](http://hello-terrain.kenny.wtf/examples) to get an idea of how to do things.

4. For support, join the [Discord server](https://discord.gg/HgTd2B828n).

## React Example

If you're using `@hello-terrain/react`, the smallest setup is a WebGPU `Canvas` plus a `Terrain` render prop:

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
    >
      <Terrain rootSize={1024} maxLevel={6} elevation={elevation}>
        {({ positionNode }) => (
          <meshStandardNodeMaterial positionNode={positionNode} />
        )}
      </Terrain>
    </Canvas>
  );
}
```

See the [React overview](http://hello-terrain.kenny.wtf/docs/react) and the package readme at [`packages/react/README.md`](packages/react/README.md) for the full API and runtime patterns.

## Shoutouts

inspired by [Terrain3D](https://github.com/TokisanGames/Terrain3D) with a quad-tree twist.

This monorepo workspace was generated with [create-krispya](https://github.com/krispya/create-krispya).
