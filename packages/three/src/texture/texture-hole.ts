import { bool, int, ivec2, select, vec2 } from "three/tsl";
import type { Node } from "three/webgpu";
import { loadTileField, type TileFieldStorage } from "../gpu/tileFieldStorage";

export type TerrainHoleMode = "discard" | "collapse" | "none";

/** Collapse removes a whole grid triangle if any of its three vertices is a hole. */
export function textureHoleNode(field: TileFieldStorage, grid: Node, tile: Node, mode: TerrainHoleMode): Node {
  if (mode === "none") return bool(false);
  const edge = field.edgeVertexCount;
  const point = grid.clamp(0, edge - 1);
  const load = (x: Node, y: Node) => loadTileField(field, x, y, tile).r.bitAnd(4).notEqual(0);
  if (mode === "discard") {
    const nearest = ivec2(point.round());
    return load(nearest.x, nearest.y);
  }
  const cell = ivec2(point.floor().min(edge - 2));
  const fraction = point.sub(vec2(cell));
  const a = load(cell.x, cell.y), b = load(cell.x.add(1), cell.y);
  const c = load(cell.x, cell.y.add(1)), d = load(cell.x.add(1), cell.y.add(1));
  const skirt = cell.x.equal(0).or(cell.y.equal(0)).or(cell.x.equal(edge - 2)).or(cell.y.equal(edge - 2));
  const mid = int(Math.floor((edge - 1) / 2));
  const diagonalAD = select(skirt, cell.x.lessThan(mid).equal(cell.y.lessThan(mid)), cell.x.add(cell.y).mod(2).equal(0));
  return select(diagonalAD,
    a.or(d).or(select(fraction.y.lessThanEqual(fraction.x), b, c)),
    b.or(c).or(select(fraction.x.add(fraction.y).lessThanEqual(1), a, d)));
}

/** CPU counterpart of textureHoleNode, including TerrainGeometry's alternating diagonals. */
export function isTextureHole(
  controls: Uint32Array,
  tileOffset: number,
  edge: number,
  gx: number,
  gy: number,
  mode: TerrainHoleMode,
): boolean {
  if (mode === "none") return false;
  gx = Math.max(0, Math.min(edge - 1, gx)); gy = Math.max(0, Math.min(edge - 1, gy));
  const hole = (x: number, y: number) => (controls[tileOffset + y * edge + x]! & 4) !== 0;
  if (mode === "discard") return hole(Math.round(gx), Math.round(gy));
  const x = Math.min(edge - 2, Math.floor(gx)), y = Math.min(edge - 2, Math.floor(gy));
  const fx = gx - x, fy = gy - y;
  const skirt = x === 0 || y === 0 || x === edge - 2 || y === edge - 2;
  const mid = Math.floor((edge - 1) / 2);
  const diagonalAD = skirt ? (x < mid) === (y < mid) : (x + y) % 2 === 0;
  return diagonalAD
    ? hole(x, y) || hole(x + 1, y + 1) || (fy <= fx ? hole(x + 1, y) : hole(x, y + 1))
    : hole(x + 1, y) || hole(x, y + 1) || (fx + fy <= 1 ? hole(x, y) : hole(x + 1, y + 1));
}
