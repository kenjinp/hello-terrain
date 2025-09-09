import { Fn, type ShaderNodeObject, instanceIndex, vec2 } from "three/tsl";
import type { ComputeNode, Node, WebGPURenderer } from "three/webgpu";
import type { StorageBuffer } from "./StorageBuffer";

export class ComputeToBuffer {
  private bufferToShader: Map<StorageBuffer, ShaderNodeObject<ComputeNode>>;

  constructor(
    private fn: (
      pixelPos: ShaderNodeObject<Node>,
      uvPos: ShaderNodeObject<Node>,
      texelSize: ShaderNodeObject<Node>
    ) => Node
  ) {
    this.bufferToShader = new Map<
      StorageBuffer,
      ShaderNodeObject<ComputeNode>
    >();
  }

  private create(outTo: StorageBuffer, width: number, height: number) {
    return Fn(() => {
      const resolution = vec2(width, height);
      const posX = instanceIndex.mod(width);
      const posY = instanceIndex.div(width);
      const pixelPosition = vec2(posX, posY);
      const uvCoord = vec2(pixelPosition.add(vec2(0.5, 0.5))).div(resolution);
      const textelSize = vec2(1, 1).div(resolution);

      outTo.storageNode
        .element(index)
        .assign(this.fn(pixelPosition, uvCoord, textelSize));
    })().compute(width * height);
  }

  createBinds(width: number, height: number, ...targets: StorageBuffer[]) {
    for (const target of targets)
      this.bufferToShader.set(target, this.create(target, width, height));
    return this;
  }

  renderBind(renderer: WebGPURenderer, bindTarget: StorageBuffer) {
    if (!this.bufferToShader.has(bindTarget)) {
      throw new Error(
        "You are trying to render to a texture that this shader doesn't have. Did you forgot to call createBindTo?"
      );
    }

    // biome-ignore lint/style/noNonNullAssertion: Handled above
    renderer.compute(this.bufferToShader.get(bindTarget)!);

    return bindTarget;
  }
}
