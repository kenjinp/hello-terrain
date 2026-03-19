import { float, Fn, int, mix, texture, vec2, vec3 } from "three/tsl";
import type { DataArrayTexture } from "three";
import type { Node } from "three/webgpu";

export const sampleTextureArrayLayer = Fn(
  ([textureArray, uv, layerIndex]: [DataArrayTexture, Node, Node]) => {
    return texture(textureArray, vec2(uv.x, uv.y)).depth(int(layerIndex));
  },
);

export const heightBlend = Fn(
  ([
    baseColor,
    overlayColor,
    baseHeight,
    overlayHeight,
    blendFactor,
    sharpness = float(8),
  ]: [Node, Node, Node, Node, Node, Node?]) => {
    const heightDelta = overlayHeight.sub(baseHeight).mul(sharpness);
    const weight = blendFactor
      .add(heightDelta)
      .max(float(0))
      .min(float(1))
      .toVar();
    return mix(baseColor, overlayColor, weight);
  },
);

export const decodeNormalRG = Fn(([normalRG]: [Node]) => {
  const x = normalRG.x.mul(float(2)).sub(float(1));
  const y = normalRG.y.mul(float(2)).sub(float(1));
  const zSq = float(1).sub(x.mul(x)).sub(y.mul(y)).max(float(0));
  return vec3(x, y, zSq.sqrt()).normalize();
});
