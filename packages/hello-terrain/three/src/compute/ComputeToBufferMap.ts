import { Fn, type ShaderNodeObject, instanceIndex, int, vec2 } from "three/tsl";
import type { ComputeNode, Node, WebGPURenderer } from "three/webgpu";
import type { StorageBuffer } from "./StorageBuffer";

// A buffer map is an array-like representation of a texture with a width and height times number of nodes
export class ComputeToBufferMap {
  private bufferToShader: Map<StorageBuffer, ShaderNodeObject<ComputeNode>>;

  constructor(
    private fn: (
      nodeIndex: ShaderNodeObject<Node>,
      vertexIndex: ShaderNodeObject<Node>,
      uv: ShaderNodeObject<Node>,
      texelSize: ShaderNodeObject<Node>
    ) => void
  ) {
    this.bufferToShader = new Map<
      StorageBuffer,
      ShaderNodeObject<ComputeNode>
    >();
  }

  private create(outTo: StorageBuffer, width: number, numComponents: number) {
    // One instance per "vertex" of the bufferMap
    const computeInstanceCount = outTo.maxItems;
    return Fn(() => {
      const index = int(instanceIndex).mul(numComponents);
      // Calculate which node and vertex within that node this index represents // Calculate which node and vertex within that node this index represents
      const verticesPerNode = int(width).mul(width);
      const nodeIndex = index.div(verticesPerNode).toFloat().floor().toInt();
      const vertexIndex = index.mod(verticesPerNode);

      // const nodeIndex = int(instanceIndex);

      // Loop(width, ({ i }) => {
      //   return Loop(width, ({ i: j }) => {
      //     const vertexIndex = int(i).mul(width).add(j);

      //     const texelSize = vec2(1, 1).div(width);
      //     const pixelPosition = vec2(i, j);
      //     const uvCoord = vec2(pixelPosition.add(vec2(0.5, 0.5))).div(width);

      //     this.fn(nodeIndex, vertexIndex, uvCoord, texelSize);
      //   });
      // });

      // const vertexIndex = int(instanceIndex).mod(int(width * width));

      // // Calculate 2D coordinates within the node's vertex grid
      const x = vertexIndex.mod(int(width));
      const y = vertexIndex.div(int(width)).toFloat().floor();
      const texelSize = vec2(1, 1).div(width);
      const pixelPosition = vec2(x, y);
      const uvCoord = vec2(pixelPosition.add(vec2(0.5, 0.5))).div(width);

      this.fn(nodeIndex, vertexIndex, uvCoord, texelSize);

      // outTo.storageNode
      //   .element(vertexIndex)
      //   .assign(this.fn(nodeIndex, vertexIndex, uvCoord, texelSize));
    })().compute(computeInstanceCount, [width, width, numComponents]);
  }

  createBinds(
    width: number,
    numComponents: number,
    ...targets: StorageBuffer[]
  ) {
    for (const target of targets)
      this.bufferToShader.set(
        target,
        this.create(target, width, numComponents)
      );
    return this;
  }

  renderBind(renderer: WebGPURenderer, bindTarget: StorageBuffer) {
    if (!this.bufferToShader.has(bindTarget)) {
      throw new Error(
        "You are trying to render to a StorageBuffer that this shader doesn't have. Did you forgot to call createBindTo?"
      );
    }

    // biome-ignore lint/style/noNonNullAssertion: Handled above
    renderer.compute(this.bufferToShader.get(bindTarget)!);

    return bindTarget;
  }
}
