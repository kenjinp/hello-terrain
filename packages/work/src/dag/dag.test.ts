import { describe, expect, it } from "vitest";
import { dag } from "./dag";

type N = { id: string };
const n = (id: string): N => ({ id });

describe("dag()", () => {
  it("addNode() materializes an empty adjacency set", () => {
    const d = dag<N>();
    const a = n("a");

    expect(d.getAdjacencies(a)).toBeUndefined();

    d.addNode(a);
    const adj = d.getAdjacencies(a);
    expect(adj).toBeInstanceOf(Set);
    expect([...adj!]).toEqual([]);
  });

  it("is id-keyed (node identity is not required)", () => {
    const d = dag<N>();
    d.addEdge(n("a"), n("b"));

    // Querying with fresh objects of the same id should work.
    expect([...d.getAdjacencies(n("a"))!].map((x) => x.id)).toEqual(["b"]);
    expect([...d.getAdjacencies(n("b"))!].map((x) => x.id)).toEqual([]);
  });

  it("addEdge() adds both endpoints and only hashes unique edges", () => {
    const d = dag<N>();
    const a = n("a");
    const b = n("b");

    expect(d.getHash()).toBe(0);

    d.addEdge(a, b);
    expect([...d.getAdjacencies(a)!].map((x) => x.id)).toEqual(["b"]);
    expect([...d.getAdjacencies(b)!].map((x) => x.id)).toEqual([]);
    const h1 = d.getHash();

    // Re-adding the same edge should not change adjacency or hash.
    d.addEdge(a, b);
    expect([...d.getAdjacencies(a)!].map((x) => x.id)).toEqual(["b"]);
    expect(d.getHash()).toBe(h1);
  });

  it("removeEdgeId() removes edges and updates hash", () => {
    const d = dag<N>();
    d.addEdge(n("a"), n("b"));
    d.removeEdgeId("a", "b");
    expect(d.getHash()).toBe(0);
    expect([...d.getAdjacencies(n("a"))!].map((x) => x.id)).toEqual([]);
  });

  it("getHash() is independent of insertion order for the same edge set", () => {
    const a = n("a");
    const b = n("b");
    const c = n("c");

    const d1 = dag<N>();
    d1.addEdge(a, b);
    d1.addEdge(a, c);
    d1.addEdge(b, c);

    const d2 = dag<N>();
    d2.addEdge(b, c);
    d2.addEdge(a, c);
    d2.addEdge(a, b);

    expect(d1.getHash()).toBe(d2.getHash());
  });

  it("topologicalSort() orders prerequisites before dependents", () => {
    const d = dag<N>();
    const a = n("a");
    const b = n("b");
    const c = n("c");

    d.addEdge(a, b);
    d.addEdge(b, c);

    expect(d.topologicalSort().map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("topologicalSort() handles diamonds (partial-order constraints)", () => {
    const d = dag<N>();
    const a = n("a");
    const b = n("b");
    const c = n("c");
    const dNode = n("d");

    d.addEdge(a, b);
    d.addEdge(a, c);
    d.addEdge(b, dNode);
    d.addEdge(c, dNode);

    const out = d.topologicalSort().map((x) => x.id);
    const idx = (id: string) => out.indexOf(id);

    expect(new Set(out)).toEqual(new Set(["a", "b", "c", "d"]));
    expect(idx("a")).toBeLessThan(idx("b"));
    expect(idx("a")).toBeLessThan(idx("c"));
    expect(idx("b")).toBeLessThan(idx("d"));
    expect(idx("c")).toBeLessThan(idx("d"));
  });

  it("topologicalSort() throws with a readable cycle path", () => {
    const d = dag<N>();
    const a = n("a");
    const b = n("b");
    const c = n("c");

    d.addEdge(a, b);
    d.addEdge(b, c);
    d.addEdge(c, a);

    expect(() => d.topologicalSort()).toThrowError("Cycle detected: a -> b -> c -> a");
  });

  it("adjacenciesEquals() returns true when two nodes have identical adjacency sets", () => {
    const d = dag<N>();
    const a = n("a");
    const b = n("b");
    const c = n("c");
    const dNode = n("d");

    d.addEdge(a, c);
    d.addEdge(b, c);

    expect(d.adjacenciesEquals(a, b)).toBe(true);

    d.addEdge(b, dNode);
    expect(d.adjacenciesEquals(a, b)).toBe(false);
  });
});
