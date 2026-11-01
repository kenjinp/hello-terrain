[![Discord Shield](https://img.shields.io/discord/900742295710728282?style=flat&colorA=000000&colorB=000000&label=&logo=discord&logoColor=ffffff)](https://discord.gg/HgTd2B828n)

[![Three.js](https://img.shields.io/badge/Three.js-000000?style=for-the-badge&logo=three.js&logoColor=white)](https://threejs.org/docs/) [![React-Three-Fiber](https://img.shields.io/badge/React--Three--Fiber-000000?style=for-the-badge&logo=react&logoColor=61DAFB)](https://docs.pmnd.rs/react-three-fiber) [![WebGPU](https://img.shields.io/badge/WebGPU-F34B7D?style=for-the-badge&logo=webgpu&logoColor=white&colorA=000000&colorB=000000)](https://threejs.org/docs/) [![npm version](https://img.shields.io/npm/v/@hello-terrain/three?style=for-the-badge&colorA=000000&colorB=000000&logo=hello-terrain/three&label=hello-terrain/three)](https://www.npmjs.com/package/@hello-terrain/three) [![npm version](https://img.shields.io/npm/v/@hello-terrain/react?style=for-the-badge&colorA=000000&colorB=000000&logo=hello-terrain/react&label=hello-terrain/react)](https://www.npmjs.com/package/@hello-terrain/react)



![A Quadtree Debug Scene using Hello-Terrain](https://kenny.wtf/hello-terrain.webp)

# hello-terrain

Realtime web terrain engine, for vast virtual worlds. Built for [three.js](https://threejs.org/) and [react-three/fiber](https://r3f.docs.pmnd.rs/getting-started/introduction).

## Features

- Quadtree-based variable LOD for flat, infinite-flat, cube-sphere, and torus terrain
- GPU-evaluated TSL elevation functions and derived terrain normals
- Custom appearance through three.js node materials
- Composable compute stage plugins
- Procedural and authored material controls, packed texture arrays, and hole-aware rendering

Core texturing includes UV/vertical mapping, per-corner detiling, height blending, and optional hole-aware CPU queries/raycast. [Runnable examples](https://hello-terrain.kenny.wtf/examples/materials/procedural-texturing) begin with this phase. Triplanar/hex/bombing quality methods, painting tools, overlays, caches, and wetness remain planned; this is not a Terrain3D file importer or physics-collision integration.

## Getting Started

1. Read the [Introduction](http://hello-terrain.kenny.wtf/docs) to understand the architecture and see how it's used.

2. Read the [Installation](http://hello-terrain.kenny.wtf/docs/installation) instructions.

3. Review the [Examples](http://hello-terrain.kenny.wtf/examples) to get an idea of how to do things.

4. For support, join the [Discord server](https://discord.gg/HgTd2B828n).

## React Example

If you're using `@hello-terrain/react`, the smallest setup is a `Canvas` plus a `Terrain` render prop. With React Three Fiber 10 the default `Canvas` already renders with `WebGPURenderer`:

```tsx
import { Terrain } from "@hello-terrain/react";
import { Canvas } from "@react-three/fiber";
import { float } from "three/tsl";

const elevation = () => float(0);

export function App() {
  return (
    <Canvas renderer={{ antialias: true }}>
      <Terrain rootSize={1024} maxLevel={6} elevation={elevation}>
        {({ positionNode }) => (
          <meshStandardNodeMaterial positionNode={positionNode} />
        )}
      </Terrain>
    </Canvas>
  );
}
```

On React Three Fiber 8 or 9, build the renderer yourself with an async `gl` factory that returns an initialized `WebGPURenderer` from `three/webgpu`; see [Installation](http://hello-terrain.kenny.wtf/docs/installation).

See the [React overview](http://hello-terrain.kenny.wtf/docs/react) and the package readme at [`packages/react/README.md`](packages/react/README.md) for the full API and runtime patterns.

## Shoutouts

inspired by [Terrain3D](https://github.com/TokisanGames/Terrain3D) with a quad-tree twist.

This monorepo workspace was generated with [create-krispya](https://github.com/krispya/create-krispya).
