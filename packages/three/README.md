# @hello-terrain/three
Realtime web terrain engine, for vast virtual worlds. Built for [three.js](https://threejs.org/).
## Features

- Performant variable LOD system for huge (earth-scale!) open worlds
- Elevation manipulation, terrain holes, texture painting, overlays, colors, and wetness
- TSL-based elevation and texture assignment nodes
- Composable compute stage plugins

## Getting Started

1. Read the [Introduction](http://hello-terrain.kenny.wtf/docs) to understand the architecture and see how it's used.

2. Read the [Installation](http://hello-terrain.kenny.wtf/docs/installation) instructions.

3. Review the [Examples](http://hello-terrain.kenny.wtf/examples) to get an idea of how to do things.

4. For support, join the [Discord server](https://discord.gg/HgTd2B828n).

## Project Architecture
This library uses [unbuild](https://github.com/unjs/unbuild) for building.
- `src/index.ts` is the main entry point for your library exports
- Add your library code in the `src` folder
- `tests/` contains your test files


## Libraries
The following libraries are used - checkout the linked docs to learn more
- [unbuild](https://github.com/unjs/unbuild) - Unified JavaScript build system


## Tools
- [Vitest](https://vitest.dev/) - Fast unit test framework powered by Vite
- [Oxlint](https://oxc.rs/docs/guide/usage/linter) - A fast linter for JavaScript and TypeScript
- [Oxfmt](https://oxc.rs/docs/guide/usage/formatter) - Fast Prettier-compatible code formatter


## Development Commands
- `pnpm install` to install the dependencies
- `pnpm run build` to build the library into the `dist` folder
- `pnpm run test` to run the tests
- `pnpm run release` to build and publish to npm
