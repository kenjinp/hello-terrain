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