import type { ShaderNodeObject } from "three/tsl";
import {
  Fn,
  cross,
  dFdx,
  dFdy,
  float,
  int,
  mix,
  positionWorld,
  select,
  smoothstep,
  vec4,
} from "three/tsl";
import type { Node } from "three/webgpu";
import type { TerrainVaryings } from "../TerrainVaryings";
import type { TerrainTextureArray } from "../texture/TerrainTextureArray";
import { controlmapStorageProperty } from "./properties";
import {
  heightBlend,
  sampleTextureArray,
  sampleTextureArrayTriplanar,
  sampleTextureArrayTriplanarDebug,
  sampleTextureArrayTriplanarNoTile,
  triplanarDebugWeights,
} from "./textureArraySampling";

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

export interface TerrainTextureMaterialTriplanarParams
  extends TerrainTextureMaterialParams {
  /** Sharpness of triplanar blending (higher = sharper transitions between projections). Default: 2 */
  triplanarSharpness?: number | UniformValue;
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

/**
 * Create a color node using triplanar texture sampling
 *
 * This node uses triplanar projection to prevent texture stretching on steep
 * slopes. It projects textures from three orthogonal planes (XY, XZ, YZ) and
 * blends them based on the surface normal.
 *
 * Features:
 * 1. Reads control data from the current vertex
 * 2. Samples base and overlay textures using triplanar projection
 * 3. Blends textures using height-based blending
 * 4. Returns final RGBA color (alpha 0 for holes)
 *
 * Usage:
 * ```ts
 * const colorNode = createTerrainColorNodeTriplanar({
 *   varyings: terrain.varyings,
 *   textureArray: terrain.textureArray,
 *   textureScale: 10,
 *   triplanarSharpness: 2,
 * });
 * material.colorNode = colorNode;
 * ```
 */
export const createTerrainColorNodeTriplanar = (
  params: TerrainTextureMaterialTriplanarParams
): ShaderNodeObject<Node> => {
  const {
    varyings,
    textureArray,
    textureScale = 10,
    heightBlendSharpness = 4,
    triplanarSharpness = 2,
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
  const triplanarSharpnessNode =
    typeof triplanarSharpness === "number"
      ? float(triplanarSharpness)
      : triplanarSharpness;

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

    // Compute geometric normal from screen-space derivatives of world position
    // This correctly reflects the actual scaled terrain geometry
    const dPdx = dFdx(worldPos);
    const dPdy = dFdy(worldPos);
    const geometricNormal = cross(dPdy, dPdx).normalize();

    // Apply UV scale to texture scale
    const scaledTextureScale = textureScaleNode.div(uvScale);

    // Sample base and overlay textures using triplanar projection
    const baseSample = sampleTextureArrayTriplanar(
      albedoHeightTexture,
      worldPos,
      geometricNormal,
      baseId,
      scaledTextureScale,
      triplanarSharpnessNode
    );
    const overlaySample = sampleTextureArrayTriplanar(
      albedoHeightTexture,
      worldPos,
      geometricNormal,
      overlayId,
      scaledTextureScale,
      triplanarSharpnessNode
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
 * Create a normal node using triplanar texture sampling
 *
 * Samples normal and roughness from texture arrays using triplanar projection
 * to prevent stretching on steep slopes.
 *
 * Usage:
 * ```ts
 * const normalNode = createTerrainNormalNodeTriplanar({
 *   varyings: terrain.varyings,
 *   textureArray: terrain.textureArray,
 * });
 * material.normalNode = normalNode;
 * ```
 */
export const createTerrainNormalNodeTriplanar = (
  params: Omit<TerrainTextureMaterialTriplanarParams, "heightBlendSharpness">
): ShaderNodeObject<Node> => {
  const {
    varyings,
    textureArray,
    textureScale = 10,
    triplanarSharpness = 2,
  } = params;

  // Create texture uniform outside the Fn
  const normalRoughnessTexture = textureArray.normalRoughnessArray;

  // Convert to shader nodes - support both numbers and uniforms
  const textureScaleNode =
    typeof textureScale === "number" ? float(textureScale) : textureScale;
  const triplanarSharpnessNode =
    typeof triplanarSharpness === "number"
      ? float(triplanarSharpness)
      : triplanarSharpness;

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

    // Compute geometric normal from screen-space derivatives of world position
    const dPdx = dFdx(worldPos);
    const dPdy = dFdy(worldPos);
    const geometricNormal = cross(dPdy, dPdx).normalize();

    // Apply UV scale to texture scale
    const scaledTextureScale = textureScaleNode.div(uvScale);

    // Sample base and overlay textures using triplanar projection
    const baseSample = sampleTextureArrayTriplanar(
      normalRoughnessTexture,
      worldPos,
      geometricNormal,
      baseId,
      scaledTextureScale,
      triplanarSharpnessNode
    );
    const overlaySample = sampleTextureArrayTriplanar(
      normalRoughnessTexture,
      worldPos,
      geometricNormal,
      overlayId,
      scaledTextureScale,
      triplanarSharpnessNode
    );

    // Simple linear blend for normals
    const blendedNormal = baseSample.rgb
      .mul(float(1).sub(blend))
      .add(overlaySample.rgb.mul(blend));

    return blendedNormal;
  })();
};

/**
 * Create a roughness node using triplanar texture sampling
 *
 * Samples roughness values from texture arrays using triplanar projection.
 *
 * Usage:
 * ```ts
 * const roughnessNode = createTerrainRoughnessNodeTriplanar({
 *   varyings: terrain.varyings,
 *   textureArray: terrain.textureArray,
 * });
 * material.roughnessNode = roughnessNode;
 * ```
 */
export const createTerrainRoughnessNodeTriplanar = (
  params: Omit<TerrainTextureMaterialTriplanarParams, "heightBlendSharpness">
): ShaderNodeObject<Node> => {
  const {
    varyings,
    textureArray,
    textureScale = 10,
    triplanarSharpness = 2,
  } = params;

  // Create texture uniform outside the Fn
  const normalRoughnessTexture = textureArray.normalRoughnessArray;

  // Convert to shader nodes - support both numbers and uniforms
  const textureScaleNode =
    typeof textureScale === "number" ? float(textureScale) : textureScale;
  const triplanarSharpnessNode =
    typeof triplanarSharpness === "number"
      ? float(triplanarSharpness)
      : triplanarSharpness;

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

    // Compute geometric normal from screen-space derivatives of world position
    const dPdx = dFdx(worldPos);
    const dPdy = dFdy(worldPos);
    const geometricNormal = cross(dPdy, dPdx).normalize();

    // Apply UV scale to texture scale
    const scaledTextureScale = textureScaleNode.div(uvScale);

    // Sample base and overlay textures using triplanar projection
    const baseSample = sampleTextureArrayTriplanar(
      normalRoughnessTexture,
      worldPos,
      geometricNormal,
      baseId,
      scaledTextureScale,
      triplanarSharpnessNode
    );
    const overlaySample = sampleTextureArrayTriplanar(
      normalRoughnessTexture,
      worldPos,
      geometricNormal,
      overlayId,
      scaledTextureScale,
      triplanarSharpnessNode
    );

    // Linear blend roughness from alpha channel
    const blendedRoughness = baseSample.a
      .mul(float(1).sub(blend))
      .add(overlaySample.a.mul(blend));

    return blendedRoughness;
  })();
};

