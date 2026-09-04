import type { Texture } from "three";
import { float, Fn, texture } from "three/tsl";
import type { Node, TextureNode } from "three/webgpu";

/** A texture (or texture node) holding encoded elevation data. */
export type ElevationTexture = TextureNode | Texture;

/** @deprecated Use {@link ElevationTexture}. Removed in the next release. */
export type HeightmapTexture = ElevationTexture;

/**
 * Decode an RG-packed 16-bit elevation sample (R/G in [0, 1]) to a normalized
 * value in [0, 1].
 */
export const decodeUint16RG = Fn(([sample]: [Node]) =>
  sample.r.mul(float(256)).add(sample.g).div(float(257)),
);

/**
 * Bilinearly sample an RG-packed 16-bit elevation texture and return elevation
 * in meters.
 *
 * @param elevationTexture - Texture or texture node (RG encoding).
 * @param uv - Sample coordinates in [0, 1].
 * @param minM - Minimum elevation in meters.
 * @param maxM - Maximum elevation in meters (unused; kept for API symmetry with range-based callers).
 * @param rangeM - Elevation span in meters (`maxM - minM`).
 */
export const sampleElevationTextureMeters = Fn(
  ([elevationTexture, uv, minM, _maxM, rangeM]: [ElevationTexture, Node, Node, Node, Node]) => {
    const sample = texture(elevationTexture, uv);
    const normalized = decodeUint16RG(sample);
    return minM.add(normalized.mul(rangeM));
  },
);

/** @deprecated Use {@link sampleElevationTextureMeters}. Removed in the next release. */
export const sampleHeightmapMeters = sampleElevationTextureMeters;
