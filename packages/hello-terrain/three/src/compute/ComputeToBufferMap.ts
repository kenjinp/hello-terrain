import {
  Fn,
  If,
  float,
  int,
  storage,
  uint,
  vec2,
  workgroupId,
} from "three/tsl";
import type { ComputeNode, Node, WebGPURenderer } from "three/webgpu";
import type { StorageBuffer } from "./StorageBuffer";

// A buffer map is an array-like representation of a texture with a width and height times number of nodes
export class ComputeToBufferMap {
  bufferToShader: Map<StorageBuffer, ComputeNode>;
  private computeInstanceCount?: number;
  private workgroupSize?: [number, number, number];
  dispatchSize?: [number, number, number];

  private static ceilPowerOfTwo(n: number): number {
    if (n <= 1) return 1;
    return 1 << Math.ceil(Math.log2(n));
  }

  constructor(
    private fn: (
      nodeIndex: Node,
      globalVertexIndex: Node,
      uv: Node,
      localCoordinates: Node,
      texelSize: Node
    ) => void
  ) {
    this.bufferToShader = new Map<StorageBuffer, ComputeNode>();
  }

  private create(
    width: number,
    _numComponents: number,
    instanceCount: number,
    activeLeafIndicesStorage: StorageBuffer
  ) {
    // Create optimized shader that uses indirection via active leaf indices
    this.computeInstanceCount = instanceCount;
    this.workgroupSize = [1, 1, 1];
    const dispatchX = ComputeToBufferMap.ceilPowerOfTwo(width);
    const dispatchY = ComputeToBufferMap.ceilPowerOfTwo(width);
    const dispatchZ = ComputeToBufferMap.ceilPowerOfTwo(instanceCount);
    this.dispatchSize = [dispatchX, dispatchY, dispatchZ];

    // Create a storage node for the active leaf indices
    const activeLeafIndicesNode = storage(
      activeLeafIndicesStorage.storageBufferAttribute,
      "uint",
      activeLeafIndicesStorage.storageBufferAttribute.count
    );

    return Fn(() => {
      const fWidth = float(width);
      const activeIndex = workgroupId.z; // This is 0..activeLeafCount-1
      const nodeIndex = activeLeafIndicesNode.element(activeIndex).toVar(); // Look up actual node index
      const iWidth = int(width);
      const ix = int(workgroupId.x);
      const iy = int(workgroupId.y);
      const iInstanceCount = int(instanceCount);

      // Only execute the body when within XY bounds and active index is valid.
      If(
        ix
          .lessThan(iWidth)
          .and(iy.lessThan(iWidth))
          .and(uint(activeIndex).lessThan(uint(iInstanceCount))),
        () => {
          const texelSize = vec2(1, 1).div(fWidth);
          const localCoordinates = vec2(workgroupId.x, workgroupId.y);
          const localUVCoords = localCoordinates.div(fWidth);
          // Compute global vertex index: nodeIndex * (width*width) + y * width + x
          const verticesPerNode = iWidth.mul(iWidth);
          const globalIndex = int(nodeIndex)
            .mul(verticesPerNode)
            .add(iy.mul(iWidth).add(ix));
          this.fn(
            nodeIndex,
            globalIndex,
            localUVCoords,
            localCoordinates,
            texelSize
          );
        }
      );
    })().computeKernel(this.workgroupSize);
  }

  createBinds(
    width: number,
    numComponents: number,
    instanceCount: number,
    activeLeafIndicesStorage: StorageBuffer,
    ...targets: StorageBuffer[]
  ) {
    for (const target of targets)
      this.bufferToShader.set(
        target,
        this.create(
          width,
          numComponents,
          instanceCount,
          activeLeafIndicesStorage
        )
      );
    return this;
  }

  renderBind(renderer: WebGPURenderer, bindTarget: StorageBuffer) {
    if (!this.bufferToShader.has(bindTarget)) {
      throw new Error(
        "You are trying to render to a ComputeToBufferMap that this shader doesn't have. Did you forgot to call createBindTo?"
      );
    }
    if (!this.computeInstanceCount) {
      throw new Error("No compute instance count");
    }
    if (!this.workgroupSize) {
      throw new Error("No workgroupSize");
    }
    if (!this.dispatchSize) {
      throw new Error("No dispatchSize");
    }

    renderer.compute(
      // biome-ignore lint/style/noNonNullAssertion: Handled above
      this.bufferToShader.get(bindTarget)!,
      this.dispatchSize
    );
  }

  renderBindOptimized(
    renderer: WebGPURenderer,
    bindTarget: StorageBuffer,
    activeInstanceCount: number
  ) {
    if (!this.bufferToShader.has(bindTarget)) {
      throw new Error(
        "You are trying to render to a ComputeToBufferMap that this shader doesn't have. Did you forget to call createOptimizedBinds?"
      );
    }
    if (!this.workgroupSize) {
      throw new Error("No workgroupSize");
    }
    if (!this.dispatchSize) {
      throw new Error("No dispatchSize");
    }

    // Use optimized dispatch size with only active leaf count in Z dimension
    const optimizedDispatchSize: [number, number, number] = [
      this.dispatchSize[0], // X dimension (width)
      this.dispatchSize[1], // Y dimension (height)
      ComputeToBufferMap.ceilPowerOfTwo(activeInstanceCount), // Z dimension (active instances only)
    ];

    renderer.compute(
      // biome-ignore lint/style/noNonNullAssertion: Handled above
      this.bufferToShader.get(bindTarget)!,
      optimizedDispatchSize
    );
  }
}
