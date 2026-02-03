import { bench, group, run, summary } from "mitata";
import { graph, param, task } from "../src/index";

// Build graphs outside the bench bodies so the benches measure run-loop costs,
// not graph construction/allocation.

const cleanGraph = (() => {
  const g = graph();
  const p = param(1);
  const a = task((get, work) => {
    const pv = get(p);
    return work(() => pv + 1);
  });
  const b = task((get, work) => {
    const av = get(a);
    return work(() => av + 1);
  });
  g.add(a);
  g.add(b);
  return { g, p, a, b };
})();

const dirtyGraph = (() => {
  const g = graph();
  const p = param(1);
  const a = task((get, work) => {
    const pv = get(p);
    return work(() => pv + 1);
  });
  const b = task((get, work) => {
    const av = get(a);
    return work(() => av + 1);
  });
  g.add(a);
  g.add(b);
  return { g, p, a, b };
})();

const wideGraph = (() => {
  const g = graph();
  const p = param(1);
  const targets: any[] = [];
  for (let i = 0; i < 100; i++) {
    const t = task((get, work) => {
      const pv = get(p);
      return work(() => pv + i);
    });
    g.add(t);
    targets.push(t);
  }
  return { g, p, targets };
})();

const deepChainGraph = (() => {
  const g = graph();
  const p = param(1);
  let prev: any = task((get, work) => {
    const pv = get(p);
    return work(() => pv);
  });
  g.add(prev);
  for (let i = 0; i < 199; i++) {
    const next = task((get, work) => {
      const v = get(prev as any) as number;
      return work(() => v + 1);
    });
    g.add(next);
    prev = next;
  }
  return { g, p, tail: prev };
})();

// Warm once so deps are discovered/topo compiled.
await cleanGraph.g.run({ targets: [cleanGraph.b] });
await dirtyGraph.g.run({ targets: [dirtyGraph.b] });
await wideGraph.g.run({ targets: wideGraph.targets });
await deepChainGraph.g.run({ targets: [deepChainGraph.tail] });

summary(() => {
  group("graph.run() hot loop", () => {
    // ------------------------------------------------------------
    // All-clean: repeated runs should cache-hit
    // ------------------------------------------------------------
    bench("allClean (single target)", async () => {
      await cleanGraph.g.run({ targets: [cleanGraph.b] });
    });

    // ------------------------------------------------------------
    // Small dirty: flip one param, dirties downstream
    // ------------------------------------------------------------
    bench("smallDirty (param change each run)", async () => {
      dirtyGraph.p.set((x) => x + 1);
      await dirtyGraph.g.run({ targets: [dirtyGraph.b] });
    });

    // ------------------------------------------------------------
    // Wide graph: many independent tasks
    // ------------------------------------------------------------
    bench("wideGraph (100 independent tasks)", async () => {
      await wideGraph.g.run({ targets: wideGraph.targets });
    });

    // ------------------------------------------------------------
    // Deep chain: worst-case dependency depth
    // ------------------------------------------------------------
    bench("deepChain (length 200)", async () => {
      await deepChainGraph.g.run({ targets: [deepChainGraph.tail] });
    });
  });
});

await run();