/**
 * Debug mode values for triplanar visualization uniform:
 * - 0 = off (normal rendering)
 * - 1 = weights (pure RGB showing axis blend weights)
 * - 2 = tinted (textures with axis color tints)
 */
export const TRIPLANAR_DEBUG_OFF = 0;
export const TRIPLANAR_DEBUG_WEIGHTS = 1;
export const TRIPLANAR_DEBUG_TINTED = 2;

export interface TerrainTextureMaterialTriplanarDebugParams
  extends TerrainTextureMaterialTriplanarParams {
  /**
   * Debug mode uniform (0 = off, 1 = weights, 2 = tinted).
   * Use uniform() to create a reactive value that can be changed at runtime.
   */
  debugMode: UniformValue;
}

/**
 * Create a color node with triplanar sampling and debug visualization support
 *
 * This unified node supports runtime switching between normal rendering and
 * debug visualization modes via a uniform, without shader recompilation.
 *
 * Debug modes (controlled by debugMode uniform):
 * - 0: Normal triplanar texture rendering
 * - 1: Pure RGB colors showing blend weights (R=X, G=Y, B=Z)
 * - 2: Textures with axis color tints
 *
 * Usage:
 * ```ts
 * const debugModeUniform = uniform(0); // 0=off, 1=weights, 2=tinted
 *
 * const colorNode = createTerrainColorNodeTriplanarDebug({
 *   varyings: terrain.varyings,
 *   textureArray: terrain.textureArray,
 *   debugMode: debugModeUniform,
 * });
 * material.colorNode = colorNode;
 *
 * // Toggle debug mode at runtime:
 * debugModeUniform.value = 1; // Show weights
 * ```
 */
