import {
  Fn,
  type ShaderNodeObject,
  float,
  int,
  texture,
  vec2,
} from "three/tsl";
import type { Node, Texture } from "three/webgpu";

// converts a uInt8 RB texture to a 16bit float
// From https://github.com/mrdoob/three.js/issues/22780#issuecomment-1457288432
export const readGreyStyle = Fn(
  ([rgTexture, uv]: [rgTexture: Texture, uv: ShaderNodeObject<Node>]) => {
    const value = texture(rgTexture, uv);
    const greyStyle = value.r
      .mul(256.0)
      .add(value.g.mul(256.0))
      .div(257.0)
      .toFloat();
    return greyStyle;
  }
);

export const floatToRG = Fn(([value]: [value: ShaderNodeObject<Node>]) => {
  // Pack a normalized float into two 8-bit channels (RG)
  const v16 = float(value).mul(65535.0);
  const hi = v16.div(256.0).floor();
  const lo = v16.sub(hi.mul(256.0));

  // Normalize to [0,1] for 8-bit channels
  const r = hi.div(255.0);
  const g = lo.div(255.0);

  return vec2(int(r), int(g));
});
