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