export const createTerrainColorNodeTriplanarDebug = (
  params: TerrainTextureMaterialTriplanarDebugParams
): ShaderNodeObject<Node> => {
  const {
    varyings,
    textureArray,
    textureScale = 10,
    heightBlendSharpness = 4,
    triplanarSharpness = 2,
    debugMode,
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
  const triplanarSharpnessNode =
    typeof triplanarSharpness === "number"
      ? float(triplanarSharpness)
      : triplanarSharpness;

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

    // Compute geometric normal from screen-space derivatives of world position
    // This correctly reflects the actual scaled terrain geometry
    const dPdx = dFdx(worldPos);
    const dPdy = dFdy(worldPos);
    const geometricNormal = cross(dPdy, dPdx).normalize();

    // Apply UV scale to texture scale
    const scaledTextureScale = textureScaleNode.div(uvScale);

    // Compute all three possible outputs:

    // 1. Normal triplanar sampling (uses geometric normal for correct projection)
    const baseSampleNormal = sampleTextureArrayTriplanar(
      albedoHeightTexture,
      worldPos,
      geometricNormal,
      baseId,
      scaledTextureScale,
      triplanarSharpnessNode
    );
    const overlaySampleNormal = sampleTextureArrayTriplanar(
      albedoHeightTexture,
      worldPos,
      geometricNormal,
      overlayId,
      scaledTextureScale,
      triplanarSharpnessNode
    );
    const normalColor = heightBlend(
      baseSampleNormal.rgb,
      overlaySampleNormal.rgb,
      baseSampleNormal.a,
      overlaySampleNormal.a,
      blend,
      heightBlendSharpnessNode
    );

    // 2. Debug weights (pure RGB)
    const weightsColor = triplanarDebugWeights(
      geometricNormal,
      triplanarSharpnessNode
    ).rgb;

    // 3. Debug tinted (textures with color tints)
    const baseSampleTinted = sampleTextureArrayTriplanarDebug(
      albedoHeightTexture,
      worldPos,
      geometricNormal,
      baseId,
      scaledTextureScale,
      triplanarSharpnessNode
    );
    const overlaySampleTinted = sampleTextureArrayTriplanarDebug(
      albedoHeightTexture,
      worldPos,
      geometricNormal,
      overlayId,
      scaledTextureScale,
      triplanarSharpnessNode
    );
    const tintedColor = heightBlend(
      baseSampleTinted.rgb,
      overlaySampleTinted.rgb,
      baseSampleTinted.a,
      overlaySampleTinted.a,
      blend,
      heightBlendSharpnessNode
    );

    // Select output based on debug mode uniform:
    // 0 = normal, 1 = weights, 2 = tinted
    // Use mix with step functions to select the right output
    const isWeights = debugMode.equal(float(1));
    const isTinted = debugMode.equal(float(2));

    // Select between the three modes
    const finalColor = mix(
      mix(normalColor, weightsColor, select(isWeights, float(1), float(0))),
      tintedColor,
      select(isTinted, float(1), float(0))
    );

    // Handle holes (set alpha to 0 to discard)
    return vec4(finalColor, select(hole, float(0), float(1)));
  })();
};

