import {
  Fn,
  type ShaderNodeObject,
  abs,
  float,
  floor,
  fract,
  mix,
  mx_noise_float,
  pow,
  sin,
  smoothstep,
  texture,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { Node, Texture } from "three/webgpu";

/**
 * Sample from texture array with layer index
 *
 * Note: The texture parameter should be a DataArrayTexture instance,
 * which will be automatically converted to a uniform by TSL.
 * Uses .depth() to specify the array layer index for proper WGSL generation.
 */
export const sampleTextureArray = Fn(
  ([textureArr, uv, layerIndex]: [
    Texture,
    ShaderNodeObject<Node>,
    ShaderNodeObject<Node>,
  ]) => {
    // Use .depth() to specify the array layer index
    // This generates proper textureSample with array_index parameter in WGSL
    return texture(textureArr, uv).depth(layerIndex);
  }
);

/**
 * Sample from texture array with stochastic tiling to reduce repetition
 *
 * Implements Inigo Quilez's technique from https://www.shadertoy.com/view/Xtl3zf
 * This breaks up visible texture repetition by:
 * 1. Sampling a variation pattern (noise) at low frequency
 * 2. Using the variation to select between different UV offsets
 * 3. Blending between two offset samples with a smooth, color-aware transition
 *
 * @param textureArr The texture array to sample from (DataArrayTexture)
 * @param uv UV coordinates for sampling
 * @param layerIndex Index of the texture layer in the array
 * @param variationScale Scale for the variation pattern (lower = larger variation zones, default ~0.01)
 */
export const sampleTextureArrayNoTile = Fn(
  ([textureArr, uv, layerIndex, variationScale]: [
    Texture,
    ShaderNodeObject<Node>,
    ShaderNodeObject<Node>,
    ShaderNodeObject<Node>,
  ]) => {
    // Sample variation pattern using procedural noise at low frequency
    // This determines which "virtual pattern" to use at each location.
    // Add layer-dependent offset so different textures get different patterns,
    // which breaks up height blending tiling between base and overlay textures.
    const layerOffset = layerIndex.toFloat().mul(0.37);
    const k = mx_noise_float(uv.mul(variationScale).add(layerOffset));

    // Compute index into virtual patterns (8 patterns total)
    const index = k.mul(8.0);
    const i = floor(index);
    const f = fract(index);

    // Hash-based offsets for two adjacent virtual patterns
    // Using sin with different frequencies creates pseudo-random but deterministic offsets
    const offa = sin(vec2(3.0, 7.0).mul(i.add(layerOffset)));
    const offb = sin(vec2(3.0, 7.0).mul(i.add(1.0).add(layerOffset)));

    // Sample texture at two offset positions
    // Note: Using standard sampling - mipmap level is computed from offset UVs
    // The visual improvement from breaking tiling far outweighs any minor mipmap artifacts
    const cola = texture(textureArr, uv.add(offa)).depth(layerIndex);
    const colb = texture(textureArr, uv.add(offb)).depth(layerIndex);

    // Color-aware smooth blending
    // The dot product adjustment helps hide seams by accounting for color differences
    const colorDiff = cola.rgb.sub(colb.rgb);
    const blendAdjust = colorDiff.dot(vec3(1.0)).mul(0.1);
    const blendFactor = smoothstep(float(0.2), float(0.8), f.sub(blendAdjust));

    // Interpolate between the two virtual patterns
    return mix(cola, colb, blendFactor);
  }
);

/**
 * Triplanar texture sampling for terrain surfaces
 *
 * Projects textures from three orthogonal planes (XY, XZ, YZ) and blends
 * them based on the surface normal. This prevents texture stretching on
 * steep slopes that occurs with standard planar (XZ) projection.
 *
 * @param textureArr The texture array to sample from (DataArrayTexture)
 * @param worldPos World position of the fragment (vec3)
 * @param normal Surface normal vector (should be normalized)
 * @param layerIndex Index of the texture layer in the array
 * @param textureScale Scale factor for texture coordinates (higher = more tiling)
 * @param sharpness Controls blending sharpness between projections (higher = sharper, default 1)
 */
export const sampleTextureArrayTriplanar = Fn(
  ([textureArr, worldPos, normal, layerIndex, textureScale, sharpness]: [
    Texture,
    ShaderNodeObject<Node>,
    ShaderNodeObject<Node>,
    ShaderNodeObject<Node>,
    ShaderNodeObject<Node>,
    ShaderNodeObject<Node>,
  ]) => {
    // Calculate blend weights from absolute normal components
    // Use power function to control blend sharpness
    const blendWeights = pow(abs(normal), sharpness).toVar();

    // Normalize weights so they sum to 1
    const weightSum = blendWeights.x.add(blendWeights.y).add(blendWeights.z);
    const normalizedWeights = blendWeights.div(weightSum);

    // Calculate UV coordinates for each projection plane
    // X projection: use YZ coordinates (for surfaces facing X axis - cliffs)
    const uvX = vec2(worldPos.z, worldPos.y).div(textureScale);
    // Y projection: use XZ coordinates (for surfaces facing Y axis - flat ground)
    const uvY = vec2(worldPos.x, worldPos.z).div(textureScale);
    // Z projection: use XY coordinates (for surfaces facing Z axis - cliffs)
    const uvZ = vec2(worldPos.x, worldPos.y).div(textureScale);

    // Sample texture from each projection
    const sampleX = texture(textureArr, uvX).depth(layerIndex);
    const sampleY = texture(textureArr, uvY).depth(layerIndex);
    const sampleZ = texture(textureArr, uvZ).depth(layerIndex);

    // Blend samples based on normalized weights
    const blendedSample = sampleX
      .mul(normalizedWeights.x)
      .add(sampleY.mul(normalizedWeights.y))
      .add(sampleZ.mul(normalizedWeights.z));

    return blendedSample;
  }
);

/**
 * Simplified triplanar sampling with default sharpness
 *
 * Convenience wrapper that uses a sharpness of 2.0 for natural blending.
 *
 * @param textureArr The texture array to sample from (DataArrayTexture)
 * @param worldPos World position of the fragment (vec3)
 * @param normal Surface normal vector (should be normalized)
 * @param layerIndex Index of the texture layer in the array
 * @param textureScale Scale factor for texture coordinates
 */
export const sampleTextureArrayTriplanarSimple = Fn(
  ([textureArr, worldPos, normal, layerIndex, textureScale]: [
    Texture,
    ShaderNodeObject<Node>,
    ShaderNodeObject<Node>,
    ShaderNodeObject<Node>,
    ShaderNodeObject<Node>,
  ]) => {
    return sampleTextureArrayTriplanar(
      textureArr,
      worldPos,
      normal,
      layerIndex,
      textureScale,
      float(2.0)
    );
  }
);

/**
 * Debug visualization for triplanar blend weights
 *
 * Returns a color showing which projection axis dominates:
 * - Red = X axis projection (surfaces facing X - east/west cliffs)
 * - Green = Y axis projection (surfaces facing Y - flat ground)
 * - Blue = Z axis projection (surfaces facing Z - north/south cliffs)
 *
 * Use this to verify triplanar blending is working correctly.
 *
 * @param normal Surface normal vector (should be normalized)
 * @param sharpness Controls blending sharpness between projections (higher = sharper)
 * @returns vec4 with RGB showing axis weights and alpha = 1
 */
export const triplanarDebugWeights = Fn(
  ([normal, sharpness]: [ShaderNodeObject<Node>, ShaderNodeObject<Node>]) => {
    // Calculate blend weights from absolute normal components
    const blendWeights = pow(abs(normal), sharpness).toVar();

    // Normalize weights so they sum to 1
    const weightSum = blendWeights.x.add(blendWeights.y).add(blendWeights.z);
    const normalizedWeights = blendWeights.div(weightSum);

    // Return weights as RGB color
    return vec4(
      normalizedWeights.x, // Red = X axis
      normalizedWeights.y, // Green = Y axis
      normalizedWeights.z, // Blue = Z axis
      float(1.0)
    );
  }
);

/**
 * Debug triplanar sampling that tints each axis with a different color
 *
 * Samples textures using triplanar projection but tints each axis:
 * - X projection tinted RED
 * - Y projection tinted GREEN
 * - Z projection tinted BLUE
 *
 * This helps visualize which projection is being used where.
 *
 * @param textureArr The texture array to sample from (DataArrayTexture)
 * @param worldPos World position of the fragment (vec3)
 * @param normal Surface normal vector (should be normalized)
 * @param layerIndex Index of the texture layer in the array
 * @param textureScale Scale factor for texture coordinates
 * @param sharpness Controls blending sharpness between projections
 */
export const sampleTextureArrayTriplanarDebug = Fn(
  ([textureArr, worldPos, normal, layerIndex, textureScale, sharpness]: [
    Texture,
    ShaderNodeObject<Node>,
    ShaderNodeObject<Node>,
    ShaderNodeObject<Node>,
    ShaderNodeObject<Node>,
    ShaderNodeObject<Node>,
  ]) => {
    // Calculate blend weights from absolute normal components
    const blendWeights = pow(abs(normal), sharpness).toVar();

    // Normalize weights so they sum to 1
    const weightSum = blendWeights.x.add(blendWeights.y).add(blendWeights.z);
    const normalizedWeights = blendWeights.div(weightSum);

    // Calculate UV coordinates for each projection plane
    const uvX = vec2(worldPos.z, worldPos.y).div(textureScale);
    const uvY = vec2(worldPos.x, worldPos.z).div(textureScale);
    const uvZ = vec2(worldPos.x, worldPos.y).div(textureScale);

    // Sample texture from each projection
    const sampleX = texture(textureArr, uvX).depth(layerIndex);
    const sampleY = texture(textureArr, uvY).depth(layerIndex);
    const sampleZ = texture(textureArr, uvZ).depth(layerIndex);

    // Tint each sample with axis color (multiply with tint)
    const tintX = vec3(1.0, 0.3, 0.3); // Red tint
    const tintY = vec3(0.3, 1.0, 0.3); // Green tint
    const tintZ = vec3(0.3, 0.3, 1.0); // Blue tint

    const tintedX = sampleX.rgb.mul(tintX);
    const tintedY = sampleY.rgb.mul(tintY);
    const tintedZ = sampleZ.rgb.mul(tintZ);

    // Blend tinted samples based on normalized weights
    const blendedColor = tintedX
      .mul(normalizedWeights.x)
      .add(tintedY.mul(normalizedWeights.y))
      .add(tintedZ.mul(normalizedWeights.z));

    // Blend alpha from all samples
    const blendedAlpha = sampleX.a
      .mul(normalizedWeights.x)
      .add(sampleY.a.mul(normalizedWeights.y))
      .add(sampleZ.a.mul(normalizedWeights.z));

    return vec4(blendedColor, blendedAlpha);
  }
);

/**
 * Triplanar texture sampling with stochastic tiling to reduce repetition
 *
 * Combines triplanar projection (to prevent stretching on slopes) with
 * stochastic tiling (to reduce visible texture repetition). This is ideal
 * for large terrain surfaces where both issues are common.
 *
 * The stochastic technique is based on Inigo Quilez's method:
 * https://www.shadertoy.com/view/Xtl3zf
 *
 * @param textureArr The texture array to sample from (DataArrayTexture)
 * @param worldPos World position of the fragment (vec3)
 * @param normal Surface normal vector (should be normalized)
 * @param layerIndex Index of the texture layer in the array
 * @param textureScale Scale factor for texture coordinates (higher = more tiling)
 * @param sharpness Controls blending sharpness between projections (higher = sharper)
 * @param variationScale Scale for the variation pattern (lower = larger variation zones)
 */
export const sampleTextureArrayTriplanarNoTile = Fn(
  ([
    textureArr,
    worldPos,
    normal,
    layerIndex,
    textureScale,
    sharpness,
    variationScale,
  ]: [
    Texture,
    ShaderNodeObject<Node>,
    ShaderNodeObject<Node>,
    ShaderNodeObject<Node>,
    ShaderNodeObject<Node>,
    ShaderNodeObject<Node>,
    ShaderNodeObject<Node>,
  ]) => {
    // Calculate blend weights from absolute normal components
    const blendWeights = pow(abs(normal), sharpness).toVar();

    // Normalize weights so they sum to 1
    const weightSum = blendWeights.x.add(blendWeights.y).add(blendWeights.z);
    const normalizedWeights = blendWeights.div(weightSum);

    // Calculate UV coordinates for each projection plane
    const uvX = vec2(worldPos.z, worldPos.y).div(textureScale);
    const uvY = vec2(worldPos.x, worldPos.z).div(textureScale);
    const uvZ = vec2(worldPos.x, worldPos.y).div(textureScale);

    // Apply stochastic sampling to each projection
    const sampleX = sampleTextureArrayNoTile(
      textureArr,
      uvX,
      layerIndex,
      variationScale
    );
    const sampleY = sampleTextureArrayNoTile(
      textureArr,
      uvY,
      layerIndex,
      variationScale
    );
    const sampleZ = sampleTextureArrayNoTile(
      textureArr,
      uvZ,
      layerIndex,
      variationScale
    );

    // Blend samples based on normalized weights
    const blendedSample = sampleX
      .mul(normalizedWeights.x)
      .add(sampleY.mul(normalizedWeights.y))
      .add(sampleZ.mul(normalizedWeights.z));

    return blendedSample;
  }
);

/**
 * Height-based blend mask for texture transitions
 *
 * Creates a blend mask based on height values from two textures,
 * with anti-aliasing to prevent speckle/noise artifacts. Use this to
 * create natural-looking transitions where higher texture areas blend
 * over lower areas.
 *
 * Used by terrain material channels (color/normal/roughness) to ensure
 * consistent blending across all channels.
 *
 * @param baseHeight Height value from base texture (0-1)
 * @param overlayHeight Height value from overlay texture (0-1)
 * @param blendFactor Overall blend amount (0=base, 1=overlay)
 * @param sharpness Controls transition sharpness (higher = sharper)
 * @param minWidth Minimum transition width for anti-aliasing (0-1)
 * @param transitionWidth Width of the transition zone where height blending applies (0-1)
 * @returns Blend mask (0-1) used to mix base/overlay
 */
export const heightBlendMask = Fn(
  ([
    baseHeight,
    overlayHeight,
    blendFactor,
    sharpness,
    minWidth,
    transitionWidth,
  ]: ShaderNodeObject<Node>[]) => {
    // Height-based blending: blend factor controls overall mix, heights create organic edges.
    //
    // Strategy: Mix between linear blend and height-winner blend.
    // - Within the transition zone, heights have more influence
    // - At extremes (blend ~0 or ~1), control blend dominates
    //
    // The transitionWidth parameter expands the zone where height blending occurs,
    // creating smoother transitions even when control map boundaries are sharp.

    // Height comparison: who would win in pure height-based mode
    const heightDiff = overlayHeight.sub(baseHeight);
    // Convert to 0-1: 0.5 = equal, >0.5 = overlay wins, <0.5 = base wins
    const heightWinner = heightDiff.mul(sharpness).add(float(0.5));
    const heightWinnerClamped = heightWinner.clamp(0, 1);

    // Blend between linear and height-based using minWidth to control the mix.
    // minWidth=0 → pure height-based at edges
    // minWidth=1 → pure linear (heights ignored)
    // Default minWidth ~0.3 → 70% height influence at transition
    const heightInfluence = float(1).sub(minWidth);

    // Calculate the distance from blend center (0.5)
    // distFromCenter: 0 at blend=0.5, 0.5 at blend=0 or 1
    const distFromCenter = blendFactor.sub(float(0.5)).abs();

    // Use transitionWidth to expand the zone where height blending occurs.
    // With transitionWidth=0.3:
    //   - blend 0.0 to 0.15: mostly base with some height influence
    //   - blend 0.15 to 0.85: full height influence zone
    //   - blend 0.85 to 1.0: mostly overlay with some height influence
    // The smoothstep creates a soft falloff at the boundaries.
    const halfWidth = transitionWidth.mul(float(0.5));
    const innerEdge = float(0.5).sub(halfWidth); // Where full height influence starts
    const outerEdge = float(0.5); // Where height influence fades to zero

    // edgeFactor: 1 within the expanded transition zone, fading to 0 at extremes
    // Uses smoothstep for a gradual falloff instead of a hard cutoff
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
);

/**
 * Slope-based auto-texturing
 *
 * Blends a slope texture (e.g., rock) onto flat areas based on surface normal.
 * Useful for automatically applying cliff/rock textures on steep slopes.
 *
 * @param baseColor RGB color of base texture
 * @param slopeColor RGB color of slope texture
 * @param normal Surface normal vector
 * @param threshold Slope threshold (0=flat, 1=vertical)
 * @param blend Blend range for smooth transition
 */
export const slopeBlend = Fn(
  ([
    baseColor,
    slopeColor,
    normal,
    threshold,
    blend,
  ]: ShaderNodeObject<Node>[]) => {
    const slope = float(1).sub(normal.y);
    const slopeFactor = slope.sub(threshold).div(blend).clamp(0, 1);
    return mix(baseColor, slopeColor, slopeFactor);
  }
);

/**
 * Noise-based edge blending for organic texture transitions
 *
 * Uses procedural noise to create irregular, natural-looking edges between
 * texture regions instead of linear interpolation. This technique is inspired
 * by three-landscape's edgeBlend function.
 *
 * The noise modulates the blend threshold, creating organic boundaries that
 * follow the noise pattern rather than perfectly following the blend weight.
 *
 * @param weight Blend weight from control map (0-1)
 * @param blur Controls the softness of the transition (higher = softer edges)
 * @param amplitude How much the noise affects the blend (higher = more irregular edges)
 * @param wavelength Scale of the noise pattern (higher = larger noise features)
 * @param accuracy Multiplier for the weight value (controls blend sharpness)
 * @param uv UV coordinates for noise sampling (typically world position XZ)
 * @returns Modified blend factor (0-1)
 */
export const noiseEdgeBlend = Fn(
  ([weight, blur, amplitude, wavelength, accuracy, uv]: [
    ShaderNodeObject<Node>,
    ShaderNodeObject<Node>,
    ShaderNodeObject<Node>,
    ShaderNodeObject<Node>,
    ShaderNodeObject<Node>,
    ShaderNodeObject<Node>,
  ]) => {
    // Sample procedural noise at the UV coordinates scaled by wavelength.
    // mx_noise_float is typically in [0, 1]; remap to [-1, 1] so noise can
    // push edges in both directions (matching the three-landscape intent).
    const k = mx_noise_float(uv.mul(wavelength)).mul(2.0).sub(1.0);

    // Apply noise to the blend weight and use smoothstep for smooth transition
    // The 1.5 center point allows the noise to push the blend in either direction
    return smoothstep(
      float(1.5).sub(blur),
      float(1.5).add(blur),
      // three-landscape's edgeBlend expects v roughly in [0, 3], with 1.5 as the midpoint.
      // Our control blend is [0, 1], so scale by 3 so 0.5 maps to 1.5 (the transition center).
      weight
        .mul(3.0)
        .mul(accuracy)
        .add(k.mul(amplitude))
    );
  }
);

/**
 * Convert RGB color to HSV color space
 *
 * @param rgb RGB color (vec3 with components in 0-1 range)
 * @returns HSV color (vec3: H in 0-1, S in 0-1, V in 0-1)
 */
export const rgbToHsv = Fn(([rgb]: [ShaderNodeObject<Node>]) => {
  const r = rgb.x;
  const g = rgb.y;
  const b = rgb.z;

  const maxC = r.max(g).max(b);
  const minC = r.min(g).min(b);
  const delta = maxC.sub(minC);

  // Value is the maximum component
  const v = maxC;

  // Saturation is 0 when max is 0, otherwise delta/max
  const s = maxC.equal(float(0)).select(float(0), delta.div(maxC));

  // Hue calculation (0-1 range, wrapping)
  // When delta is 0, hue is undefined (we use 0)
  const hueR = g.sub(b).div(delta).add(float(6)).mod(float(6)); // Red is max
  const hueG = b.sub(r).div(delta).add(float(2)); // Green is max
  const hueB = r.sub(g).div(delta).add(float(4)); // Blue is max

  // Select hue based on which component is max
  const h = delta
    .equal(float(0))
    .select(
      float(0),
      maxC.equal(r).select(hueR, maxC.equal(g).select(hueG, hueB)).div(float(6))
    );

  return vec3(h, s, v);
});

/**
 * Convert HSV color to RGB color space
 *
 * @param hsv HSV color (vec3: H in 0-1, S in 0-1, V in 0-1)
 * @returns RGB color (vec3 with components in 0-1 range)
 */
export const hsvToRgb = Fn(([hsv]: [ShaderNodeObject<Node>]) => {
  const h = hsv.x.mul(float(6)); // Scale H to 0-6 range
  const s = hsv.y;
  const v = hsv.z;

  const i = floor(h);
  const f = fract(h);

  const p = v.mul(float(1).sub(s));
  const q = v.mul(float(1).sub(s.mul(f)));
  const t = v.mul(float(1).sub(s.mul(float(1).sub(f))));

  // Use modular arithmetic to select the correct RGB values
  const iMod = i.mod(float(6));

  // Select RGB based on hue sector
  const r = iMod
    .lessThan(float(1))
    .select(
      v,
      iMod
        .lessThan(float(2))
        .select(
          q,
          iMod
            .lessThan(float(3))
            .select(
              p,
              iMod
                .lessThan(float(4))
                .select(p, iMod.lessThan(float(5)).select(t, v))
            )
        )
    );

  const g = iMod
    .lessThan(float(1))
    .select(
      t,
      iMod
        .lessThan(float(2))
        .select(
          v,
          iMod
            .lessThan(float(3))
            .select(
              v,
              iMod
                .lessThan(float(4))
                .select(q, iMod.lessThan(float(5)).select(p, p))
            )
        )
    );

  const b = iMod
    .lessThan(float(1))
    .select(
      p,
      iMod
        .lessThan(float(2))
        .select(
          p,
          iMod
            .lessThan(float(3))
            .select(
              t,
              iMod
                .lessThan(float(4))
                .select(v, iMod.lessThan(float(5)).select(v, q))
            )
        )
    );

  return vec3(r, g, b);
});

/**
 * Adjust the saturation of an RGB color
 *
 * Converts to HSV, multiplies the saturation component, and converts back.
 * This allows for desaturating (multiplier < 1) or oversaturating (multiplier > 1)
 * colors for better visual harmony across different terrain textures.
 *
 * @param color RGB color (vec3)
 * @param saturationMultiplier Saturation multiplier (1.0 = unchanged, 0.0 = grayscale, 2.0 = double saturation)
 * @returns Adjusted RGB color (vec3)
 */
export const adjustSaturation = Fn(
  ([color, saturationMultiplier]: [
    ShaderNodeObject<Node>,
    ShaderNodeObject<Node>,
  ]) => {
    const hsv = rgbToHsv(color);
    const adjustedHsv = vec3(
      hsv.x,
      hsv.y.mul(saturationMultiplier).clamp(0, 1),
      hsv.z
    );
    return hsvToRgb(adjustedHsv);
  }
);
