import { task } from "@hello-terrain/work";
import { Fn, float, int, packHalf2x16, storage, vec2 } from "three/tsl";
import type { Node } from "three/webgpu";
import { StorageBufferAttribute, WebGPURenderer } from "three/webgpu";
import { createComputeToBufferMap } from "../compute/gpu";
import { createHeightmapContextTask } from "./heightmap.task";
import { innerTileSegments, maxNodes } from "./params";
import { leafGpuBufferTask } from "./quadtree.task";

// ── Storage buffer context ──────────────────────────────────────────────

export const createNormalmapContextTask = task((get, work) => {
  const edgeVertexCount = get(innerTileSegments) + 3;
  const verticesPerNode = edgeVertexCount * edgeVertexCount;
  const totalElements = get(maxNodes) * verticesPerNode;
  return work(() => {
    const data = new Uint32Array(totalElements);
    // Each element is a single u32 holding two packed f16 values (normal.x, normal.y).
    // The Z component is reconstructed at read-time: nz = sqrt(1 - nx*nx - ny*ny).
    const attribute = new StorageBufferAttribute(data, 1);
    const node = storage(attribute, "uint", totalElements);

    return {
      data,
      attribute,
      node,
    };
  });
}).displayName("createNormalmapContextTask");

// ── Normal computation from heightmap via central differences ───────────

/**
 * Build a TSL function that computes the surface normal at a grid point
 * by sampling the four cardinal neighbours in the heightmap buffer and
 * using central differences.
 *
 * The heightmap is laid out as a flat array of floats:
 *   globalIndex = nodeIndex * (edgeVertexCount * edgeVertexCount) + y * edgeVertexCount + x
 *
 * At grid edges the sample is clamped, producing an acceptable
 * approximation for the skirt ring.
 */
function createNormalFromHeightmap(heightmapNode: Node, edgeVertexCount: number) {
  /**
   * Returns a TSL function `(nodeIndex, ix, iy) => vec2(nx, ny)` where
   * nx/ny are the XY components of the unit surface normal.
   */
  return Fn(([nodeIndex, ix, iy]: [Node, Node, Node]) => {
    const iEdge = int(edgeVertexCount);
    const last = iEdge.sub(int(1));
    const verticesPerNode = iEdge.mul(iEdge);
    const baseOffset = int(nodeIndex).mul(verticesPerNode);

    // Clamp neighbour indices to the valid range [0, edgeVertexCount-1]
    const xLeft = int(ix).sub(int(1)).max(int(0));
    const xRight = int(ix).add(int(1)).min(last);
    const yUp = int(iy).sub(int(1)).max(int(0));
    const yDown = int(iy).add(int(1)).min(last);

    // Sample the four cardinal neighbours
    const hLeft = heightmapNode.element(baseOffset.add(int(iy).mul(iEdge).add(xLeft)));
    const hRight = heightmapNode.element(baseOffset.add(int(iy).mul(iEdge).add(xRight)));
    const hUp = heightmapNode.element(baseOffset.add(yUp.mul(iEdge).add(int(ix))));
    const hDown = heightmapNode.element(baseOffset.add(yDown.mul(iEdge).add(int(ix))));

    // Central differences — dx/dz are in texel units so the spacing
    // cancels when we normalise, but we keep the denominator (2.0) for
    // correct magnitude when clamped at borders.
    const dhdx = float(hRight).sub(float(hLeft));
    const dhdz = float(hDown).sub(float(hUp));

    // Tangent-space normal: n = normalize(-dh/dx, 2*texelSpacing, -dh/dz)
    // We treat the texel spacing as 1.0 so the vertical component is 2.0.
    // After normalisation only the direction matters.
    const nx = dhdx.negate();
    const nz = dhdz.negate();
    const ny = float(2.0);
    const len = nx.mul(nx).add(ny.mul(ny)).add(nz.mul(nz)).sqrt();

    // Return normalised XY; Z is reconstructed at read-time.
    return vec2(nx.div(len), ny.div(len));
  });
}

// ── Compute tasks ───────────────────────────────────────────────────────

export const createComputeNormalMapTask = task((get, work) => {
  const heightmapContext = get(createHeightmapContextTask);
  const normalmapContext = get(createNormalmapContextTask);
  const leafState = get(leafGpuBufferTask);
  const tileEdgeVertexCount = get(innerTileSegments) + 3;

  return work(() => {
    const computeNormal = createNormalFromHeightmap(heightmapContext.node, tileEdgeVertexCount);

    const { create } = createComputeToBufferMap(
      (nodeIndex, globalVertexIndex, _uv, localCoordinates) => {
        const ix = int(localCoordinates.x);
        const iy = int(localCoordinates.y);

        // Compute the XY normal components from the heightmap
        const normalXY = computeNormal(nodeIndex, ix, iy);

        // Pack two f16 values into a single u32 and write to the buffer
        normalmapContext.node.element(globalVertexIndex).assign(packHalf2x16(normalXY));
      },
      leafState.count,
    );

    return create(tileEdgeVertexCount);
  });
}).displayName("createComputeNormalMapTask");

export const computeNormalMapTask = task<{ renderer: WebGPURenderer }>(
  (get, work, { resources }) => {
    const { execute } = get(createComputeNormalMapTask);
    return work(() => (resources?.renderer ? execute(resources?.renderer) : () => {}));
  },
)
  .displayName("computeNormalMapTask")
  .lane("gpu");

// ── Reading helpers (for use in vertex/fragment shaders) ────────────────
//
// To unpack in a vertex or fragment shader:
//
//   import { unpackHalf2x16 } from "three/tsl";
//
//   const packed = normalmapStorage.element(globalIndex);
//   const normalXY = unpackHalf2x16(packed);
//   const nz = sqrt(float(1.0).sub(normalXY.x.mul(normalXY.x)).sub(normalXY.y.mul(normalXY.y)));
//   const normal = vec3(normalXY.x, nz, normalXY.y);
//
// Note: the Y component stored is the *up* axis in tangent space, which
// maps to the geometric Y axis. Adjust the swizzle if your coordinate
// convention differs.
