import {
  Fn,
  type ShaderNodeObject,
  float,
  instanceIndex,
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

  private create(outTo: StorageBuffer, width: number, _numComponents: number) {
    const computeInstanceCount = outTo.maxItems;
    this.computeInstanceCount = computeInstanceCount;
    this.workgroupSize = [_numComponents, 1, 1];
    this.dispatchSize = [width, width, computeInstanceCount];
    return Fn(() => {
      const fWidth = float(width);
      const globalIndex = instanceIndex;
      const nodeIndex = workgroupId.z;
      const texelSize = vec2(1, 1).div(fWidth);
      const localCoordinates = vec2(workgroupId.x, workgroupId.y);
      const localUVCoords = localCoordinates.div(fWidth);
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
    ...targets: StorageBuffer[]
  ) {
    for (const target of targets)
      this.bufferToShader.set(
        target,
        this.create(target, width, numComponents)
      );
    return this;
  }

  async renderBind(renderer: WebGPURenderer, bindTarget: StorageBuffer) {
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
