import {
  Fn,
  type ShaderNodeObject,
  float,
  int,
  vec2,
  workgroupId,
} from "three/tsl";
import type { ComputeNode, Node, WebGPURenderer } from "three/webgpu";
import type { StorageBuffer } from "./StorageBuffer";

// A buffer map is an array-like representation of a texture with a width and height times number of nodes
export class ComputeToBufferMap {
  private bufferToShader: Map<StorageBuffer, ShaderNodeObject<ComputeNode>>;
  private computeInstanceCount?: number;
  private workgroupSize?: [number, number, number];
  private dispatchSize?: [number, number, number];

  constructor(
    private fn: (
      nodeIndex: ShaderNodeObject<Node>,
      globalVertexIndex: ShaderNodeObject<Node>,
      uv: ShaderNodeObject<Node>,
      localCoordinates: ShaderNodeObject<Node>,
      texelSize: ShaderNodeObject<Node>
    ) => void
  ) {
    this.bufferToShader = new Map<
      StorageBuffer,
      ShaderNodeObject<ComputeNode>
    >();
  }

  private create(width: number, _numComponents: number, instanceCount: number) {
    // Use explicit instanceCount (e.g., maxNodes) for Z dimension, not outTo.maxItems
    this.computeInstanceCount = instanceCount;
    this.workgroupSize = [1, 1, 1];
    this.dispatchSize = [width, width, instanceCount];
    return Fn(() => {
      const fWidth = float(width);
      const nodeIndex = workgroupId.z;
      const texelSize = vec2(1, 1).div(fWidth);
      const localCoordinates = vec2(workgroupId.x, workgroupId.y);
      const localUVCoords = localCoordinates.div(fWidth);
      // Compute global vertex index: nodeIndex * (width*width) + y * width + x
      const iWidth = int(width);
      const verticesPerNode = iWidth.mul(iWidth);
      const ix = int(workgroupId.x);
      const iy = int(workgroupId.y);
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
    })().computeKernel(this.workgroupSize);
  }

  createBinds(
    width: number,
    numComponents: number,
    instanceCount: number,
    ...targets: StorageBuffer[]
  ) {
    for (const target of targets)
      this.bufferToShader.set(
        target,
        this.create(width, numComponents, instanceCount)
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
}
