/**
 * Everything that trades frame time for fidelity, in one place. Most of these
 * are baked into the shaders or the terrain allocation when they are built,
 * so switching preset rebuilds the scene.
 */
export interface QualityPreset {
  label: string;
  /** Atmosphere samples per ray segment, per pixel (a ray has up to two). */
  atmosphereSteps: number;
  /** Samples through the interior gas along each ray. */
  nebulaSteps: number;
  /** Whether eclipse shadows fall through the interior gas (costly). */
  nebulaShadows: boolean;
  /** Atmosphere samples per segment for the sky reflected in the water. */
  reflectionSteps: number;
  /**
   * Resolution of the atmosphere march, as a fraction of the
   * canvas. Its cost falls with the square of this.
   */
  volumeScale: number;
  /** Plane waves summed for the water normal. */
  waveCount: number;
  /** Ground-detail noise octaves, as cell sizes in metres (powers of two). */
  detailCells: readonly number[];
  /** Vertices along the edge of each terrain tile. */
  innerTileSegments: number;
  /** Terrain tile budget. */
  maxNodes: number;
  /** A tile splits when the camera is within this many tile radii. */
  lodDistanceFactor: number;
  /** Upper bound on device pixel ratio. */
  maxDpr: number;
}

export const QUALITY_PRESETS = {
  low: {
    label: "Low",
    atmosphereSteps: 6,
    nebulaSteps: 4,
    nebulaShadows: false,
    reflectionSteps: 3,
    volumeScale: 0.34,
    waveCount: 12,
    detailCells: [512, 64],
    innerTileSegments: 31,
    maxNodes: 1024,
    lodDistanceFactor: 4,
    maxDpr: 1,
  },
  standard: {
    label: "Standard",
    atmosphereSteps: 10,
    nebulaSteps: 6,
    nebulaShadows: false,
    reflectionSteps: 4,
    volumeScale: 0.5,
    waveCount: 18,
    detailCells: [512, 64, 8],
    innerTileSegments: 61,
    maxNodes: 1536,
    lodDistanceFactor: 4,
    maxDpr: 1,
  },
  high: {
    label: "High",
    atmosphereSteps: 16,
    nebulaSteps: 10,
    nebulaShadows: true,
    reflectionSteps: 8,
    volumeScale: 0.5,
    waveCount: 28,
    detailCells: [512, 64, 8, 1],
    innerTileSegments: 61,
    maxNodes: 2560,
    lodDistanceFactor: 6,
    maxDpr: 1.5,
  },
  ultra: {
    label: "Ultra",
    atmosphereSteps: 32,
    nebulaSteps: 16,
    nebulaShadows: true,
    reflectionSteps: 12,
    volumeScale: 0.5,
    waveCount: 40,
    detailCells: [512, 64, 8, 1],
    innerTileSegments: 93,
    maxNodes: 3072,
    lodDistanceFactor: 7,
    maxDpr: 2,
  },
} as const satisfies Record<string, QualityPreset>;

export type QualityId = keyof typeof QUALITY_PRESETS;

export function isQualityId(value: unknown): value is QualityId {
  return typeof value === "string" && value in QUALITY_PRESETS;
}
