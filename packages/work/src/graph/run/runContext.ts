import type { Lane } from "../../types";
import type { RunOptions } from "../graph.types";
import type { RunContext, RunDeps } from "./types";

export function createRunContext<L extends Lane, Res>(
  deps: RunDeps,
  runId: string,
  startedAt: number,
  options?: RunOptions<L, Res>,
): RunContext<L, Res> {
  const controller = new AbortController();
  if (options?.signal) {
    if (options.signal.aborted) controller.abort(options.signal.reason);
    else {
      options.signal.addEventListener("abort", () => controller.abort(options.signal!.reason), {
        once: true,
      });
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
    controller,
    signal,
    options,
    nowMs: deps.nowMs,
    getSemaphore,
    status: "ok",
    taskCount: 0,
    cacheHits: 0,
  };
}

