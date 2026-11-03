/** Native uint32 control data. Sharing bit positions does not imply Terrain3D file compatibility. */
export interface TextureControlValues {
  base: number;
  overlay?: number;
  blend?: number;
  /** Radians, quantized to 16 rotations. */
  uvRotation?: number;
  /** Multiplier, quantized to powers of two from 1/16 through 8. */
  uvScale?: number;
  hole?: boolean;
  nav?: boolean;
  auto?: boolean;
}

/** CPU authoring counterpart of the TSL textureControl function. */
export function packTextureControl(values: TextureControlValues): number {
  const base = Math.min(31, Math.max(0, Math.trunc(values.base)));
  const overlay = Math.min(31, Math.max(0, Math.trunc(values.overlay ?? base)));
  const blend = Math.round(Math.min(1, Math.max(0, values.blend ?? 0)) * 255);
  const rotation = Math.round((values.uvRotation ?? 0) * 8 / Math.PI) & 15;
  const scale = Math.min(3, Math.max(-4, Math.round(Math.log2(Math.max(1 / 16, values.uvScale ?? 1))))) & 7;
  return ((base << 27) | (overlay << 22) | (blend << 14) | (rotation << 10) |
    (scale << 7) | (Number(values.hole ?? false) << 2) |
    (Number(values.nav ?? false) << 1) | Number(values.auto ?? false)) >>> 0;
}

export function unpackTextureControl(packed: number) {
  const scale = (packed >>> 7) & 7;
  return {
    base: packed >>> 27,
    overlay: (packed >>> 22) & 31,
    blend: ((packed >>> 14) & 255) / 255,
    uvRotation: ((packed >>> 10) & 15) * Math.PI / 8,
    uvScale: 2 ** (scale >= 4 ? scale - 8 : scale),
    hole: (packed & 4) !== 0,
    nav: (packed & 2) !== 0,
    auto: (packed & 1) !== 0,
  };
}
