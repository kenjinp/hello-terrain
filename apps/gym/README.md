# Terrain gym

From the repo root, run `pnpm gym --help` or `pnpm gym --list`.

Install the pinned browser with `pnpm --filter @hello-terrain/gym browser:install`.
Start with `pnpm gym --mode probe --software`, then `pnpm gym --software`.
Software Vulkan is a correctness environment, not a hardware performance baseline.

See [the workflow and measurement contracts](../docs/content/docs/docs/terrain-gym.mdx).

The browser adapter uses production `useTerrain`/`Terrain`; it does not implement
another terrain scheduler. Shared scenarios, mathematical oracles, and reports
live in `packages/three/gym`. Runs build workspace source and save artifacts in
`.gym/runs/`. Public library packages do not depend on the gym.
