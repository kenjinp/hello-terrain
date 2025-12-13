import { Fn, float, int, positionWorld, select, vec4 } from "three/tsl";
import type { ShaderNodeObject } from "three/tsl";
import type { Node } from "three/webgpu";
import type { TerrainVaryings } from "../TerrainVaryings";
import type { TerrainTextureArray } from "../texture/TerrainTextureArray";
import { controlmapStorageProperty } from "./properties";
import { heightBlend, sampleTextureArray } from "./textureArraySampling";

/** Uniform type for reactive shader values - accepts any shader node */
// biome-ignore lint/suspicious/noExplicitAny: TSL uniform types are complex and vary
type UniformValue = ShaderNodeObject<any>;

export interface TerrainTextureMaterialParams {
  /** TerrainMesh varyings for vertex data access */
  varyings: TerrainVaryings;
  /** Texture array containing all terrain textures */
  textureArray: TerrainTextureArray;
  /** World-space scale for texture UVs (higher = more tiling). Can be a number or uniform for reactive updates. */
  textureScale?: number | UniformValue;
  /** Sharpness of height-based blending (higher = sharper). Can be a number or uniform for reactive updates. */
  heightBlendSharpness?: number | UniformValue;
}

/**
 * Create a color node for terrain texture rendering
 *
 * This node:
 * 1. Reads control data from the current vertex
 * 2. Samples base and overlay textures from texture arrays
 * 3. Blends textures using height-based blending
 * 4. Returns final RGBA color (alpha 0 for holes)
 *
 * Usage:
 * ```ts
 * const colorNode = createTerrainColorNode({
 *   varyings: terrain.varyings,
 *   textureArray: terrain.textureArray,
 *   textureScale: 10,
 * });
 * material.colorNode = colorNode;
 * ```
 */
export const createTerrainColorNode = (
  params: TerrainTextureMaterialParams
): ShaderNodeObject<Node> => {
  const {
    varyings,
    textureArray,
    textureScale = 10,
    heightBlendSharpness = 4,
  } = params;

  // Create texture uniforms outside the Fn
  const albedoHeightTexture = textureArray.albedoHeightArray;

  // Convert to shader nodes - support both numbers and uniforms
  const textureScaleNode =
    typeof textureScale === "number" ? float(textureScale) : textureScale;
  const heightBlendSharpnessNode =
    typeof heightBlendSharpness === "number"
      ? float(heightBlendSharpness)
      : heightBlendSharpness;

  return Fn(() => {
    // Read and decode control data
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
    const hole = packedInt
      .shiftRight(int(3))
      .bitAnd(int(0x01))
      .equal(int(1))
      .toVar();

    const worldPos = positionWorld;
    const textureUV = worldPos.xz.div(textureScaleNode);
    const scaledUV = textureUV.mul(uvScale);

    // Sample base and overlay textures (albedo + height)
    const baseSample = sampleTextureArray(
      albedoHeightTexture,
      scaledUV,
      baseId
    );
    const overlaySample = sampleTextureArray(
      albedoHeightTexture,
      scaledUV,
      overlayId
    );

    // Height-based blend
    const blendedColor = heightBlend(
      baseSample.rgb,
      overlaySample.rgb,
      baseSample.a,
      overlaySample.a,
      blend,
      heightBlendSharpnessNode
    );

    // Handle holes (set alpha to 0 to discard)
    return vec4(blendedColor, select(hole, float(0), float(1)));
  })();
};

/**
 * Create a normal+roughness node for terrain PBR materials
 *
 * Samples normal and roughness from texture arrays and blends them.
 *
 * Usage:
 * ```ts
 * const normalNode = createTerrainNormalNode({
 *   varyings: terrain.varyings,
 *   textureArray: terrain.textureArray,
 * });
 * material.normalNode = normalNode;
 * ```
 */
export const createTerrainNormalNode = (
  params: Omit<TerrainTextureMaterialParams, "heightBlendSharpness">
): ShaderNodeObject<Node> => {
  const { varyings, textureArray, textureScale = 10 } = params;

  // Create texture uniform outside the Fn
  const normalRoughnessTexture = textureArray.normalRoughnessArray;

  // Convert to shader node - support both numbers and uniforms
  const textureScaleNode =
    typeof textureScale === "number" ? float(textureScale) : textureScale;

  return Fn(() => {
    // Read and decode control data
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

    const worldPos = positionWorld;
    const textureUV = worldPos.xz.div(textureScaleNode);
    const scaledUV = textureUV.mul(uvScale);

    // Sample base and overlay textures (normal + roughness)
    const baseSample = sampleTextureArray(
      normalRoughnessTexture,
      scaledUV,
      baseId
    );
    const overlaySample = sampleTextureArray(
      normalRoughnessTexture,
      scaledUV,
      overlayId
    );

    // Simple linear blend for normals (could use height-based blend here too)
    const blendedNormal = baseSample.rgb
      .mul(float(1).sub(blend))
      .add(overlaySample.rgb.mul(blend));

    return blendedNormal;
  })();
};

/**
 * Create a roughness node for terrain PBR materials
 *
 * Samples roughness values from texture arrays and blends them.
 *
 * Usage:
 * ```ts
 * const roughnessNode = createTerrainRoughnessNode({
 *   varyings: terrain.varyings,
 *   textureArray: terrain.textureArray,
 * });
 * material.roughnessNode = roughnessNode;
 * ```
 */
export const createTerrainRoughnessNode = (
  params: Omit<TerrainTextureMaterialParams, "heightBlendSharpness">
): ShaderNodeObject<Node> => {
  const { varyings, textureArray, textureScale = 10 } = params;

  // Create texture uniform outside the Fn
  const normalRoughnessTexture = textureArray.normalRoughnessArray;

  // Convert to shader node - support both numbers and uniforms
  const textureScaleNode =
    typeof textureScale === "number" ? float(textureScale) : textureScale;

  return Fn(() => {
    // Read and decode control data
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

    const worldPos = positionWorld;
    const textureUV = worldPos.xz.div(textureScaleNode);
    const scaledUV = textureUV.mul(uvScale);

    // Sample base and overlay textures (normal + roughness in alpha)
    const baseSample = sampleTextureArray(
      normalRoughnessTexture,
      scaledUV,
      baseId
    );
    const overlaySample = sampleTextureArray(
      normalRoughnessTexture,
      scaledUV,
      overlayId
    );

    // Linear blend roughness from alpha channel
    const blendedRoughness = baseSample.a
      .mul(float(1).sub(blend))
      .add(overlaySample.a.mul(blend));

    return blendedRoughness;
  })();
};
