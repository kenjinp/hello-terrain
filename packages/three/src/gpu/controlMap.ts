import { storage } from "three/tsl";
import type { StorageBufferNode } from "three/webgpu";
import { StorageBufferAttribute } from "three/webgpu";

export interface ControlData {
  baseTextureId: number;
  overlayTextureId: number;
  blend: number;
  uvRotation: number;
  uvScale: number;
  hole: boolean;
  navigation: boolean;
  autoShader: boolean;
}

export interface ControlMapContext {
  data: Uint32Array<ArrayBuffer>;
  attribute: StorageBufferAttribute;
  node: StorageBufferNode;
}

export const CONTROL_MAP_BITS = {
  baseTextureId: { shift: 27, mask: 0x1f },
  overlayTextureId: { shift: 22, mask: 0x1f },
  blend: { shift: 14, mask: 0xff },
  uvRotation: { shift: 10, mask: 0x0f },
  uvScale: { shift: 7, mask: 0x07 },
  hole: { shift: 2, mask: 0x01 },
  navigation: { shift: 1, mask: 0x01 },
  autoShader: { shift: 0, mask: 0x01 },
} as const;

export function packControlData(data: ControlData): number {
  const baseTextureId = data.baseTextureId & CONTROL_MAP_BITS.baseTextureId.mask;
  const overlayTextureId = data.overlayTextureId & CONTROL_MAP_BITS.overlayTextureId.mask;
  const blend = data.blend & CONTROL_MAP_BITS.blend.mask;
  const uvRotation = data.uvRotation & CONTROL_MAP_BITS.uvRotation.mask;
  const uvScale = data.uvScale & CONTROL_MAP_BITS.uvScale.mask;
  const hole = data.hole ? 1 : 0;
  const navigation = data.navigation ? 1 : 0;
  const autoShader = data.autoShader ? 1 : 0;

  return (
    (baseTextureId << CONTROL_MAP_BITS.baseTextureId.shift) |
    (overlayTextureId << CONTROL_MAP_BITS.overlayTextureId.shift) |
    (blend << CONTROL_MAP_BITS.blend.shift) |
    (uvRotation << CONTROL_MAP_BITS.uvRotation.shift) |
    (uvScale << CONTROL_MAP_BITS.uvScale.shift) |
    (hole << CONTROL_MAP_BITS.hole.shift) |
    (navigation << CONTROL_MAP_BITS.navigation.shift) |
    (autoShader << CONTROL_MAP_BITS.autoShader.shift)
  ) >>> 0;
}

export function unpackControlData(packed: number): ControlData {
  const value = packed >>> 0;
  return {
    baseTextureId:
      (value >>> CONTROL_MAP_BITS.baseTextureId.shift) &
      CONTROL_MAP_BITS.baseTextureId.mask,
    overlayTextureId:
      (value >>> CONTROL_MAP_BITS.overlayTextureId.shift) &
      CONTROL_MAP_BITS.overlayTextureId.mask,
    blend: (value >>> CONTROL_MAP_BITS.blend.shift) & CONTROL_MAP_BITS.blend.mask,
    uvRotation:
      (value >>> CONTROL_MAP_BITS.uvRotation.shift) &
      CONTROL_MAP_BITS.uvRotation.mask,
    uvScale:
      (value >>> CONTROL_MAP_BITS.uvScale.shift) & CONTROL_MAP_BITS.uvScale.mask,
    hole: ((value >>> CONTROL_MAP_BITS.hole.shift) & CONTROL_MAP_BITS.hole.mask) === 1,
    navigation:
      ((value >>> CONTROL_MAP_BITS.navigation.shift) &
        CONTROL_MAP_BITS.navigation.mask) === 1,
    autoShader:
      ((value >>> CONTROL_MAP_BITS.autoShader.shift) &
        CONTROL_MAP_BITS.autoShader.mask) === 1,
  };
}

export function createControlMapStorage(totalElements: number): ControlMapContext {
  const data = new Uint32Array(totalElements);
  const attribute = new StorageBufferAttribute(data, 1);
  const node = storage(attribute, "u32", totalElements);
  return {
    data,
    attribute,
    node,
  };
}
