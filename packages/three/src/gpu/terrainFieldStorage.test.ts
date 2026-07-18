import { describe, expect, it } from 'vitest';

/** CPU mirror of pack/denormalize helpers for unit tests. */
function packNormalizedNumber(
    height: number,
    packMin: number,
    packMax: number,
    epsilon = 1e-4
): number {
    const span = Math.max(packMax - packMin, epsilon);
    return (height - packMin) / span;
}

function denormalizeNumber(
    normalized: number,
    packMin: number,
    packMax: number,
    epsilon = 1e-4
): number {
    const span = Math.max(packMax - packMin, epsilon);
    return packMin + normalized * span;
}

describe('terrain field pack/denormalize', () => {
    it('preserves elevation through normalize and denormalize', () => {
        const packMin = 1200;
        const packMax = 4200;
        for (const height of [1200, 2500.5, 4199.25]) {
            const normalized = packNormalizedNumber(height, packMin, packMax);
            expect(normalized).toBeGreaterThanOrEqual(0);
            expect(normalized).toBeLessThanOrEqual(1);
            expect(denormalizeNumber(normalized, packMin, packMax)).toBeCloseTo(height, 3);
        }
    });

    it('handles flat tiles with epsilon span', () => {
        const height = 500;
        const normalized = packNormalizedNumber(height, height, height);
        expect(normalized).toBe(0);
        expect(denormalizeNumber(normalized, height, height)).toBeCloseTo(height, 4);
    });
});
