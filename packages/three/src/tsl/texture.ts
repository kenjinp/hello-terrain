import { Fn, If, bool, float, int, ivec2, select, texture, textureLoad, textureSize, uint } from "three/tsl";
import type { Node, Texture, TextureNode } from "three/webgpu";
import type { ElevationParams } from "./elevation";

function asFloat(value: Node | number): Node {
  // Cache in the source type first: r186 ConditionalNode reuses its raw variable on subsequent builds.
  return typeof value === "number" ? float(value) : float(value.toVar());
}

function asBool(value: Node | boolean): Node {
  return typeof value === "boolean" ? bool(value) : bool(value);
}

export interface TextureParams extends ElevationParams {
  /** Raw elevation in meters, before elevationScale. */
  elevation: Node;
  /** Unit surface normal in terrain/world coordinates, including elevationScale. */
  normal: Node;
  /** 0 = parallel to the undisplaced surface; 1 = vertical. */
  slope: Node;
  /** Integer coordinates in this tile's field, including its skirt ring. */
  fieldTexel: Node;
}
export type TextureCallback = (params: TextureParams) => Node;

export interface TextureControlParams {
  base: Node | number;
  overlay?: Node | number;
  blend?: Node | number;
  /** Radians, quantized to 16 rotations. */
  uvRotation?: Node | number;
  /** Multiplier, quantized to powers of two from 1/16 through 8. */
  uvScale?: Node | number;
  hole?: Node | boolean;
  nav?: Node | boolean;
  auto?: Node | boolean;
}

export interface DecodedTextureControl {
  base: Node;
  overlay: Node;
  blend: Node;
  uvRotation: Node;
  uvScale: Node;
  hole: Node;
  nav: Node;
  auto: Node;
}

/** Packed uint32; never reinterpreted as a float. */
export function textureControl(values: TextureControlParams): Node {
  return Fn(() => {
    const base = uint(asFloat(values.base).clamp(0, 31));
    const overlay = uint(asFloat(values.overlay ?? values.base).clamp(0, 31));
    // Match CPU Math.round explicitly; GPU round can choose a different result at half steps.
    const blend = uint(asFloat(values.blend ?? 0).clamp().mul(255).add(0.5).floor());
    const rotation = uint(int(asFloat(values.uvRotation ?? 0).mul(8 / Math.PI).add(0.5).floor()).bitAnd(15));
    const scale = uint(int(asFloat(values.uvScale ?? 1).max(1 / 16).log2().add(0.5).floor().clamp(-4, 3)).bitAnd(7));
    return base.shiftLeft(27).bitOr(overlay.shiftLeft(22)).bitOr(blend.shiftLeft(14))
      .bitOr(rotation.shiftLeft(10)).bitOr(scale.shiftLeft(7))
      .bitOr(uint(asBool(values.hole ?? false)).shiftLeft(2))
      .bitOr(uint(asBool(values.nav ?? false)).shiftLeft(1)).bitOr(uint(asBool(values.auto ?? false)));
  })();
}

export function decodeTextureControl(packed: Node): DecodedTextureControl {
  const word = uint(packed);
  const scale = word.shiftRight(7).bitAnd(7).toFloat();
  return {
    base: word.shiftRight(27),
    overlay: word.shiftRight(22).bitAnd(31),
    blend: word.shiftRight(14).bitAnd(255).toFloat().div(255),
    uvRotation: word.shiftRight(10).bitAnd(15).toFloat().mul(Math.PI / 8),
    uvScale: float(2).pow(scale.sub(select(scale.greaterThanEqual(4), float(8), float(0)))),
    hole: word.bitAnd(4).notEqual(0),
    nav: word.bitAnd(2).notEqual(0),
    auto: word.bitAnd(1).notEqual(0),
  };
}

/** Keeps the largest two nonnegative weights; ties favor the lowest slot index. */
export function textureWeights(
  weights: readonly (Node | number)[],
  extra: Omit<TextureControlParams, "base" | "overlay" | "blend"> = {},
): Node {
  if (weights.length < 1 || weights.length > 32) throw new Error("textureWeights requires 1–32 slots");
  return Fn(() => {
    const best = float(-1).toVar();
    const second = float(-1).toVar();
    const base = uint(0).toVar();
    const overlay = uint(0).toVar();
    weights.forEach((value, slot) => {
      const weight = asFloat(value).max(0).toVar();
      If(weight.greaterThan(best), () => {
        second.assign(best); overlay.assign(base);
        best.assign(weight); base.assign(uint(slot));
      }).ElseIf(weight.greaterThan(second), () => {
        second.assign(weight); overlay.assign(uint(slot));
      });
    });
    const blend = second.max(0).div(best.add(second.max(0)).max(1e-8));
    return textureControl({ ...extra, base, overlay: select(second.greaterThan(0), overlay, base), blend });
  })();
}

/** Exact nearest load from a native r32uint source map; UV origin follows the source image. */
export function controlMapSample(map: Texture | TextureNode, uv: Node, level: Node = int(0)): Node {
  const node = (map as TextureNode).isTextureNode ? map as TextureNode : texture(map as Texture);
  return Fn(() => {
    const size = textureSize(node, level);
    const texel = ivec2(uv.clamp().mul(size)).min(ivec2(size).sub(1));
    return textureLoad(node, texel, level).r;
  })();
}

/** RGBA channels are four consecutive slot weights. Top-two conversion is deliberately lossy. */
export function weightMapsToControl(
  maps: readonly (Texture | TextureNode)[],
  uv: Node,
  slotOffset = 0,
): Node {
  if (maps.length < 1 || maps.length > 2 || slotOffset < 0 || slotOffset + maps.length * 4 > 32 || !Number.isInteger(slotOffset)) {
    throw new Error("weightMapsToControl requires 1–2 maps and slots within 0–31");
  }
  return Fn(() => {
    const weights: Node[] = [];
    for (const map of maps) {
      const source = (map as TextureNode).isTextureNode ? map as TextureNode : texture(map as Texture);
      const sample = texture(source, uv, 0).toVar();
      weights.push(sample.r, sample.g, sample.b, sample.a);
    }
    const decoded = decodeTextureControl(textureWeights(weights));
    return textureControl({ ...decoded, base: decoded.base.add(slotOffset), overlay: decoded.overlay.add(slotOffset) });
  })();
}
