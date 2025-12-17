import type { ShaderNodeObject } from "three/tsl";
import {
  Fn,
  float,
  floor,
  fract,
  int,
  mix,
  positionWorld,
  pow,
  select,
  vec4,
} from "three/tsl";
import type { Node } from "three/webgpu";
import type { TerrainUniforms } from "../TerrainUniforms";
import type { TerrainVaryings } from "../TerrainVaryings";
import type { TerrainTextureArray } from "../texture/TerrainTextureArray";
import { controlmapStorageProperty } from "./properties";
import {
  adjustSaturation,
  heightBlendMask,
  sampleTextureArrayTriplanarDebug,
  sampleTextureArrayTriplanarNoTile,
  triplanarDebugWeights,
} from "./textureArraySampling";

/** Uniform type for reactive shader values - accepts any shader node */
// biome-ignore lint/suspicious/noExplicitAny: TSL uniform types are complex and vary
type UniformValue = ShaderNodeObject<any>;

// ------------------------------------------------------------
// Shared blend context (TSL locals) for aligned channels
// ------------------------------------------------------------
//
// In NodeMaterial, `colorNode`, `normalNode`, `roughnessNode` end up in the same
// fragment shader. If they each rebuild the same blend math, it can be emitted
// multiple times. We can share work by:
// - Building the common blend math once as TSL nodes (stored as `.toVar()`),
// - Reusing the *same node instances* across the three outputs.
//
// Note: This is different from using a GPU varying; most of this math depends on
// fragment-only operations (texture sampling, noise), so it can't be moved to
// vertex stage without changing quality. This approach keeps everything in the
// fragment shader, but avoids duplication.

type BlendContext = {
  // Decoded control bits
  uvScale: ShaderNodeObject<Node>;
  hole: ShaderNodeObject<Node>;

  // Shared geometry inputs
  worldPos: ShaderNodeObject<Node>;
  geometricNormal: ShaderNodeObject<Node>;
  scaledTextureScale: ShaderNodeObject<Node>;

  // Sampling params that must match across channels
  triplanarSharpnessNode: ShaderNodeObject<Node>;
  variationScaleNode: ShaderNodeObject<Node>;

  // Texture id interpolation
  baseIdFloor: ShaderNodeObject<Node>;
  baseIdCeil: ShaderNodeObject<Node>;
  overlayIdFloor: ShaderNodeObject<Node>;
  overlayIdCeil: ShaderNodeObject<Node>;
  baseTransitionBlend: ShaderNodeObject<Node>;
  overlayTransitionBlend: ShaderNodeObject<Node>;

  // Blend-mode selection
  isLinearMode: ShaderNodeObject<Node>;
  controlBlend: ShaderNodeObject<Node>;

  // Shared albedo+height samples (from albedoHeightArray)
  baseFloorAlbedoHeight: ShaderNodeObject<Node>;
  baseCeilAlbedoHeight: ShaderNodeObject<Node>;
  overlayFloorAlbedoHeight: ShaderNodeObject<Node>;
  overlayCeilAlbedoHeight: ShaderNodeObject<Node>;

  // Heights used to compute masks (derived from the samples above)
  baseFloorHeight: ShaderNodeObject<Node>;
  baseCeilHeight: ShaderNodeObject<Node>;
  overlayFloorHeight: ShaderNodeObject<Node>;
  overlayCeilHeight: ShaderNodeObject<Node>;
  blendedBaseHeight: ShaderNodeObject<Node>;
  blendedOverlayHeight: ShaderNodeObject<Node>;

  // Masks used to mix floor/ceil and base/overlay (aligned across channels)
  baseTransitionMask: ShaderNodeObject<Node>;
  overlayTransitionMask: ShaderNodeObject<Node>;
  finalMask: ShaderNodeObject<Node>;
};

const _objIds = new WeakMap<object, number>();
let _nextObjId = 1;
function _idFor(obj: unknown): string {
  if (!obj || (typeof obj !== "object" && typeof obj !== "function"))
    return "v";
  const o = obj as object;
  const existing = _objIds.get(o);
  if (existing) return String(existing);
  const id = _nextObjId++;
  _objIds.set(o, id);
  return String(id);
}

// Cache contexts per (varyings, textureArray, param-node identities)
const _blendContextCache = new WeakMap<object, Map<string, BlendContext>>();

