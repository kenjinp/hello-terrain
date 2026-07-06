import { FloatType, NearestFilter, RedFormat } from 'three';
import { describe, expect, it } from 'vitest';

import { catmullRomWeights, createHeightmapField } from './field';

function makeField(
    values: number[][],
    overrides: Partial<Parameters<typeof createHeightmapField>[0]> = {}
) {
    const height = values.length;
    const width = values[0].length;
    const data = new Uint16Array(width * height);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            data[y * width + x] = values[y][x];
        }
    }
    return createHeightmapField({
        data,
        width,
        height,
        minMeters: 0,
        maxMeters: 65535,
        ...overrides,
    });
}

/** uv of the center of texel (x, y) on a w×h grid. */
const texelCenter = (x: number, y: number, w: number, h: number) =>
    [(x + 0.5) / w, (y + 0.5) / h] as const;

describe('createHeightmapField texture', () => {
    it('uploads normalized f32 with nearest filtering and no mipmaps', () => {
        const field = makeField([
            [0, 65535],
            [32768, 12345],
        ]);
        expect(field.texture.format).toBe(RedFormat);
        expect(field.texture.type).toBe(FloatType);
        expect(field.texture.minFilter).toBe(NearestFilter);
        expect(field.texture.magFilter).toBe(NearestFilter);
        expect(field.texture.generateMipmaps).toBe(false);
        // The store is f32, so compare against f32-rounded expectations.
        expect(Array.from(field.normalized)).toEqual(
            [0, 65535 / 65535, 32768 / 65535, 12345 / 65535].map(Math.fround)
        );
    });

    it('flipY reverses row order for both GPU upload and CPU sampling', () => {
        const field = makeField(
            [
                [100, 200],
                [300, 400],
            ],
            { flipY: true }
        );
        // Row 0 of the store is now the bottom source row.
        expect(field.normalized[0]).toBeCloseTo(300 / 65535, 10);
        expect(field.sampleNormalizedCpu(...texelCenter(0, 0, 2, 2))).toBeCloseTo(300 / 65535, 10);
    });

    it('rejects mismatched dimensions', () => {
        expect(() =>
            createHeightmapField({
                data: new Uint16Array(3),
                width: 2,
                height: 2,
                minMeters: 0,
                maxMeters: 1,
            })
        ).toThrow(/does not match/);
    });
});

describe('catmullRomWeights', () => {
    it('partitions unity for arbitrary t', () => {
        for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.999]) {
            const w = catmullRomWeights(t);
            expect(w[0] + w[1] + w[2] + w[3]).toBeCloseTo(1, 12);
        }
    });

    it('interpolates: t=0 selects the second control point exactly', () => {
        expect(catmullRomWeights(0)).toEqual([0, 1, 0, 0]);
    });
});

describe('CPU bilinear sampler', () => {
    const field = makeField([
        [0, 1000, 2000],
        [3000, 4000, 5000],
        [6000, 7000, 8000],
    ]);

    it('returns exact values at texel centers', () => {
        for (let y = 0; y < 3; y += 1) {
            for (let x = 0; x < 3; x += 1) {
                const [u, v] = texelCenter(x, y, 3, 3);
                // f32 storage bounds precision to ~7 significant digits.
                expect(field.sampleNormalizedCpu(u, v)).toBeCloseTo((y * 3000 + x * 1000) / 65535, 6);
            }
        }
    });

    it('averages midway between horizontal neighbors', () => {
        const v = texelCenter(0, 0, 3, 3)[1];
        const uMid = (0.5 / 3 + 1.5 / 3) / 2;
        expect(field.sampleNormalizedCpu(uMid, v)).toBeCloseTo(500 / 65535, 10);
    });

    it('clamps outside the texture instead of wrapping', () => {
        expect(field.sampleNormalizedCpu(-1, -1)).toBeCloseTo(0, 10);
        expect(field.sampleNormalizedCpu(2, 2)).toBeCloseTo(8000 / 65535, 10);
    });
});

describe('CPU bicubic sampler', () => {
    const ramp = makeField([
        [0, 1000, 2000, 3000],
        [0, 1000, 2000, 3000],
        [0, 1000, 2000, 3000],
        [0, 1000, 2000, 3000],
    ]);

    it('passes through texel-center values (interpolating spline)', () => {
        for (let x = 0; x < 4; x += 1) {
            const [u, v] = texelCenter(x, 1, 4, 4);
            expect(ramp.sampleNormalizedBicubicCpu(u, v)).toBeCloseTo((x * 1000) / 65535, 8);
        }
    });

    it('reproduces linear ramps exactly away from clamped edges', () => {
        // On a 4-wide texture the full 4-tap footprint is interior only for
        // sx in [1, 2) — clamped edge taps legitimately bend the spline.
        for (const u of [0.4, 0.45, 0.55, 0.6]) {
            expect(ramp.sampleNormalizedBicubicCpu(u, 0.5)).toBeCloseTo(
                ramp.sampleNormalizedCpu(u, 0.5),
                6
            );
        }
    });
});

describe('meters conversion', () => {
    it('maps normalized range onto [minMeters, maxMeters]', () => {
        const field = makeField(
            [
                [0, 65535],
                [0, 65535],
            ],
            { minMeters: -186, maxMeters: 1503 }
        );
        expect(field.sampleMetersCpu(...texelCenter(0, 0, 2, 2))).toBeCloseTo(-186, 6);
        expect(field.sampleMetersCpu(...texelCenter(1, 0, 2, 2))).toBeCloseTo(1503, 6);
        expect(field.rangeMeters).toBe(1689);
    });
});