export interface TerrainTextureMaterialTriplanarNoTileParams
  extends TerrainTextureMaterialTriplanarParams {
  /**
   * Debug mode uniform (0 = off, 1 = weights, 2 = tinted).
   * Use uniform() to create a reactive value that can be changed at runtime.
   */
  debugMode: UniformValue;
  /**
   * Scale for the stochastic variation pattern (lower = larger variation zones).
   * Default: 0.01. Typical range: 0.001 - 0.1
   */
  variationScale?: number | UniformValue;
  /**
   * Width of the transition blend zone between different textures (0-1).
   * Higher values create smoother transitions.
   * Default: 0.3. Typical range: 0.1 - 0.5
   */
  transitionBlendWidth?: number | UniformValue;
}

/**
 * Create a color node with triplanar sampling, stochastic tiling, and debug support
 *
 * This node combines:
 * - Triplanar projection (prevents stretching on steep slopes)
 * - Stochastic tiling (reduces visible texture repetition using Inigo Quilez's technique)
 * - Debug visualization modes
 *
 * The stochastic technique samples the texture at randomized offsets based on a
 * low-frequency variation pattern, then blends between samples for seamless transitions.
 * This effectively breaks up the visible grid pattern that occurs with tiled textures.
 *
 * Debug modes (controlled by debugMode uniform):
 * - 0: Normal triplanar + stochastic texture rendering
 * - 1: Pure RGB colors showing blend weights (R=X, G=Y, B=Z)
 * - 2: Textures with axis color tints
 *
 * Usage:
 * ```ts
 * const debugModeUniform = uniform(0);
 * const variationScaleUniform = uniform(0.01);
 *
 * const colorNode = createTerrainColorNodeTriplanarNoTile({
 *   varyings: terrain.varyings,
 *   textureArray: terrain.textureArray,
 *   debugMode: debugModeUniform,
 *   variationScale: variationScaleUniform,
 * });
 * material.colorNode = colorNode;
 * ```
 */
