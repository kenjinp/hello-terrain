import { Fn, If, float, globalId, int, uint, vec2 } from "three/tsl";
import type { Node, WebGPURenderer } from "three/webgpu";

// A buffer map is an array-like representation of a texture with a width and height times number of nodes
const WORKGROUP_X = 16;
const WORKGROUP_Y = 16;

function ceilPowerOfTwo(n: number): number {
  if (n <= 1) return 1;
  return 1 << Math.ceil(Math.log2(n));
}

/**
 * Creates a 2D compute dispatch that iterates over a grid of vertices for
 * each active leaf node (Z-axis).
 *
 * @param fn        Callback invoked per vertex with node/vertex indices, UV,
 *                  local coordinates, and texel size.
 * @param instanceCount  Number of active leaf nodes.
 * @param bindings  Optional array of TSL nodes (storage buffers, uniforms)
 *                  that must be included in the compute pipeline's bind
 *                  group. Use this when your `fn` callback calls helper
 *                  functions that use `.setLayout()` and capture resources
 *                  from closures — TSL cannot trace through `.setLayout()`
 *                  boundaries to discover those dependencies automatically.
 *                  Prefer writing compute helpers without `.setLayout()`
 *                  instead; this parameter is a safety net for edge cases.
 */
export function createComputeToBufferMap(
  fn: (
    nodeIndex: Node,
    globalVertexIndex: Node,
    uv: Node,
    localCoordinates: Node,
    texelSize: Node,
  ) => void,
  instanceCount: number,
  bindings?: Node[],
) {
  function create(width: number) {
    // 2D workgroups for better occupancy, Z-axis iterates over active leaf nodes
    const workgroupSize = [WORKGROUP_X, WORKGROUP_Y, 1];
    const dispatchX = ceilPowerOfTwo(Math.ceil(width / WORKGROUP_X));
    const dispatchY = ceilPowerOfTwo(Math.ceil(width / WORKGROUP_Y));
    const dispatchZ = ceilPowerOfTwo(instanceCount);
    const dispatchSize = [dispatchX, dispatchY, dispatchZ];
    const computeShader = Fn(() => {
      // Force-bind any external resources that TSL can't auto-discover
      bindings?.forEach((b) => b.toVar());

      const fWidth = float(width);
      const activeIndex = globalId.z;
      // Leaves are packed contiguously at indices 0..count-1, so activeIndex IS the nodeIndex
      const nodeIndex = int(activeIndex).toVar();
      const iWidth = int(width);
      const ix = int(globalId.x);
      const iy = int(globalId.y);
      const iInstanceCount = int(instanceCount);

      If(
        ix
          .lessThan(iWidth)
          .and(iy.lessThan(iWidth))
          .and(uint(activeIndex).lessThan(uint(iInstanceCount))),
        () => {
          const texelSize = vec2(1, 1).div(fWidth);
          const localCoordinates = vec2(globalId.x, globalId.y);
          const localUVCoords = localCoordinates.div(fWidth);
          const verticesPerNode = iWidth.mul(iWidth);
          const globalIndex = int(nodeIndex).mul(verticesPerNode).add(iy.mul(iWidth).add(ix));
          fn(nodeIndex, globalIndex, localUVCoords, localCoordinates, texelSize);
        },
      );
    })().computeKernel(workgroupSize);

    function execute(renderer: WebGPURenderer) {
      const optimizedDispatchSize: [number, number, number] = [
        dispatchSize[0],
        dispatchSize[1],
        ceilPowerOfTwo(instanceCount),
      ];

      renderer.compute(computeShader, optimizedDispatchSize);
    }

    return { execute };
  }

  return { create };
}
