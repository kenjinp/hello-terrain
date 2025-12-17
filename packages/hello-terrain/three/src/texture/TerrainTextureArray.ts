import {
  DataArrayTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGBAFormat,
  RepeatWrapping,
  UnsignedByteType,
} from "three/webgpu";

export interface TextureSetOptions {
  /** Texture resolution (must be power of 2, same for all textures) */
  resolution: number;
  /** Maximum number of texture sets (default: 32) */
  maxTextures?: number;
  /** Enable mipmaps for texture arrays */
  generateMipmaps?: boolean;
}

export class TerrainTextureArray {
  /** Albedo (RGB) + Height (A) texture array */
  readonly albedoHeightArray: DataArrayTexture;

  /** Normal (RGB) + Roughness (A) texture array */
  readonly normalRoughnessArray: DataArrayTexture;

  /** AO (R channel, single-channel grayscale stored in RGBA) texture array */
  readonly aoArray: DataArrayTexture;

  /** Number of texture sets currently loaded */
  private textureCount = 0;

  readonly maxTextures: number;
  readonly resolution: number;

  constructor(options: TextureSetOptions) {
    const { resolution, maxTextures = 32, generateMipmaps = true } = options;

    this.maxTextures = maxTextures;
    this.resolution = resolution;

    // Pre-allocate arrays with maxTextures depth
    const pixelCount = resolution * resolution * 4 * maxTextures;

    this.albedoHeightArray = new DataArrayTexture(
      new Uint8Array(pixelCount),
      resolution,
      resolution,
      maxTextures
    );
    this.albedoHeightArray.format = RGBAFormat;
    this.albedoHeightArray.type = UnsignedByteType;
    this.albedoHeightArray.generateMipmaps = generateMipmaps;
    this.albedoHeightArray.minFilter = generateMipmaps
      ? LinearMipmapLinearFilter
      : LinearFilter;
    this.albedoHeightArray.magFilter = LinearFilter;
    this.albedoHeightArray.wrapS = RepeatWrapping;
    this.albedoHeightArray.wrapT = RepeatWrapping;
    this.albedoHeightArray.needsUpdate = true;

    this.normalRoughnessArray = new DataArrayTexture(
      new Uint8Array(pixelCount),
      resolution,
      resolution,
      maxTextures
    );
    this.normalRoughnessArray.format = RGBAFormat;
    this.normalRoughnessArray.type = UnsignedByteType;
    this.normalRoughnessArray.generateMipmaps = generateMipmaps;
    this.normalRoughnessArray.minFilter = generateMipmaps
      ? LinearMipmapLinearFilter
      : LinearFilter;
    this.normalRoughnessArray.magFilter = LinearFilter;
    this.normalRoughnessArray.wrapS = RepeatWrapping;
    this.normalRoughnessArray.wrapT = RepeatWrapping;
    this.normalRoughnessArray.needsUpdate = true;

    this.aoArray = new DataArrayTexture(
      new Uint8Array(pixelCount),
      resolution,
      resolution,
      maxTextures
    );
    this.aoArray.format = RGBAFormat;
    this.aoArray.type = UnsignedByteType;
    this.aoArray.generateMipmaps = generateMipmaps;
    this.aoArray.minFilter = generateMipmaps
      ? LinearMipmapLinearFilter
      : LinearFilter;
    this.aoArray.magFilter = LinearFilter;
    this.aoArray.wrapS = RepeatWrapping;
    this.aoArray.wrapT = RepeatWrapping;
    this.aoArray.needsUpdate = true;
  }

