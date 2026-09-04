# @hello-terrain/work

[![npm version](https://img.shields.io/npm/v/@hello-terrain/work?style=for-the-badge&colorA=000000&colorB=000000)](https://www.npmjs.com/package/@hello-terrain/work)


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
- **`cache: "none"`**:
  - the task recomputes on every run
  - any downstream tasks are treated as dirty every run
  - within a run, downstream tasks can still depend on values computed earlier in the run

## Lanes and `laneConcurrency`

Tasks can be tagged with a **lane** (default `"cpu"`). Lanes become meaningful when you pass
`laneConcurrency` to `graph.run()`, which enables **per-lane concurrency limits** for that run.

- If `laneConcurrency` is **omitted** (or `{}`), tasks are **not throttled** by lane.
- If `laneConcurrency` is **provided and non-empty**, tasks acquire a permit for their lane before
  running. Lanes not listed in `laneConcurrency` default to **1 permit**.

```ts
import { graph, task } from "@hello-terrain/work";

const cpuTask = task((_get, work) => work(() => expensiveCompute()))
  .lane("cpu")
  .displayName("cpuTask");

const ioTask = task(async (_get, work, ctx) =>
  work(async () => fetch("https://example.com", { signal: ctx.signal })),
)
  .lane("io")
  .displayName("ioTask");

const g = graph();
g.add(cpuTask);
g.add(ioTask);

await g.run({
  targets: [cpuTask, ioTask],
  laneConcurrency: {
    cpu: 2,
    io: 8,
  },
});
```

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