export const createTerrainColorNodeTriplanarNoTile = (
  params: TerrainTextureMaterialTriplanarNoTileParams
): ShaderNodeObject<Node> => {
  const {
    varyings,
    textureArray,
    textureScale = 10,
    heightBlendSharpness = 4,
    triplanarSharpness = 2,
    debugMode,
    variationScale = 0.01,
    transitionBlendWidth = 0.3,
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
  const triplanarSharpnessNode =
    typeof triplanarSharpness === "number"
      ? float(triplanarSharpness)
      : triplanarSharpness;
  const variationScaleNode =
    typeof variationScale === "number" ? float(variationScale) : variationScale;
  const transitionBlendWidthNode =
    typeof transitionBlendWidth === "number"
      ? float(transitionBlendWidth)
      : transitionBlendWidth;

  return Fn(() => {
    // Read control data from varyings (interpolated by GPU across triangles)
    // This creates smooth transitions between vertices with different control values
    const interpolatedBaseId = varyings.vControlBaseId;
    const interpolatedOverlayId = varyings.vControlOverlayId;
    const interpolatedBlend = varyings.vControlBlend;

    // For UV scale and hole, we still need to read from storage (they don't need interpolation)
    const globalVertexIndex = varyings.vGlobalVertexIndex;
    const packed = controlmapStorageProperty.element(globalVertexIndex);
    const packedInt = packed.toUint();
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

    // Compute geometric normal from screen-space derivatives of world position
    const dPdx = dFdx(worldPos);
    const dPdy = dFdy(worldPos);
    const geometricNormal = cross(dPdy, dPdx).normalize();

    // Apply UV scale to texture scale
    const scaledTextureScale = textureScaleNode.div(uvScale);

    // === TEXTURE ID TRANSITION BLENDING ===
    // When texture IDs are interpolated between vertices, we get fractional values.
    // Sample both floor and ceil texture IDs and blend between them for smooth transitions.

    // Get floor and ceil texture IDs for base texture
    const baseIdFloor = interpolatedBaseId.floor().toInt();
    const baseIdCeil = interpolatedBaseId.ceil().toInt();
    const baseIdFract = interpolatedBaseId.sub(interpolatedBaseId.floor());

    // Get floor and ceil texture IDs for overlay texture
    const overlayIdFloor = interpolatedOverlayId.floor().toInt();
    const overlayIdCeil = interpolatedOverlayId.ceil().toInt();
    const overlayIdFract = interpolatedOverlayId.sub(
      interpolatedOverlayId.floor()
    );

    // Calculate transition blend factors with adjustable width
    // transitionBlendWidth controls how smooth the transition is
    const baseTransitionBlend = smoothstep(
      float(0.5).sub(transitionBlendWidthNode),
      float(0.5).add(transitionBlendWidthNode),
      baseIdFract
    );
    const overlayTransitionBlend = smoothstep(
      float(0.5).sub(transitionBlendWidthNode),
      float(0.5).add(transitionBlendWidthNode),
      overlayIdFract
    );

    // The blend factor from the control map, with smoothstep for smoother interpolation
    const controlBlend = smoothstep(float(0), float(1), interpolatedBlend);

    // Sample all needed textures for base (floor and ceil IDs)
    const baseFloorSample = sampleTextureArrayTriplanarNoTile(
      albedoHeightTexture,
      worldPos,
      geometricNormal,
      baseIdFloor,
      scaledTextureScale,
      triplanarSharpnessNode,
      variationScaleNode
    );
    const baseCeilSample = sampleTextureArrayTriplanarNoTile(
      albedoHeightTexture,
      worldPos,
      geometricNormal,
      baseIdCeil,
      scaledTextureScale,
      triplanarSharpnessNode,
      variationScaleNode
    );

    // Sample all needed textures for overlay (floor and ceil IDs)
    const overlayFloorSample = sampleTextureArrayTriplanarNoTile(
      albedoHeightTexture,
      worldPos,
      geometricNormal,
      overlayIdFloor,
      scaledTextureScale,
      triplanarSharpnessNode,
      variationScaleNode
    );
    const overlayCeilSample = sampleTextureArrayTriplanarNoTile(
      albedoHeightTexture,
      worldPos,
      geometricNormal,
      overlayIdCeil,
      scaledTextureScale,
      triplanarSharpnessNode,
      variationScaleNode
    );

    // Blend between floor and ceil samples for both base and overlay
    // Use height-based blending so texture heights influence the transition
    const blendedBaseColor = heightBlend(
      baseFloorSample.rgb,
      baseCeilSample.rgb,
      baseFloorSample.a,
      baseCeilSample.a,
      baseTransitionBlend,
      heightBlendSharpnessNode
    );
    // Blend heights for use in final base-to-overlay blend
    const blendedBaseHeight = mix(
      baseFloorSample.a,
      baseCeilSample.a,
      baseTransitionBlend
    );

    const blendedOverlayColor = heightBlend(
      overlayFloorSample.rgb,
      overlayCeilSample.rgb,
      overlayFloorSample.a,
      overlayCeilSample.a,
      overlayTransitionBlend,
      heightBlendSharpnessNode
    );
    const blendedOverlayHeight = mix(
      overlayFloorSample.a,
      overlayCeilSample.a,
      overlayTransitionBlend
    );

    // Final color: blend between base and overlay using height-based blending
    const noTileColor = heightBlend(
      blendedBaseColor,
      blendedOverlayColor,
      blendedBaseHeight,
      blendedOverlayHeight,
      controlBlend,
      heightBlendSharpnessNode
    );

    // For debug modes, use simple rounded IDs
    const baseId = interpolatedBaseId.round().toInt();
    const overlayId = interpolatedOverlayId.round().toInt();

    // Debug weights (pure RGB)
    const weightsColor = triplanarDebugWeights(
      geometricNormal,
      triplanarSharpnessNode
    ).rgb;

    // Debug tinted (textures with color tints)
    const baseSampleTinted = sampleTextureArrayTriplanarDebug(
      albedoHeightTexture,
      worldPos,
      geometricNormal,
      baseId,
      scaledTextureScale,
      triplanarSharpnessNode
    );
    const overlaySampleTinted = sampleTextureArrayTriplanarDebug(
      albedoHeightTexture,
      worldPos,
      geometricNormal,
      overlayId,
      scaledTextureScale,
      triplanarSharpnessNode
    );
    const tintedColor = heightBlend(
      baseSampleTinted.rgb,
      overlaySampleTinted.rgb,
      baseSampleTinted.a,
      overlaySampleTinted.a,
      controlBlend,
      heightBlendSharpnessNode
    );

    // Select output based on debug mode uniform:
    // 0 = noTile, 1 = weights, 2 = tinted
    const isWeights = debugMode.equal(float(1));
    const isTinted = debugMode.equal(float(2));

    // Select between the three modes
    const finalColor = mix(
      mix(noTileColor, weightsColor, select(isWeights, float(1), float(0))),
      tintedColor,
      select(isTinted, float(1), float(0))
    );

    // Handle holes (set alpha to 0 to discard)
    return vec4(finalColor, select(hole, float(0), float(1)));
  })();
};

/**
 * Create a roughness node using triplanar texture sampling with stochastic tiling
 * Samples roughness values from texture arrays using triplanar projection with anti-tiling.
 *
 * @example
 * ```ts
 * const roughnessNode = createTerrainRoughnessNodeTriplanarNoTile({
 *   varyings: terrain.varyings,
 *   textureArray: myTextureArray,
 *   textureScale: 10,
 *   triplanarSharpness: 2,
 *   variationScale: 0.01,
 * });
 * material.roughnessNode = roughnessNode;
 * ```
 */
export const createTerrainRoughnessNodeTriplanarNoTile = (
  params: Omit<
    TerrainTextureMaterialTriplanarNoTileParams,
    "heightBlendSharpness" | "debugMode"
  >
): ShaderNodeObject<Node> => {
  const {
    varyings,
    textureArray,
    textureScale = 10,
    triplanarSharpness = 2,
    variationScale = 0.01,
    transitionBlendWidth = 0.3,
  } = params;

  // Create texture uniform outside the Fn
  const normalRoughnessTexture = textureArray.normalRoughnessArray;

  // Convert to shader nodes - support both numbers and uniforms
  const textureScaleNode =
    typeof textureScale === "number" ? float(textureScale) : textureScale;
  const triplanarSharpnessNode =
    typeof triplanarSharpness === "number"
      ? float(triplanarSharpness)
      : triplanarSharpness;
  const variationScaleNode =
    typeof variationScale === "number" ? float(variationScale) : variationScale;
  const transitionBlendWidthNode =
    typeof transitionBlendWidth === "number"
      ? float(transitionBlendWidth)
      : transitionBlendWidth;

  return Fn(() => {
    // Read control data from varyings (interpolated by GPU across triangles)
    const interpolatedBaseId = varyings.vControlBaseId;
    const interpolatedOverlayId = varyings.vControlOverlayId;
    const interpolatedBlend = varyings.vControlBlend;

    // For UV scale, we still need to read from storage
    const globalVertexIndex = varyings.vGlobalVertexIndex;
    const packed = controlmapStorageProperty.element(globalVertexIndex);
    const packedInt = packed.toUint();
    const uvScale = packedInt
      .shiftRight(int(10))
      .bitAnd(int(0x0f))
      .toFloat()
      .add(1.0)
      .toVar();

    const worldPos = positionWorld;

    // Compute geometric normal from screen-space derivatives of world position
    const dPdx = dFdx(worldPos);
    const dPdy = dFdy(worldPos);
    const geometricNormal = cross(dPdy, dPdx).normalize();

    // Apply UV scale to texture scale
    const scaledTextureScale = textureScaleNode.div(uvScale);

    // === TEXTURE ID TRANSITION BLENDING ===
    // Get floor and ceil texture IDs for base texture
    const baseIdFloor = interpolatedBaseId.floor().toInt();
    const baseIdCeil = interpolatedBaseId.ceil().toInt();
    const baseIdFract = interpolatedBaseId.sub(interpolatedBaseId.floor());

    // Get floor and ceil texture IDs for overlay texture
    const overlayIdFloor = interpolatedOverlayId.floor().toInt();
    const overlayIdCeil = interpolatedOverlayId.ceil().toInt();
    const overlayIdFract = interpolatedOverlayId.sub(
      interpolatedOverlayId.floor()
    );

    // Calculate transition blend factors with adjustable width
    const baseTransitionBlend = smoothstep(
      float(0.5).sub(transitionBlendWidthNode),
      float(0.5).add(transitionBlendWidthNode),
      baseIdFract
    );
    const overlayTransitionBlend = smoothstep(
      float(0.5).sub(transitionBlendWidthNode),
      float(0.5).add(transitionBlendWidthNode),
      overlayIdFract
    );

    // The blend factor from the control map
    const controlBlend = smoothstep(float(0), float(1), interpolatedBlend);

    // Sample all needed textures for base (floor and ceil IDs)
    const baseFloorSample = sampleTextureArrayTriplanarNoTile(
      normalRoughnessTexture,
      worldPos,
      geometricNormal,
      baseIdFloor,
      scaledTextureScale,
      triplanarSharpnessNode,
      variationScaleNode
    );
    const baseCeilSample = sampleTextureArrayTriplanarNoTile(
      normalRoughnessTexture,
      worldPos,
      geometricNormal,
      baseIdCeil,
      scaledTextureScale,
      triplanarSharpnessNode,
      variationScaleNode
    );

    // Sample all needed textures for overlay (floor and ceil IDs)
    const overlayFloorSample = sampleTextureArrayTriplanarNoTile(
      normalRoughnessTexture,
      worldPos,
      geometricNormal,
      overlayIdFloor,
      scaledTextureScale,
      triplanarSharpnessNode,
      variationScaleNode
    );
    const overlayCeilSample = sampleTextureArrayTriplanarNoTile(
      normalRoughnessTexture,
      worldPos,
      geometricNormal,
      overlayIdCeil,
      scaledTextureScale,
      triplanarSharpnessNode,
      variationScaleNode
    );

    // Blend between floor and ceil samples for roughness (alpha channel)
    // Use smoothstep-based blending for smooth transitions
    const blendedBaseRoughness = mix(
      baseFloorSample.a,
      baseCeilSample.a,
      baseTransitionBlend
    );
    const blendedOverlayRoughness = mix(
      overlayFloorSample.a,
      overlayCeilSample.a,
      overlayTransitionBlend
    );

    // Final roughness: blend between base and overlay
    const blendedRoughness = mix(
      blendedBaseRoughness,
      blendedOverlayRoughness,
      controlBlend
    );

    return blendedRoughness;
  })();
};
