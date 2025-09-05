import { BufferAttribute, BufferGeometry } from "three";

/**
 * Custom geometry for terrain tiles with properly handled skirts.
 * This geometry ensures that corner triangles are subdivided correctly.
 */
export class TerrainGeometry extends BufferGeometry {
  constructor(innerSegments: number) {
    super();

    // Validate innerSegments parameter
    if (
      innerSegments < 1 ||
      !Number.isFinite(innerSegments) ||
      !Number.isInteger(innerSegments)
    ) {
      throw new Error(
        `Invalid innerSegments: ${innerSegments}. Must be a positive integer.`
      );
    }

    try {
      this.setIndex(this.generateIndices(innerSegments));
      this.setAttribute(
        "position",
        new BufferAttribute(
          new Float32Array(this.generatePositions(innerSegments)),
          3
        )
      );
      this.setAttribute(
        "normal",
        new BufferAttribute(
          new Float32Array(this.generateNormals(innerSegments)),
          3
        )
      );
      this.setAttribute(
        "uv",
        new BufferAttribute(
          new Float32Array(this.generateUvs(innerSegments)),
          2
        )
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
  private generateIndices(innerSegments: number): number[] {
    // We construct a grid with an extra duplicated ring around the interior
    // (innerSegments + 1) grid to form the skirt. This produces a (innerSegments + 3)
    // by (innerSegments + 3) vertex grid. The outer ring shares the same x/z as
    // the border vertices so it can be displaced downward to form the skirt.
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

        // Flip diagonal by quadrant around the midpoint so skirts pull cleanly at all corners.
        // Default uses diagonal (b-c). Alternate uses diagonal (a-d).
        const leftHalf = x < mid;
        const topHalf = y < mid;
        const useDefaultDiagonal =
          (leftHalf && topHalf) || (!leftHalf && !topHalf);

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
   * Generate UV coordinates for the terrain with skirts.
   * UVs are normalized to [0, 1] range.
   */
  private generateUvs(innerSegments: number): number[] {
    const edgeVertexCountWithSkirt = innerSegments + 1 + 2;

    const uvs: number[] = [];

    for (let iy = 0; iy < edgeVertexCountWithSkirt; iy++) {
      const v = Math.min(Math.max((iy - 1) / innerSegments, 0), 1);
      for (let ix = 0; ix < edgeVertexCountWithSkirt; ix++) {
        const u = Math.min(Math.max((ix - 1) / innerSegments, 0), 1);
        uvs.push(u, v);
      }
    }

    return uvs;
  }

  /**
   * Generate vertex normals.
   * - Inner vertices: up (0, 1, 0)
   * - Skirt ring vertices (outermost edge): down (0, -1, 0)
   */
  private generateNormals(innerSegments: number): number[] {
    const edgeVertexCountWithSkirt = innerSegments + 1 + 2;
    const last = edgeVertexCountWithSkirt - 1;
    const normals: number[] = [];

    for (let iy = 0; iy < edgeVertexCountWithSkirt; iy++) {
      const onEdgeY = iy === 0 || iy === last;
      for (let ix = 0; ix < edgeVertexCountWithSkirt; ix++) {
        const onEdgeX = ix === 0 || ix === last;
        const isSkirt = onEdgeX || onEdgeY;
        if (isSkirt) {
          normals.push(0, -1, 0);
        } else {
          normals.push(0, 1, 0);
        }
      }
    }

    return normals;
  }
}
