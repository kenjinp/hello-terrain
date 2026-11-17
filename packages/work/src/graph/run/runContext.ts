import type { Lane } from "../../types";
import type { RunOptions } from "../graph.types";
import type { RunContext, RunDeps } from "./types";

export function createRunContext<L extends Lane, Res>(
  deps: RunDeps,
  runId: string,
  startedAt: number,
  options: RunOptions<L, Res> | undefined,
  epoch: number,
): RunContext<L, Res> {
  const controller = new AbortController();
  let detach: VoidFunction | undefined;
  const outer = options?.signal;
  if (outer) {
    if (outer.aborted) controller.abort(outer.reason);
    else {
      // Removed when the run ends: a long-lived signal passed to every run must not collect one
      // listener, and with it one run context, per run.
      const onAbort = () => controller.abort(outer.reason);
      outer.addEventListener("abort", onAbort, { once: true });
      detach = () => outer.removeEventListener("abort", onAbort);
    }
  }
  const signal = controller.signal;

  const laneConcurrency = options?.laneConcurrency as Partial<Record<L, number>> | undefined;
  const laneConcurrencyEnabled = !!laneConcurrency && Object.keys(laneConcurrency).length > 0;

  const semaphoreByLane = new Map<L, ReturnType<RunDeps["semaphore"]>>();
  function getSemaphore(lane: L) {
    if (!laneConcurrencyEnabled) return undefined;
    const existing = semaphoreByLane.get(lane);
    if (existing) return existing;
    const permits = laneConcurrency![lane] ?? 1;
    const sema = deps.semaphore(permits);
    semaphoreByLane.set(lane, sema);
    return sema;
  }

  return {
    runId,
    startedAt,
    epoch,
    controller,
    pin: 0,
    signal,
    options,
    nowMs: deps.nowMs,
    getSemaphore,
    status: "ok",
    taskCount: 0,
    cacheHits: 0,
    detach,
  };
}

