import { float, Fn, texture } from "three/tsl";
import type { Node, TextureNode } from "three/webgpu";

/**
 * Decode an RG-packed 16-bit heightmap sample (R/G in [0, 1]) to a normalized
 * value in [0, 1].
 */
export const decodeUint16RG = Fn(([sample]: [Node]) =>
  sample.r.mul(float(256)).add(sample.g).div(float(257)),
);

/**
 * Bilinearly sample an RG-packed 16-bit heightmap and return elevation in meters.
 *
 * @param heightmapTexture - Texture node (RG encoding).
 * @param uv - Sample coordinates in [0, 1].
 * @param minM - Minimum elevation in meters.
 * @param maxM - Maximum elevation in meters (unused; kept for API symmetry with range-based callers).
 * @param rangeM - Elevation span in meters (`maxM - minM`).
 */
export const sampleHeightmapMeters = Fn(
  ([heightmapTexture, uv, minM, _maxM, rangeM]: [
    TextureNode,
    Node,
    Node,
    Node,
    Node,
  ]) => {
    const sample = texture(heightmapTexture, uv);
    const normalized = decodeUint16RG(sample);
    return minM.add(normalized.mul(rangeM));
  },
);
