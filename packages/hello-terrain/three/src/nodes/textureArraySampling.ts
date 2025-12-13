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
    // This determines which "virtual pattern" to use at each location
    const k = mx_noise_float(uv.mul(variationScale));

    // Compute index into virtual patterns (8 patterns total)
    const index = k.mul(8.0);
    const i = floor(index);
    const f = fract(index);

    // Hash-based offsets for two adjacent virtual patterns
    // Using sin with different frequencies creates pseudo-random but deterministic offsets
    const offa = sin(vec2(3.0, 7.0).mul(i));
    const offb = sin(vec2(3.0, 7.0).mul(i.add(1.0)));

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
 * Height-based blending for natural texture transitions
 *
 * Uses height values from texture alpha channels to create more natural
 * transitions between base and overlay textures. Higher areas of one texture
 * will blend over lower areas of another.
 *
 * @param baseColor RGB color of base texture
 * @param overlayColor RGB color of overlay texture
 * @param baseHeight Height value from base texture (0-1)
 * @param overlayHeight Height value from overlay texture (0-1)
 * @param blendFactor Overall blend amount (0=base, 1=overlay)
 * @param sharpness Controls transition sharpness (higher = sharper)
 */
export const heightBlend = Fn(
  ([
    baseColor,
    overlayColor,
    baseHeight,
    overlayHeight,
    blendFactor,
    sharpness,
  ]: ShaderNodeObject<Node>[]) => {
    const depth = float(0.2);
    const baseBlendHeight = baseHeight.add(
      float(1).sub(blendFactor).mul(depth)
    );
    const overlayBlendHeight = overlayHeight.add(blendFactor.mul(depth));

    const blendMask = overlayBlendHeight
      .sub(baseBlendHeight)
      .mul(sharpness)
      .add(float(0.5))
      .clamp(0, 1);

    return mix(baseColor, overlayColor, blendMask);
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
