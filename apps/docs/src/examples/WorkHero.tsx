"use client";

import { graph, param, task } from "@hello-terrain/work";
import { useEffect, useMemo, useRef, useState } from "react";

type Runtime = {
  g: ReturnType<typeof graph>;
  scheduleRun: () => void;
  setStrength: (v: number) => void;
  dispose: () => void;
};

function clamp01(x: number) {
  return Math.min(1, Math.max(0, x));
}

type RunStats = {
  report: null | {
    status: string;
    durationMs: number;
    taskCount: number;
    cacheHits: number;
  };
  taskStart: number;
  taskFinish: number;
  taskError: number;
  taskCacheHit: number;
  byTask: Record<
    string,
    {
      name: string;
      lane?: string;
      durationMs?: number;
      cacheHit?: boolean;
      error?: boolean;
    }
  >;
};

const emptyStats = (): RunStats => ({
  report: null,
  taskStart: 0,
  taskFinish: 0,
  taskError: 0,
  taskCacheHit: 0,
  byTask: {},
});

export function WorkHero(props: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<Runtime | null>(null);

  const [strengthUi, setStrengthUi] = useState(0.65);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<RunStats>(() => emptyStats());

  const imageUrl = useMemo(
    () =>
      // Public Unsplash image (swap if you prefer)
      "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1400&q=60",
    [],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    setStatus("loading");
    setError(null);

    // --- Inputs ---
    const mouseX = param(0).displayName("mouseX");
    const mouseY = param(0).displayName("mouseY");
    const strength = param(strengthUi).displayName("strength");
    const url = param(imageUrl).displayName("imageUrl");

    // --- Tasks ---
    const loadImage = task(async (get: any, _work: any, tctx: any) => {
      const u = get(url);
      const res = await fetch(u, { signal: tctx.signal });
      const blob = await res.blob();
      return await createImageBitmap(blob);
    })
      .lane("io")
      .displayName("loadImage");

    const draw = task((get: any, work: any) => {
      const bmp = get(loadImage);
      const mx = get(mouseX);
      const my = get(mouseY);
      const s = clamp01(get(strength));

      return work(() => {
        const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
        const w = Math.max(1, canvas.width);
        const h = Math.max(1, canvas.height);

        ctx.clearRect(0, 0, w, h);

        // Base draw: cover canvas, tiny parallax based on mouse
        const dx = (mx / Math.max(1, w / dpr) - 0.5) * 24 * s;
        const dy = (my / Math.max(1, h / dpr) - 0.5) * 24 * s;
        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.drawImage(bmp, dx, dy, w / dpr, h / dpr);
        ctx.restore();

        // Pixel effect: subtle chromatic shift + brightness around cursor
        const img = ctx.getImageData(0, 0, w, h);
        const data = img.data;

        const cx = mx * dpr;
        const cy = my * dpr;
        const radius = 260 * dpr;

        // Cheap sampling for docs: skip pixels, still looks “alive”
        const step = 2;
        for (let py = 0; py < h; py += step) {
          for (let px = 0; px < w; px += step) {
            const i = (py * w + px) * 4;
            const dist = Math.hypot(px - cx, py - cy);
            const k = Math.max(0, 1 - dist / radius) * s; // 0..1
            if (k <= 0) continue;

            const off = Math.floor(10 * k);
            data[i + 1] = Math.min(255, data[i + 1] + off * 5); // G up
            data[i + 2] = Math.max(0, data[i + 2] - off * 5); // B down

            // Brightness bump
            const bump = off * 2;
            data[i] = Math.min(255, data[i] + bump);
            data[i + 1] = Math.min(255, data[i + 1] + bump);
            data[i + 2] = Math.min(255, data[i + 2] + bump);
          }
        }

        ctx.putImageData(img, 0, 0);
      });
    })
      .lane("cpu")
      .displayName("draw");

    // --- Graph wiring ---
    const g = graph();
    g.add(loadImage);
    g.add(draw);

    // Per-run stats
    let currentRunId: string | null = null;
    const taskMeta: Record<string, { name: string; lane?: string }> = {
      [loadImage.id]: { name: loadImage.name ?? "loadImage", lane: "io" },
      [draw.id]: { name: draw.name ?? "draw", lane: "cpu" },
    };

    const resetForRun = (runId: string) => {
      currentRunId = runId;
      setError(null);
      if (status === "error") setStatus("loading");
      setStats({
        report: null,
        taskStart: 0,
        taskFinish: 0,
        taskError: 0,
        taskCacheHit: 0,
        byTask: Object.fromEntries(
          Object.entries(taskMeta).map(([id, m]) => [id, { name: m.name, lane: m.lane }]),
        ),
      });
    };

    const unsubRunStart = g.on("run:start", (e: any) => {
      resetForRun(e.runId);
    });

    const unsubRunFinish = g.on("run:finish", (_e: any) => {
      // report is set from g.run(); this is just to keep run lifecycle observable
    });

    const unsubTask = g.on("task:*", (e: any) => {
      if (currentRunId && e.runId !== currentRunId) return;
      setStats((prev) => {
        if (e.type === "task:start") return { ...prev, taskStart: prev.taskStart + 1 };
        if (e.type === "task:finish") {
          return {
            ...prev,
            taskFinish: prev.taskFinish + 1,
            byTask: {
              ...prev.byTask,
              [e.taskId]: {
                ...(prev.byTask[e.taskId] ?? { name: taskMeta[e.taskId]?.name ?? e.taskId }),
                durationMs: e.durationMs,
                cacheHit: false,
                error: false,
              },
            },
          };
        }
        if (e.type === "task:error") {
          return {
            ...prev,
            taskError: prev.taskError + 1,
            byTask: {
              ...prev.byTask,
              [e.taskId]: {
                ...(prev.byTask[e.taskId] ?? { name: taskMeta[e.taskId]?.name ?? e.taskId }),
                error: true,
              },
            },
          };
        }
        if (e.type === "task:cacheHit") {
          return {
            ...prev,
            taskCacheHit: prev.taskCacheHit + 1,
            byTask: {
              ...prev.byTask,
              [e.taskId]: {
                ...(prev.byTask[e.taskId] ?? { name: taskMeta[e.taskId]?.name ?? e.taskId }),
                cacheHit: true,
              },
            },
          };
        }
        return prev;
      });
    });

    const unsubError = g.on("task:error", (e: any) => {
      setStatus("error");
      setError(e.error instanceof Error ? e.error.message : String(e.error));
    });

    let scheduled = false;
    const scheduleRun = () => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(async () => {
        scheduled = false;
        try {
          const r = await g.run({ targets: [draw], laneConcurrency: { cpu: 1, io: 4 } });
          setStats((prev) => ({ ...prev, report: r }));
          if (r.status === "ok") {
            setStatus("ready");
            setError(null);
          } else if (r.status === "cancelled") setStatus("loading");
          else setStatus("error");
        } catch (e) {
          setStatus("error");
          setError(e instanceof Error ? e.message : String(e));
        }
      });
    };

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const cssW = Math.max(1, Math.floor(rect.width));
      const cssH = 360;
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
      scheduleRun();
    };

    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();

    const onMove = (ev: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      mouseX.set(() => ev.clientX - r.left);
      mouseY.set(() => ev.clientY - r.top);
      scheduleRun();
    };
    const onLeave = () => {
      // Ease back to center
      const r = canvas.getBoundingClientRect();
      mouseX.set(() => r.width / 2);
      mouseY.set(() => r.height / 2);
      scheduleRun();
    };

    canvas.addEventListener("pointermove", onMove, { passive: true });
    canvas.addEventListener("pointerleave", onLeave, { passive: true });

    // Initial render
    onLeave();

    runtimeRef.current = {
      g,
      scheduleRun,
      setStrength: (v) => {
        strength.set(() => v);
        scheduleRun();
      },
      dispose: () => {
        canvas.removeEventListener("pointermove", onMove);
        canvas.removeEventListener("pointerleave", onLeave);
        ro.disconnect();
        unsubRunStart();
        unsubRunFinish();
        unsubTask();
        unsubError();
      },
    };

    return () => {
      runtimeRef.current?.dispose();
      runtimeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    runtimeRef.current?.setStrength(strengthUi);
  }, [strengthUi]);

  return (
    <div
      className={[
        "not-prose",
        "relative overflow-hidden rounded-xl border",
        "bg-gradient-to-br from-neutral-950 via-neutral-900 to-neutral-950",
        "shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_20px_80px_rgba(0,0,0,0.55)]",
        props.className ?? "",
      ].join(" ")}
    >
      <div className="pointer-events-none absolute inset-0 opacity-50 [background:radial-gradient(600px_circle_at_20%_20%,rgba(99,102,241,0.22),transparent_60%),radial-gradient(500px_circle_at_80%_60%,rgba(34,197,94,0.14),transparent_55%)]" />

      <div className="relative p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <div className="text-xs font-medium tracking-wide text-neutral-300/80">
              @hello-terrain/work
            </div>
            <div className="mt-1 text-xl font-semibold text-neutral-50">
              Reactive canvas image manipulation
            </div>
            <div className="mt-1 text-sm text-neutral-300/80">
              Move your pointer over the image. Mouse \(x,y\) are params; drawing is a task.
            </div>
          </div>

          <label className="flex items-center gap-3 text-sm text-neutral-200">
            <span className="whitespace-nowrap text-neutral-300/80">Strength</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={strengthUi}
              onChange={(e) => setStrengthUi(Number(e.target.value))}
              className="w-40 accent-white"
              aria-label="Effect strength"
            />
            <span className="w-12 text-right tabular-nums text-neutral-300/80">
              {strengthUi.toFixed(2)}
            </span>
          </label>
        </div>

        <div
          ref={containerRef}
          className="relative mt-4 overflow-hidden rounded-lg border border-white/10"
        >
          <canvas ref={canvasRef} className="block" />
          <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-black/55 px-2 py-1 text-xs text-white/80 backdrop-blur">
            {status === "loading" ? "loading image…" : status === "error" ? "error" : "move mouse"}
          </div>

          <div className="pointer-events-none absolute right-3 top-3 rounded-md bg-black/55 px-2 py-1 text-xs text-white/80 backdrop-blur">
            <div className="font-medium text-white/90">graph</div>
            <div className="mt-1 grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 tabular-nums">
              <div className="text-white/60">status</div>
              <div>{stats.report?.status ?? "—"}</div>

              <div className="text-white/60">duration</div>
              <div>{stats.report ? `${stats.report.durationMs.toFixed(1)}ms` : "—"}</div>

              <div className="text-white/60">tasks</div>
              <div>{stats.report ? String(stats.report.taskCount) : "—"}</div>

              <div className="text-white/60">cacheHits</div>
              <div>{stats.report ? String(stats.report.cacheHits) : "—"}</div>

              <div className="text-white/60">events</div>
              <div>
                start {stats.taskStart} · finish {stats.taskFinish}
                {stats.taskCacheHit ? ` · hit ${stats.taskCacheHit}` : ""}
                {stats.taskError ? ` · err ${stats.taskError}` : ""}
              </div>

              <div className="text-white/60">tasks</div>
              <div className="grid gap-y-0.5">
                {Object.values(stats.byTask).map((t) => (
                  <div key={t.name} className="flex items-center justify-between gap-3">
                    <span className="text-white/85">
                      {t.name}
                      {t.lane ? <span className="text-white/50"> ({t.lane})</span> : null}
                    </span>
                    <span className="text-white/70 tabular-nums">
                      {t.error
                        ? "error"
                        : t.cacheHit
                          ? "cache"
                          : t.durationMs != null
                            ? `${t.durationMs.toFixed(1)}ms`
                            : "—"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {error ? (
          <div className="mt-3 text-sm text-red-200/90">
            <span className="font-medium">Error:</span> {error}
          </div>
        ) : null}
      </div>
    </div>
  );
}
