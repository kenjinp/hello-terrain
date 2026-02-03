# @hello-terrain/work

[![npm version](https://img.shields.io/npm/v/@hello-terrain/three?style=for-the-badge&colorA=000000&colorB=000000)](https://www.npmjs.com/package/@hello-terrain/work)


A small reactive task graph for typed async computations.

## Quick start

```ts
import { graph, param, task } from "@hello-terrain/work";

const value = param(2);

const calcSquare = task((get, work) => {
  const currentValue = get(value);
  return work(() => currentValue * currentValue);
});

const calcGraph = graph();
calcGraph.add(calcSquare);

await calcGraph.run();
calcGraph.get(calcSquare); // 4

value.set(4);

await calcGraph.run();
calcGraph.get(calcSquare); // 16
```

## Semantics

- **Dependency tracking**: tasks discover dependencies by calling `get(ref)` before `work(...)`.
- **Targets must be registered**: tasks passed as `targets` must be registered via `g.add(task)`.
- **Upstream tasks** referenced by `get(otherTask)` are registered automatically when discovered.
- **`cache:"none"`**:\n  - the task recomputes on every run\n  - any downstream tasks are treated as dirty every run\n  - within a run, downstream tasks can still depend on values computed earlier in the run

## Benchmarks

This package uses **mitata** for microbenchmarks:

```bash
pnpm --filter @hello-terrain/work bench
```

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

This library was generated with create-krispya
