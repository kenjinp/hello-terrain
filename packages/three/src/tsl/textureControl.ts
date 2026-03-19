import { Fn, float, int, uint } from "three/tsl";
import type { ProxiedObject } from "three/tsl";
import type Node from "three/src/nodes/core/Node.js";
import type { ShaderNodeFn } from "three/src/nodes/TSL.js";

export interface TextureControlParams {
  worldPosition: Node;
  rootSize: Node;
  rootUV: Node;
  tileUV: Node;
  tileLevel: Node;
  tileSize: Node;
  tileOriginVec2: Node;
  nodeIndex: Node;
  elevation: Node;
  normal: Node;
  slope: Node;
}

export interface TextureControl {
  baseTextureId: Node;
  overlayTextureId?: Node;
  blend?: Node;
  uvScale?: Node;
  uvRotation?: Node;
  hole?: Node;
  navigation?: Node;
  autoShader?: Node;
}

export type TextureControlReturn =
  ShaderNodeFn<[ProxiedObject<TextureControlParams>]>;

export type TextureControlCallback = (
  params: TextureControlParams,
) => TextureControl;

function toU1Flag(value: Node | undefined): Node {
  return value ? uint(value).bitAnd(uint(0x01)) : uint(0);
}

export const packControlU32 = Fn(([control]: [TextureControl]) => {
  const baseTextureId = uint(control.baseTextureId).bitAnd(uint(0x1f));
  const overlayTextureId = uint(control.overlayTextureId ?? int(0)).bitAnd(
    uint(0x1f),
  );
  const blend = uint(
    float(control.blend ?? float(0))
      .max(float(0))
      .min(float(1))
      .mul(float(255))
      .round(),
  ).bitAnd(uint(0xff));
  const uvRotation = uint(control.uvRotation ?? int(0)).bitAnd(uint(0x0f));
  const uvScale = uint(control.uvScale ?? int(0)).bitAnd(uint(0x07));
  const hole = toU1Flag(control.hole);
  const navigation = toU1Flag(control.navigation);
  const autoShader = toU1Flag(control.autoShader);

  return baseTextureId
    .shiftLeft(uint(27))
    .bitOr(overlayTextureId.shiftLeft(uint(22)))
    .bitOr(blend.shiftLeft(uint(14)))
    .bitOr(uvRotation.shiftLeft(uint(10)))
    .bitOr(uvScale.shiftLeft(uint(7)))
    .bitOr(hole.shiftLeft(uint(2)))
    .bitOr(navigation.shiftLeft(uint(1)))
    .bitOr(autoShader);
});

export function createTextureControlFunction(
  callback: TextureControlCallback,
): TextureControlReturn {
  const tslFunction = (args: TextureControlParams) => {
    const params: TextureControlParams = {
      worldPosition: args.worldPosition,
      rootSize: args.rootSize,
      rootUV: args.rootUV,
      tileUV: args.tileUV,
      tileLevel: args.tileLevel,
      tileSize: args.tileSize,
      tileOriginVec2: args.tileOriginVec2,
      nodeIndex: args.nodeIndex,
      elevation: args.elevation,
      normal: args.normal,
      slope: args.slope,
    };
    return callback(params);
  };

  return Fn(tslFunction as unknown as (args: ProxiedObject<TextureControlParams>) => TextureControl);
}
