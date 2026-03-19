import { Fn, float, int, uint } from "three/tsl";
import type { Node, StorageBufferNode } from "three/webgpu";

const decodeUvScale = Fn(([uvScaleIndex]: [Node]) => {
  // Quantized scalar in [1..8] to keep branch-free decode.
  return uvScaleIndex.toFloat().add(float(1));
});

const asControlUint = Fn(([packedValue]: [Node]) => {
  return uint(packedValue).toVar();
});

export const decodeControlBaseId = Fn(([packedValue]: [Node]) => {
  const packed = asControlUint(packedValue);
  return packed.shiftRight(uint(27)).bitAnd(uint(0x1f)).toInt();
});

export const decodeControlOverlayId = Fn(([packedValue]: [Node]) => {
  const packed = asControlUint(packedValue);
  return packed.shiftRight(uint(22)).bitAnd(uint(0x1f)).toInt();
});

export const decodeControlBlend = Fn(([packedValue]: [Node]) => {
  const packed = asControlUint(packedValue);
  return packed
    .shiftRight(uint(14))
    .bitAnd(uint(0xff))
    .toFloat()
    .div(float(255));
});

export const decodeControlUvRotation = Fn(([packedValue]: [Node]) => {
  const packed = asControlUint(packedValue);
  return packed.shiftRight(uint(10)).bitAnd(uint(0x0f)).toInt();
});

export const decodeControlUvScaleIndex = Fn(([packedValue]: [Node]) => {
  const packed = asControlUint(packedValue);
  return packed.shiftRight(uint(7)).bitAnd(uint(0x07)).toInt();
});

export const decodeControlUvScale = Fn(([packedValue]: [Node]) => {
  return decodeUvScale(decodeControlUvScaleIndex(packedValue));
});

export const decodeControlHole = Fn(([packedValue]: [Node]) => {
  const packed = asControlUint(packedValue);
  return packed.shiftRight(uint(2)).bitAnd(uint(0x01)).equal(uint(1));
});

export const decodeControlNavigation = Fn(([packedValue]: [Node]) => {
  const packed = asControlUint(packedValue);
  return packed.shiftRight(uint(1)).bitAnd(uint(0x01)).equal(uint(1));
});

export const decodeControlAutoShader = Fn(([packedValue]: [Node]) => {
  const packed = asControlUint(packedValue);
  return packed.bitAnd(uint(0x01)).equal(uint(1));
});

export const decodeControlData = Fn(([packedValue]: [Node]) => {
  const baseId = decodeControlBaseId(packedValue);
  const overlayId = decodeControlOverlayId(packedValue);
  const blend = decodeControlBlend(packedValue);
  const uvRotation = decodeControlUvRotation(packedValue);
  const uvScaleIndex = decodeControlUvScaleIndex(packedValue);
  const hole = decodeControlHole(packedValue);
  const navigation = decodeControlNavigation(packedValue);
  const autoShader = decodeControlAutoShader(packedValue);

  return {
    baseId,
    overlayId,
    blend,
    uvRotation,
    uvScaleIndex,
    uvScale: decodeUvScale(uvScaleIndex),
    hole,
    navigation,
    autoShader,
  };
});

export const readControlMapPacked = Fn(
  ([controlMapNode, globalVertexIndex]: [StorageBufferNode, Node]) => {
    return controlMapNode.element(int(globalVertexIndex)).toUint();
  },
);

export const readControlMapVertex = Fn(
  ([controlMapNode, globalVertexIndex]: [StorageBufferNode, Node]) => {
    const packed = readControlMapPacked(controlMapNode, globalVertexIndex);
    return decodeControlData(packed);
  },
);