/**
 * Decode control data from packed uint32
 */
function decodeControl(packed: ShaderNodeObject<Node>) {
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
}

function getBlendContext(
  params: TerrainTextureMaterialEnhancedParams
): BlendContext {
  const {
    varyings,
    uniforms,
    textureArray,
    textureScale = 10,
    heightBlendSharpness = 4,
    triplanarSharpness = 2,
    variationScale = 0.01,
    transitionBlendWidth = 0.3,
    blendMode = 1,
    noiseBlur = 0.5,
    noiseAmplitude = 1.25,
    noiseWavelength = 16384,
    noiseAccuracy = 1.25,
    heightBlendMinWidth = 0.1,
  } = params;

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
  const blendModeNode =
    typeof blendMode === "number" ? float(blendMode) : blendMode;
  const noiseBlurNode =
    typeof noiseBlur === "number" ? float(noiseBlur) : noiseBlur;
  const noiseAmplitudeNode =
    typeof noiseAmplitude === "number" ? float(noiseAmplitude) : noiseAmplitude;
  const noiseWavelengthNode =
    typeof noiseWavelength === "number"
      ? float(noiseWavelength)
      : noiseWavelength;
  const noiseAccuracyNode =
    typeof noiseAccuracy === "number" ? float(noiseAccuracy) : noiseAccuracy;
  const heightBlendMinWidthNode =
    typeof heightBlendMinWidth === "number"
      ? float(heightBlendMinWidth)
      : heightBlendMinWidth;

  // Build a stable-ish cache key from node identities. This enables cross-call
  // sharing as long as the caller passes the same uniform node instances.
  const cacheRoot = varyings as unknown as object;
  const cacheKey = [
    _idFor(textureArray),
    _idFor(uniforms),
    _idFor(textureScaleNode as unknown as object),
    _idFor(heightBlendSharpnessNode as unknown as object),
    _idFor(triplanarSharpnessNode as unknown as object),
    _idFor(variationScaleNode as unknown as object),
    _idFor(transitionBlendWidthNode as unknown as object),
    _idFor(blendModeNode as unknown as object),
    _idFor(noiseBlurNode as unknown as object),
    _idFor(noiseAmplitudeNode as unknown as object),
    _idFor(noiseWavelengthNode as unknown as object),
    _idFor(noiseAccuracyNode as unknown as object),
    _idFor(heightBlendMinWidthNode as unknown as object),
  ].join("|");

  let map = _blendContextCache.get(cacheRoot);
  if (!map) {
    map = new Map();
    _blendContextCache.set(cacheRoot, map);
  }
  const cached = map.get(cacheKey);
  if (cached) return cached;

  const albedoHeightTexture = textureArray.albedoHeightArray;

  const worldPos = positionWorld;
  const geometricNormal = varyings.vNormal.normalize();

  // ============================================================
  // 4-VERTEX CONTROL MAP SAMPLING
  // ============================================================
  // Instead of using flat int varyings (which cause hard edges between
  // base textures), we sample control data from the 4 surrounding vertices
  // based on world position. The skirt vertices already contain data
  // from neighboring tiles, so no cross-node lookup is needed.

  // Get node metadata from varyings
  const nodeIndex = varyings.vNodeIndex;
  const nodeOrigin = varyings.vNodeOrigin;
  const nodeCenterX = nodeOrigin.x;
  const nodeCenterZ = nodeOrigin.y;
  const nodeSize = varyings.vNodeSize;

  // Calculate edge vertex count (segments + 3 for skirt)
  const segments = uniforms.uSegments.toVar();
  const edgeVertexCount = segments.add(int(3));
  const edgeVertexCountInt = int(edgeVertexCount);
  const verticesPerNode = edgeVertexCountInt.mul(edgeVertexCountInt);

  // Calculate local position within node [-0.5, 0.5] -> [0, 1]
  const localX = worldPos.x.sub(nodeCenterX).div(nodeSize).add(float(0.5));
  const localZ = worldPos.z.sub(nodeCenterZ).div(nodeSize).add(float(0.5));

  // Map to vertex grid coordinates
  // Inner vertices (1 to edgeVertexCount-2) span [0, 1] in local coords
  // gridX = localX * segments + 1 (offset by 1 for skirt)
  const segmentsFloat = segments.toFloat();
  const gridX = localX.mul(segmentsFloat).add(float(1.0));
  const gridZ = localZ.mul(segmentsFloat).add(float(1.0));

  // Floor to get the 4 surrounding vertex indices
  const ix0 = int(floor(gridX))
    .max(int(0))
    .min(edgeVertexCountInt.sub(int(2)));
  const iz0 = int(floor(gridZ))
    .max(int(0))
    .min(edgeVertexCountInt.sub(int(2)));
  const ix1 = ix0.add(int(1));
  const iz1 = iz0.add(int(1));

  // Compute global indices for 4 surrounding vertices
  const baseGlobalIndex = int(nodeIndex).mul(verticesPerNode);
  const idx00 = baseGlobalIndex.add(iz0.mul(edgeVertexCountInt).add(ix0));
  const idx10 = baseGlobalIndex.add(iz0.mul(edgeVertexCountInt).add(ix1));
  const idx01 = baseGlobalIndex.add(iz1.mul(edgeVertexCountInt).add(ix0));
  const idx11 = baseGlobalIndex.add(iz1.mul(edgeVertexCountInt).add(ix1));

  // Sample control data from all 4 vertices
  const control00 = controlmapStorageProperty.element(idx00);
  const control10 = controlmapStorageProperty.element(idx10);
  const control01 = controlmapStorageProperty.element(idx01);
  const control11 = controlmapStorageProperty.element(idx11);

  // Decode control data for each vertex
  const decoded00 = decodeControl(control00);
  const decoded10 = decodeControl(control10);
  const decoded01 = decodeControl(control01);
  const decoded11 = decodeControl(control11);

  // Bilinear interpolation weights
  const fx = fract(gridX).toVar();
  const fz = fract(gridZ).toVar();

  // Use control data from vertex 00 for uvScale and hole (they should be consistent)
  const uvScale = decoded00.uvScaleVal.toVar();
  const hole = decoded00.hole.toVar();

  const scaledTextureScale = textureScaleNode.div(uvScale).toVar();

  // ============================================================
  // SAMPLE MATERIALS FOR ALL 4 VERTICES
  // ============================================================
  // For each vertex, sample base and overlay textures and blend them

  // Helper to sample and blend base+overlay for a single vertex's control data
  const sampleVertexMaterial = (
    baseId: ShaderNodeObject<Node>,
    overlayId: ShaderNodeObject<Node>,
    blend: ShaderNodeObject<Node>
  ) => {
    const baseSample = sampleTextureArrayTriplanarNoTile(
      albedoHeightTexture,
      worldPos,
      geometricNormal,
      baseId,
      scaledTextureScale,
      triplanarSharpnessNode,
      variationScaleNode
    );
    const overlaySample = sampleTextureArrayTriplanarNoTile(
      albedoHeightTexture,
      worldPos,
      geometricNormal,
      overlayId,
      scaledTextureScale,
      triplanarSharpnessNode,
      variationScaleNode
    );

    // Height-blend between base and overlay for this vertex
    const baseHeight = baseSample.a;
    const overlayHeight = overlaySample.a;

    const blendMask = select(
      blendModeNode.lessThan(float(0.5)), // linear mode
      blend,
      heightBlendMask(
        baseHeight,
        overlayHeight,
        blend,
        heightBlendSharpnessNode,
        heightBlendMinWidthNode,
        transitionBlendWidthNode
      )
    );

    // Return blended RGBA (color + height for 4-way blending)
    return vec4(
      mix(baseSample.rgb, overlaySample.rgb, blendMask),
      mix(baseHeight, overlayHeight, blendMask)
    );
  };

  // Sample materials for all 4 vertices
  const mat00 = sampleVertexMaterial(
    decoded00.baseId,
    decoded00.overlayId,
    decoded00.blend
  ).toVar();
  const mat10 = sampleVertexMaterial(
    decoded10.baseId,
    decoded10.overlayId,
    decoded10.blend
  ).toVar();
  const mat01 = sampleVertexMaterial(
    decoded01.baseId,
    decoded01.overlayId,
    decoded01.blend
  ).toVar();
  const mat11 = sampleVertexMaterial(
    decoded11.baseId,
    decoded11.overlayId,
    decoded11.blend
  ).toVar();

  // ============================================================
  // HEIGHT-ADJUSTED BILINEAR BLENDING (Terrain3D style)
  // ============================================================
  // Adjust bilinear weights by texture height to create natural transitions
  // Higher textures get more weight, creating organic blending at edges

  // Base bilinear weights
  const w00Base = float(1).sub(fx).mul(float(1).sub(fz));
  const w10Base = fx.mul(float(1).sub(fz));
  const w01Base = float(1).sub(fx).mul(fz);
  const w11Base = fx.mul(fz);

  // Height values (add small epsilon to prevent division issues)
  const h00 = mat00.a.add(float(0.001));
  const h10 = mat10.a.add(float(0.001));
  const h01 = mat01.a.add(float(0.001));
  const h11 = mat11.a.add(float(0.001));

  // Height-adjusted weights (Terrain3D formula: w^(1/(h*sharpness)))
  // Higher sharpness = more influence from height differences
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

  // Normalize weights
  const totalWeight = w00.add(w10).add(w01).add(w11);

  // Final blended color (weighted average of 4 vertex materials)
  const blendedColor = mat00.rgb
    .mul(w00)
    .add(mat10.rgb.mul(w10))
    .add(mat01.rgb.mul(w01))
    .add(mat11.rgb.mul(w11))
    .div(totalWeight)
    .toVar();

  // Final blended height
  const blendedHeight = h00
    .mul(w00)
    .add(h10.mul(w10))
    .add(h01.mul(w01))
    .add(h11.mul(w11))
    .div(totalWeight)
    .toVar();

  // ============================================================
  // BUILD BLEND CONTEXT
  // ============================================================
  // For compatibility with existing node functions, we populate the context
  // with the 4-vertex blended results. The "floor" and "ceil" now represent
  // the same blended result (no separate floor/ceil interpolation needed).

  const baseFloorAlbedoHeight = vec4(blendedColor, blendedHeight).toVar();
  const baseCeilAlbedoHeight = baseFloorAlbedoHeight;
  const overlayFloorAlbedoHeight = baseFloorAlbedoHeight;
  const overlayCeilAlbedoHeight = baseFloorAlbedoHeight;

  const baseFloorHeight = blendedHeight;
  const baseCeilHeight = blendedHeight;
  const overlayFloorHeight = blendedHeight;
  const overlayCeilHeight = blendedHeight;
  const blendedBaseHeight = blendedHeight;
  const blendedOverlayHeight = blendedHeight;

  // For 4-vertex blending, these masks are not used (blending already done)
  const baseTransitionMask = float(0).toVar();
  const overlayTransitionMask = float(0).toVar();
  const finalMask = float(0).toVar();

  // Keep for noise mode detection (though less relevant with 4-vertex blending)
  const isLinearMode = blendModeNode.lessThan(float(0.5)).toVar();
  const controlBlend = float(0).toVar(); // Not used in 4-vertex mode

  // Use vertex 00's base ID for debug visualization
  const baseIdFloor = decoded00.baseId.toVar();
  const baseIdCeil = baseIdFloor;
  const overlayIdFloor = decoded00.overlayId.toVar();
  const overlayIdCeil = overlayIdFloor;
  const baseTransitionBlend = float(0).toVar();
  const overlayTransitionBlend = float(0).toVar();

  const ctx: BlendContext = {
    uvScale,
    hole,
    worldPos,
    geometricNormal,
    scaledTextureScale,
    triplanarSharpnessNode,
    variationScaleNode,
    baseIdFloor,
    baseIdCeil,
    overlayIdFloor,
    overlayIdCeil,
    baseTransitionBlend,
    overlayTransitionBlend,
    isLinearMode,
    controlBlend,
    baseFloorAlbedoHeight,
    baseCeilAlbedoHeight,
    overlayFloorAlbedoHeight,
    overlayCeilAlbedoHeight,
    baseFloorHeight,
    baseCeilHeight,
    overlayFloorHeight,
    overlayCeilHeight,
    blendedBaseHeight,
    blendedOverlayHeight,
    baseTransitionMask,
    overlayTransitionMask,
    finalMask,
  };

  map.set(cacheKey, ctx);
  return ctx;
}

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

