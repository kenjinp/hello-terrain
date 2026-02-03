export interface Identifiable {
  readonly id: string;
}

export function dag<T extends Identifiable>() {
  // id-keyed adjacency (outgoing) and reverse adjacency (incoming)
  const adjById = new Map<string, Set<string>>();
  const incomingById = new Map<string, Set<string>>();
  // Optional metadata for convenience wrapper APIs.
  const nodeById = new Map<string, T>();
  let hash = 0;

  function nodeHash(id: string | number): number {
    const str = String(id);
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = (Math.imul(h, 31) + str.charCodeAt(i)) | 0;
    }
    return h;
  }

  function edgeHash(fromId: string | number, toId: string | number): number {
    return (Math.imul(nodeHash(fromId), 0x9e3779b9) ^ nodeHash(toId)) | 0;
  }

  function addNodeId(id: string): void {
    if (!adjById.has(id)) adjById.set(id, new Set());
    if (!incomingById.has(id)) incomingById.set(id, new Set());
  }

  function addNode(node: T): void {
    nodeById.set(node.id, node);
    addNodeId(node.id);
  }

  function addEdgeId(fromId: string, toId: string, fromNode?: T, toNode?: T): void {
    if (fromNode) nodeById.set(fromId, fromNode);
    if (toNode) nodeById.set(toId, toNode);
    addNodeId(fromId);
    addNodeId(toId);

    const out = adjById.get(fromId)!;
    if (!out.has(toId)) {
      out.add(toId);
      incomingById.get(toId)!.add(fromId);
      hash ^= edgeHash(fromId, toId);
    }
  }

  function addEdge(from: T, to: T): void {
    addEdgeId(from.id, to.id, from, to);
  }

  function removeEdgeId(fromId: string, toId: string): void {
    const out = adjById.get(fromId);
    if (!out) return;
    if (out.delete(toId)) {
      incomingById.get(toId)?.delete(fromId);
      hash ^= edgeHash(fromId, toId);
    }
  }

  function removeNodeId(id: string): void {
    // Remove outgoing edges
    const out = adjById.get(id);
    if (out) {
      for (const toId of out) removeEdgeId(id, toId);
    }
    // Remove incoming edges
    const inc = incomingById.get(id);
    if (inc) {
      for (const fromId of inc) removeEdgeId(fromId, id);
    }
    adjById.delete(id);
    incomingById.delete(id);
    nodeById.delete(id);
  }

  function getHash(): number {
    return hash;
  }

  function getAdjacenciesId(id: string): Set<string> | undefined {
    return adjById.get(id);
  }

  function getIncomingIds(id: string): Set<string> | undefined {
    return incomingById.get(id);
  }

  function getAdjacencies(node: T): Set<T> | undefined {
    const ids = adjById.get(node.id);
    if (!ids) return undefined;
    // Wrapper: materialize nodes if we have them (fallback to `{id}`).
    const out = new Set<T>();
    for (const id of ids) out.add((nodeById.get(id) ?? ({ id } as T)) as T);
    return out;
  }

  function adjacenciesEquals(nodeA: T, nodeB: T): boolean {
    const a = adjById.get(nodeA.id);
    const b = adjById.get(nodeB.id);
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.size !== b.size) return false;
    for (const neighborId of a) if (!b.has(neighborId)) return false;
    return true;
  }

  function topologicalSortIds(): string[] {
    const stateMap = new Map<string, "exploring" | "processed">();
    const sorted: string[] = [];
    const path: string[] = [];

    function visit(id: string): void {
      stateMap.set(id, "exploring");
      path.push(id);

      for (const neighborId of adjById.get(id) ?? []) {
        const neighborState = stateMap.get(neighborId);
        if (neighborState === "exploring") {
          const cycleStart = path.indexOf(neighborId);
          const cycle = path.slice(cycleStart);
          cycle.push(neighborId);
          throw new Error(`Cycle detected: ${cycle.join(" -> ")}`);
        }

        if (!neighborState) visit(neighborId);
      }

      stateMap.set(id, "processed");
      path.pop();
      sorted.push(id);
    }

    for (const id of adjById.keys()) {
      if (!stateMap.has(id)) visit(id);
    }

    return sorted.reverse();
  }

  function topologicalSort(): T[] {
    const ids = topologicalSortIds();
    return ids.map((id) => (nodeById.get(id) ?? ({ id } as T)) as T);
  }

  return {
    topologicalSort,
    topologicalSortIds,
    addNode,
    addNodeId,
    addEdge,
    addEdgeId,
    removeEdgeId,
    removeNodeId,
    getHash,
    getAdjacencies,
    getAdjacenciesId,
    getIncomingIds,
    adjacenciesEquals,
  };
}
