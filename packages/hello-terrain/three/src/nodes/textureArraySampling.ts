import {
  Fn,
  abs,
  float,
  floor,
  fract,
  mix,
  pow,
  sin,
  smoothstep,
  texture,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { Node, Texture } from "three/webgpu";

// ============================================================
// TERRAIN SAMPLER FACTORY
// ============================================================
// Creates setLayout() functions for terrain texture sampling.
// By using setLayout(), the TSL compiler generates actual WGSL functions
// that are CALLED instead of being INLINED, dramatically reducing shader size.
//
// Pattern: Factory creates a closure capturing texture references.
// The returned Fn uses setLayout() to become a real WGSL function.
// Textures are accessed as global WGSL bindings from within the function.

// biome-ignore lint/suspicious/noExplicitAny: TSL function types are complex
type SamplerFn = any;

/**
 * Create terrain sampling functions with setLayout() for shader function extraction.
 *
 * This factory creates TWO separate functions (one per texture array) that:
 * 1. Use triplanar projection (prevents stretching on slopes)
 * 2. Apply stochastic tiling (reduces visible repetition)
 * 3. Generate as actual WGSL functions via setLayout()
 *
 * By creating real WGSL functions, the shader size is dramatically reduced
 * (from ~2500 lines to ~800 lines) because sampling code is defined ONCE
 * and CALLED multiple times instead of being inlined.
 *
 * @param albedoHeightArr Texture array with RGB=albedo, A=height
 * @param normalRoughnessArr Texture array with RGB=normal, A=roughness
 * @param noiseTexture Pre-computed noise for stochastic tiling
 */
export const createTerrainSamplerFunctions = (
  albedoHeightArr: Texture,
  normalRoughnessArr: Texture,
  noiseTexture: Texture
): {
  sampleAlbedoHeight: SamplerFn;
  sampleNormalRoughness: SamplerFn;
} => {
  // ============================================================
  // ALBEDO+HEIGHT SAMPLER
  // ============================================================
  const sampleAlbedoHeight = Fn(
    ({
      worldPos,
      geometricNormal,
      textureId,
      textureScale,
      triplanarSharpness,
      variationScale,
    }: {
      worldPos: Node;
      geometricNormal: Node;
      textureId: Node;
      textureScale: Node;
      triplanarSharpness: Node;
      variationScale: Node;
    }) => {
      // Triplanar weights - explicitly splat sharpness to vec3 for WGSL compatibility
      const sharpnessVec = vec3(
        triplanarSharpness,
        triplanarSharpness,
        triplanarSharpness
      );
      const weights = pow(abs(geometricNormal), sharpnessVec);
      const totalWeight = weights.x.add(weights.y).add(weights.z);
      const w = weights.div(totalWeight);

      // UV coordinates for each projection axis
      const uvX = vec2(worldPos.z, worldPos.y).div(textureScale);
      const uvY = vec2(worldPos.x, worldPos.z).div(textureScale);
      const uvZ = vec2(worldPos.x, worldPos.y).div(textureScale);

      // Pre-compute layer offset for stochastic tiling (explicit float cast for WGSL)
      // This is to reduce patterns in the stochastic tiling
      const irrationalNumberOffset = float(0.37);
      const textureIdFloat = float(0).toVar();
      textureIdFloat.assign(textureId.toFloat());
      const layerOffset = textureIdFloat.mul(irrationalNumberOffset);

      // Sample each axis with stochastic tiling (textureId is already int)
      const sampleX = sampleStochastic(
        albedoHeightArr,
        noiseTexture,
        uvX,
        textureId,
        layerOffset,
        variationScale
      );
      const sampleY = sampleStochastic(
        albedoHeightArr,
        noiseTexture,
        uvY,
        textureId,
        layerOffset,
        variationScale
      );
      const sampleZ = sampleStochastic(
        albedoHeightArr,
        noiseTexture,
        uvZ,
        textureId,
        layerOffset,
        variationScale
      );

      // Blend samples based on triplanar weights
      return vec4(
        sampleX.rgb
          .mul(w.x)
          .add(sampleY.rgb.mul(w.y))
          .add(sampleZ.rgb.mul(w.z)),
        sampleX.a.mul(w.x).add(sampleY.a.mul(w.y)).add(sampleZ.a.mul(w.z))
      );
    }
  ).setLayout({
    name: "sampleAlbedoHeight",
    type: "vec4",
    inputs: [
      { name: "worldPos", type: "vec3" },
      { name: "geometricNormal", type: "vec3" },
      { name: "textureId", type: "int" },
      { name: "textureScale", type: "float" },
      { name: "triplanarSharpness", type: "float" },
      { name: "variationScale", type: "float" },
    ],
  });

  // ============================================================
  // NORMAL+ROUGHNESS SAMPLER
  // ============================================================
  const sampleNormalRoughness = Fn(
    ({
      worldPos,
      geometricNormal,
      textureId,
      textureScale,
      triplanarSharpness,
      variationScale,
    }: {
      worldPos: Node;
      geometricNormal: Node;
      textureId: Node;
      textureScale: Node;
      triplanarSharpness: Node;
      variationScale: Node;
    }) => {
      // Triplanar weights - explicitly splat sharpness to vec3 for WGSL compatibility
      const sharpnessVec = vec3(
        triplanarSharpness,
        triplanarSharpness,
        triplanarSharpness
      );
      const weights = pow(abs(geometricNormal), sharpnessVec);
      const totalWeight = weights.x.add(weights.y).add(weights.z);
      const w = weights.div(totalWeight);

      // UV coordinates for each projection axis
      const uvX = vec2(worldPos.z, worldPos.y).div(textureScale);
      const uvY = vec2(worldPos.x, worldPos.z).div(textureScale);
      const uvZ = vec2(worldPos.x, worldPos.y).div(textureScale);

      // Pre-compute layer offset for stochastic tiling (explicit float cast for WGSL)
      // This is to reduce patterns in the stochastic tiling
      const irrationalNumberOffset = float(0.37);
      const textureIdFloat = float(0).toVar();
      textureIdFloat.assign(textureId.toFloat());
      const layerOffset = textureIdFloat.mul(irrationalNumberOffset);

      // Sample each axis with stochastic tiling (textureId is already int)
      const sampleX = sampleStochastic(
        normalRoughnessArr,
        noiseTexture,
        uvX,
        textureId,
        layerOffset,
        variationScale
      );
      const sampleY = sampleStochastic(
        normalRoughnessArr,
        noiseTexture,
        uvY,
        textureId,
        layerOffset,
        variationScale
      );
      const sampleZ = sampleStochastic(
        normalRoughnessArr,
        noiseTexture,
        uvZ,
        textureId,
        layerOffset,
        variationScale
      );

      // Blend samples based on triplanar weights
      return vec4(
        sampleX.rgb
          .mul(w.x)
          .add(sampleY.rgb.mul(w.y))
          .add(sampleZ.rgb.mul(w.z)),
        sampleX.a.mul(w.x).add(sampleY.a.mul(w.y)).add(sampleZ.a.mul(w.z))
      );
    }
  ).setLayout({
    name: "sampleNormalRoughness",
    type: "vec4",
    inputs: [
      { name: "worldPos", type: "vec3" },
      { name: "geometricNormal", type: "vec3" },
      { name: "textureId", type: "int" },
      { name: "textureScale", type: "float" },
      { name: "triplanarSharpness", type: "float" },
      { name: "variationScale", type: "float" },
    ],
  });

  return {
    sampleAlbedoHeight,
    sampleNormalRoughness,
  };
};

// ============================================================
// INTERNAL STOCHASTIC SAMPLING HELPER
// ============================================================
// This is inlined intentionally since it's only called from within
// the setLayout functions above. The outer functions are what
// get compiled to WGSL functions.

/**
 * Sample from texture array with stochastic tiling to reduce repetition.
 * Implements Inigo Quilez's technique from https://www.shadertoy.com/view/Xtl3zf
 *
 * @internal Called from within setLayout functions
 */
const sampleStochastic = (
  textureArr: Texture,
  noiseTexture: Texture,
  uv: Node,
  layerIndex: Node,
  layerOffset: Node,
  variationScale: Node
) => {
  // Sample variation pattern from pre-computed noise texture
  const noiseUV = fract(uv.mul(variationScale).add(layerOffset));
  const k = texture(noiseTexture, noiseUV).r.mul(2.0).sub(1.0);

  // Compute index into virtual patterns (8 patterns total)
  const index = k.mul(8.0);
  const i = floor(index);
  const f = fract(index);

  // Hash-based offsets for two adjacent virtual patterns
  const offa = sin(vec2(3.0, 7.0).mul(i.add(layerOffset)));
  const offb = sin(vec2(3.0, 7.0).mul(i.add(1.0).add(layerOffset)));

  // Sample texture at two offset positions (layerIndex is already int from setLayout)
  const cola = texture(textureArr, uv.add(offa)).depth(layerIndex);
  const colb = texture(textureArr, uv.add(offb)).depth(layerIndex);

  // Color-aware smooth blending
  const colorDiff = cola.rgb.sub(colb.rgb);
  const blendAdjust = colorDiff.dot(vec3(1.0)).mul(0.1);
  const blendFactor = smoothstep(float(0.2), float(0.8), f.sub(blendAdjust));

  // Interpolate between the two virtual patterns
  return mix(cola, colb, blendFactor);
};

// ============================================================
// STANDALONE TRIPLANAR SAMPLER (for brush preview, etc.)
// ============================================================

/**
 * Sample a single texture array with triplanar projection and stochastic tiling.
 *
 * This is a simplified version for cases where you only need to sample one texture
 * (e.g., brush preview). For full terrain rendering with multiple texture arrays,
 * use createTerrainSamplerFunctions instead.
 *
 * @param textureArr The texture array to sample from
 * @param noiseTexture Pre-computed noise for stochastic tiling
 * @param worldPos World position for triplanar UVs
 * @param normal Surface normal for triplanar weights
 * @param layerIndex Texture layer index to sample
 * @param textureScale UV scale (higher = more tiling)
 * @param sharpness Triplanar blend sharpness (higher = sharper)
 * @param variationScale Stochastic variation scale (lower = larger zones)
 */
export const sampleTriplanarNoTile = Fn(
  ([
    textureArr,
    noiseTexture,
    worldPos,
    normal,
    layerIndex,
    textureScale,
    sharpness,
    variationScale,
  ]: [Texture, Texture, Node, Node, Node, Node, Node, Node]) => {
    // Calculate triplanar blend weights
    const blendWeights = pow(abs(normal), sharpness);
    const weightSum = blendWeights.x.add(blendWeights.y).add(blendWeights.z);
    const w = blendWeights.div(weightSum);

    // Calculate UV coordinates for each projection plane
    const uvX = vec2(worldPos.z, worldPos.y).div(textureScale);
    const uvY = vec2(worldPos.x, worldPos.z).div(textureScale);
    const uvZ = vec2(worldPos.x, worldPos.y).div(textureScale);

    // Pre-compute layer offset for stochastic tiling
    const irrationalNumberOffset = float(0.37);
    const layerOffset = layerIndex.mul(irrationalNumberOffset);

    // Sample each triplanar axis with stochastic tiling
    const sampleX = sampleStochastic(
      textureArr,
      noiseTexture,
      uvX,
      layerIndex,
      layerOffset,
      variationScale
    );
    const sampleY = sampleStochastic(
      textureArr,
      noiseTexture,
      uvY,
      layerIndex,
      layerOffset,
      variationScale
    );
    const sampleZ = sampleStochastic(
      textureArr,
      noiseTexture,
      uvZ,
      layerIndex,
      layerOffset,
      variationScale
    );

    // Blend samples based on triplanar weights
    return vec4(
      sampleX.rgb.mul(w.x).add(sampleY.rgb.mul(w.y)).add(sampleZ.rgb.mul(w.z)),
      sampleX.a.mul(w.x).add(sampleY.a.mul(w.y)).add(sampleZ.a.mul(w.z))
    );
  }
);

// ============================================================
// HEIGHT-BASED BLENDING
// ============================================================

/**
 * Height-based blend mask for texture transitions.
 * Uses setLayout() for shader function extraction.
 *
 * Creates a blend mask based on height values from two textures,
 * with anti-aliasing to prevent speckle/noise artifacts.
 *
 * @param baseHeight Height value from base texture (0-1)
 * @param overlayHeight Height value from overlay texture (0-1)
 * @param blendFactor Overall blend amount (0=base, 1=overlay)
 * @param sharpness Controls transition sharpness (higher = sharper)
 * @param minWidth Minimum transition width for anti-aliasing (0-1)
 * @param transitionWidth Width of the transition zone (0-1)
 */
export const heightBlendMask = Fn(
  ({
    baseHeight,
    overlayHeight,
    blendFactor,
    sharpness,
    minWidth,
    transitionWidth,
  }: {
    baseHeight: Node;
    overlayHeight: Node;
    blendFactor: Node;
    sharpness: Node;
    minWidth: Node;
    transitionWidth: Node;
  }) => {
    // Height comparison: who would win in pure height-based mode
    const heightDiff = overlayHeight.sub(baseHeight);
    const heightWinner = heightDiff.mul(sharpness).add(float(0.5));
    const heightWinnerClamped = heightWinner.clamp(0, 1);

    // Height influence based on minWidth
    const heightInfluence = float(1).sub(minWidth);

    // Distance from blend center (0.5)
    const distFromCenter = blendFactor.sub(float(0.5)).abs();

    // Transition zone calculation
    const halfWidth = transitionWidth.mul(float(0.5));
    const innerEdge = float(0.5).sub(halfWidth);
    const outerEdge = float(0.5);

    // Edge factor: 1 within transition zone, fading to 0 at extremes
    const edgeFactor = float(1).sub(
      smoothstep(innerEdge, outerEdge, distFromCenter)
    );

    // Mix: within transition zone, use height; at extremes, use linear blend
    const heightContribution = heightWinnerClamped
      .mul(edgeFactor)
      .mul(heightInfluence);
    const linearContribution = blendFactor.mul(
      float(1).sub(edgeFactor.mul(heightInfluence))
    );

    return heightContribution.add(linearContribution).clamp(0, 1);
  }
).setLayout({
  name: "heightBlendMask",
  type: "float",
  inputs: [
    { name: "baseHeight", type: "float" },
    { name: "overlayHeight", type: "float" },
    { name: "blendFactor", type: "float" },
    { name: "sharpness", type: "float" },
    { name: "minWidth", type: "float" },
    { name: "transitionWidth", type: "float" },
  ],
});

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/**
 * Slope-based auto-texturing.
 * Uses setLayout() for shader function extraction.
 */
export const slopeBlend = Fn(
  ({
    baseColor,
    slopeColor,
    normal,
    threshold,
    blend,
  }: {
    baseColor: Node;
    slopeColor: Node;
    normal: Node;
    threshold: Node;
    blend: Node;
  }) => {
    const slope = float(1).sub(normal.y);
    const slopeFactor = slope.sub(threshold).div(blend).clamp(0, 1);
    return mix(baseColor, slopeColor, slopeFactor);
  }
).setLayout({
  name: "slopeBlend",
  type: "vec3",
  inputs: [
    { name: "baseColor", type: "vec3" },
    { name: "slopeColor", type: "vec3" },
    { name: "normal", type: "vec3" },
    { name: "threshold", type: "float" },
    { name: "blend", type: "float" },
  ],
});

/**
 * Adjust the saturation of an RGB color (FAST - luminance-based).
 * Uses setLayout() for shader function extraction.
 */
export const adjustSaturation = Fn(
  ({
    color,
    saturationMultiplier,
  }: {
    color: Node;
    saturationMultiplier: Node;
  }) => {
    // Calculate perceived luminance using Rec. 709 coefficients
    const luminance = color.x
      .mul(float(0.2126))
      .add(color.y.mul(float(0.7152)))
      .add(color.z.mul(float(0.0722)));

    // Mix between grayscale (luminance) and original color
    return mix(
      vec3(luminance, luminance, luminance),
      color,
      saturationMultiplier
    );
  }
).setLayout({
  name: "adjustSaturation",
  type: "vec3",
  inputs: [
    { name: "color", type: "vec3" },
    { name: "saturationMultiplier", type: "float" },
  ],
});