/**
 * Create terrain normal and roughness nodes that are *aligned* with
 * `createTerrainColorNode`.
 *
 * Key idea: we use the **same sampling strategy** (triplanar + stochastic),
 * the **same texture-id interpolation** (floor/ceil), and the **same blend
 * masks** (linear / height / noise) derived from the albedo-height texture's
 * height channel. This keeps diffuse/normal/roughness transitions visually
 * in lockstep.
 */

export const createTerrainNormalNode = (
  params: TerrainTextureMaterialEnhancedParams
): ShaderNodeObject<Node> => {
  const { textureArray } = params;
  const ctx = getBlendContext(params);
  const normalRoughnessTexture = textureArray.normalRoughnessArray;

  return Fn(() => {
    const baseFloorNR = sampleTextureArrayTriplanarNoTile(
      normalRoughnessTexture,
      ctx.worldPos,
      ctx.geometricNormal,
      ctx.baseIdFloor,
      ctx.scaledTextureScale,
      ctx.triplanarSharpnessNode,
      ctx.variationScaleNode
    );
    const baseCeilNR = sampleTextureArrayTriplanarNoTile(
      normalRoughnessTexture,
      ctx.worldPos,
      ctx.geometricNormal,
      ctx.baseIdCeil,
      ctx.scaledTextureScale,
      ctx.triplanarSharpnessNode,
      ctx.variationScaleNode
    );
    const overlayFloorNR = sampleTextureArrayTriplanarNoTile(
      normalRoughnessTexture,
      ctx.worldPos,
      ctx.geometricNormal,
      ctx.overlayIdFloor,
      ctx.scaledTextureScale,
      ctx.triplanarSharpnessNode,
      ctx.variationScaleNode
    );
    const overlayCeilNR = sampleTextureArrayTriplanarNoTile(
      normalRoughnessTexture,
      ctx.worldPos,
      ctx.geometricNormal,
      ctx.overlayIdCeil,
      ctx.scaledTextureScale,
      ctx.triplanarSharpnessNode,
      ctx.variationScaleNode
    );

    const blendedBaseNormal = mix(
      baseFloorNR.rgb,
      baseCeilNR.rgb,
      ctx.baseTransitionMask
    );
    const blendedOverlayNormal = mix(
      overlayFloorNR.rgb,
      overlayCeilNR.rgb,
      ctx.overlayTransitionMask
    );
    return mix(blendedBaseNormal, blendedOverlayNormal, ctx.finalMask);
  })();
};

