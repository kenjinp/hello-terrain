import type { ScopeTeardownReason, TeardownReason } from "../tasks/task.types";
import { TASK_DEF } from "../tasks/task.types";
import type { GraphEvent, GraphEventType, GraphTeardownOptions } from "./graph.types";

const LIVE = 0;
const RETIRED = 1;
const TEARING = 2;
const DONE = 3;

/** One `ctx.scope` registration. */
export type ScopeEntry = {
  /** The object given to `use` or `adopt`. Unused for `defer`. */
  value: unknown;
  fn: (...args: any[]) => unknown;
  /** Registered with `defer`: called with the info only. */
  deferred: boolean;
};

/**
 * One value a task produced, with everything that has to be undone when it goes away.
 *
 * A generation moves live -> retired -> tearing -> done and never back, which is what makes
 * teardown run exactly once. It is torn down when both of these hold:
 *
 * - every run that started before it was retired has ended (it may still be reading it), and
 * - nothing built on it is left: each value records the generations it read through `get()` and
 *   holds them until it has been torn down itself, or replaced if it needs no teardown. A lease
 *   (`graph.use`) holds what it reads in the same way.
 *
 * Order therefore follows what was actually read, not the shape of the graph at teardown time.
 */
export type Generation = {
  readonly taskId: string;
  /** The task's `.teardown(fn)`, if it has one. */
  td: ((value: unknown, info: unknown) => unknown) | undefined;
  value: unknown;
  /** False when only the scope entries run: the value was kept, or its teardown is already queued. */
  withValue: boolean;
  entries: ScopeEntry[] | undefined;
  /** Generations this one was built on. They are not torn down before this one is. */
  reads: Generation[] | undefined;
  /** How many values, executions or leases currently hold this one through `reads`. */
  holders: number;
  state: number;
  /** Position in the retirement order. Runs that started before it pin the generation. */
  retiredSeq: number;
  reason: ScopeTeardownReason;
  /** What the execution threw, when `reason` is "failed". */
  error: unknown;
  /** How many teardown functions this generation runs. Known once it is retired. */
  count: number;
  /** `ctx.teardownPrevious()` released it. Whatever was computed from it meanwhile is stale. */
  revoked: boolean;
  info: InfoHandle | undefined;
  done: VoidFunction[] | undefined;
};

/** The slice of a task node the teardown runtime reads and writes. */
export type TeardownNode = {
  ref: { readonly id: string; readonly [TASK_DEF]: { options: { teardown?: unknown } } };
  value?: unknown;
  live: boolean;
  /** The current value's generation, when it has a teardown or scope entries. */
  gen?: Generation;
  /** What the current value was built on, when it has no generation of its own. */
  reads?: Generation[];
  /** Set when `dispose()` queued this node's value, so a run still in flight cannot queue it again. */
  disposed?: boolean;
};

export type TeardownCounts = {
  pending: number;
  held: number;
  completed: number;
  failed: number;
};

/** A teardown did not finish within `teardown.timeoutMs`. The graph moved on without it. */
export class TeardownTimeoutError extends Error {
  readonly taskId: string;
  readonly timeoutMs: number;
  constructor(taskId: string, timeoutMs: number) {
    super("Teardown of task " + taskId + " did not finish within " + timeoutMs + " ms");
    this.name = "TeardownTimeoutError";
    this.taskId = taskId;
    this.timeoutMs = timeoutMs;
  }
}

type InfoHandle = {
  /** What the teardown functions of one generation are given. */
  readonly info: { readonly reason: ScopeTeardownReason; readonly signal: AbortSignal };
  abort(error: unknown): void;
};

/** `signal` is lazy: an AbortController is only created for teardowns that ask for it. */
function createInfo(reason: ScopeTeardownReason, error: unknown): InfoHandle {
  let controller: AbortController | undefined;
  let aborted = false;
  let abortedWith: unknown;
  const info = {
    reason,
    get signal(): AbortSignal {
      if (!controller) {
        controller = new AbortController();
        if (aborted) controller.abort(abortedWith);
      }
      return controller.signal;
    },
  };
  if (reason === "failed") (info as { error?: unknown }).error = error;
  return {
    info,
    abort(cause) {
      aborted = true;
      abortedWith = cause;
      controller?.abort(cause);
    },
  };
}

