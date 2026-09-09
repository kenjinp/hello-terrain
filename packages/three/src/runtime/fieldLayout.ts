/** Shared scalar layout contract; importing CPU sampling never loads TSL. */
export const TILE_BOUNDS_FLOATS_PER_TILE = 4;
export const TILE_BOUNDS_LOD_MIN_OFFSET = 0;
export const TILE_BOUNDS_LOD_MAX_OFFSET = 1;
export const TILE_BOUNDS_PACK_MIN_OFFSET = 2;
export const TILE_BOUNDS_PACK_MAX_OFFSET = 3;
export const TERRAIN_FIELD_PACK_EPSILON = 1e-4;
export const FIELD_INNER_TEXEL_OFFSET = 1.5;
export const FIELD_EDGE_EXTRA_TEXELS = 3;

export function tileLocalToFieldUVNumber(localCoord: number, innerSegments: number): number {
    return (
        (localCoord * innerSegments + FIELD_INNER_TEXEL_OFFSET) /
        (innerSegments + FIELD_EDGE_EXTRA_TEXELS)
    );
}