export const createTerrainRoughnessNode = (
  params: TerrainTextureMaterialEnhancedParams
): ShaderNodeObject<Node> => {
  const { textureArray } = params;
  const ctx = getBlendContext(params);
  const normalRoughnessTexture = textureArray.normalRoughnessArray;

  return Fn(() => {
    const baseFloorR = sampleTextureArrayTriplanarNoTile(
      normalRoughnessTexture,
      ctx.worldPos,
      ctx.geometricNormal,
      ctx.baseIdFloor,
      ctx.scaledTextureScale,
      ctx.triplanarSharpnessNode,
      ctx.variationScaleNode
    ).a;
    const baseCeilR = sampleTextureArrayTriplanarNoTile(
      normalRoughnessTexture,
      ctx.worldPos,
      ctx.geometricNormal,
      ctx.baseIdCeil,
      ctx.scaledTextureScale,
      ctx.triplanarSharpnessNode,
      ctx.variationScaleNode
    ).a;
    const overlayFloorR = sampleTextureArrayTriplanarNoTile(
      normalRoughnessTexture,
      ctx.worldPos,
      ctx.geometricNormal,
      ctx.overlayIdFloor,
      ctx.scaledTextureScale,
      ctx.triplanarSharpnessNode,
      ctx.variationScaleNode
    ).a;
    const overlayCeilR = sampleTextureArrayTriplanarNoTile(
      normalRoughnessTexture,
      ctx.worldPos,
      ctx.geometricNormal,
      ctx.overlayIdCeil,
      ctx.scaledTextureScale,
      ctx.triplanarSharpnessNode,
      ctx.variationScaleNode
    ).a;

    const blendedBaseRoughness = mix(
      baseFloorR,
      baseCeilR,
      ctx.baseTransitionMask
    );
    const blendedOverlayRoughness = mix(
      overlayFloorR,
      overlayCeilR,
      ctx.overlayTransitionMask
    );
    return mix(blendedBaseRoughness, blendedOverlayRoughness, ctx.finalMask);
  })();
};

