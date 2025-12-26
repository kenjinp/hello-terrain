import {
  Fn,
  abs,
  float,
  floor,
  fract,
  int,
  mix,
  positionWorld,
  pow,
  select,
  texture,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { Node } from "three/webgpu";
import type { TerrainUniforms } from "../TerrainUniforms";
import type { TerrainVaryings } from "../TerrainVaryings";
import type { TerrainTextureArray } from "../texture/TerrainTextureArray";
import { controlmapStorageProperty } from "./properties";
import {
  adjustSaturation,
  createTerrainSamplerFunctions,
  heightBlendMask,
} from "./textureArraySampling";

/** Uniform type for reactive shader values - accepts any shader node */
type UniformValue = Node;

/**
 * Decode control data from packed uint32
 */
const decodeControl = (packed: Node) => {
  const packedInt = packed.toUint();
  const baseId = packedInt.shiftRight(int(27)).bitAnd(int(0x1f));
  const overlayId = packedInt.shiftRight(int(22)).bitAnd(int(0x1f));
  const blend = packedInt
    .shiftRight(int(14))
    .bitAnd(int(0xff))
    .toFloat()
    .div(float(255.0));
  const uvScaleVal = packedInt
    .shiftRight(int(10))
    .bitAnd(int(0x0f))
    .toFloat()
    .add(1.0);
  const hole = packedInt.shiftRight(int(3)).bitAnd(int(0x01)).equal(int(1));
  return { baseId, overlayId, blend, uvScaleVal, hole };
};

export interface TerrainTextureMaterialParams {
  /** TerrainMesh varyings for vertex data access */
  varyings: TerrainVaryings;
  /** TerrainMesh uniforms for shader configuration (required for 4-vertex blending) */
  uniforms: TerrainUniforms;
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
 * Extended parameters for enhanced terrain texture rendering
 * Includes all triplanar no-tile parameters plus additional height blend and saturation controls
 */
export interface TerrainTextureMaterialEnhancedParams
  extends TerrainTextureMaterialTriplanarNoTileParams {
  /**
   * Minimum transition width for height blend anti-aliasing.
   * Higher values create smoother blends but reduce height-based detail.
   * Lower values preserve more height detail but may appear noisy.
   * Default: 0.1. Typical range: 0.01 - 0.3
   */
  heightBlendMinWidth?: number | UniformValue;

  /**
   * Saturation multiplier for final color.
   * 1.0 = unchanged, 0.0 = grayscale, 2.0 = double saturation.
   * Default: 1.0
   */
  saturation?: number | UniformValue;
}

/**
 * Debug mode values for triplanar visualization uniform:
 * - 0 = off (normal rendering)
 * - 1 = weights (pure RGB showing axis blend weights)
 * - 2 = tinted (textures with axis color tints)
 */
export const TRIPLANAR_DEBUG_OFF = 0;
export const TRIPLANAR_DEBUG_WEIGHTS = 1;
export const TRIPLANAR_DEBUG_TINTED = 2;

/**
 * Return type for createTerrainMaterialNodes - contains all material output nodes
 */
export interface TerrainMaterialNodes {
  /** Color/albedo node for colorNode (vec4 with alpha for hole handling) */
  colorNode: Node;
  /** Normal node for normalNode (vec3, texture-space normals) */
  normalNode: Node;
  /** Roughness node for roughnessNode (float) */
  roughnessNode: Node;
}

/**
 * Create all terrain material nodes in a single call.
 *
 * This function computes ALL material channels (color, normal, roughness, AO)
 * in a SINGLE unified expression tree. By using .toVar() to cache intermediate
 * results, the TSL compiler generates each computation only once.
 *
 * **Key optimization:** Instead of 4 separate Fn() closures that each decode
 * the control map and sample textures independently, we now:
 * 1. Decode control map ONCE
 * 2. Sample all 8 materials (base+overlay × 4 vertices) ONCE each
 * 3. Compute 4 height blend masks ONCE each
 * 4. Blend all channels with the same 4-vertex weights ONCE
 *
 * This reduces texture samples from ~56 to 24 and eliminates redundant control
 * map decoding and blend weight calculations.
 *
 * Example usage:
 * ```ts
 * const { colorNode, normalNode, roughnessNode } = createTerrainMaterialNodes({
 *   varyings: terrain.varyings,
 *   uniforms: terrain.uniforms,
 *   textureArray,
 *   textureScale: uniform(10),
 *   // ... other params
 * });
 *
 * material.colorNode = colorNode;
 * material.normalNode = normalNode;
 * material.roughnessNode = roughnessNode;
 * ```
 *
 * Debug modes (controlled by debugMode uniform):
 * - 0: Normal rendering
 * - 1: Pure RGB colors showing triplanar blend weights
 * - 2: Textures with axis color tints
 */
export const createTerrainMaterialNodes = (
  params: TerrainTextureMaterialEnhancedParams
): TerrainMaterialNodes => {
  const {
    varyings,
    uniforms,
    textureArray,
    textureScale = 10,
    heightBlendSharpness = 4,
    triplanarSharpness = 2,
    variationScale = 0.01,
    transitionBlendWidth = 0.3,
    heightBlendMinWidth = 0.1,
    debugMode,
    saturation = 1.0,
  } = params;

  // Convert numeric params to shader nodes
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
  const heightBlendMinWidthNode =
    typeof heightBlendMinWidth === "number"
      ? float(heightBlendMinWidth)
      : heightBlendMinWidth;
  const saturationNode =
    typeof saturation === "number" ? float(saturation) : saturation;

  // Get texture arrays
  const albedoHeightTexture = textureArray.albedoHeightArray;
  const normalRoughnessTexture = textureArray.normalRoughnessArray;
  const noiseTexture = textureArray.noiseTexture;

  // ============================================================
  // CREATE SAMPLER FUNCTIONS WITH setLayout()
  // ============================================================
  // These functions are compiled as actual WGSL functions, not inlined
  const { sampleAlbedoHeight, sampleNormalRoughness } =
    createTerrainSamplerFunctions(
      albedoHeightTexture,
      normalRoughnessTexture,
      noiseTexture
    );

  // ============================================================
  // UNIFIED COMPUTATION - SINGLE EXPRESSION TREE
  // ============================================================
  // All computation happens here, building a single expression tree.
  // By using .toVar() to cache results, TSL generates each value once.

  const worldPos = positionWorld;
  const geometricNormal = varyings.vNormal.normalize();

  // ============================================================
  // 4-VERTEX CONTROL MAP SAMPLING (ONCE)
  // ============================================================
  const nodeIndex = varyings.vNodeIndex;
  const nodeOrigin = varyings.vNodeOrigin;
  const nodeCenterX = nodeOrigin.x;
  const nodeCenterZ = nodeOrigin.y;
  const nodeSize = varyings.vNodeSize;

  const segments = uniforms.uSegments.toVar();
  const edgeVertexCount = segments.add(int(3));
  const edgeVertexCountInt = int(edgeVertexCount);
  const verticesPerNode = edgeVertexCountInt.mul(edgeVertexCountInt);

  const localX = worldPos.x.sub(nodeCenterX).div(nodeSize).add(float(0.5));
  const localZ = worldPos.z.sub(nodeCenterZ).div(nodeSize).add(float(0.5));

  const segmentsFloat = segments.toFloat();
  const gridX = localX.mul(segmentsFloat).add(float(1.0));
  const gridZ = localZ.mul(segmentsFloat).add(float(1.0));

  const ix0 = int(floor(gridX))
    .max(int(0))
    .min(edgeVertexCountInt.sub(int(2)));
  const iz0 = int(floor(gridZ))
    .max(int(0))
    .min(edgeVertexCountInt.sub(int(2)));
  const ix1 = ix0.add(int(1));
  const iz1 = iz0.add(int(1));

  const baseGlobalIndex = int(nodeIndex).mul(verticesPerNode);
  const idx00 = baseGlobalIndex.add(iz0.mul(edgeVertexCountInt).add(ix0));
  const idx10 = baseGlobalIndex.add(iz0.mul(edgeVertexCountInt).add(ix1));
  const idx01 = baseGlobalIndex.add(iz1.mul(edgeVertexCountInt).add(ix0));
  const idx11 = baseGlobalIndex.add(iz1.mul(edgeVertexCountInt).add(ix1));

  const control00 = controlmapStorageProperty.element(idx00);
  const control10 = controlmapStorageProperty.element(idx10);
  const control01 = controlmapStorageProperty.element(idx01);
  const control11 = controlmapStorageProperty.element(idx11);

  const decoded00 = decodeControl(control00);
  const decoded10 = decodeControl(control10);
  const decoded01 = decodeControl(control01);
  const decoded11 = decodeControl(control11);

  const fx = fract(gridX).toVar();
  const fz = fract(gridZ).toVar();

  const uvScale = decoded00.uvScaleVal.toVar();
  const hole = decoded00.hole.toVar();

  const scaledTextureScale = textureScaleNode.div(uvScale).toVar();

  // ============================================================
  // SAMPLE COMPLETE MATERIALS FOR ALL 8 TEXTURE IDs
  // ============================================================
  // Sample each texture ID ONCE and cache with .toVar()
  // This is the key optimization: we sample each texture only once

  const sampleMaterial = (textureId: Node) => ({
    albedoHeight: sampleAlbedoHeight({
      worldPos,
      geometricNormal,
      textureId,
      textureScale: scaledTextureScale,
      triplanarSharpness: triplanarSharpnessNode,
      variationScale: variationScaleNode,
    }).toVar(),
    normalRoughness: sampleNormalRoughness({
      worldPos,
      geometricNormal,
      textureId,
      textureScale: scaledTextureScale,
      triplanarSharpness: triplanarSharpnessNode,
      variationScale: variationScaleNode,
    }).toVar(),
  });

  // Sample all 8 materials (base + overlay for 4 vertices)
  const mat00Base = sampleMaterial(decoded00.baseId);
  const mat00Overlay = sampleMaterial(decoded00.overlayId);
  const mat10Base = sampleMaterial(decoded10.baseId);
  const mat10Overlay = sampleMaterial(decoded10.overlayId);
  const mat01Base = sampleMaterial(decoded01.baseId);
  const mat01Overlay = sampleMaterial(decoded01.overlayId);
  const mat11Base = sampleMaterial(decoded11.baseId);
  const mat11Overlay = sampleMaterial(decoded11.overlayId);

  // ============================================================
  // COMPUTE HEIGHT BLEND MASKS (4 times, not 12)
  // ============================================================
  const blendMask00 = heightBlendMask({
    baseHeight: mat00Base.albedoHeight.a,
    overlayHeight: mat00Overlay.albedoHeight.a,
    blendFactor: decoded00.blend,
    sharpness: heightBlendSharpnessNode,
    minWidth: heightBlendMinWidthNode,
    transitionWidth: transitionBlendWidthNode,
  }).toVar();

  const blendMask10 = heightBlendMask({
    baseHeight: mat10Base.albedoHeight.a,
    overlayHeight: mat10Overlay.albedoHeight.a,
    blendFactor: decoded10.blend,
    sharpness: heightBlendSharpnessNode,
    minWidth: heightBlendMinWidthNode,
    transitionWidth: transitionBlendWidthNode,
  }).toVar();

  const blendMask01 = heightBlendMask({
    baseHeight: mat01Base.albedoHeight.a,
    overlayHeight: mat01Overlay.albedoHeight.a,
    blendFactor: decoded01.blend,
    sharpness: heightBlendSharpnessNode,
    minWidth: heightBlendMinWidthNode,
    transitionWidth: transitionBlendWidthNode,
  }).toVar();

  const blendMask11 = heightBlendMask({
    baseHeight: mat11Base.albedoHeight.a,
    overlayHeight: mat11Overlay.albedoHeight.a,
    blendFactor: decoded11.blend,
    sharpness: heightBlendSharpnessNode,
    minWidth: heightBlendMinWidthNode,
    transitionWidth: transitionBlendWidthNode,
  }).toVar();

  // ============================================================
  // BLEND BASE+OVERLAY PER VERTEX (using cached values)
  // ============================================================
  const blended00 = {
    albedo: mix(
      mat00Base.albedoHeight.rgb,
      mat00Overlay.albedoHeight.rgb,
      blendMask00
    ).toVar(),
    normal: mix(
      mat00Base.normalRoughness.rgb,
      mat00Overlay.normalRoughness.rgb,
      blendMask00
    ).toVar(),
    roughness: mix(
      mat00Base.normalRoughness.a,
      mat00Overlay.normalRoughness.a,
      blendMask00
    ).toVar(),
    height: mix(
      mat00Base.albedoHeight.a,
      mat00Overlay.albedoHeight.a,
      blendMask00
    ).toVar(),
  };

  const blended10 = {
    albedo: mix(
      mat10Base.albedoHeight.rgb,
      mat10Overlay.albedoHeight.rgb,
      blendMask10
    ).toVar(),
    normal: mix(
      mat10Base.normalRoughness.rgb,
      mat10Overlay.normalRoughness.rgb,
      blendMask10
    ).toVar(),
    roughness: mix(
      mat10Base.normalRoughness.a,
      mat10Overlay.normalRoughness.a,
      blendMask10
    ).toVar(),
    height: mix(
      mat10Base.albedoHeight.a,
      mat10Overlay.albedoHeight.a,
      blendMask10
    ).toVar(),
  };

  const blended01 = {
    albedo: mix(
      mat01Base.albedoHeight.rgb,
      mat01Overlay.albedoHeight.rgb,
      blendMask01
    ).toVar(),
    normal: mix(
      mat01Base.normalRoughness.rgb,
      mat01Overlay.normalRoughness.rgb,
      blendMask01
    ).toVar(),
    roughness: mix(
      mat01Base.normalRoughness.a,
      mat01Overlay.normalRoughness.a,
      blendMask01
    ).toVar(),
    height: mix(
      mat01Base.albedoHeight.a,
      mat01Overlay.albedoHeight.a,
      blendMask01
    ).toVar(),
  };

  const blended11 = {
    albedo: mix(
      mat11Base.albedoHeight.rgb,
      mat11Overlay.albedoHeight.rgb,
      blendMask11
    ).toVar(),
    normal: mix(
      mat11Base.normalRoughness.rgb,
      mat11Overlay.normalRoughness.rgb,
      blendMask11
    ).toVar(),
    roughness: mix(
      mat11Base.normalRoughness.a,
      mat11Overlay.normalRoughness.a,
      blendMask11
    ).toVar(),
    height: mix(
      mat11Base.albedoHeight.a,
      mat11Overlay.albedoHeight.a,
      blendMask11
    ).toVar(),
  };

  // ============================================================
  // HEIGHT-WEIGHTED 4-VERTEX BLENDING (ONCE for all channels)
  // ============================================================
  const w00Base = float(1).sub(fx).mul(float(1).sub(fz));
  const w10Base = fx.mul(float(1).sub(fz));
  const w01Base = float(1).sub(fx).mul(fz);
  const w11Base = fx.mul(fz);

  const h00 = blended00.height.add(float(0.001));
  const h10 = blended10.height.add(float(0.001));
  const h01 = blended01.height.add(float(0.001));
  const h11 = blended11.height.add(float(0.001));

  const heightSharpness = heightBlendSharpnessNode;
  const w00 = pow(
    w00Base.max(float(0.001)),
    float(1).div(h00.mul(heightSharpness))
  ).toVar();
  const w10 = pow(
    w10Base.max(float(0.001)),
    float(1).div(h10.mul(heightSharpness))
  ).toVar();
  const w01 = pow(
    w01Base.max(float(0.001)),
    float(1).div(h01.mul(heightSharpness))
  ).toVar();
  const w11 = pow(
    w11Base.max(float(0.001)),
    float(1).div(h11.mul(heightSharpness))
  ).toVar();

  const totalWeight = w00.add(w10).add(w01).add(w11).toVar();

  // ============================================================
  // BLEND ALL CHANNELS WITH SAME WEIGHTS (ONCE)
  // ============================================================
  const finalAlbedo = blended00.albedo
    .mul(w00)
    .add(blended10.albedo.mul(w10))
    .add(blended01.albedo.mul(w01))
    .add(blended11.albedo.mul(w11))
    .div(totalWeight)
    .toVar();

  const finalNormal = blended00.normal
    .mul(w00)
    .add(blended10.normal.mul(w10))
    .add(blended01.normal.mul(w01))
    .add(blended11.normal.mul(w11))
    .div(totalWeight)
    .toVar();

  const finalRoughness = blended00.roughness
    .mul(w00)
    .add(blended10.roughness.mul(w10))
    .add(blended01.roughness.mul(w01))
    .add(blended11.roughness.mul(w11))
    .div(totalWeight)
    .toVar();

  // ============================================================
  // COLOR NODE WITH DEBUG MODES
  // ============================================================
  // Only colorNode needs Fn() wrapper for debug/saturation logic
  const colorNode = Fn(() => {
    // Apply saturation adjustment using setLayout function
    const saturatedColor = adjustSaturation({
      color: finalAlbedo,
      saturationMultiplier: saturationNode,
    });

    // Debug weights (pure RGB)
    const blendWeights = pow(
      abs(geometricNormal),
      triplanarSharpnessNode
    ).toVar();
    const weightSum = blendWeights.x.add(blendWeights.y).add(blendWeights.z);
    const normalizedWeights = blendWeights.div(weightSum);
    const weightsColor = vec3(
      normalizedWeights.x,
      normalizedWeights.y,
      normalizedWeights.z
    );

    // Debug tinted (textures with color tints)
    const uvX = vec2(worldPos.z, worldPos.y).div(scaledTextureScale);
    const uvY = vec2(worldPos.x, worldPos.z).div(scaledTextureScale);
    const uvZ = vec2(worldPos.x, worldPos.y).div(scaledTextureScale);

    const baseId = decoded00.baseId.toInt();
    const sampleBaseX = texture(albedoHeightTexture, uvX).depth(baseId);
    const sampleBaseY = texture(albedoHeightTexture, uvY).depth(baseId);
    const sampleBaseZ = texture(albedoHeightTexture, uvZ).depth(baseId);

    const tintX = vec3(1.0, 0.3, 0.3);
    const tintY = vec3(0.3, 1.0, 0.3);
    const tintZ = vec3(0.3, 0.3, 1.0);

    const tintedColor = sampleBaseX.rgb
      .mul(tintX)
      .mul(normalizedWeights.x)
      .add(sampleBaseY.rgb.mul(tintY).mul(normalizedWeights.y))
      .add(sampleBaseZ.rgb.mul(tintZ).mul(normalizedWeights.z));

    // Select output based on debug mode uniform:
    // 0 = enhanced, 1 = weights, 2 = tinted
    const isWeights = debugMode.equal(float(1));
    const isTinted = debugMode.equal(float(2));

    const finalColor = mix(
      mix(saturatedColor, weightsColor, select(isWeights, float(1), float(0))),
      tintedColor,
      select(isTinted, float(1), float(0))
    );

    // Handle holes (set alpha to 0 to discard)
    const alpha = select(hole, float(0), float(1));

    return vec4(finalColor, alpha);
  })();

  // ============================================================
  // RETURN NODES - Direct references to cached values
  // ============================================================
  return {
    colorNode,
    normalNode: finalNormal,
    roughnessNode: finalRoughness,
  };
};
