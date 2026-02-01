# @hello-terrain/work

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