/**
 * Create terrain ambient occlusion node that is *aligned* with
 * `createTerrainColorNode`.
 *
 * Uses the same sampling strategy (triplanar + stochastic), texture-id
 * interpolation, and blend masks as the color/roughness nodes to keep
 * AO transitions visually in lockstep.
 */
export const createTerrainAoNode = (
  params: TerrainTextureMaterialEnhancedParams
): ShaderNodeObject<Node> => {
  const { textureArray } = params;
  const ctx = getBlendContext(params);
  const aoTexture = textureArray.aoArray;

  return Fn(() => {
    // Sample AO from the R channel of the AO texture array
    const baseFloorAo = sampleTextureArrayTriplanarNoTile(
      aoTexture,
      ctx.worldPos,
      ctx.geometricNormal,
      ctx.baseIdFloor,
      ctx.scaledTextureScale,
      ctx.triplanarSharpnessNode,
      ctx.variationScaleNode
    ).r;
    const baseCeilAo = sampleTextureArrayTriplanarNoTile(
      aoTexture,
      ctx.worldPos,
      ctx.geometricNormal,
      ctx.baseIdCeil,
      ctx.scaledTextureScale,
      ctx.triplanarSharpnessNode,
      ctx.variationScaleNode
    ).r;
    const overlayFloorAo = sampleTextureArrayTriplanarNoTile(
      aoTexture,
      ctx.worldPos,
      ctx.geometricNormal,
      ctx.overlayIdFloor,
      ctx.scaledTextureScale,
      ctx.triplanarSharpnessNode,
      ctx.variationScaleNode
    ).r;
    const overlayCeilAo = sampleTextureArrayTriplanarNoTile(
      aoTexture,
      ctx.worldPos,
      ctx.geometricNormal,
      ctx.overlayIdCeil,
      ctx.scaledTextureScale,
      ctx.triplanarSharpnessNode,
      ctx.variationScaleNode
    ).r;

    const blendedBaseAo = mix(baseFloorAo, baseCeilAo, ctx.baseTransitionMask);
    const blendedOverlayAo = mix(
      overlayFloorAo,
      overlayCeilAo,
      ctx.overlayTransitionMask
    );
    return mix(blendedBaseAo, blendedOverlayAo, ctx.finalMask);
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
 * Blend mode for texture transitions
 * - linear: Simple linear interpolation between textures
 * - height: Height-based blending using texture height maps for natural transitions
 * - noise: Noise-based edge blending for organic, irregular transition boundaries
 */
export type BlendMode = "linear" | "height" | "noise";

/**
 * Extended parameters for enhanced terrain texture rendering
 * Includes all triplanar no-tile parameters plus additional blend mode and saturation controls
 */
export interface TerrainTextureMaterialEnhancedParams
  extends TerrainTextureMaterialTriplanarNoTileParams {
  /**
   * Blend mode for texture transitions.
   * - 0 or 'linear': Simple linear interpolation
   * - 1 or 'height': Height-based blending (default)
   * - 2 or 'noise': Noise-based edge blending
   */
  blendMode?: number | UniformValue;

  /**
   * Noise blur - controls the softness of noise-based transitions.
   * Higher values create softer edges. Default: 0.5
   * Only used when blendMode is 'noise' (2).
   */
  noiseBlur?: number | UniformValue;

  /**
   * Noise amplitude - how much the noise affects the blend.
   * Higher values create more irregular edges. Default: 1.25
   * Only used when blendMode is 'noise' (2).
   */
  noiseAmplitude?: number | UniformValue;

  /**
   * Noise wavelength - scale of the noise pattern.
   * Higher values create larger noise features. Default: 16384
   * Only used when blendMode is 'noise' (2).
   */
  noiseWavelength?: number | UniformValue;

  /**
   * Noise accuracy - multiplier for the weight value.
   * Controls blend sharpness in noise mode. Default: 1.25
   * Only used when blendMode is 'noise' (2).
   */
  noiseAccuracy?: number | UniformValue;

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
 * Create an enhanced color node with triplanar sampling, stochastic tiling,
 * multiple blend modes, and saturation control.
 *
 * This node combines all terrain texturing features:
 * - Triplanar projection (prevents stretching on steep slopes)
 * - Stochastic tiling (reduces visible texture repetition)
 * - Multiple blend modes (linear, height-based, noise-based)
 * - Saturation control for color harmony
 * - Debug visualization modes
 *
 * Blend modes (controlled by blendMode uniform):
 * - 0 (linear): Simple linear interpolation between textures
 * - 1 (height): Height-based blending using texture height maps (default)
 * - 2 (noise): Noise-based edge blending for organic transitions
 *
 * Debug modes (controlled by debugMode uniform):
 * - 0: Normal rendering with selected blend mode
 * - 1: Pure RGB colors showing triplanar blend weights
 * - 2: Textures with axis color tints
 *
 * Usage:
 * ```ts
 * const blendModeUniform = uniform(1); // 0=linear, 1=height, 2=noise
 * const saturationUniform = uniform(1.0);
 *
 * const colorNode = createTerrainColorNode({
 *   varyings: terrain.varyings,
 *   textureArray: terrain.textureArray,
 *   debugMode: uniform(0),
 *   blendMode: blendModeUniform,
 *   saturation: saturationUniform,
 *   // Noise params (only used when blendMode=2)
 *   noiseBlur: uniform(0.5),
 *   noiseAmplitude: uniform(1.25),
 *   noiseWavelength: uniform(16384),
 *   noiseAccuracy: uniform(1.25),
 * });
 * material.colorNode = colorNode;
 * ```
 */
export const createTerrainColorNode = (
  params: TerrainTextureMaterialEnhancedParams
): ShaderNodeObject<Node> => {
  const { textureArray, debugMode, saturation = 1.0 } = params;
  const ctx = getBlendContext(params);

  const albedoHeightTexture = textureArray.albedoHeightArray;
  const saturationNode =
    typeof saturation === "number" ? float(saturation) : saturation;

  return Fn(() => {
    const blendedBaseColor = mix(
      ctx.baseFloorAlbedoHeight.rgb,
      ctx.baseCeilAlbedoHeight.rgb,
      ctx.baseTransitionMask
    );
    const blendedOverlayColor = mix(
      ctx.overlayFloorAlbedoHeight.rgb,
      ctx.overlayCeilAlbedoHeight.rgb,
      ctx.overlayTransitionMask
    );
    const enhancedColor = mix(
      blendedBaseColor,
      blendedOverlayColor,
      ctx.finalMask
    );

    // === SATURATION ADJUSTMENT ===
    const saturatedColor = adjustSaturation(enhancedColor, saturationNode);

    // === DEBUG MODES ===
    // Use the flat texture IDs from context (same as used for rendering)
    const baseId = ctx.baseIdFloor;
    const overlayId = ctx.overlayIdFloor;

    // Debug weights (pure RGB)
    const weightsColor = triplanarDebugWeights(
      ctx.geometricNormal,
      ctx.triplanarSharpnessNode
    ).rgb;

    // Debug tinted (textures with color tints)
    const baseSampleTinted = sampleTextureArrayTriplanarDebug(
      albedoHeightTexture,
      ctx.worldPos,
      ctx.geometricNormal,
      baseId,
      ctx.scaledTextureScale,
      ctx.triplanarSharpnessNode
    );
    const overlaySampleTinted = sampleTextureArrayTriplanarDebug(
      albedoHeightTexture,
      ctx.worldPos,
      ctx.geometricNormal,
      overlayId,
      ctx.scaledTextureScale,
      ctx.triplanarSharpnessNode
    );
    const tintedColor = mix(
      baseSampleTinted.rgb,
      overlaySampleTinted.rgb,
      ctx.finalMask
    );

    // Select output based on debug mode uniform:
    // 0 = enhanced, 1 = weights, 2 = tinted
    const isWeights = debugMode.equal(float(1));
    const isTinted = debugMode.equal(float(2));

    // Select between the three modes
    const finalColor = mix(
      mix(saturatedColor, weightsColor, select(isWeights, float(1), float(0))),
      tintedColor,
      select(isTinted, float(1), float(0))
    );

    // Handle holes (set alpha to 0 to discard)
    return vec4(finalColor, select(ctx.hole, float(0), float(1)));
  })();
};
