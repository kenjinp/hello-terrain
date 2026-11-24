/**
 * Everything that trades frame time for fidelity, in one place. Most of these
 * are baked into the shaders or the terrain allocation when they are built,
 * so switching preset rebuilds the scene.
 */
export interface QualityPreset {
  label: string;
  /** Atmosphere samples per ray segment, per pixel (a ray has up to two). */
  atmosphereSteps: number;
  /** Atmosphere samples per segment for the sky reflected in the water. */
  reflectionSteps: number;
  /** Plane waves summed for the water normal. */
  waveCount: number;
  /** Ground-detail noise octaves, as cell sizes in metres (powers of two). */
  detailCells: readonly number[];
  /** Vertices along the edge of each terrain tile. */
  innerTileSegments: number;
  /** Terrain tile budget. */
  maxNodes: number;
  /** Upper bound on device pixel ratio. */
  maxDpr: number;
}

export const QUALITY_PRESETS = {
  standard: {
    label: "Standard",
    atmosphereSteps: 10,
    reflectionSteps: 4,
    waveCount: 18,
    detailCells: [512, 64, 8],
    innerTileSegments: 61,
    maxNodes: 1536,
    maxDpr: 1,
  },
  high: {
    label: "High",
    atmosphereSteps: 16,
    reflectionSteps: 8,
    waveCount: 28,
    detailCells: [512, 64, 8, 1],
    innerTileSegments: 61,
    maxNodes: 2048,
    maxDpr: 1.5,
  },
  ultra: {
    label: "Ultra",
    atmosphereSteps: 32,
    reflectionSteps: 12,
    waveCount: 40,
    detailCells: [512, 64, 8, 1],
    innerTileSegments: 93,
    maxNodes: 2048,
    maxDpr: 2,
  },
} as const satisfies Record<string, QualityPreset>;

export type QualityId = keyof typeof QUALITY_PRESETS;

export function isQualityId(value: unknown): value is QualityId {
  return typeof value === "string" && value in QUALITY_PRESETS;
}
