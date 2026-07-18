import { describe, expect, it } from 'vitest';
import { U32_EMPTY } from './types.js';
import {
    createSpatialIndex,
    insertSpatialIndexRaw,
    lookupSpatialIndexRaw,
    resetSpatialIndex,
} from './spatialIndex.js';

describe('quadtree/spatialIndex', () => {
    it('inserts and looks up large u32 coordinates', () => {
        const idx = createSpatialIndex(16);
        resetSpatialIndex(idx);

        insertSpatialIndexRaw(idx, 0, 25, 50_000_000, 60_000_000, 123);
        insertSpatialIndexRaw(idx, 5, 30, 0xffffffff, 0xfffffffe, 999);

        expect(lookupSpatialIndexRaw(idx, 0, 25, 50_000_000, 60_000_000)).toBe(123);
        expect(lookupSpatialIndexRaw(idx, 5, 30, 0xffffffff, 0xfffffffe)).toBe(999);
        expect(lookupSpatialIndexRaw(idx, 0, 25, 1, 2)).toBe(U32_EMPTY);
    });

    it('handles collisions with linear probing', () => {
        const idx = createSpatialIndex(32);
        resetSpatialIndex(idx);

        for (let i = 0; i < 16; i++) {
            insertSpatialIndexRaw(idx, 0, 1, i, i * 3, i + 100);
        }

        for (let i = 0; i < 16; i++) {
            expect(lookupSpatialIndexRaw(idx, 0, 1, i, i * 3)).toBe(i + 100);
        }
    });

    it('throws when the table is over capacity', () => {
        const idx = createSpatialIndex(2); // size = 4
        resetSpatialIndex(idx);

        insertSpatialIndexRaw(idx, 0, 0, 0, 0, 1);
        insertSpatialIndexRaw(idx, 0, 0, 1, 0, 2);
        insertSpatialIndexRaw(idx, 0, 0, 2, 0, 3);
        insertSpatialIndexRaw(idx, 0, 0, 3, 0, 4);

        expect(() => insertSpatialIndexRaw(idx, 0, 0, 4, 0, 5)).toThrow(/full/i);
    });
});
