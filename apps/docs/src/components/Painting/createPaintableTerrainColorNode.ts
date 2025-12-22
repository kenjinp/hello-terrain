import type { TerrainTextureArray } from "@hello-terrain/three";
import { sampleTriplanarNoTile } from "@hello-terrain/three";
import type { ShaderNodeObject } from "three/tsl";
import {
  Fn,
  exp,
  float,
  mix,
  positionWorld,
  smoothstep,
  uniform,
  vec2,
  vec4,
} from "three/tsl";
import type { Node } from "three/webgpu";
import * as THREE from "three/webgpu";

/**
 * Paint mode options for brush preview
 */
export const PAINT_MODE = {
  OFF: 0,
  BASE_TEXTURE: 1,
  OVERLAY_TEXTURE: 2,
  BLEND: 3,
  HEIGHTMAP_RAISE: 4,
  HEIGHTMAP_LOWER: 5,
} as const;

export type PaintMode = (typeof PAINT_MODE)[keyof typeof PAINT_MODE];

/**
 * Uniforms for controlling brush preview in the terrain shader
 */
export interface BrushPreviewUniforms {
  /** Brush center position in world XZ coordinates */
  brushPosition: ReturnType<typeof uniform<THREE.Vector2>>;
  /** Brush radius in world units */
  brushRadius: ReturnType<typeof uniform<number>>;
  /** Brush softness (0 = hard edge, 1 = soft gaussian falloff) */
  brushSoftness: ReturnType<typeof uniform<number>>;
  /** Brush strength/opacity (0-1) */
  brushStrength: ReturnType<typeof uniform<number>>;
  /** Texture ID to preview (0-31) */
  previewTextureId: ReturnType<typeof uniform<number>>;
  /** Current paint mode (see PAINT_MODE constants) */
  previewMode: ReturnType<typeof uniform<number>>;
  /** Whether brush preview is active (0 = hidden, 1 = visible) */
  brushActive: ReturnType<typeof uniform<number>>;
}

/**
 * Create uniforms for brush preview
 *
 * These uniforms control how the brush preview is rendered on the terrain.
 * Update the `.value` property of each uniform to change the preview in real-time.
 *
 * @example
 * ```ts
 * const brushUniforms = createBrushPreviewUniforms();
 *
 * // Update brush position on mouse move
 * brushUniforms.brushPosition.value.set(worldX, worldZ);
 * brushUniforms.brushActive.value = 1;
 *
 * // Change brush settings
 * brushUniforms.brushRadius.value = 100;
 * brushUniforms.brushSoftness.value = 0.7;
 * ```
 */
export const createBrushPreviewUniforms = (): BrushPreviewUniforms => ({
  brushPosition: uniform(new THREE.Vector2(0, 0)),
  brushRadius: uniform(50),
  brushSoftness: uniform(0.5),
  brushStrength: uniform(1.0),
  previewTextureId: uniform(0),
  previewMode: uniform(PAINT_MODE.BASE_TEXTURE),
  brushActive: uniform(0),
});

export interface PaintableTerrainColorNodeParams {
  /** The base terrain color node to wrap */
  baseColorNode: ShaderNodeObject<Node>;
  /** Texture array for sampling preview texture */
  textureArray: TerrainTextureArray;
  /** Brush preview uniforms */
  brushUniforms: BrushPreviewUniforms;
  /** World-space scale for texture UVs */
  textureScale: number | ShaderNodeObject<Node>;
  /** Triplanar sharpness for preview texture sampling */
  triplanarSharpness?: number | ShaderNodeObject<Node>;
  /** Variation scale for anti-tiling */
  variationScale?: number | ShaderNodeObject<Node>;
  /** Optional normal for triplanar sampling (defaults to up vector) */
  normalNode?: ShaderNodeObject<Node>;
}

/**
 * Create a composable color node that wraps terrain rendering with brush preview
 *
 * This TSL function takes an existing terrain color node and composites a
 * brush preview overlay on top. The preview shows what the painted texture
 * will look like, with a ring outline at the brush edge.
 *
 * Features:
 * - Real-time preview of paint texture within brush radius
 * - Gaussian falloff for soft brush edges
 * - Ring outline at brush boundary
 * - Slight brightness tint to distinguish preview from actual paint
 *
 * @example
 * ```ts
 * const brushUniforms = createBrushPreviewUniforms();
 *
 * const colorNode = createPaintableTerrainColorNode({
 *   baseColorNode: createTerrainColorNodeTriplanarNoTile({...}),
 *   textureArray,
 *   brushUniforms,
 *   textureScale: 50,
 * });
 *
 * // In useFrame:
 * brushUniforms.brushPosition.value.set(intersectionPoint.x, intersectionPoint.z);
 * brushUniforms.brushActive.value = isOverTerrain ? 1 : 0;
 * ```
 */
