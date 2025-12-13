import { Fn, int } from "three/tsl";
import { controlmapStorageProperty } from "./properties";
import type { TerrainVaryings } from "../TerrainVaryings";

/**
 * Read and decode control data at current vertex using vGlobalVertexIndex
 * Returns individual shader node values for each control field.
 *
 * Bit layout:
 * - Bits 31-27: Base Texture ID (0-31)
 * - Bits 26-22: Overlay Texture ID (0-31)
 * - Bits 21-14: Blend Factor (0-255)
 * - Bits 13-10: UV Scale (0-15)
 * - Bits 9-6: UV Rotation (0-15)
 * - Bit 5: Auto-shader flag
 * - Bit 4: Navigation flag
 * - Bit 3: Hole flag
 * - Bits 2-0: Reserved
 */
export const createReadControlAtVertex = (varyings: TerrainVaryings) => {
  return Fn(() => {
    const globalVertexIndex = varyings.vGlobalVertexIndex;
    const packed = controlmapStorageProperty.element(globalVertexIndex);
    const packedInt = packed.toUint();

    const baseId = packedInt.shiftRight(int(27)).bitAnd(int(0x1f)).toVar();
    const overlayId = packedInt.shiftRight(int(22)).bitAnd(int(0x1f)).toVar();
    const blend = packedInt
      .shiftRight(int(14))
      .bitAnd(int(0xff))
      .toFloat()
      .div(255.0)
      .toVar();
    const uvScale = packedInt
      .shiftRight(int(10))
      .bitAnd(int(0x0f))
      .toFloat()
      .add(1.0)
      .toVar();
    const autoShader = packedInt
      .shiftRight(int(5))
      .bitAnd(int(0x01))
      .equal(int(1))
      .toVar();
    const hole = packedInt.shiftRight(int(3)).bitAnd(int(0x01)).equal(int(1)).toVar();

    return { baseId, overlayId, blend, uvScale, autoShader, hole };
  });
};
