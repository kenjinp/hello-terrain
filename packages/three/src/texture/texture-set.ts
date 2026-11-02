import {
  Color, DataArrayTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace,
  RepeatWrapping, RGBAFormat, SRGBColorSpace, UnsignedByteType,
  type ColorRepresentation, type CompressedArrayTexture, type Texture,
} from "three";

export interface TerrainTextureSlot {
  name?: string;
  albedo?: Texture;
  normal?: Texture;
  height?: Texture;
  roughness?: Texture;
  ao?: Texture;
  /** World/terrain meters per texture repeat. */
  uvScale?: number;
  tint?: ColorRepresentation;
  normalStrength?: number;
  roughnessOffset?: number;
  aoStrength?: number;
  heightOffset?: number;
  heightScale?: number;
  projection?: "uv" | "vertical";
  antiTiling?: "none" | "detile";
  detiling?: { rotation: number; shift: number };
}

export interface TerrainTextureSet {
  readonly slots: readonly TerrainTextureSlot[];
  /** RGB is albedo; A is height. */
  readonly albedoHeight: DataArrayTexture | CompressedArrayTexture;
  /** RG is tangent normal XY; B is AO; A is roughness. */
  readonly normalRoughAo: DataArrayTexture | CompressedArrayTexture;
  readonly packing: "fast";
  readonly disposed: boolean;
  /** Owns the two arrays, never the source maps passed to the runtime packer. */
  dispose(): void;
}

function validateSlots(slots: readonly TerrainTextureSlot[]) {
  if (slots.length < 1 || slots.length > 32) throw new Error("A terrain texture set requires 1–32 slots");
  for (const slot of slots) {
    if (!Number.isFinite(slot.uvScale ?? 10) || (slot.uvScale ?? 10) <= 0) throw new Error("Texture slot uvScale must be positive");
    for (const value of [slot.normalStrength, slot.roughnessOffset, slot.aoStrength, slot.heightOffset, slot.heightScale, slot.detiling?.rotation, slot.detiling?.shift]) {
      if (value !== undefined && !Number.isFinite(value)) throw new Error("Texture slot parameters must be finite");
    }
  }
}

/** Takes ownership of prepacked arrays (including KTX2 CompressedArrayTexture inputs). */
export function terrainTextureSetFromArrays(
  arrays: Pick<TerrainTextureSet, "albedoHeight" | "normalRoughAo">,
  slots: readonly TerrainTextureSlot[],
): TerrainTextureSet {
  validateSlots(slots);
  const a = arrays.albedoHeight.image as { width: number; height: number; depth: number };
  const b = arrays.normalRoughAo.image as { width: number; height: number; depth: number };
  if (!a || !b || !Number.isInteger(a.width) || !Number.isInteger(a.height) || a.width < 1 || a.height < 1 || a.width !== b.width || a.height !== b.height || a.depth !== slots.length || b.depth !== slots.length) {
    throw new Error("Terrain texture arrays must have matching dimensions and one layer per slot");
  }
  const mipCount = (array: DataArrayTexture | CompressedArrayTexture) => array.generateMipmaps
    ? Math.floor(Math.log2(Math.max(a.width, a.height))) + 1 : Math.max(1, array.mipmaps.length);
  if (mipCount(arrays.albedoHeight) !== mipCount(arrays.normalRoughAo)) {
    throw new Error("Terrain texture arrays must have matching mip counts");
  }
  for (const array of [arrays.albedoHeight, arrays.normalRoughAo]) {
    const isData = "isDataArrayTexture" in array && array.isDataArrayTexture === true;
    if (!isData && !("isCompressedArrayTexture" in array && array.isCompressedArrayTexture === true)) {
      throw new Error("Terrain texture sets require 2D array textures");
    }
    if (isData && (array.format !== RGBAFormat || array.type !== UnsignedByteType)) {
      throw new Error("Uncompressed fast-packed arrays must use RGBA unsigned-byte data");
    }
  }
  if (arrays.normalRoughAo.colorSpace === SRGBColorSpace) throw new Error("Normal/AO/roughness arrays must contain linear data");
  for (const array of [arrays.albedoHeight, arrays.normalRoughAo]) {
    array.wrapS = array.wrapT = RepeatWrapping;
    array.magFilter = LinearFilter;
    array.minFilter = array.generateMipmaps || array.mipmaps.length > 1 ? LinearMipmapLinearFilter : LinearFilter;
    array.needsUpdate = true;
  }
  const ownedSlots = slots.map((slot) => {
    const { albedo: _albedo, normal: _normal, height: _height, roughness: _roughness, ao: _ao, ...parameters } = slot;
    return Object.freeze({ ...parameters, detiling: slot.detiling ? Object.freeze({ ...slot.detiling }) : undefined });
  });
  let disposed = false;
  return {
    slots: Object.freeze(ownedSlots),
    ...arrays,
    packing: "fast",
    get disposed() { return disposed; },
    dispose() {
      if (disposed) return;
      disposed = true;
      arrays.albedoHeight.dispose();
      if (arrays.normalRoughAo !== arrays.albedoHeight) arrays.normalRoughAo.dispose();
    },
  };
}

type Pixels = { data: Uint8Array | Uint8ClampedArray; width: number; height: number; srgb: boolean; flipY: boolean };

