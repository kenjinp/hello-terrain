import { createTerrainTextureSet, terrainTextureSetFromArrays, type TerrainTextureSet } from "@hello-terrain/three";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import {
  CompressedArrayTexture, DataTexture, NearestFilter, NoColorSpace, RedFormat, RGBAFormat, SRGBColorSpace,
  TextureLoader, UnsignedByteType, UnsignedIntType,
  type CompressedTexture, type Texture, type WebGPURenderer,
} from "three/webgpu";

export interface TexturingExampleAssets {
  set: TerrainTextureSet;
  controlMap?: DataTexture;
  weightMap?: Texture;
  dispose(): void;
}

export function createExampleTextureSet(alternate = false): TerrainTextureSet {
  const colors = alternate
    ? [[70, 104, 122], [144, 77, 60], [183, 149, 90], [202, 219, 231]]
    : [[74, 111, 43], [108, 95, 83], [198, 174, 110], [227, 232, 235]];
  const sources: Texture[] = [];
  const slots = colors.map((color, layer) => {
    const pixels = new Uint8Array(64 * 64 * 4);
    const heights = new Uint8Array(pixels.length);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const i = (y * 64 + x) * 4;
      const grain = Math.sin(x * 12.9898 + y * 78.233 + layer * 17) * 43758.5453;
      const detail = grain - Math.floor(grain);
      const value = 0.72 + detail * 0.28;
      for (let channel = 0; channel < 3; channel++) {
        pixels[i + channel] = Math.round(color[channel]! * value);
        heights[i + channel] = Math.round(detail * 255);
      }
      pixels[i + 3] = heights[i + 3] = 255;
    }
    const albedo = new DataTexture(pixels, 64, 64, RGBAFormat, UnsignedByteType);
    albedo.colorSpace = SRGBColorSpace;
    const height = new DataTexture(heights, 64, 64, RGBAFormat, UnsignedByteType);
    sources.push(albedo, height);
    return {
      name: ["Grass", "Rock", "Sand", "Snow"][layer], albedo, height, uvScale: 12,
      projection: layer === 1 ? "vertical" as const : "uv" as const,
      antiTiling: layer === 0 ? "detile" as const : "none" as const,
    };
  });
  const set = createTerrainTextureSet(slots, { resolution: 64 });
  // The packer copies source pixels. The caller retains and disposes source ownership.
  sources.forEach(source => source.dispose());
  return set;
}

/** r186's native KTX2 path ignores layerCount; its mip byte arrays still contain every layer. */
async function loadNativeBc3Array(path: string, loader: KTX2Loader): Promise<CompressedArrayTexture> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Texture array HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  const header = new DataView(bytes);
  if (bytes.byteLength < 80 || header.getUint32(0, true) !== 0x58544bab ||
      header.getUint32(4, true) !== 0xbb303220 || header.getUint32(8, true) !== 0x0a1a0a0d ||
      ![137, 138].includes(header.getUint32(12, true)) || header.getUint32(28, true) !== 0 ||
      header.getUint32(36, true) !== 1 || header.getUint32(44, true) !== 0) {
    throw new Error("Expected an un-supercompressed native BC3 KTX2 2D array");
  }
  const width = header.getUint32(20, true), height = header.getUint32(24, true);
  const layers = header.getUint32(32, true), levels = header.getUint32(40, true);
  if (layers !== 4 || width === 0 || height === 0 || levels === 0) throw new Error("Expected four material layers with explicit mipmaps");
  const source = await new Promise<CompressedTexture>((resolve, reject) => loader.parse(bytes, resolve, reject));
  try {
    if (source.mipmaps.length !== levels || source.mipmaps.some((mip, level) =>
      mip.data.byteLength !== Math.ceil(Math.max(1, width >> level) / 4) *
        Math.ceil(Math.max(1, height >> level) / 4) * 16 * layers)) {
      throw new Error("BC3 mip payload does not match the array dimensions");
    }
    const texture = new CompressedArrayTexture(source.mipmaps, width, height, layers, source.format, source.type);
    texture.colorSpace = source.colorSpace;
    texture.needsUpdate = true;
    return texture;
  } finally { source.dispose(); }
}

/** Each invocation owns its loads; no shared loader cache is disposed out from under another terrain. */
export async function loadTexturingExampleAssets(
  renderer: WebGPURenderer,
  options: { compressed: boolean; painted: boolean; alternate: boolean },
): Promise<TexturingExampleAssets> {
  const owned: Texture[] = [];
  const loader = new KTX2Loader().detectSupport(renderer);
  let set: TerrainTextureSet | undefined;
  try {
    if (options.compressed) {
      // @types/three r182 declares void; the renderer API returns a boolean.
      const hasFeature = renderer.hasFeature.bind(renderer) as (name: string) => boolean;
      if (!hasFeature("texture-compression-bc")) throw new Error("This native BC3 example requires texture-compression-bc; use the procedural example on this device.");
      const loaded = await Promise.allSettled([
        "/assets/materials/terrain-fast/albedo-height.ktx2",
        "/assets/materials/terrain-fast/normal-ao-roughness.ktx2",
      ].map(async path => {
        const value = await loadNativeBc3Array(path, loader);
        owned.push(value);
        return value;
      }));
      // Wait for both requests even on failure, so all successfully loaded arrays are disposed.
      const [albedoHeight, normalRoughAo] = loaded.map(result => {
        if (result.status === "rejected") throw result.reason;
        return result.value;
      });
      normalRoughAo!.colorSpace = NoColorSpace;
      set = terrainTextureSetFromArrays({ albedoHeight: albedoHeight!, normalRoughAo: normalRoughAo! },
        ["Rocky ground", "Cliff", "Moss", "Forest stone"].map((name, i) => ({ name, uvScale: 18,
          projection: i === 1 ? "vertical" : "uv", normalStrength: 0.7 })));
      owned.length = 0; // Ownership transferred to the texture set.
    } else {
      set = createExampleTextureSet(options.alternate);
    }
    let controlMap: DataTexture | undefined;
    let weightMap: Texture | undefined;
    if (options.painted) {
      const response = await fetch("/assets/texturing/painted-control.r32");
      if (!response.ok) throw new Error(`Control map HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength !== 256 * 256 * 4) throw new Error("Expected a 256×256 native little-endian r32 control map");
      controlMap = new DataTexture(new Uint32Array(bytes), 256, 256, RedFormat, UnsignedIntType);
      controlMap.minFilter = controlMap.magFilter = NearestFilter;
      controlMap.generateMipmaps = false; controlMap.needsUpdate = true;
      owned.push(controlMap);
      weightMap = await new TextureLoader().loadAsync("/assets/texturing/painted-weights.png");
      weightMap.colorSpace = NoColorSpace;
      owned.push(weightMap);
    }
    const resultSet = set;
    let disposed = false;
    return { set: resultSet, controlMap, weightMap, dispose() {
      if (disposed) return;
      disposed = true; resultSet.dispose(); owned.forEach(value => value.dispose());
    } };
  } catch (error) {
    set?.dispose(); owned.forEach(value => value.dispose());
    throw error;
  } finally { loader.dispose(); }
}
