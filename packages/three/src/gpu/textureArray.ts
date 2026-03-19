import {
  ClampToEdgeWrapping,
  DataArrayTexture,
  LinearFilter,
  LinearMipMapLinearFilter,
  RGBAFormat,
  UnsignedByteType,
} from "three";

type ImageLike = ImageData | Uint8Array;

export interface TextureArrayContext {
  albedoHeight: DataArrayTexture;
  normalRoughness: DataArrayTexture;
  textureCount: number;
  resolution: number;
  maxTextures: number;
}

function createEmptyTextureArray(
  resolution: number,
  maxTextures: number,
  generateMipmaps: boolean,
): DataArrayTexture {
  const data = new Uint8Array(resolution * resolution * 4 * maxTextures);
  const texture = new DataArrayTexture(data, resolution, resolution, maxTextures);
  texture.format = RGBAFormat;
  texture.type = UnsignedByteType;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = generateMipmaps ? LinearMipMapLinearFilter : LinearFilter;
  texture.generateMipmaps = generateMipmaps;
  texture.needsUpdate = true;
  return texture;
}

function asByteArray(source: ImageLike, expectedSize: number): Uint8Array {
  if (source instanceof Uint8Array) {
    if (source.length !== expectedSize) {
      throw new Error(
        `Expected source length ${expectedSize}, received ${source.length}.`,
      );
    }
    return source;
  }

  const array = source.data;
  if (array.length !== expectedSize) {
    throw new Error(
      `Expected source length ${expectedSize}, received ${array.length}.`,
    );
  }
  return new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
}

function layerOffset(
  resolution: number,
  maxTextures: number,
  layer: number,
  pixelOffset = 0,
): number {
  const layerStride = resolution * resolution * 4;
  if (layer < 0 || layer >= maxTextures) {
    throw new Error(`Texture array layer ${layer} is out of bounds.`);
  }
  return layer * layerStride + pixelOffset;
}

export function packIntoLayer(
  target: DataArrayTexture,
  layer: number,
  rgbSource: ImageLike,
  alphaSource: ImageLike,
): void {
  const { width, height, depth } = target.image;
  const resolution = width;
  const expected = resolution * height * 4;
  const rgb = asByteArray(rgbSource, expected);
  const alpha = asByteArray(alphaSource, expected);

  const data = target.image.data as Uint8Array;
  const baseOffset = layerOffset(resolution, depth, layer);

  for (let i = 0; i < expected; i += 4) {
    const targetIndex = baseOffset + i;
    data[targetIndex] = rgb[i] ?? 0;
    data[targetIndex + 1] = rgb[i + 1] ?? 0;
    data[targetIndex + 2] = rgb[i + 2] ?? 0;
    data[targetIndex + 3] = alpha[i] ?? 0;
  }

  target.needsUpdate = true;
}

export function createTextureArrays(
  resolution: number,
  maxTextures = 32,
  generateMipmaps = true,
): TextureArrayContext {
  return {
    albedoHeight: createEmptyTextureArray(
      resolution,
      maxTextures,
      generateMipmaps,
    ),
    normalRoughness: createEmptyTextureArray(
      resolution,
      maxTextures,
      generateMipmaps,
    ),
    textureCount: 0,
    resolution,
    maxTextures,
  };
}

export function addTextureSet(
  context: TextureArrayContext,
  albedo: ImageLike,
  normal: ImageLike,
  height: ImageLike,
  roughness: ImageLike,
  ao?: ImageLike,
): number {
  if (context.textureCount >= context.maxTextures) {
    throw new Error(
      `Texture array is full (${context.maxTextures} layers already assigned).`,
    );
  }

  const layer = context.textureCount;
  packIntoLayer(context.albedoHeight, layer, albedo, height);
  packIntoLayer(context.normalRoughness, layer, normal, roughness);

  if (ao) {
    const expected = context.resolution * context.resolution * 4;
    const aoBytes = asByteArray(ao, expected);
    const data = context.normalRoughness.image.data as Uint8Array;
    const baseOffset = layerOffset(context.resolution, context.maxTextures, layer);
    for (let i = 0; i < expected; i += 4) {
      data[baseOffset + i + 3] = aoBytes[i] ?? 255;
    }
    context.normalRoughness.needsUpdate = true;
  }

  context.textureCount += 1;
  return layer;
}
