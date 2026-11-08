import { expect, it } from 'vitest';
import { vec3, type Vec3 } from 'math';
import { cubeSphereDatum } from './precision';
import { CUBE_FACES } from '../quadtree/topology/cubeSphereFaces';

it('reuses datum outputs without mutating shared cube-face bases', () => {
    const before = structuredClone(CUBE_FACES);
    const output: Vec3 = [0, 0, 0];
    for (let face = 0; face < 6; face++) {
        for (const u of [0, 0.125, 0.5, 0.9, 1]) {
            for (const v of [0, 0.125, 0.5, 0.9, 1]) {
                const basis = CUBE_FACES[face]!;
                const expected: Vec3 = [0, 0, 0];
                vec3.set(expected, ...basis.forward);
                vec3.scaleAndAdd(expected, expected, [...basis.right], u * 2 - 1);
                vec3.scaleAndAdd(expected, expected, [...basis.up], v * 2 - 1);
                vec3.normalize(expected, expected);
                vec3.scale(expected, expected, 6371007.1809);
                expect(cubeSphereDatum(output, face, u, v, 6371007.1809)).toBe(output);
                expect(output).toEqual(expected);
            }
        }
    }
    expect(CUBE_FACES).toEqual(before);
});
