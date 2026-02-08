/**
 * Compute-path tile functions.
 *
 * IMPORTANT: These functions intentionally do NOT use `.setLayout()`.
 *
 * When a TSL `Fn` uses `.setLayout()`, Three.js emits it as a standalone
 * WGSL function. If that function references storage buffers or uniforms
 * captured from a JavaScript closure, TSL cannot trace through the
 * `.setLayout()` boundary to discover those dependencies for the compute
 * pipeline's bind group. This causes "unresolved value" WGSL compilation
 * errors.
 *
 * By omitting `.setLayout()`, TSL inlines these functions into the compute
 * kernel and automatically discovers all storage buffer and uniform
 * dependencies. Since compute kernels typically call each helper once,
 * inlining has no meaningful code-size cost.
 *
 * Rule of thumb for library authors:
 *   - Compute-path functions that capture external resources (storage
 *     buffers, uniforms) from closures → do NOT use `.setLayout()`.
 *   - Vertex/fragment functions where the pipeline already directly
 *     references those resources → `.setLayout()` is safe.
 */

import { Fn, float, int, pow, vec2, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";
import type { LeafStorageState } from "../../tasks/quadtree.task";
import type { TerrainUniformsContext } from "../../tasks/uniforms/terrainUniforms";

export function createTileCompute(leafStorage: LeafStorageState, uniforms: TerrainUniformsContext) {
  // ── Property getters ───────────────────────────────────────────────

  const tileLevel = Fn(([nodeIndex]: [Node]) => {
    const nodeOffset = nodeIndex.mul(int(4));
    return leafStorage.node.element(nodeOffset).toInt();
  });

  const tileOriginVec2 = Fn(([nodeIndex]: [Node]) => {
    const nodeOffset = nodeIndex.mul(int(4));
    const nodeX = leafStorage.node.element(nodeOffset.add(int(1))).toFloat();
    const nodeY = leafStorage.node.element(nodeOffset.add(int(2))).toFloat();
    return vec2(nodeX, nodeY);
  });

  const tileSize = Fn(([nodeIndex]: [Node]) => {
    const rootSize = uniforms.uRootSize.toVar();
    const level = tileLevel(nodeIndex);
    return float(rootSize).div(pow(float(2), level.toFloat()));
  });

  // ── Compute-specific functions ─────────────────────────────────────

  // Compute-shader version of rootUV that derives world position from
  // node/tile data and localUV including the skirt ring.
  // localUV here is in [0, 1) based on workgroupId / tileEdgeVertexCount.
  // With an overlapping ring, the logical local coordinate range is
  // [-0.5 - step, 0.5 + step], where step = 1.0 / uSegments.
  const rootUVCompute = Fn(([nodeIndex, localUV]: [Node, Node]) => {
    const nodeVec2 = tileOriginVec2(nodeIndex);
    const nodeX = nodeVec2.x;
    const nodeY = nodeVec2.y;
    const rootSize = uniforms.uRootSize.toVar();
    const rootOrigin = uniforms.uRootOrigin.toVar();
    const size = tileSize(nodeIndex);

    const half = float(0.5);
    const halfRoot = float(rootSize).mul(half);

    // World-space center of this tile (without local offset)
    const centerX = rootOrigin.x.add(nodeX.add(half).mul(size)).sub(halfRoot);
    const centerZ = rootOrigin.z.add(nodeY.add(half).mul(size)).sub(halfRoot);

    // Reconstruct discrete indices and expand skirts outward by one inner step
    const fS = uniforms.uInnerTileSegments.toVar().toFloat();
    const fEdge = fS.add(float(3.0));
    const ix = localUV.x.mul(fEdge).floor();
    const iy = localUV.y.mul(fEdge).floor();
    // uExpanded/vExpanded are in [-1/S, 1 + 1/S], so skirt ring samples one step outside
    const uExpanded = ix.sub(float(1.0)).div(fS);
    const vExpanded = iy.sub(float(1.0)).div(fS);

    const localX = uExpanded.sub(half);
    const localZ = vExpanded.sub(half);

    // World position of this vertex (skirt shares border XZ)
    const worldX = centerX.add(localX.mul(size));
    const worldZ = centerZ.add(localZ.mul(size));

    // Map to root UV (continuous and tile-aligned)
    const centeredX = worldX.sub(rootOrigin.x);
    const centeredZ = worldZ.sub(rootOrigin.z);
    return vec2(
      centeredX.div(rootSize).add(half),
      centeredZ.div(rootSize).mul(float(-1.0)).add(half),
    );
  });

  const tileVertexWorldPositionCompute = Fn(([nodeIndex, localUV]: [Node, Node]) => {
    const half = float(0.5);
    const rootSize = uniforms.uRootSize.toVar();
    const rootOrigin = uniforms.uRootOrigin.toVar();
    const uvVal = rootUVCompute(nodeIndex, localUV);

    // Inverse of rootUV mapping
    const worldX = rootOrigin.x.add(uvVal.x.sub(half).mul(rootSize));
    const worldZ = rootOrigin.z.add(half.sub(uvVal.y).mul(rootSize));
    return vec3(worldX, rootOrigin.y, worldZ);
  });

  return {
    tileLevel,
    tileOriginVec2,
    tileSize,
    rootUVCompute,
    tileVertexWorldPositionCompute,
  };
}