function sourcePixels(source: Texture): Pixels {
  if ("isCompressedTexture" in source && source.isCompressedTexture === true) {
    throw new Error("Compressed sources must be prepacked arrays; use terrainTextureSetFromArrays");
  }
  const image = source.image as { width: number; height: number; data?: Uint8Array };
  if (!image || image.width < 1 || image.height < 1) throw new Error("Texture source must be loaded before packing");
  if (image.data) {
    if (source.type !== UnsignedByteType || source.format !== RGBAFormat || image.data.length !== image.width * image.height * 4) {
      throw new Error("Runtime data sources must be RGBA unsigned-byte textures");
    }
    return { data: image.data, width: image.width, height: image.height, srgb: source.colorSpace === SRGBColorSpace, flipY: source.flipY };
  }
  if (typeof document === "undefined") throw new Error("Image source packing requires a browser; DataTexture packing also works without a DOM");
  const canvas = document.createElement("canvas");
  canvas.width = image.width; canvas.height = image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("A 2D canvas is required to pack image sources");
  context.drawImage(image as unknown as CanvasImageSource, 0, 0);
  return { data: context.getImageData(0, 0, image.width, image.height).data, width: image.width, height: image.height, srgb: source.colorSpace === SRGBColorSpace, flipY: source.flipY };
}

function decodeChannel(value: number, srgb: boolean): number {
  value /= 255;
  return srgb ? (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4) : value;
}

function sampleChannel(pixels: Pixels | undefined, x: number, y: number, size: number, channel: number, fallback: number, color = false): number {
  if (!pixels) return fallback;
  const gx = Math.max(0, Math.min(pixels.width - 1, (x + 0.5) * pixels.width / size - 0.5));
  const sourceY = pixels.flipY ? size - 1 - y : y;
  const gy = Math.max(0, Math.min(pixels.height - 1, (sourceY + 0.5) * pixels.height / size - 0.5));
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const x1 = Math.min(x0 + 1, pixels.width - 1), y1 = Math.min(y0 + 1, pixels.height - 1);
  const fx = gx - x0, fy = gy - y0;
  const srgb = color && pixels.srgb;
  const a = decodeChannel(pixels.data[(y0 * pixels.width + x0) * 4 + channel]!, srgb);
  const b = decodeChannel(pixels.data[(y0 * pixels.width + x1) * 4 + channel]!, srgb);
  const c = decodeChannel(pixels.data[(y1 * pixels.width + x0) * 4 + channel]!, srgb);
  const d = decodeChannel(pixels.data[(y1 * pixels.width + x1) * 4 + channel]!, srgb);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

/** Packs loaded RGBA image/DataTexture sources into two owned RGBA8 arrays, with generated mips. */
export function createTerrainTextureSet(
  slots: readonly TerrainTextureSlot[],
  options: { resolution?: number } = {},
): TerrainTextureSet {
  validateSlots(slots);
  const firstImage = slots[0]?.albedo?.image as { width?: number } | undefined;
  const size = options.resolution ?? firstImage?.width ?? 256;
  if (!Number.isInteger(size) || size < 1) throw new Error("Texture set resolution must be a positive integer");
  const albedoData = new Uint8Array(size * size * slots.length * 4);
  const normalData = new Uint8Array(albedoData.length);
  const sources = new Map<Texture, Pixels>();
  for (const slot of slots) for (const source of [slot.albedo, slot.normal, slot.height, slot.roughness, slot.ao]) {
    if (source && !sources.has(source)) sources.set(source, sourcePixels(source));
  }
  slots.forEach((slot, layer) => {
    const albedo = slot.albedo ? sources.get(slot.albedo) : undefined;
    const normal = slot.normal ? sources.get(slot.normal) : undefined;
    const height = slot.height ? sources.get(slot.height) : undefined;
    const roughness = slot.roughness ? sources.get(slot.roughness) : undefined;
    const ao = slot.ao ? sources.get(slot.ao) : undefined;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const index = ((layer * size + y) * size + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        let value = sampleChannel(albedo, x, y, size, channel, 1, true);
        // Resize color in linear space, then encode RGB. Alpha and scalar maps stay linear.
        value = value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
        albedoData[index + channel] = Math.round(value * 255);
      }
      albedoData[index + 3] = Math.round(sampleChannel(height, x, y, size, 0, 0.5) * 255);
      normalData[index] = Math.round(sampleChannel(normal, x, y, size, 0, 0.5) * 255);
      normalData[index + 1] = Math.round(sampleChannel(normal, x, y, size, 1, 0.5) * 255);
      normalData[index + 2] = Math.round(sampleChannel(ao, x, y, size, 0, 1) * 255);
      normalData[index + 3] = Math.round(sampleChannel(roughness, x, y, size, 0, 0.8) * 255);
    }
  });
  const albedoHeight = new DataArrayTexture(albedoData, size, size, slots.length);
  const normalRoughAo = new DataArrayTexture(normalData, size, size, slots.length);
  albedoHeight.colorSpace = SRGBColorSpace;
  normalRoughAo.colorSpace = NoColorSpace;
  albedoHeight.generateMipmaps = normalRoughAo.generateMipmaps = true;
  return terrainTextureSetFromArrays({ albedoHeight, normalRoughAo }, slots);
}

/** Resolve the caller's color through three.js color management when building material parameters. */
export function textureSlotTint(slot: TerrainTextureSlot): Color {
  return new Color(slot.tint ?? 0xffffff);
}
