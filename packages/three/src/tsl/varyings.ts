import { varyingProperty } from "three/tsl";

/**
 * Module-scope varying *declarations* (not runtime state).
 *
 * These are intentionally shared across terrain instances and materials, which
 * is safe in three's TSL:
 *
 * - `varyingProperty(type, name)` returns a `PropertyNode` with `global = true`
 *   and no `.value`. It carries only its type and shader name.
 * - Every per-compile artifact (the `NodeVarying`, generated shader symbol,
 *   usage counts) lives in the `NodeBuilder` that compiles a given material,
 *   via `builder.getDataFromNode(node)` / `builder.getVaryingFromNode(node)`,
 *   never on the node itself. Two materials compiled from the same node get
 *   independent varyings.
 * - three declares its own built-ins the same way at module scope
 *   (`diffuseColor`, `roughness`, `metalness`, ... in `PropertyNode.js`).
 *
 * The "no module-scope variables" rule targets mutable per-instance state
 * (scratch objects, caches, GPU resources); pure node declarations like these
 * are the sanctioned exception. See `tests/no-module-scope-state.test.ts`.
 */

export const vGlobalVertexIndex = /*@__PURE__*/ varyingProperty("int", "vGlobalVertexIndex");

export const vElevation = /*@__PURE__*/ varyingProperty("f32", "vElevation");
