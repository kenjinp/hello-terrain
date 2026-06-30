IMPORTANT: before you do anything else, run the beans prime command and heed its output.

After priming, read the terrain specs in `packages/three/spec/` before making design or API changes:

- `packages/three/spec/README.md`
- `packages/three/spec/architecture.md`
- `packages/three/spec/naming-conventions.md`
- `packages/three/spec/concepts.md`

When naming or refactoring terrain APIs, follow `packages/three/spec/naming-conventions.md` as the source of truth.

Prefer functions over classes. 

In library internals, don't use three.js. Only expose three.js for consumer level methods. 

When you do import three.js, import runtime values only from its public entry points — `three`, `three/tsl`, `three/webgpu`. Never import values from deep source paths (`three/src/*`): they create a second TSL/node instance that fails to compile against a consumer's renderer, so the terrain silently doesn't render while the rest of the scene does. Type-only imports from `three/src/*` are fine but must be written as `import type`. See `packages/three/spec/patterns.md` → "Import three.js Only Through Public Entry Points".

Don't use module-scope variables, as there maybe be mulitple instances of the terrain. 

Review the apps/docs and make sure that any API changes are reflected in the docs
