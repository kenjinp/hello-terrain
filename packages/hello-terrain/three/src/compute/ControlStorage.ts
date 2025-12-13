/**
 * Control Data Bit Layout (32 bits per vertex):
 *
 * | Bits   | Field            | Range    | Description                    |
 * |--------|------------------|----------|--------------------------------|
 * | 31-27  | Base Texture ID  | 0-31     | Primary texture index          |
 * | 26-22  | Overlay Tex ID   | 0-31     | Secondary texture index        |
 * | 21-14  | Blend Factor     | 0-255    | Blend weight (0=base, 255=over)|
 * | 13-10  | UV Scale         | 0-15     | Texture repeat multiplier      |
 * | 9-6    | UV Rotation      | 0-15     | Rotation in 22.5° increments   |
 * | 5      | Auto-shader      | 0-1      | Enable slope-based texturing   |
 * | 4      | Navigation       | 0-1      | Navigable surface flag         |
 * | 3      | Hole             | 0-1      | Render hole (discard pixel)    |
 * | 2-0    | Reserved         | —        | Future use                     |
 */

export interface ControlData {
  baseTextureId: number;    // 0-31
  overlayTextureId: number; // 0-31
  blend: number;            // 0-255
  uvScale?: number;         // 0-15
  uvRotation?: number;      // 0-15
  autoShader?: boolean;
  navigation?: boolean;
  hole?: boolean;
}

export const ControlDataPacker = {
  pack(data: ControlData): number {
    let packed = 0;
    packed |= (data.baseTextureId & 0x1F) << 27;
    packed |= (data.overlayTextureId & 0x1F) << 22;
    packed |= (data.blend & 0xFF) << 14;
    packed |= ((data.uvScale ?? 0) & 0x0F) << 10;
    packed |= ((data.uvRotation ?? 0) & 0x0F) << 6;
    packed |= (data.autoShader ? 1 : 0) << 5;
    packed |= (data.navigation ? 1 : 0) << 4;
    packed |= (data.hole ? 1 : 0) << 3;
    return packed >>> 0; // Ensure unsigned 32-bit integer
  },

  unpack(packed: number): ControlData {
    return {
      baseTextureId: (packed >>> 27) & 0x1F,
      overlayTextureId: (packed >>> 22) & 0x1F,
      blend: (packed >>> 14) & 0xFF,
      uvScale: (packed >>> 10) & 0x0F,
      uvRotation: (packed >>> 6) & 0x0F,
      autoShader: ((packed >>> 5) & 0x01) === 1,
      navigation: ((packed >>> 4) & 0x01) === 1,
      hole: ((packed >>> 3) & 0x01) === 1,
    };
  },
};
