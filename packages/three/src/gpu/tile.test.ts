import { describe, expect, it } from "vitest";
import {
  FIELD_EDGE_EXTRA_TEXELS,
  FIELD_INNER_TEXEL_OFFSET,
  HALF_PI,
  sphereTileArcLength,
  tileLocalToFieldUVNumber,
} from "./tile";

/**
 * Parity guards for the CPU variants of formulas that also exist in TSL form
 * (`tileLocalToFieldUV`, the `tileSize` cube-sphere branch). The TSL bodies
 * live adjacent in `tile.ts`; if these expectations change, both variants
 * must change together.
 */
describe("tileLocalToFieldUVNumber", () => {
  const innerSegments = 61;
  const edge = innerSegments + FIELD_EDGE_EXTRA_TEXELS;

  it("maps the first inner vertex past the skirt border", () => {
    expect(tileLocalToFieldUVNumber(0, innerSegments)).toBeCloseTo(
      FIELD_INNER_TEXEL_OFFSET / edge,
      12,
    );
  });

  it("maps the last inner vertex symmetrically before the far border", () => {
    expect(tileLocalToFieldUVNumber(1, innerSegments)).toBeCloseTo(
      (innerSegments + FIELD_INNER_TEXEL_OFFSET) / edge,
      12,
    );
    expect(
      tileLocalToFieldUVNumber(0, innerSegments) +
        tileLocalToFieldUVNumber(1, innerSegments),
    ).toBeCloseTo(1, 12);
  });

  it("maps the tile center to the texture center", () => {
    expect(tileLocalToFieldUVNumber(0.5, innerSegments)).toBeCloseTo(0.5, 12);
  });
});

/**
 * Documents the relationship between the three UV conventions used across the
 * pipeline (see `ElevationParams` / `ComputeStageCallback` JSDoc):
 * - `tileUV` / stage `uv`: `ix / width` over the whole skirted grid.
 * - `tileFaceUV` inner-grid local: `(ix - 1) / innerSegments` in [0, 1].
 * - `tileLocalToFieldUV`: inner-grid local -> texel-centred field UV.
 * These are intentionally different; this test pins the offsets so a change
 * to any one of them is caught.
 */
describe("grid UV conventions", () => {
  const innerSegments = 61;
  const width = innerSegments + FIELD_EDGE_EXTRA_TEXELS;
  const gridUV = (ix: number) => ix / width;
  const innerLocal = (ix: number) => (ix - 1) / innerSegments;

  it("grid uv spans the skirt ring and never reaches 1", () => {
    expect(gridUV(0)).toBe(0);
    expect(gridUV(width - 1)).toBeLessThan(1);
    expect(gridUV(width - 1)).toBeCloseTo((width - 1) / width, 12);
  });

  it("inner-grid local uv maps the first and last inner texels to 0 and 1", () => {
    expect(innerLocal(1)).toBe(0);
    expect(innerLocal(width - 2)).toBe(1);
    // Skirt texels fall exactly one texel outside [0, 1].
    expect(innerLocal(0)).toBeCloseTo(-1 / innerSegments, 12);
    expect(innerLocal(width - 1)).toBeCloseTo(1 + 1 / innerSegments, 12);
  });

  it("field uv is the grid uv shifted by half a texel (texel centre)", () => {
    for (let ix = 1; ix <= width - 2; ix += 10) {
      const fieldUV = tileLocalToFieldUVNumber(innerLocal(ix), innerSegments);
      expect(fieldUV).toBeCloseTo(gridUV(ix) + 0.5 / width, 12);
    }
  });
});

describe("sphereTileArcLength", () => {
  it("spans a quarter arc at the root level", () => {
    expect(sphereTileArcLength(1000, 1)).toBeCloseTo(1000 * HALF_PI, 9);
  });

  it("halves per subdivision level", () => {
    const level3 = sphereTileArcLength(1000, 2 ** 3);
    const level4 = sphereTileArcLength(1000, 2 ** 4);
    expect(level4).toBeCloseTo(level3 / 2, 9);
  });
});
