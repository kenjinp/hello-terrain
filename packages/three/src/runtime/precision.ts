import { vec3, type Vec3 } from 'math';
import { CUBE_FACES } from '../quadtree/topology/cubeSphereFaces';

/** CPU binary64 datum oracle; no rendering-origin or f32 intermediate. */
export function cubeSphereDatum(out: Vec3, face: number, u: number, v: number, radius: number) {
    const basis = CUBE_FACES[face];
    if (!basis) throw new Error('Invalid cube face');
    vec3.set(out, ...basis.forward);
    vec3.scaleAndAdd(out, out, [...basis.right], u * 2 - 1);
    vec3.scaleAndAdd(out, out, [...basis.up], v * 2 - 1);
    vec3.normalize(out, out);
    return vec3.scale(out, out, radius);
}

/** Subtraction happens in binary64 before the renderer receives small offsets. */
export function datumOffset(out: Vec3, datum: Vec3, anchor: Vec3) {
    return vec3.subtract(out, datum, anchor);
}
