"use client";

import { ExamplesCanvas, useExamplesCanvas } from "@/components/ExamplesCanvas";
import { RunTimingBars } from "@/components/RunTimingBars";
import { graph, param, task, type GraphEvent, type RunReport } from "@hello-terrain/work";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type PaletteId = "ocean" | "heat" | "mono";

type HeightField = {
  size: number;
  min: number;
  max: number;
  heights: Float32Array;
};

type ContourSegment = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  level: number; // 0..levels-1
};

type UiSnapshot = {
  lastReport: RunReport | null;
  lastRunAtMs: number | null;
  eventCounts: { start: number; finish: number; cacheHit: number; error: number };
  lastTaskDurationsMs: Record<string, number | undefined>;
  lastTaskEventType: Record<string, GraphEvent["type"] | undefined>;
  inspect: InspectResult | null;
  showUI: boolean;
  palette: PaletteId;
  seed: number;
};

// NOTE: Inspect types are intentionally inlined here.
// `@hello-terrain/work` exposes `g.inspect()` at runtime, but does not currently export
// the Inspect* TypeScript types from its public entrypoint.
type InspectNode =
  | { id: string; kind: "param"; name?: string; version?: number }
  | {
      id: string;
      kind: "task";
      name?: string;
      lane?: string;
      cache?: "memo" | "none";
      tags?: readonly string[];
      state?: "idle" | "running" | "ready" | "error";
      dirty?: boolean;
      version?: number;
    };

type InspectEdge = { from: string; to: string; kind: "task" | "param" };

type InspectResult = {
  nodes: InspectNode[];
  edges: InspectEdge[];
  meta?: {
    structureVersion: number;
    compiledVersion: number;
    compileCount: number;
    topoOrder?: readonly string[];
  };
};

function clamp01(x: number) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function smoothstep(t: number) {
  return t * t * (3 - 2 * t);
}

function sleep(ms: number, signal?: AbortSignal) {
  if (ms <= 0) return Promise.resolve();
  if (!signal) return new Promise<void>((r) => setTimeout(r, ms));
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));

  return new Promise<void>((resolve, reject) => {
    const id = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(id);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

// A fast-ish integer hash -> [0,1)
function hash2i(x: number, y: number, seed: number) {
  // Force to 32-bit ints
  let h = (x | 0) * 374761393 + (y | 0) * 668265263 + (seed | 0) * 1442695041;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177) | 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

function valueNoise2(x: number, y: number, seed: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = smoothstep(xf);
  const v = smoothstep(yf);

  const a = hash2i(xi, yi, seed);
  const b = hash2i(xi + 1, yi, seed);
  const c = hash2i(xi, yi + 1, seed);
  const d = hash2i(xi + 1, yi + 1, seed);

  const ab = lerp(a, b, u);
  const cd = lerp(c, d, u);
  return lerp(ab, cd, v);
}

function fbm2(x: number, y: number, seed: number, octaves: number) {
  let sum = 0;
  let amp = 0.6;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise2(x * freq, y * freq, seed + i * 1013);
    norm += amp;
    amp *= 0.5;
    freq *= 2.0;
  }
  return sum / Math.max(1e-6, norm);
}

function paletteLut(p: PaletteId) {
  // 256-entry RGBA LUT (Uint8ClampedArray), tuned for punchy “poster” colors.
  const lut = new Uint8ClampedArray(256 * 4);

  const stops: Array<[number, [number, number, number]]> =
    p === "ocean"
      ? [
          [0.0, [3, 8, 18]],
          [0.25, [12, 48, 92]],
          [0.5, [30, 140, 170]],
          [0.7, [120, 210, 180]],
          [1.0, [245, 250, 255]],
        ]
      : p === "heat"
        ? [
            [0.0, [10, 0, 18]],
            [0.25, [90, 10, 70]],
            [0.55, [220, 80, 30]],
            [0.75, [250, 190, 60]],
            [1.0, [255, 255, 240]],
          ]
        : [
            [0.0, [10, 10, 12]],
            [0.4, [70, 70, 80]],
            [0.7, [180, 180, 190]],
            [1.0, [250, 250, 255]],
          ];

  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let s = 0;
    while (s + 1 < stops.length && t > stops[s + 1][0]) s++;
    const [t0, c0] = stops[s];
    const [t1, c1] = stops[Math.min(stops.length - 1, s + 1)];
    const u = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
    const r = Math.round(lerp(c0[0], c1[0], u));
    const g = Math.round(lerp(c0[1], c1[1], u));
    const b = Math.round(lerp(c0[2], c1[2], u));

    const j = i * 4;
    lut[j] = r;
    lut[j + 1] = g;
    lut[j + 2] = b;
    lut[j + 3] = 255;
  }

  return lut;
}

