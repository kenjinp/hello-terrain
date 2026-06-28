import { describe, expect, it } from "vitest";
import { TerrainGeometry } from "../src/index.js";

function idx(edgeVertexCountWithSkirt: number, ix: number, iy: number) {
  return iy * edgeVertexCountWithSkirt + ix;
}

function posAt(
  g: TerrainGeometry,
  edgeVertexCountWithSkirt: number,
  ix: number,
  iy: number
) {
  const pos = g.getAttribute("position");
  const i = idx(edgeVertexCountWithSkirt, ix, iy);
  return [pos.getX(i), pos.getY(i), pos.getZ(i)] as const;
}

function normAt(
  g: TerrainGeometry,
  edgeVertexCountWithSkirt: number,
  ix: number,
  iy: number
) {
  const n = g.getAttribute("normal");
  const i = idx(edgeVertexCountWithSkirt, ix, iy);
  return [n.getX(i), n.getY(i), n.getZ(i)] as const;
}

function uvAt(
  g: TerrainGeometry,
  edgeVertexCountWithSkirt: number,
  ix: number,
  iy: number
) {
  const uv = g.getAttribute("uv");
  const i = idx(edgeVertexCountWithSkirt, ix, iy);
  return [uv.getX(i), uv.getY(i)] as const;
}

