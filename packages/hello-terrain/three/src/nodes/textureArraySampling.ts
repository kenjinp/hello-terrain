import { Fn, type ShaderNodeObject, float, mix, texture } from "three/tsl";
import type { Node } from "three/webgpu";
import type { Texture } from "three/webgpu";

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