function buildContours(field: HeightField, levels: number): ContourSegment[] {
  const { size, heights, min, max } = field;
  if (size < 2) return [];
  const out: ContourSegment[] = [];

  // Marching-squares line segments, per iso-level.
  // Each cell is [x,y] -> [x+1,y+1] in pixel space; we store coords in [0,1].
  const w = size;
  const h = size;
  const invW = 1 / (w - 1);
  const invH = 1 / (h - 1);

  // Keep levels away from exact min/max to reduce edge noise.
  for (let li = 0; li < levels; li++) {
    const t = (li + 1) / (levels + 1);
    const iso = lerp(min, max, t);

    for (let y = 0; y < h - 1; y++) {
      const row0 = y * w;
      const row1 = (y + 1) * w;
      for (let x = 0; x < w - 1; x++) {
        const a = heights[row0 + x];
        const b = heights[row0 + x + 1];
        const c = heights[row1 + x + 1];
        const d = heights[row1 + x];

        const ia = a > iso ? 1 : 0;
        const ib = b > iso ? 1 : 0;
        const ic = c > iso ? 1 : 0;
        const id = d > iso ? 1 : 0;
        const idx = (ia << 0) | (ib << 1) | (ic << 2) | (id << 3);
        if (idx === 0 || idx === 15) continue;

        // Linear interpolation along edges.
        const tx = (v0: number, v1: number) => {
          const denom = v1 - v0;
          if (Math.abs(denom) < 1e-8) return 0.5;
          return clamp01((iso - v0) / denom);
        };

        // Edges: 0=top(a-b), 1=right(b-c), 2=bottom(d-c), 3=left(a-d)
        const e0 = tx(a, b);
        const e1 = tx(b, c);
        const e2 = tx(d, c);
        const e3 = tx(a, d);

        const x0 = x;
        const y0 = y;

        const p = (edge: 0 | 1 | 2 | 3): [number, number] => {
          switch (edge) {
            case 0:
              return [x0 + e0, y0];
            case 1:
              return [x0 + 1, y0 + e1];
            case 2:
              return [x0 + e2, y0 + 1];
            case 3:
              return [x0, y0 + e3];
          }
        };

        // Segment lookup (standard marching squares; resolves ambig by producing two segments).
        const segs: Array<[0 | 1 | 2 | 3, 0 | 1 | 2 | 3]> = [];
        switch (idx) {
          case 1:
          case 14:
            segs.push([3, 0]);
            break;
          case 2:
          case 13:
            segs.push([0, 1]);
            break;
          case 3:
          case 12:
            segs.push([3, 1]);
            break;
          case 4:
          case 11:
            segs.push([1, 2]);
            break;
          case 5:
            segs.push([3, 2], [0, 1]);
            break;
          case 6:
          case 9:
            segs.push([0, 2]);
            break;
          case 7:
          case 8:
            segs.push([3, 2]);
            break;
          case 10:
            segs.push([3, 0], [1, 2]);
            break;
          default:
            break;
        }

        for (const [ea, eb] of segs) {
          const [px0, py0] = p(ea);
          const [px1, py1] = p(eb);
          out.push({
            x0: px0 * invW,
            y0: py0 * invH,
            x1: px1 * invW,
            y1: py1 * invH,
            level: li,
          });
        }
      }
    }
  }

  return out;
}

function stableNodeLabel(n: InspectNode) {
  return n.name ?? n.id.slice(0, 6);
}

function computeDepths(nodes: InspectNode[], edges: InspectEdge[]) {
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const incoming = new Map<string, string[]>();
  for (const e of edges) {
    const arr = incoming.get(e.to) ?? [];
    arr.push(e.from);
    incoming.set(e.to, arr);
  }

  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (id: string): number => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const n = byId.get(id);
    if (!n) {
      visiting.delete(id);
      memo.set(id, 0);
      return 0;
    }
    if (n.kind === "param") {
      visiting.delete(id);
      memo.set(id, 0);
      return 0;
    }
    const deps = incoming.get(id) ?? [];
    let best = 0;
    for (const dep of deps) best = Math.max(best, depthOf(dep));
    visiting.delete(id);
    memo.set(id, best + 1);
    return best + 1;
  };

  for (const n of nodes) depthOf(n.id);
  return memo;
}

