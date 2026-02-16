import { task } from "@hello-terrain/work";
import { Fn, float, int, packHalf2x16, storage, vec2 } from "three/tsl";
import type { Node } from "three/webgpu";
import { StorageBufferAttribute } from "three/webgpu";
import type { ComputePipeline } from "../gpu/compute";
import {
  elevationFieldStageTask,
  createElevationFieldContextTask,
  tileNodesTask,
} from "./elevation-field.task";
import { innerTileSegments, maxNodes } from "./params";
import { createUniformsTask } from "./uniforms/uniforms.task";

// ── Storage buffer context ──────────────────────────────────────────────

export const createNormalFieldContextTask = task((get, work) => {
  const edgeVertexCount = get(innerTileSegments) + 3;
  const verticesPerNode = edgeVertexCount * edgeVertexCount;
  const totalElements = get(maxNodes) * verticesPerNode;
  return work(() => {
    const data = new Uint32Array(totalElements);
    // Each element is a single u32 holding two packed f16 values (normal.x, normal.z).
    // The Y (up) component is reconstructed at read-time: ny = sqrt(1 - nx*nx - nz*nz).
    const attribute = new StorageBufferAttribute(data, 1);
    const node = storage(attribute, "uint", totalElements);

    return {
      data,
      attribute,
      node,
    };
  });
}).displayName("createNormalFieldContextTask");

// ── Normal computation from elevation field via central differences ───────────

/**
 * Build a TSL function that computes the surface normal at a grid point
 * by sampling the four cardinal neighbors in the elevation field buffer and
 * using central differences.
 *
 * The elevation field is laid out as a flat array of floats:
 *   globalIndex = nodeIndex * (edgeVertexCount * edgeVertexCount) + y * edgeVertexCount + x
 *
 * At grid edges the sample is clamped, producing an acceptable
 * approximation for the skirt ring.
 */
export function createNormalFromElevationField(
  elevationFieldNode: Node,
  edgeVertexCount: number
) {
  /**
   * Returns a TSL function `(nodeIndex, ix, iy, verticalScale) => vec2(nx, nz)`
   * where nx/nz are the horizontal components of the unit surface normal.
   *
   * `verticalScale` is `2 * texelWorldSpacing / elevationScale`, accounting
   * for the tile's world-space texel spacing and the elevation vertical scale.
   */
  return Fn(([nodeIndex, ix, iy, verticalScale]: [Node, Node, Node, Node]) => {
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
    const hLeft = elevationFieldNode.element(
      baseOffset.add(int(iy).mul(iEdge).add(xLeft))
    );
    const hRight = elevationFieldNode.element(
      baseOffset.add(int(iy).mul(iEdge).add(xRight))
    );
    const hUp = elevationFieldNode.element(
      baseOffset.add(yUp.mul(iEdge).add(int(ix)))
    );
    const hDown = elevationFieldNode.element(
      baseOffset.add(yDown.mul(iEdge).add(int(ix)))
    );

    // Central differences: dhdx ≈ h(x+1) - h(x-1) over 2 texel spacings.
    const dhdx = float(hRight).sub(float(hLeft));
    const dhdz = float(hDown).sub(float(hUp));

    // Surface normal: n = normalize(-dhdx, verticalScale, -dhdz)
    // where verticalScale = 2 * texelWorldSpacing / elevationScale
    // correctly relates the horizontal grid spacing to the vertical height units.
    const nx = dhdx.negate();
    const nz = dhdz.negate();
    const ny = float(verticalScale);
    const len = nx.mul(nx).add(ny.mul(ny)).add(nz.mul(nz)).sqrt();

    // Return normalised XZ; Y (up) is reconstructed at read-time.
    return vec2(nx.div(len), nz.div(len));
  });
}

// ── Compute stage ───────────────────────────────────────────────────────

/**
 * Normal field compute stage — reads height neighbours from the elevation field
 * buffer, computes surface normals via central differences, packs XZ
 * components into a u32 via `packHalf2x16`, and writes to the normal field
 * storage buffer.
 *
 * The vertical scale accounts for each tile's world-space texel spacing
 * and the elevation scale uniform, so normals are correct at all LOD levels.
 *
 * Accumulates the upstream elevation pipeline via `get(elevationFieldStageTask)`.
 */
export const normalFieldStageTask = task((get, work) => {
  const upstream = get(elevationFieldStageTask);
  const elevationFieldContext = get(createElevationFieldContextTask);
  const normalFieldContext = get(createNormalFieldContextTask);
  const tileEdgeVertexCount = get(innerTileSegments) + 3;
  const tile = get(tileNodesTask);
  const uniforms = get(createUniformsTask);
  const segments = get(innerTileSegments);

  return work((): ComputePipeline => {
    const computeNormal = createNormalFromElevationField(
      elevationFieldContext.node,
      tileEdgeVertexCount
    );
    return [
      ...upstream,
      (nodeIndex, globalVertexIndex, _uv, localCoordinates) => {
        const ix = int(localCoordinates.x);
        const iy = int(localCoordinates.y);

        // World-space texel spacing, adjusted for elevation vertical scale.
        // This ensures normals are correct regardless of tile LOD level.
        const texelWorldSpacing = tile.tileSize(nodeIndex).div(float(segments));
        const verticalScale = float(2)
          .mul(texelWorldSpacing)
          .div(uniforms.uElevationScale);

        // Compute the XZ normal components from the elevation field
        const normalXZ = computeNormal(nodeIndex, ix, iy, verticalScale);

        // Pack two f16 values into a single u32 and write to the buffer
        normalFieldContext.node
          .element(globalVertexIndex)
          .assign(packHalf2x16(normalXZ));
      },
    ];
  });
}).displayName("normalFieldStageTask");