export const createPaintableTerrainColorNode = (
  params: PaintableTerrainColorNodeParams
): ShaderNodeObject<Node> => {
  const {
    baseColorNode,
    textureArray,
    brushUniforms,
    textureScale,
    triplanarSharpness = 2,
    variationScale = 0.01,
  } = params;

  // Convert to shader nodes
  const textureScaleNode =
    typeof textureScale === "number" ? float(textureScale) : textureScale;
  const triplanarSharpnessNode =
    typeof triplanarSharpness === "number"
      ? float(triplanarSharpness)
      : triplanarSharpness;
  const variationScaleNode =
    typeof variationScale === "number" ? float(variationScale) : variationScale;

  const albedoHeightTexture = textureArray.albedoHeightArray;
  const noiseTexture = textureArray.noiseTexture;

  return Fn(() => {
    // Get world position for distance calculation
    const worldXZ = vec2(positionWorld.x, positionWorld.z);
    const toBrush = worldXZ.sub(brushUniforms.brushPosition);
    const distance = toBrush.length();

    // Calculate normalized distance from brush center
    const normalizedDist = distance.div(brushUniforms.brushRadius);

    // Brush falloff calculation
    // Hard edge: sharp cutoff at brush radius
    const hardEdge = float(1).sub(
      smoothstep(float(0.9), float(1.0), normalizedDist)
    );
    // Soft edge: gaussian-like falloff
    const softEdge = exp(normalizedDist.mul(normalizedDist).mul(-3));
    // Blend between hard and soft based on softness parameter
    const falloff = mix(hardEdge, softEdge, brushUniforms.brushSoftness);

    // Sample the preview texture using triplanar projection
    // Use a simple up-facing normal for preview (flat ground assumption)
    const previewNormal = params.normalNode ?? vec2(0, 1).toVec3().normalize();

    const previewSample = sampleTriplanarNoTile(
      albedoHeightTexture,
      noiseTexture,
      positionWorld,
      previewNormal,
      brushUniforms.previewTextureId,
      textureScaleNode,
      triplanarSharpnessNode,
      variationScaleNode
    );

    // Calculate blend amount for preview overlay
    const blendAmount = falloff
      .mul(brushUniforms.brushStrength)
      .mul(brushUniforms.brushActive);

    // Tint the preview slightly brighter to distinguish from actual painted areas
    const previewTint = vec4(previewSample.rgb.mul(1.15), previewSample.a);

    // Add subtle ring outline at brush edge
    const ringWidth = float(0.03);
    const ringCenter = float(0.97);
    const ringDist = normalizedDist.sub(ringCenter).abs();
    const ring = smoothstep(ringWidth, float(0.0), ringDist).mul(
      brushUniforms.brushActive
    );

    // Ring color with slight transparency
    const ringColor = vec4(1.0, 1.0, 1.0, 0.8);

    // Composite: base -> preview blend -> ring outline
    const withPreview = mix(baseColorNode, previewTint, blendAmount.mul(0.7));
    const finalColor = mix(withPreview, ringColor, ring.mul(0.4));

    return finalColor;
  })();
};

/**
 * Calculate brush falloff at a given distance (CPU-side utility)
 *
 * Use this to apply the same falloff when actually painting to storage buffers.
 *
 * @param distance Distance from brush center
 * @param radius Brush radius
 * @param softness Brush softness (0 = hard, 1 = soft)
 * @returns Falloff value (0-1)
 */
export const calculateBrushFalloff = (
  distance: number,
  radius: number,
  softness: number
): number => {
  const normalized = distance / radius;
  if (normalized >= 1) return 0;

  // Hard edge
  const hardEdge = normalized < 0.9 ? 1 : 1 - (normalized - 0.9) / 0.1;
  // Soft edge (gaussian-like)
  const softEdge = Math.exp(-normalized * normalized * 3);
  // Lerp between hard and soft
  return hardEdge * (1 - softness) + softEdge * softness;
};
