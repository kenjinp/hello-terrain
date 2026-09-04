import { describe, expect, it } from "vitest";

/** CPU mirror of {@link decodeUint16RG} for unit tests. */
function decodeUint16RGNumber(r: number, g: number): number {
  return (r * 256 + g) / 257;
}

/** CPU mirror of pack/denormalize helpers for unit tests. */
function packNormalizedNumber(
  height: number,
  packMin: number,
  packMax: number,
  epsilon = 1e-4,
): number {
  const span = Math.max(packMax - packMin, epsilon);
  return (height - packMin) / span;
}

function denormalizeNumber(
  normalized: number,
  packMin: number,
  packMax: number,
  epsilon = 1e-4,
): number {
  const span = Math.max(packMax - packMin, epsilon);
  return packMin + normalized * span;
}

describe("decodeUint16RG", () => {
  it("round-trips known uint16 values via normalized RG channels", () => {
    for (const value of [0, 1, 257, 4096, 32768, 65535]) {
      const hi = Math.floor(value / 256) / 255;
      const lo = (value % 256) / 255;
      const decoded = decodeUint16RGNumber(hi, lo);
      expect(decoded).toBeCloseTo(value / 65535, 4);
    }
  });
});

describe("terrain field pack/denormalize", () => {
  it("preserves elevation through normalize and denormalize", () => {
    const packMin = 1200;
    const packMax = 4200;
    for (const height of [1200, 2500.5, 4199.25]) {
      const normalized = packNormalizedNumber(height, packMin, packMax);
      expect(normalized).toBeGreaterThanOrEqual(0);
      expect(normalized).toBeLessThanOrEqual(1);
      expect(denormalizeNumber(normalized, packMin, packMax)).toBeCloseTo(height, 3);
    }
  });

  it("handles flat tiles with epsilon span", () => {
    const height = 500;
    const normalized = packNormalizedNumber(height, height, height);
    expect(normalized).toBe(0);
    expect(denormalizeNumber(normalized, height, height)).toBeCloseTo(height, 4);
  });
});