describe("TerrainGeometry", () => {
  it("throws on invalid innerSegments", () => {
    expect(() => new TerrainGeometry(0)).toThrow(/Invalid innerSegments/);
    expect(() => new TerrainGeometry(-1)).toThrow(/Invalid innerSegments/);
    expect(() => new TerrainGeometry(Number.NaN)).toThrow(
      /Invalid innerSegments/
    );
    expect(() => new TerrainGeometry(Number.POSITIVE_INFINITY)).toThrow(
      /Invalid innerSegments/
    );
    expect(() => new TerrainGeometry(1.5)).toThrow(/Invalid innerSegments/);
  });

  it("creates expected attributes and index sizing invariants", () => {
    for (const innerSegments of [1, 2, 8]) {
      const g = new TerrainGeometry(innerSegments);
      const edgeVertexCountWithSkirt = innerSegments + 3;
      const vertexCount = edgeVertexCountWithSkirt * edgeVertexCountWithSkirt;
      const cellsPerEdge = edgeVertexCountWithSkirt - 1;

      const pos = g.getAttribute("position");
      const nrm = g.getAttribute("normal");
      const uv = g.getAttribute("uv");
      const index = g.getIndex();

      expect(pos.itemSize).toBe(3);
      expect(nrm.itemSize).toBe(3);
      expect(uv.itemSize).toBe(2);
      expect(pos.count).toBe(vertexCount);
      expect(nrm.count).toBe(vertexCount);
      expect(uv.count).toBe(vertexCount);

      expect(pos.array).toBeInstanceOf(Float32Array);
      expect(nrm.array).toBeInstanceOf(Float32Array);
      expect(uv.array).toBeInstanceOf(Float32Array);

      expect(index).not.toBeNull();
      expect(index!.count).toBe(cellsPerEdge * cellsPerEdge * 6);

      // Indices must reference only existing vertices
      const idxArr = Array.from(index!.array as unknown as ArrayLike<number>);
      const maxIdx = Math.max(...idxArr);
      const minIdx = Math.min(...idxArr);
      expect(minIdx).toBeGreaterThanOrEqual(0);
      expect(maxIdx).toBeLessThan(vertexCount);
    }
  });

  it("can omit generated normals for shader-driven terrain meshes", () => {
    const g = new TerrainGeometry(8, true, false, { includeNormals: false });

    expect(g.getAttribute("position")).toBeDefined();
    expect(g.getAttribute("uv")).toBeDefined();
    expect(g.getAttribute("normal")).toBeUndefined();
    expect(g.getIndex()).not.toBeNull();
  });

  it("positions are clamped to [-0.5,0.5] and skirt duplicates edge ring", () => {
    const innerSegments = 2;
    const edgeVertexCountWithSkirt = innerSegments + 3;
    const g = new TerrainGeometry(innerSegments);

    const pos = g.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      expect(pos.getX(i)).toBeGreaterThanOrEqual(-0.5);
      expect(pos.getX(i)).toBeLessThanOrEqual(0.5);
      expect(pos.getZ(i)).toBeGreaterThanOrEqual(-0.5);
      expect(pos.getZ(i)).toBeLessThanOrEqual(0.5);
      expect(pos.getY(i)).toBe(0);
    }

    // Left skirt column duplicates first inner column in X/Z (same for right/top/bottom)
    expect(posAt(g, edgeVertexCountWithSkirt, 0, 2)).toEqual(
      posAt(g, edgeVertexCountWithSkirt, 1, 2)
    );
    expect(posAt(g, edgeVertexCountWithSkirt, 4, 2)).toEqual(
      posAt(g, edgeVertexCountWithSkirt, 3, 2)
    );
    expect(posAt(g, edgeVertexCountWithSkirt, 2, 0)).toEqual(
      posAt(g, edgeVertexCountWithSkirt, 2, 1)
    );
    expect(posAt(g, edgeVertexCountWithSkirt, 2, 4)).toEqual(
      posAt(g, edgeVertexCountWithSkirt, 2, 3)
    );
  });

  it("normals are up in the interior, outward on edges, diagonal on corners", () => {
    const innerSegments = 2;
    const edgeVertexCountWithSkirt = innerSegments + 3;
    const last = edgeVertexCountWithSkirt - 1;
    const g = new TerrainGeometry(innerSegments);

    // Interior
    expect(normAt(g, edgeVertexCountWithSkirt, 2, 2)).toEqual([0, 1, 0]);

    // Edges (non-corner)
    expect(normAt(g, edgeVertexCountWithSkirt, 0, 2)).toEqual([-1, 0, 0]);
    expect(normAt(g, edgeVertexCountWithSkirt, last, 2)).toEqual([1, 0, 0]);
    expect(normAt(g, edgeVertexCountWithSkirt, 2, 0)).toEqual([0, 0, -1]);
    expect(normAt(g, edgeVertexCountWithSkirt, 2, last)).toEqual([0, 0, 1]);

    // Corners are normalized diagonals
    const invSqrt2 = 1 / Math.sqrt(2);
    const [nx, ny, nz] = normAt(g, edgeVertexCountWithSkirt, 0, 0);
    expect(ny).toBe(0);
    expect(nx).toBeCloseTo(-invSqrt2, 6);
    expect(nz).toBeCloseTo(-invSqrt2, 6);

    // Edge normals should be unit-length
    for (const [ix, iy] of [
      [0, 2],
      [last, 2],
      [2, 0],
      [2, last],
      [0, 0],
      [last, 0],
      [0, last],
      [last, last],
    ] as const) {
      const [x, y, z] = normAt(g, edgeVertexCountWithSkirt, ix, iy);
      const len = Math.hypot(x, y, z);
      expect(len).toBeCloseTo(1, 6);
    }
  });

  it("UVs differ for extendUV=true vs extendUV=false as expected", () => {
    const innerSegments = 2;
    const edgeVertexCountWithSkirt = innerSegments + 3;
    const last = edgeVertexCountWithSkirt - 1;

    const gExtended = new TerrainGeometry(innerSegments, true);
    const gInner = new TerrainGeometry(innerSegments, false);

    // Extended maps full grid to [0,1] with flipped V
    expect(uvAt(gExtended, edgeVertexCountWithSkirt, 0, 0)).toEqual([0, 1]);
    expect(uvAt(gExtended, edgeVertexCountWithSkirt, last, last)).toEqual([
      1, 0,
    ]);

    // Inner-only clamps skirt ring to border UVs:
    // ix=0 and ix=1 both clamp to u=0, ix=last and ix=last-1 both clamp to u=1
    expect(uvAt(gInner, edgeVertexCountWithSkirt, 0, 2)).toEqual(
      uvAt(gInner, edgeVertexCountWithSkirt, 1, 2)
    );
    expect(uvAt(gInner, edgeVertexCountWithSkirt, last, 2)).toEqual(
      uvAt(gInner, edgeVertexCountWithSkirt, last - 1, 2)
    );
  });

  it("matches exact index pattern for innerSegments=1 (diagonal flips per quadrant)", () => {
    const g = new TerrainGeometry(1);
    const index = g.getIndex();
    expect(index).not.toBeNull();

    // 4x4 vertices => 3x3 cells => 54 indices
    const actual = Array.from(index!.array as unknown as ArrayLike<number>);
    expect(actual).toHaveLength(54);

    // Precomputed from the algorithm description in TerrainGeometry.ts
    const expected = [
      // y=0
      0, 5, 1, 0, 4, 5, 1, 5, 2, 2, 5, 6, 2, 6, 3, 3, 6, 7,
      // y=1
      4, 8, 5, 5, 8, 9, 5, 10, 6, 5, 9, 10, 6, 11, 7, 6, 10, 11,
      // y=2
      8, 12, 9, 9, 12, 13, 9, 14, 10, 9, 13, 14, 10, 15, 11, 10, 14, 15,
    ];

    expect(actual).toEqual(expected);
  });
});
