import {
  Fn,
  type NodeRepresentation,
  type ShaderNodeObject,
  instanceIndex,
  textureStore,
  vec2,
} from "three/tsl";
import type { ComputeNode, Node, Texture, WebGPURenderer } from "three/webgpu";

export class ComputeShader {
  private textureToShader: Map<Texture, ShaderNodeObject<ComputeNode>>;

  constructor(
    private fn: (
      pixelPos: ShaderNodeObject<Node>,
      uvPos: ShaderNodeObject<Node>,
      texelSize: ShaderNodeObject<Node>
    ) => NodeRepresentation
  ) {
    this.textureToShader = new Map<Texture, ShaderNodeObject<ComputeNode>>();
  }

  private create(outTo: Texture, width: number, height: number) {
    return Fn(() => {
      const resolution = vec2(width, height);
      const posX = instanceIndex.mod(width);
      const posY = instanceIndex.div(width);
      const pixelPosition = vec2(posX, posY);
      const uvCoord = vec2(pixelPosition.add(vec2(0.5, 0.5))).div(resolution);
      const textelSize = vec2(1, 1).div(resolution);

      return textureStore(
        outTo,
        pixelPosition,
        this.fn(pixelPosition, uvCoord, textelSize)
      ).toWriteOnly();
    })().compute(width * height);
  }

  createBinds(width: number, height: number, ...targets: Texture[]) {
    for (const target of targets)
      this.textureToShader.set(target, this.create(target, width, height));
    return this;
  }

  renderBind(renderer: WebGPURenderer, bindTarget: Texture) {
    if (!this.textureToShader.has(bindTarget)) {
      throw new Error(
        "You are trying to render to a texture that this shader doesn't have. Did you forgot to call createBindTo?"
      );
    }

    // biome-ignore lint/style/noNonNullAssertion: Handled above
    renderer.compute(this.textureToShader.get(bindTarget)!);

    return bindTarget;
  }
}