  /**
   * Add a texture set to the array
   * @param ao - Optional AO texture. If not provided, defaults to white (1.0 = no occlusion)
   * @returns Layer index (0-31) for this texture set
   */
  addTextureSet(
    albedo: ImageData,
    normal: ImageData,
    height: ImageData,
    roughness: ImageData,
    ao?: ImageData
  ): number {
    if (this.textureCount >= this.maxTextures) {
      throw new Error(`Cannot add more than ${this.maxTextures} texture sets`);
    }

    const layerIndex = this.textureCount++;

    this.packIntoLayer(this.albedoHeightArray, layerIndex, albedo, height);
    this.packIntoLayer(
      this.normalRoughnessArray,
      layerIndex,
      normal,
      roughness
    );

    // Pack AO into its own array (grayscale stored in R channel)
    if (ao) {
      this.packGrayscaleIntoLayer(this.aoArray, layerIndex, ao);
    } else {
      // Default to white (no occlusion)
      this.fillLayerWithValue(this.aoArray, layerIndex, 255);
    }

    this.albedoHeightArray.needsUpdate = true;
    this.normalRoughnessArray.needsUpdate = true;
    this.aoArray.needsUpdate = true;

    return layerIndex;
  }

  /**
   * Pack RGB from one image and A from another into a layer of the texture array
   */
  private packIntoLayer(
    target: DataArrayTexture,
    layer: number,
    rgb: ImageData,
    alpha: ImageData
  ): void {
    const { resolution } = this;

    if (rgb.width !== resolution || rgb.height !== resolution) {
      throw new Error(
        `RGB image must be ${resolution}x${resolution}, got ${rgb.width}x${rgb.height}`
      );
    }
    if (alpha.width !== resolution || alpha.height !== resolution) {
      throw new Error(
        `Alpha image must be ${resolution}x${resolution}, got ${alpha.width}x${alpha.height}`
      );
    }

    const targetData = target.image.data as Uint8Array;
    const pixelsPerLayer = resolution * resolution;
    const layerOffset = layer * pixelsPerLayer * 4;

    for (let i = 0; i < pixelsPerLayer; i++) {
      const srcIdx = i * 4;
      const dstIdx = layerOffset + i * 4;

      // Copy RGB from first image
      targetData[dstIdx + 0] = rgb.data[srcIdx + 0];
      targetData[dstIdx + 1] = rgb.data[srcIdx + 1];
      targetData[dstIdx + 2] = rgb.data[srcIdx + 2];

      // Copy R channel from second image as alpha
      targetData[dstIdx + 3] = alpha.data[srcIdx + 0];
    }
  }

  /**
   * Pack a grayscale image into a layer (R channel used, RGB all get the same value)
   */
  private packGrayscaleIntoLayer(
    target: DataArrayTexture,
    layer: number,
    grayscale: ImageData
  ): void {
    const { resolution } = this;

    if (grayscale.width !== resolution || grayscale.height !== resolution) {
      throw new Error(
        `Grayscale image must be ${resolution}x${resolution}, got ${grayscale.width}x${grayscale.height}`
      );
    }

    const targetData = target.image.data as Uint8Array;
    const pixelsPerLayer = resolution * resolution;
    const layerOffset = layer * pixelsPerLayer * 4;

    for (let i = 0; i < pixelsPerLayer; i++) {
      const srcIdx = i * 4;
      const dstIdx = layerOffset + i * 4;

      // Use R channel from grayscale image
      const value = grayscale.data[srcIdx + 0];
      targetData[dstIdx + 0] = value;
      targetData[dstIdx + 1] = value;
      targetData[dstIdx + 2] = value;
      targetData[dstIdx + 3] = 255;
    }
  }

  /**
   * Fill a layer with a constant value (used for default AO = white)
   */
  private fillLayerWithValue(
    target: DataArrayTexture,
    layer: number,
    value: number
  ): void {
    const { resolution } = this;
    const targetData = target.image.data as Uint8Array;
    const pixelsPerLayer = resolution * resolution;
    const layerOffset = layer * pixelsPerLayer * 4;

    for (let i = 0; i < pixelsPerLayer; i++) {
      const dstIdx = layerOffset + i * 4;
      targetData[dstIdx + 0] = value;
      targetData[dstIdx + 1] = value;
      targetData[dstIdx + 2] = value;
      targetData[dstIdx + 3] = 255;
    }
  }

  /**
   * Get the current number of loaded texture sets
   */
  getTextureCount(): number {
    return this.textureCount;
  }

  /**
   * Dispose of GPU resources
   */
  dispose(): void {
    this.albedoHeightArray.dispose();
    this.normalRoughnessArray.dispose();
    this.aoArray.dispose();
  }
}
