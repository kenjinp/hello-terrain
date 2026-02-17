import { BufferAttribute, BufferGeometry } from "three";

/**
 * Custom geometry for terrain tiles with properly handled skirts.
 * This geometry ensures that corner triangles are subdivided correctly.
 */
export class TerrainGeometry extends BufferGeometry {
  constructor(innerSegments: number = 14, extendUV = false) {
    super();

    // Validate innerSegments parameter
    if (
      innerSegments < 1 ||
      !Number.isFinite(innerSegments) ||
      !Number.isInteger(innerSegments)
    ) {
      throw new Error(
        `Invalid innerSegments: ${innerSegments}. Must be a positive integer.`,
      );
    }

    try {
      this.setIndex(this.generateIndices(innerSegments));
      this.setAttribute(
        "position",
        new BufferAttribute(
          new Float32Array(this.generatePositions(innerSegments)),
          3,
        ),
      );
      this.setAttribute(
        "normal",
        new BufferAttribute(
          new Float32Array(this.generateNormals(innerSegments)),
          3,
        ),
      );
      this.setAttribute(
        "uv",
        new BufferAttribute(
          new Float32Array(
            extendUV
              ? this.generateUvsExtended(innerSegments)
              : this.generateUvsOnlyInner(innerSegments),
          ),
          2,
        ),
      );
    } catch (error) {
      console.error("Error creating TerrainGeometry:", error);
      throw error;
    }
  }

  /**
   * Generate indices for terrain geometry with proper skirt corner handling.
   * The key improvement is in how corner triangles are subdivided.
   */
  /**
   * Generate indices for terrain geometry with proper skirt corner handling.
   *
   * The mesh layout is a regular grid (with duplicated outermost ring for skirt):
   *
   * SKIRT RING (rotational symmetry for proper corners):
   *  o---o---o---o---o
   *  | \ | / | \ | / |
   *  o---o---o---o---o
   *  | / |       | \ |
   *  o---o       o---o
   *  | \ |       | / |
   *  o---o---o---o---o
   *  | / | \ | / | \ |
   *  o---o---o---o---o
   *
   * INNER GRID (alternating diagonals — checkerboard pattern):
   *        o---o---o---o---o
   *        | \ | / | \ | / |
   *        o---o---o---o---o
   *        | / | \ | / | \ |
   *        o---o---o---o---o
   *        | \ | / | \ | / |
   *        o---o---o---o---o
   *
   * Where o = vertex
   * Each square cell is split into 2 triangles.
   * - Skirt cells (outer ring): diagonal flip based on quadrant for corner correctness
   * - Inner cells: alternating diagonal via (x+y)%2 to reduce interpolation artifacts
   *
   * Vertex layout (for innerSegments = 2):
   *
   *    0----1----2----3----4
   *    |    |    |    |    |
   *    5----6----7----8----9
   *    |    |    |    |    |
   *   10---11---12---13---14
   *    |    |    |    |    |
   *   15---16---17---18---19
   *    |    |    |    |    |
   *   20---21---22---23---24
   *
   * For each cell:
   *   a = top-left,
   *   b = top-right,
   *   c = bottom-left,
   *   d = bottom-right (all as flat array indices)
   *
   * Diagonal a-d:
   *   triangle 1: a, d, b
   *   triangle 2: a, c, d
   * Diagonal b-c:
   *   triangle 1: a, c, b
   *   triangle 2: b, c, d
   */
  private generateIndices(innerSegments: number): number[] {
    // grid: (innerSegments + 3) x (innerSegments + 3)
    const innerEdgeVertexCount = innerSegments + 1;
    const edgeVertexCountWithSkirt = innerEdgeVertexCount + 2;

    const indices: number[] = [];
    const cellsPerEdge = edgeVertexCountWithSkirt - 1;
    const mid = Math.floor(cellsPerEdge / 2);

    for (let y = 0; y < cellsPerEdge; y++) {
      for (let x = 0; x < cellsPerEdge; x++) {
        const a = y * edgeVertexCountWithSkirt + x;
        const b = a + 1;
        const c = a + edgeVertexCountWithSkirt;
        const d = c + 1;

        // Check if this cell is on the skirt (outer ring)
        const isSkirtCell =
          x === 0 ||
          x === cellsPerEdge - 1 ||
          y === 0 ||
          y === cellsPerEdge - 1;

        let useDefaultDiagonal: boolean;

        if (isSkirtCell) {
          // For skirt cells, use quadrant-based flip for proper corner handling
          const leftHalf = x < mid;
          const topHalf = y < mid;
          useDefaultDiagonal = (leftHalf && topHalf) || (!leftHalf && !topHalf);
        } else {
          // For inner cells, alternate diagonals in a checkerboard pattern
          // to distribute interpolation artifacts evenly and prevent visible
          // criss-cross grid patterns in the lighting/normals.
          useDefaultDiagonal = (x + y) % 2 === 0;
        }

        if (useDefaultDiagonal) {
          // diagonal a-d
          indices.push(a, d, b);
          indices.push(a, c, d);
        } else {
          // diagonal b-c
          indices.push(a, c, b);
          indices.push(b, c, d);
        }
      }
    }
    return indices;
  }