type EdgePulse = {
  from: string;
  to: string;
  startedAtMs: number;
  kind: "start" | "cacheHit" | "finish" | "error";
};

function WorkHeroInner() {
  const { showUI, isFullscreen } = useExamplesCanvas();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bitmapRef = useRef<ImageBitmap | null>(null);
  const contoursRef = useRef<ContourSegment[] | null>(null);

  const showUIRef = useRef(showUI);
  showUIRef.current = showUI;

  const uiDataRef = useRef<UiSnapshot>({
    lastReport: null,
    lastRunAtMs: null,
    eventCounts: { start: 0, finish: 0, cacheHit: 0, error: 0 },
    lastTaskDurationsMs: {},
    lastTaskEventType: {},
    inspect: null,
    showUI,
    palette: "ocean",
    seed: 1337,
  });

  const [uiSnapshot, setUiSnapshot] = useState<UiSnapshot>(uiDataRef.current);

  const pulsesRef = useRef<EdgePulse[]>([]);
  const lastVersionsRef = useRef<Map<string, number>>(new Map());
  const changedThisRunRef = useRef<Set<string>>(new Set());
  const inspectForRunRef = useRef<InspectResult | null>(null);
  const layoutRef = useRef<{
    structureVersion: number | null;
    positions: Map<string, { x: number; y: number; kind: InspectNode["kind"] }>;
    edges: InspectEdge[];
    nodes: InspectNode[];
  }>({ structureVersion: null, positions: new Map(), edges: [], nodes: [] });

  const { g, pSeed, pPalette, pFreq, pTimeMs, tAnimatedColorize, tContours, tStats } =
    useMemo(() => {
      const g = graph();

      const pSeed = param(1337).displayName("seed");
      const pPalette = param<PaletteId>("ocean").displayName("palette");
      const pSize = param(127).displayName("size");
      const pFreq = param(1.8).displayName("frequency");
      const pTimeMs = param(0).displayName("timeMs");

      const tHeight = task(async (get, work, ctx) => {
        const seed = get(pSeed);
        const size = get(pSize);
        const frequency = get(pFreq);

        const out = await work(async () => {
          // Make async + cancellation visible without being too slow.
          await sleep(45, ctx.signal);

          const heights = new Float32Array(size * size);
          let min = Infinity;
          let max = -Infinity;

          // Normalized sample space.
          const inv = 1 / Math.max(1, size - 1);

          // Domain warp for nicer structure.
          for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
              const nx = (x * inv - 0.5) * frequency;
              const ny = (y * inv - 0.5) * frequency;

              const w1 = fbm2(nx * 1.1 + 12.3, ny * 1.1 + 9.7, seed + 17, 3);
              const w2 = fbm2(nx * 1.1 - 4.2, ny * 1.1 + 2.5, seed + 29, 3);
              const wx = nx + (w1 - 0.5) * 0.9;
              const wy = ny + (w2 - 0.5) * 0.9;

              const h0 = fbm2(wx * 2.0, wy * 2.0, seed, 5);
              const ridges = 1.0 - Math.abs(h0 * 2.0 - 1.0); // ridge-like features
              const v = 0.75 * h0 + 0.25 * ridges;

              const idx = y * size + x;
              heights[idx] = v;
              if (v < min) min = v;
              if (v > max) max = v;
            }
          }

          return { size, heights, min, max } satisfies HeightField;
        });

        return out;
      }).displayName("noiseField");

      const tStats = task((get, work) => {
        const hf = get(tHeight);
        return work(() => {
          // Cheap stats; kept separate to show fan-out.
          const span = hf.max - hf.min;
          return { min: hf.min, max: hf.max, span };
        });
      }).displayName("stats");

      const tPaletteLut = task((get, work) => {
        const pal = get(pPalette);
        return work(() => paletteLut(pal));
      }).displayName("paletteLut");

      // Animated colorization: depends on time, but does NOT invalidate the expensive noiseField.
      // cache:none so it runs every frame even if timeMs doesn't change (e.g. if paused).
      const tAnimatedColorize = task((get, work) => {
        const hf = get(tHeight);
        const lut = get(tPaletteLut);
        const timeMs = get(pTimeMs);

        return work(() => {
          const { size, heights, min, max } = hf;
          const data = new Uint8ClampedArray(size * size * 4);
          const inv = 1 / Math.max(1, size - 1);
          const t = timeMs * 0.0003;
          const span = Math.max(1e-6, max - min);

          const wrap01 = (x: number) => x - Math.floor(x);

          for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
              const u = x * inv;
              const v = y * inv;

              // Flowy domain warp (cheap) over the memoized field.
              const dx = (Math.sin(t * 2.1 + u * 8.0) + Math.sin(t * 1.3 + v * 6.0)) * 0.02;
              const dy = (Math.cos(t * 1.7 + v * 7.0) + Math.cos(t * 1.1 + u * 5.0)) * 0.02;

              const sx = wrap01(u + dx) * (size - 1);
              const sy = wrap01(v + dy) * (size - 1);
              const x0 = Math.floor(sx);
              const y0 = Math.floor(sy);
              const x1 = Math.min(size - 1, x0 + 1);
              const y1 = Math.min(size - 1, y0 + 1);
              const tx = sx - x0;
              const ty = sy - y0;

              const a = heights[y0 * size + x0];
              const b = heights[y0 * size + x1];
              const c = heights[y1 * size + x1];
              const d = heights[y1 * size + x0];
              const ab = a + (b - a) * tx;
              const dc = d + (c - d) * tx;
              const h01 = clamp01((ab + (dc - ab) * ty - min) / span);

              const j = (h01 * 255) | 0;
              const o = (y * size + x) * 4;
              data[o] = lut[j * 4];
              data[o + 1] = lut[j * 4 + 1];
              data[o + 2] = lut[j * 4 + 2];
              data[o + 3] = 255;
            }
          }

          return new ImageData(data, size, size);
        });
      })
        .displayName("animatedColorize")
        .cache("none");

      const tContours = task((get, work) => {
        const hf = get(tHeight);
        return work(() => buildContours(hf, 12));
      }).displayName("contours");

      g.add(tHeight);
      g.add(tStats);
      g.add(tPaletteLut);
      g.add(tContours);
      g.add(tAnimatedColorize);

      return { g, pSeed, pPalette, pFreq, pTimeMs, tAnimatedColorize, tContours, tStats } as const;
    }, []);

  const [freqDraft, setFreqDraft] = useState(1.8);
  const commitFreq = useCallback(
    (next: number) => {
      pFreq.set(() => next);
    },
    [pFreq],
  );

  const setPalette = useCallback(
    (p: PaletteId) => {
      pPalette.set(() => p);
      uiDataRef.current.palette = p;
    },
    [pPalette],
  );

  const shuffleSeed = useCallback(() => {
    const next = (Math.random() * 1_000_000) | 0;
    pSeed.set(() => next);
    uiDataRef.current.seed = next;
  }, [pSeed]);

  // Keep a low-frequency React snapshot of UI data (avoid re-rendering every frame).
  useEffect(() => {
    const id = setInterval(() => setUiSnapshot({ ...uiDataRef.current }), 200);
    return () => clearInterval(id);
  }, []);

  // Keyboard shortcuts (R: shuffle seed). (U is owned by ExamplesCanvas.)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Only when focused (or in fullscreen) to avoid global hotkeys.
      if (!containerRef.current?.contains(document.activeElement) && !isFullscreen) return;
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        shuffleSeed();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [shuffleSeed, isFullscreen]);

  // Subscribe to graph events to drive overlay animation + stats.
  useEffect(() => {
    const unsubAll = g.on((e: GraphEvent) => {
      const now = performance.now();
      const snap = uiDataRef.current;

      switch (e.type) {
        case "run:start": {
          snap.eventCounts = { start: 0, finish: 0, cacheHit: 0, error: 0 };
          // Snapshot runtime versions at the start of the run so we can pulse only from
          // dependencies that actually changed for this run.
          const inspect = g.inspect({ includeRuntime: true });
          inspectForRunRef.current = inspect;

          const changed = new Set<string>();
          for (const n of inspect.nodes) {
            const v = n.version;
            if (typeof v !== "number") continue;
            const prev = lastVersionsRef.current.get(n.id);
            if (prev === undefined) continue; // don't spam pulses on first render
            if (prev !== v) changed.add(n.id);
          }
          changedThisRunRef.current = changed;
          return;
        }
        case "run:finish": {
          // Commit versions for next run.
          const inspect = g.inspect({ includeRuntime: true });
          inspectForRunRef.current = inspect;
          if (inspect) {
            for (const n of inspect.nodes) {
              if (typeof n.version === "number") lastVersionsRef.current.set(n.id, n.version);
            }
          }
          return;
        }
        case "task:start":
        case "task:finish":
        case "task:cacheHit":
        case "task:error": {
          const taskId = e.taskId;
          snap.lastTaskEventType[taskId] = e.type;

          if (e.type === "task:start") snap.eventCounts.start += 1;
          if (e.type === "task:finish") {
            snap.eventCounts.finish += 1;
            snap.lastTaskDurationsMs[taskId] = e.durationMs;
            // A finished task necessarily changed this run.
            changedThisRunRef.current.add(taskId);
          }
          if (e.type === "task:cacheHit") snap.eventCounts.cacheHit += 1;
          if (e.type === "task:error") snap.eventCounts.error += 1;

          // Edge pulses: only from dependencies that changed *this run*.
          const inspect = inspectForRunRef.current ?? uiDataRef.current.inspect;
          if (!inspect) return;

          const kind: EdgePulse["kind"] =
            e.type === "task:start"
              ? "start"
              : e.type === "task:finish"
                ? "finish"
                : e.type === "task:cacheHit"
                  ? "cacheHit"
                  : "error";

          const incoming = inspect.edges.filter((ed) => ed.to === taskId);
          const changedIncoming = incoming.filter((ed) => changedThisRunRef.current.has(ed.from));

          // Cache hits are best represented as a self pulse (no deps changed).
          if (e.type === "task:cacheHit") {
            pulsesRef.current.push({ from: taskId, to: taskId, startedAtMs: now, kind });
            return;
          }

          if (changedIncoming.length === 0) {
            // If we can't attribute it to a changed dependency (e.g. cache:none tasks),
            // just pulse the node itself.
            pulsesRef.current.push({ from: taskId, to: taskId, startedAtMs: now, kind });
          } else {
            for (const ed of changedIncoming) {
              pulsesRef.current.push({ from: ed.from, to: ed.to, startedAtMs: now, kind });
            }
          }
          return;
        }
        default: {
          return;
        }
      }
    });

    return () => {
      unsubAll();
    };
  }, [g]);

  // Resize canvas to container with DPR.
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    };

    resize();
    const ro = new ResizeObserver(() => resize());
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Compute loop: keep the graph running in a hot loop.
  useEffect(() => {
    let disposed = false;
    let inFlight = false;

    const runOnce = async () => {
      if (disposed || inFlight) return;
      inFlight = true;
      try {
        // Update time param every frame; only animatedColorize depends on it.
        pTimeMs.set(() => performance.now());
        const report = await g.run({ targets: [tAnimatedColorize, tContours, tStats] });
        uiDataRef.current.lastReport = report;
        uiDataRef.current.lastRunAtMs = performance.now();

        // Refresh inspect for overlay (runtime states, dirtiness, cache strategy).
        uiDataRef.current.inspect = g.inspect({ includeRuntime: true });

        // Pull computed outputs (non-throwing).
        const img = g.peek(tAnimatedColorize);
        const contours = g.peek(tContours);
        if (!img || !contours) return;
        contoursRef.current = contours;

        // Convert ImageData -> ImageBitmap for fast scaled drawing.
        try {
          const bmp = await createImageBitmap(img);
          bitmapRef.current?.close?.();
          bitmapRef.current = bmp;
        } catch {
          // Fallback: keep previous bitmap.
        }
      } finally {
        inFlight = false;
      }
    };

    // Pump as fast as possible without overlapping runs.
    const pump = () => {
      void runOnce();
      if (!disposed) requestAnimationFrame(pump);
    };
    pump();

    return () => {
      disposed = true;
      bitmapRef.current?.close?.();
      bitmapRef.current = null;
      g.dispose();
    };
  }, [g, pTimeMs, tAnimatedColorize, tContours, tStats]);

  // Draw loop.
  useEffect(() => {
    let disposed = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = (tMs: number) => {
      if (disposed) return;
      const w = canvas.width;
      const h = canvas.height;

      // Background
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#070814";
      ctx.fillRect(0, 0, w, h);

      // Draw the terrain bitmap (cover)
      const bmp = bitmapRef.current;
      if (bmp) {
        const sx = w / bmp.width;
        const sy = h / bmp.height;
        const s = Math.max(sx, sy);
        const dw = bmp.width * s;
        const dh = bmp.height * s;
        const dx = (w - dw) * 0.5;
        const dy = (h - dh) * 0.5;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(bmp, dx, dy, dw, dh);

        // Soft vignette
        const g0 = ctx.createRadialGradient(
          w * 0.5,
          h * 0.5,
          Math.min(w, h) * 0.2,
          w * 0.5,
          h * 0.5,
          Math.min(w, h) * 0.75,
        );
        g0.addColorStop(0, "rgba(0,0,0,0)");
        g0.addColorStop(1, "rgba(0,0,0,0.55)");
        ctx.fillStyle = g0;
        ctx.fillRect(0, 0, w, h);

        // Scanline sweep (purely visual; does not invalidate tasks)
        const sweep = ((tMs * 0.00012) % 1) * h;
        const g1 = ctx.createLinearGradient(0, sweep - 120, 0, sweep + 120);
        g1.addColorStop(0, "rgba(255,255,255,0)");
        g1.addColorStop(0.5, "rgba(255,255,255,0.07)");
        g1.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g1;
        ctx.fillRect(0, 0, w, h);
      }

      // Contours overlay
      const contours = contoursRef.current;
      if (contours && contours.length > 0) {
        ctx.save();
        ctx.globalAlpha = 0.22;
        ctx.lineWidth = Math.max(1, Math.floor(Math.min(w, h) * 0.0015));
        ctx.lineJoin = "round";
        ctx.lineCap = "round";

        const levels = 12;
        for (let li = 0; li < levels; li++) {
          const a = li / (levels - 1);
          ctx.strokeStyle = `rgba(255,255,255,${lerp(0.06, 0.22, a)})`;
          ctx.beginPath();
          for (const s of contours) {
            if (s.level !== li) continue;
            ctx.moveTo(s.x0 * w, s.y0 * h);
            ctx.lineTo(s.x1 * w, s.y1 * h);
          }
          ctx.stroke();
        }
        ctx.restore();
      }

      // Graph overlay (small DAG in the corner)
      const inspect = uiDataRef.current.inspect;
      if (inspect && showUIRef.current) {
        const nodes = inspect.nodes;
        const edges = inspect.edges;
        const meta = inspect.meta;

        // (Re)compute layout when structure changes.
        const structVer = meta?.structureVersion ?? 0;
        if (layoutRef.current.structureVersion !== structVer) {
          const depths = computeDepths(nodes, edges);
          const byDepth = new Map<number, InspectNode[]>();
          for (const n of nodes) {
            const d = depths.get(n.id) ?? 0;
            const arr = byDepth.get(d) ?? [];
            arr.push(n);
            byDepth.set(d, arr);
          }
          for (const arr of byDepth.values())
            arr.sort((a, b) => stableNodeLabel(a).localeCompare(stableNodeLabel(b)));

          const maxDepth = Math.max(0, ...Array.from(byDepth.keys()));
          const positions = new Map<string, { x: number; y: number; kind: InspectNode["kind"] }>();
          for (const [d, arr] of byDepth.entries()) {
            for (let i = 0; i < arr.length; i++) {
              const n = arr[i];
              const x = maxDepth === 0 ? 0.5 : d / maxDepth;
              const y = arr.length === 1 ? 0.5 : i / (arr.length - 1);
              positions.set(n.id, { x, y, kind: n.kind });
            }
          }

          layoutRef.current = { structureVersion: structVer, positions, edges, nodes };
        } else {
          layoutRef.current.edges = edges;
          layoutRef.current.nodes = nodes;
        }

        // Graph panel box (hero centerpiece)
        const pad = Math.max(14, Math.floor(Math.min(w, h) * 0.03));
        const gw = Math.min(Math.floor(w - pad * 2), Math.floor(w * 0.8));
        const gh = Math.min(Math.floor(h - pad * 2), Math.floor(h * 0.55));
        const gx = Math.floor((w - gw) * 0.5);
        const gy = Math.floor((h - gh) * 0.5);

        ctx.save();
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.strokeStyle = "rgba(255,255,255,0.12)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(gx, gy, gw, gh, 10);
        ctx.fill();
        ctx.stroke();

        ctx.font = `${Math.max(12, Math.floor(Math.min(w, h) * 0.022))}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
        ctx.fillStyle = "rgba(255,255,255,0.75)";

        // Pulse legend (what the traveling dots mean)
        const legendFontSize = Math.max(10, Math.floor(Math.min(w, h) * 0.017));
        ctx.font = `${legendFontSize}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
        const items: Array<{ label: string; color: string }> = [
          { label: "start", color: "rgba(255,220,120,0.95)" },
          { label: "finish", color: "rgba(120,255,140,0.95)" },
          // { label: "cache", color: "rgba(80,255,255,0.95)" },
          { label: "error", color: "rgba(255,90,90,0.95)" },
        ];

        let lx = gx + 70;
        const ly = gy + 18;
        const r = 3.5;
        for (const it of items) {
          ctx.fillStyle = it.color;
          ctx.beginPath();
          ctx.arc(lx, ly - 4, r, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = "rgba(255,255,255,0.60)";
          ctx.fillText(it.label, lx + 8, ly);
          lx += Math.max(52, ctx.measureText(it.label).width + 26);
          if (lx > gx + gw - 80) break; // keep compact; don't wrap
        }

        const px = (id: string) => {
          const p = layoutRef.current.positions.get(id);
          if (!p) return { x: gx + gw * 0.5, y: gy + gh * 0.5, kind: "task" as const };
          return { x: gx + 24 + p.x * (gw - 48), y: gy + 36 + p.y * (gh - 64), kind: p.kind };
        };

        // Edges
        ctx.lineWidth = 1.5;
        for (const e of layoutRef.current.edges) {
          const a = px(e.from);
          const b = px(e.to);
          ctx.strokeStyle =
            e.kind === "param" ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.18)";
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }

        // Pulses (decay quickly)
        const now = tMs;
        const pulses = pulsesRef.current;
        const nextPulses: EdgePulse[] = [];
        for (const p of pulses) {
          const age = now - p.startedAtMs;
          if (age > 1500) continue;
          nextPulses.push(p);

          const a = px(p.from);
          const b = px(p.to);
          const u = clamp01(age / 1500);
          const x = lerp(a.x, b.x, u);
          const y = lerp(a.y, b.y, u);

          const color =
            p.kind === "cacheHit"
              ? "rgba(80,255,255,0.9)"
              : p.kind === "error"
                ? "rgba(255,90,90,0.9)"
                : p.kind === "finish"
                  ? "rgba(120,255,140,0.9)"
                  : "rgba(255,220,120,0.9)";
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(x, y, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
        pulsesRef.current = nextPulses;

        // Nodes
        for (const n of layoutRef.current.nodes) {
          const p = px(n.id);
          const label = stableNodeLabel(n);
          const isParam = n.kind === "param";

          let fill = isParam ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.16)";
          let stroke = "rgba(255,255,255,0.25)";

          if (n.kind === "task") {
            if (n.state === "running") fill = "rgba(255,220,120,0.35)";
            if (n.state === "ready") fill = "rgba(120,255,140,0.22)";
            if (n.state === "error") fill = "rgba(255,90,90,0.28)";
            if (n.dirty) stroke = "rgba(255,220,120,0.7)";
            if (n.cache === "none") stroke = "rgba(255,255,255,0.45)";

            const lastEvt = uiDataRef.current.lastTaskEventType[n.id];
            if (lastEvt === "task:cacheHit") stroke = "rgba(80,255,255,0.8)";
          }

          ctx.fillStyle = fill;
          ctx.strokeStyle = stroke;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          // Label + last duration (or cache)
          ctx.fillStyle = "rgba(255,255,255,0.82)";
          ctx.fillText(label, p.x + 12, p.y + 2);

          if (n.kind === "task") {
            const lastEvt = uiDataRef.current.lastTaskEventType[n.id];
            const dur = uiDataRef.current.lastTaskDurationsMs[n.id];

            let durLabel: string | null = null;
            if (lastEvt === "task:cacheHit") durLabel = "cache";
            else if (typeof dur === "number") durLabel = `${dur.toFixed(1)}ms`;

            if (durLabel) {
              const prevFont = ctx.font;
              // Slightly smaller line under the label for readability.
              ctx.font = `${Math.max(
                10,
                Math.floor(Math.min(w, h) * 0.017),
              )}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
              ctx.fillStyle =
                lastEvt === "task:cacheHit" ? "rgba(80,255,255,0.85)" : "rgba(255,255,255,0.55)";
              ctx.fillText(durLabel, p.x + 12, p.y + 16);
              ctx.font = prevFont;
            }
          }
        }

        ctx.restore();
      }

      requestAnimationFrame(draw);
    };

    requestAnimationFrame(draw);
    return () => {
      disposed = true;
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      tabIndex={0}
      onPointerDown={(e) => {
        // Ensure our keyboard shortcuts work after a click/tap.
        (e.currentTarget as HTMLDivElement).focus();
      }}
    >
      <canvas ref={canvasRef} className="absolute inset-0" />

      {showUI && (
        <>
          {/* Minimal controls */}
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 pointer-events-auto max-w-[calc(100%-1rem)]">
            <div className="flex flex-wrap items-center justify-center gap-1 sm:gap-2 rounded-md sm:rounded-lg bg-black/25 border border-white/10 backdrop-blur-sm px-1.5 sm:px-2 py-1 sm:py-1.5">
              <button
                type="button"
                onClick={shuffleSeed}
                className="px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-md bg-black/50 hover:bg-black/70 text-white text-[10px] sm:text-[11px] md:text-xs font-mono border border-white/10 backdrop-blur-sm"
                title="Shuffle seed (R)"
              >
                Shuffle <kbd className="hidden sm:inline">r</kbd>
              </button>
              <div className="flex items-center gap-1 sm:gap-2 rounded-md bg-black/35 border border-white/10 backdrop-blur-sm px-1.5 sm:px-2 py-0.5 sm:py-1">
                <span className="text-white/70 text-[10px] md:text-xs font-mono hidden sm:inline">
                  freq
                </span>
                <input
                  type="range"
                  min={0.6}
                  max={3.5}
                  step={0.05}
                  value={freqDraft}
                  onChange={(e) => setFreqDraft(Number(e.target.value))}
                  onPointerUp={() => commitFreq(freqDraft)}
                  onKeyUp={(e) => {
                    if (e.key === "Enter") commitFreq(freqDraft);
                  }}
                  className="w-20 sm:w-28 md:w-40 accent-white"
                />
                <span className="text-white/80 text-[10px] md:text-xs font-mono tabular-nums w-9 sm:w-10 text-right">
                  {freqDraft.toFixed(2)}
                </span>
              </div>
              <div className="flex items-center gap-1 rounded-md bg-black/35 border border-white/10 backdrop-blur-sm px-1.5 sm:px-2 py-0.5 sm:py-1">
                {(["ocean", "heat", "mono"] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPalette(p)}
                    className={`px-1.5 py-0.5 rounded text-[10px] md:text-xs font-mono transition-colors ${
                      uiSnapshot.palette === p
                        ? "bg-white text-black"
                        : "text-white/80 hover:bg-white/10"
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="absolute bottom-2 left-2 right-2 md:bottom-4 md:left-4 md:right-auto z-20 bg-black/45 border border-white/10 backdrop-blur-sm rounded-md px-2.5 py-2 text-white font-mono text-[10px] md:text-xs pointer-events-none">
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              <div>
                <div className="text-white/70">run</div>
                <div>
                  {uiSnapshot.lastReport?.status ?? "—"}{" "}
                  {uiSnapshot.lastReport
                    ? `(${uiSnapshot.lastReport.durationMs.toFixed(1)}ms)`
                    : ""}
                </div>
              </div>
              <div>
                <div className="text-white/70">tasks</div>
                <div>
                  {uiSnapshot.lastReport?.taskCount ?? "—"} executed /{" "}
                  {uiSnapshot.lastReport?.cacheHits ?? "—"} cached
                </div>
              </div>
              <div>
                <div className="text-white/70">events</div>
                <div>
                  s:{uiSnapshot.eventCounts.start} f:{uiSnapshot.eventCounts.finish} c:
                  {uiSnapshot.eventCounts.cacheHit} e:
                  {uiSnapshot.eventCounts.error}
                </div>
              </div>
              <div>
                <div className="text-white/70">seed</div>
                <div>{uiSnapshot.seed}</div>
              </div>
            </div>
          </div>

          <div className="hidden md:block">
            <RunTimingBars graph={g} />
          </div>
        </>
      )}
    </div>
  );
}

export default function WorkHero() {
  return (
    <ExamplesCanvas className="bg-[#070814]">
      <WorkHeroInner />
    </ExamplesCanvas>
  );
}