/** Only objects and functions have an identity that can outlive an execution. */
export function isReference(value: unknown): boolean {
  return value !== null && (typeof value === "object" || typeof value === "function");
}

/** Whether `value` was already registered with `use` or `adopt`. */
export function owns(entries: ScopeEntry[] | undefined, value: unknown): boolean {
  if (entries === undefined) return false;
  for (let i = 0; i < entries.length; i++) {
    if (!entries[i].deferred && entries[i].value === value) return true;
  }
  return false;
}

/** Hands an error nobody is listening for to the host instead of dropping it. */
function report(error: unknown) {
  const host = globalThis as { reportError?: (e: unknown) => void };
  if (typeof host.reportError === "function") host.reportError(error);
  else console.error(error);
}

export function createTeardown(args: {
  options: GraphTeardownOptions | undefined;
  emit(e: GraphEvent): void;
  shouldEmit(type: GraphEventType): boolean;
  nowMs(): number;
  /** The oldest `mark()` among the runs still active, or Infinity when there are none. */
  oldestPin(): number;
  /** Every task downstream of `taskId`, dependents before the tasks they depend on. */
  dependentsOf(taskId: string): TeardownNode[];
  /** A dependent lost the value it was built on and has to recompute. */
  invalidate(node: TeardownNode): void;
}) {
  const { options, emit, shouldEmit, nowMs, oldestPin, dependentsOf, invalidate } = args;
  const timeoutMs = options?.timeoutMs ?? 30_000;
  const schedule = options?.schedule;

  let seq = 0;
  /** Every retired generation that has not finished, in retirement order. `pump()` compacts it. */
  const waiting: Generation[] = [];
  /** How many generations were handed to the scheduler or are running. */
  let tearingCount = 0;
  /** How many generations are retired and not done, whether or not they could start. */
  let unfinished = 0;
  /** The batch being flushed. Whatever it frees up joins it instead of waiting another tick. */
  let draining: Generation[] | undefined;
  let idle: VoidFunction[] = [];
  let disposeErrors: unknown[] | undefined;
  /** Teardown functions of retired generations that have not finished. */
  let pending = 0;
  /** The part of `pending` that has not started: a run, a lease or a dependent still holds it. */
  let held = 0;
  let completed = 0;
  let failed = 0;

  function declared(n: TeardownNode): Generation["td"] {
    return n.ref[TASK_DEF].options.teardown as Generation["td"];
  }

  function generation(
    taskId: string,
    value: unknown,
    td: Generation["td"],
    entries: ScopeEntry[] | undefined,
    reads: Generation[] | undefined,
  ): Generation {
    return {
      taskId,
      td,
      value,
      withValue: true,
      entries,
      reads,
      holders: 0,
      state: LIVE,
      retiredSeq: 0,
      reason: "replaced",
      error: undefined,
      count: 0,
      revoked: false,
      info: undefined,
      done: undefined,
    };
  }

  /** Marks a generation retired and counts what it will run. It does not queue it. */
  function account(g: Generation, reason: ScopeTeardownReason) {
    g.state = RETIRED;
    g.reason = reason;
    g.retiredSeq = ++seq;
    unfinished += 1;
    if (g.td === undefined) g.withValue = false;
    g.count = (g.withValue ? 1 : 0) + (g.entries ? g.entries.length : 0);
    pending += g.count;
    held += g.count;
  }

  function retire(g: Generation, reason: ScopeTeardownReason) {
    account(g, reason);
    waiting.push(g);
  }

  /** Drops holds. Whatever that frees up starts tearing down. */
  function release(reads: Generation[]) {
    let ready: Generation[] | undefined;
    let oldest = -1;
    for (let i = 0; i < reads.length; i++) {
      const r = reads[i];
      r.holders -= 1;
      if (r.holders === 0 && r.state === RETIRED) {
        if (oldest < 0) oldest = oldestPin();
        if (r.retiredSeq <= oldest) (ready ??= []).push(r);
      }
    }
    if (ready) start(ready);
  }

  /** Starts every retired generation that is no longer pinned by a run or held by a dependent. */
  function pump() {
    if (waiting.length === 0) return;
    const oldest = oldestPin();
    let ready: Generation[] | undefined;
    let kept = 0;
    for (let i = 0; i < waiting.length; i++) {
      const g = waiting[i];
      if (g.state === DONE) continue;
      if (g.state === RETIRED && g.holders === 0 && g.retiredSeq <= oldest) (ready ??= []).push(g);
      waiting[kept++] = g;
    }
    waiting.length = kept;
    if (ready) start(ready);
  }

  function begin(g: Generation) {
    g.state = TEARING;
    held -= g.count;
    tearingCount += 1;
  }

  function start(ready: Generation[]) {
    for (let i = 0; i < ready.length; i++) begin(ready[i]);
    if (draining) {
      for (let i = 0; i < ready.length; i++) draining.push(ready[i]);
      return;
    }
    let flushed = false;
    const flush = () => {
      if (flushed) return;
      flushed = true;
      const outer = draining;
      draining = ready;
      try {
        // `ready` grows while it is walked: a teardown that finishes synchronously frees the
        // generations it held, and they run in this same flush.
        for (let i = 0; i < ready.length; i++) step(ready[i], 0);
      } finally {
        draining = outer;
      }
    };
    if (!schedule) {
      queueMicrotask(flush);
      return;
    }
    try {
      schedule(flush);
    } catch (error) {
      // A failing scheduler must not strand the teardowns behind it.
      report(error);
      flush();
    }
  }

  /**
   * A listener that throws must not reach the teardown machinery: it would strand every
   * teardown behind it.
   */
  function notify(e: GraphEvent) {
    try {
      emit(e);
    } catch (error) {
      report(error);
    }
  }

  function settle(g: Generation, startedAt: number, threw: boolean, error?: unknown) {
    pending -= 1;
    if (threw) {
      failed += 1;
      const disposing = g.reason === "disposed" && disposeErrors !== undefined;
      if (disposing) disposeErrors!.push(error);
      if (shouldEmit("teardown:error"))
        notify({ type: "teardown:error", taskId: g.taskId, at: nowMs(), reason: g.reason, error });
      else if (!disposing) report(error);
      return;
    }
    completed += 1;
    if (startedAt >= 0) {
      const at = nowMs();
      notify({
        type: "teardown:finish",
        taskId: g.taskId,
        at,
        durationMs: Math.max(0, at - startedAt),
        reason: g.reason,
      });
    }
  }

  /**
   * Runs a generation's teardown functions from index `i`: the task's `.teardown(fn)` first,
   * then the scope entries newest first, one after another. Stays synchronous until one of them
   * returns a promise.
   */
  function step(g: Generation, i: number) {
    const entries = g.entries;
    const total = 1 + (entries ? entries.length : 0);
    const timed = shouldEmit("teardown:finish");
    for (; i < total; i++) {
      if (i === 0 && !g.withValue) continue;
      const startedAt = timed ? nowMs() : -1;
      const info = (g.info ??= createInfo(g.reason, g.error)).info;
      let result: any;
      try {
        if (i === 0) {
          result = g.td!(g.value, info);
        } else {
          const entry = entries![total - 1 - i];
          result = entry.deferred ? entry.fn(info) : entry.fn(entry.value, info);
        }
      } catch (error) {
        settle(g, startedAt, true, error);
        continue;
      }
      if (result && typeof result.then === "function") {
        wait(g, result, startedAt, i + 1);
        return;
      }
      settle(g, startedAt, false);
    }
    finish(g);
  }

  /** Waits for an async teardown function, but not past the deadline. */
  function wait(g: Generation, result: PromiseLike<unknown>, startedAt: number, next: number) {
    let open = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = (threw: boolean, error?: unknown) => {
      if (!open) return;
      open = false;
      if (timer !== undefined) clearTimeout(timer);
      settle(g, startedAt, threw, error);
      step(g, next);
    };
    if (timeoutMs !== Number.POSITIVE_INFINITY) {
      timer = setTimeout(() => {
        const error = new TeardownTimeoutError(g.taskId, timeoutMs);
        g.info?.abort(error);
        done(true, error);
      }, timeoutMs);
      (timer as { unref?: VoidFunction }).unref?.();
    }
    result.then(
      () => done(false),
      (error) => done(true, error),
    );
  }

  function finish(g: Generation) {
    g.state = DONE;
    tearingCount -= 1;
    unfinished -= 1;
    const reads = g.reads;
    g.reads = undefined;
    g.entries = undefined;
    g.value = undefined;
    g.error = undefined;
    g.td = undefined;
    g.info = undefined;
    if (reads) release(reads);

    const done = g.done;
    if (done) {
      g.done = undefined;
      for (let i = 0; i < done.length; i++) done[i]();
    }
    if (tearingCount === 0) {
      pump();
      if (tearingCount === 0 && idle.length) {
        const waiters = idle;
        idle = [];
        for (let i = 0; i < waiters.length; i++) waiters[i]();
      }
    }
  }

  function whenDone(g: Generation): Promise<void> | undefined {
    if (g.state === DONE) return undefined;
    return new Promise<void>((resolve) => (g.done ??= []).push(resolve));
  }

  /**
   * Tears a generation down now, whatever still pins or holds it. Generations that were already
   * retired and were built on it go first, so the order inside the graph is kept. Runs and
   * leases that overlap are not protected: that is what tearing down before creating means.
   */
  async function force(g: Generation, reason: TeardownReason): Promise<void> {
    if (g.state === LIVE || g.state === RETIRED) {
      for (const w of waiting.slice()) {
        if (w === g || !w.reads?.includes(g)) continue;
        if (w.state === RETIRED) await force(w, w.reason as TeardownReason);
        else if (w.state === TEARING) await whenDone(w);
      }
    }
    if (g.state === LIVE) account(g, reason);
    if (g.state === RETIRED) {
      begin(g);
      step(g, 0);
    }
    await whenDone(g);
  }

  /** Takes a node's value away from it. Returns the generation that now has to be torn down. */
  function detach(n: TeardownNode): Generation | undefined {
    const g = n.gen;
    const reads = n.reads;
    n.gen = undefined;
    n.reads = undefined;
    n.live = false;
    n.value = undefined;
    if (g) g.revoked = true;
    if (reads) release(reads);
    return g;
  }

  async function forceAll(gens: Generation[]): Promise<void> {
    for (let i = 0; i < gens.length; i++) await force(gens[i], "released");
  }

  /**
   * Releases a task's value under its dependents. Every value built on it is taken away from
   * its task right now, so nothing can read it from here on; then they are torn down one after
   * another, dependents first.
   */
  function cascade(n: TeardownNode): Promise<void> {
    const gens: Generation[] = [];
    const downstream = dependentsOf(n.ref.id);
    for (let i = 0; i < downstream.length; i++) {
      const d = downstream[i];
      if (!d.gen && !d.live && !d.reads) continue;
      const dg = detach(d);
      invalidate(d);
      if (dg) gens.push(dg);
    }
    const g = detach(n);
    if (g) gens.push(g);
    return forceAll(gens);
  }

  return {
    /** The current position in the retirement order. A run records it when it starts. */
    mark(): number {
      return seq;
    },

    /** Drops the holds of an execution that did not produce a value, or of a lease that ended. */
    release,

    /**
     * Keeps a task's current value, and what it was built on, from being torn down until the
     * returned holds are released. This is what a lease is.
     */
    hold(n: TeardownNode): Generation[] | undefined {
      const holds = n.gen ? [n.gen] : n.reads?.slice();
      if (!holds) return undefined;
      for (let i = 0; i < holds.length; i++) holds[i].holders += 1;
      return holds;
    },

    /**
     * A task produced `next`. Retires what its previous value left behind and records what the
     * new one is made of.
     */
    replace(
      n: TeardownNode,
      next: unknown,
      entries: ScopeEntry[] | undefined,
      reads: Generation[] | undefined,
    ) {
      const old = n.gen;
      const same = n.live && Object.is(n.value, next);
      // Scope entries follow the object. Two equal primitives (or two `undefined`s from a task
      // that returns nothing) say nothing about whether what the entries guard was kept.
      if (same && isReference(next)) {
        // Carried over. Returning the previous value asserts it is valid for the dependencies
        // just read, so those replace whatever it held before.
        const before = old ? old.reads : n.reads;
        if (old) {
          if (entries) {
            if (old.entries) {
              // The same object registered again by a later execution is still one object.
              for (let i = 0; i < entries.length; i++) {
                const e = entries[i];
                if (e.deferred || !isReference(e.value) || !owns(old.entries, e.value))
                  old.entries.push(e);
              }
            } else {
              old.entries = entries;
            }
          }
          old.reads = reads;
        } else if (entries) {
          n.gen = generation(n.ref.id, next, declared(n), entries, reads);
          n.reads = undefined;
        } else {
          n.reads = reads;
        }
        if (before) release(before);
        return;
      }

      if (old) {
        // An equal primitive stays the task's value; only what the old execution set up goes.
        if (same) old.withValue = false;
        retire(old, "replaced");
      } else if (n.reads) {
        release(n.reads);
      }
      const td = declared(n);
      if (entries || td) {
        n.gen = generation(n.ref.id, next, td, entries, reads);
        n.reads = undefined;
      } else {
        n.gen = undefined;
        n.reads = reads;
      }
    },

    /**
     * `ctx.teardownPrevious()`: tears the task's value down now, under its dependents, before
     * the task creates the next one. Returns nothing when there is no previous value.
     */
    releasePrevious(n: TeardownNode): Promise<void> | undefined {
      return n.live || n.gen ? cascade(n) : undefined;
    },

    /** Whether an execution read a value that `ctx.teardownPrevious()` has since torn down. */
    revoked(reads: Generation[]): boolean {
      for (let i = 0; i < reads.length; i++) if (reads[i].revoked) return true;
      return false;
    },

    /**
     * An execution threw. What it registered guards things nobody else can reach, so it runs
     * straight away instead of waiting for the run to end.
     */
    discard(
      taskId: string,
      entries: ScopeEntry[] | undefined,
      reads: Generation[] | undefined,
      error: unknown,
    ) {
      if (!entries) {
        if (reads) release(reads);
        return;
      }
      const g = generation(taskId, undefined, undefined, entries, reads);
      g.error = error;
      retire(g, "failed");
      start([g]);
    },

    /**
     * A value nobody will ever read: it arrived after the graph was disposed, or it was computed
     * from a value that `ctx.teardownPrevious()` tore down in the meantime.
     */
    orphan(
      n: TeardownNode,
      value: unknown,
      entries: ScopeEntry[] | undefined,
      reads: Generation[] | undefined,
      reason: "disposed" | "released",
    ) {
      // `work(prev => prev)` hands back a value that is already queued, or still the task's.
      const queued = (n.disposed === true || n.live) && Object.is(value, n.value);
      const td = declared(n);
      if (!entries && (queued || td === undefined)) {
        if (reads) release(reads);
        return;
      }
      const g = generation(n.ref.id, value, td, entries, reads);
      g.withValue = !queued;
      retire(g, reason);
    },

    /** Retires every live value. Order comes from what each one was built on. */
    disposeAll(nodes: Iterable<TeardownNode>) {
      disposeErrors ??= [];
      for (const n of nodes) {
        const g = n.gen;
        if (g) {
          n.gen = undefined;
          n.disposed = true;
          retire(g, "disposed");
        } else if (n.reads) {
          const reads = n.reads;
          n.reads = undefined;
          release(reads);
        }
        n.live = false;
      }
    },

    /** The teardown failures since `disposeAll`, handed over once. */
    takeDisposeErrors(): unknown[] {
      const errors = disposeErrors ?? [];
      disposeErrors = undefined;
      return errors;
    },

    pump,

    counts(): TeardownCounts {
      return { pending, held, completed, failed };
    },

    /** Resolves once nothing is tearing down or about to. Held generations are not waited for. */
    async settled(): Promise<void> {
      while (tearingCount > 0) await new Promise<void>((resolve) => idle.push(resolve));
    },

    /**
     * Resolves once every retired generation has been torn down, including the ones a lease or a
     * run is still keeping alive. `dispose()` waits on this.
     */
    async drained(): Promise<void> {
      while (unfinished > 0) await new Promise<void>((resolve) => idle.push(resolve));
    },
  };
}

export type Teardown = ReturnType<typeof createTeardown>;
