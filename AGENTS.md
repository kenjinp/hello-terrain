IMPORTANT: before you do anything else, run the beans prime command and heed its output.

After priming, read the terrain specs in `packages/three/spec/` before making design or API changes:

- `packages/three/spec/README.md`
- `packages/three/spec/architecture.md`
- `packages/three/spec/naming-conventions.md`
- `packages/three/spec/concepts.md`

When naming or refactoring terrain APIs, follow `packages/three/spec/naming-conventions.md` as the source of truth.

Prefer functions over classes. 

In library internals, don't use three.js. Only expose three.js for consumer level methods. 

Don't use module-scope variables, as there maybe be mulitple instances of the terrain. 

Review the apps/docs and make sure that any API changes are reflected in the docs

## Terrain validation gym

Use `pnpm gym --mode cpu` for fast flat topology checks and `pnpm gym --software`
for the production browser compute/render/query scenario on Linux software Vulkan.
Install Chromium first with `pnpm --filter @hello-terrain/gym browser:install`.
Use `pnpm gym --list` to select relevant scenarios, then run flat-edit, flat-lod,
and instance-isolation as shared smoke coverage. Read the printed `summary.md`
and `run.json`; replay the recorded seed and input prefix when debugging.

Exit 1 means failed assertions; exit 2 means unsupported execution, harness error,
or an incomparable baseline. Do not treat missing GPU support as a pass. Compare
performance only on matched hardware/settings after correctness passes, and keep
quality/freshness beside timing. Never loosen oracles just to make a run green.
See `apps/docs/content/docs/docs/terrain-gym.mdx` for the measurement contracts.