  /**
   * Generate vertex positions for the terrain with skirts.
   * Positions are normalized to [-0.5, 0.5] range.
   */
  private generatePositions(innerSegments: number): number[] {
    const edgeVertexCountWithSkirt = innerSegments + 1 + 2;

    const positions: number[] = [];

    for (let iy = 0; iy < edgeVertexCountWithSkirt; iy++) {
      // Map to [0, 1] across the interior ring, clamp for the outer skirt ring
      const v = Math.min(Math.max((iy - 1) / innerSegments, 0), 1);
      const z = v - 0.5;

      for (let ix = 0; ix < edgeVertexCountWithSkirt; ix++) {
        const u = Math.min(Math.max((ix - 1) / innerSegments, 0), 1);
        const x = u - 0.5;

        positions.push(x, 0, z);
      }
    }

    return positions;
  }

  /**
   * Generate UV coordinates for the inner grid only (skirt duplicates clamped to border).
   * UVs are normalized to [0, 1] range with flipped V.
   */
  private generateUvsOnlyInner(innerSegments: number): number[] {
    const edgeVertexCountWithSkirt = innerSegments + 1 + 2;

    const uvs: number[] = [];

    for (let iy = 0; iy < edgeVertexCountWithSkirt; iy++) {
      const v = Math.min(Math.max((iy - 1) / innerSegments, 0), 1);
      for (let ix = 0; ix < edgeVertexCountWithSkirt; ix++) {
        const u = Math.min(Math.max((ix - 1) / innerSegments, 0), 1);
        uvs.push(u, 1 - v);
      }
    }

    return uvs;
  }

  /**
   * Generate UVs that extend 1 extra unit outward to the skirt ring.
   * Map the entire geometry (including skirts) into [0,1] so side faces
   * receive proper UVs without relying on texture wrapping. V is flipped.
   */
  private generateUvsExtended(innerSegments: number): number[] {
    const edgeVertexCountWithSkirt = innerSegments + 1 + 2;

    const uvs: number[] = [];
    const denom = edgeVertexCountWithSkirt - 1;

    for (let iy = 0; iy < edgeVertexCountWithSkirt; iy++) {
      const v = iy / denom; // [0,1]
      for (let ix = 0; ix < edgeVertexCountWithSkirt; ix++) {
        const u = ix / denom; // [0,1]
        uvs.push(u, 1 - v);
      }
    }

    return uvs;
  }

  /**
   * Generate vertex normals.
   */
  private generateNormals(innerSegments: number): number[] {
    const edgeVertexCountWithSkirt = innerSegments + 1 + 2;
    const last = edgeVertexCountWithSkirt - 1;
    const normals: number[] = [];

    for (let iy = 0; iy < edgeVertexCountWithSkirt; iy++) {
      for (let ix = 0; ix < edgeVertexCountWithSkirt; ix++) {
        const onEdgeX = ix === 0 || ix === last;
        const onEdgeY = iy === 0 || iy === last;

        if (onEdgeX || onEdgeY) {
          let nx = 0;
          let nz = 0;

          if (ix === 0) nx -= 1; // left edge
          if (ix === last) nx += 1; // right edge
          if (iy === 0) nz -= 1; // back edge (-Z)
          if (iy === last) nz += 1; // forward edge (+Z)

          const len = Math.hypot(nx, nz);
          if (len > 0) {
            normals.push(nx / len, 0, nz / len);
          } else {
            normals.push(0, 1, 0);
          }
        } else {
          normals.push(0, 1, 0);
        }
      }
    }

    return normals;
  }
}
