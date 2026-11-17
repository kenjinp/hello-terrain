import type { ParamRef } from "../../param/param.types";
import type { Getter, TaskRef } from "../../tasks/task.types";
import { TASK_DEF } from "../../tasks/task.types";
import type { CacheStrategy, Lane } from "../../types";
import type { Generation } from "../teardown";
import type { Execution, RunContext, RunDeps, RunState, TaskNodeRuntime } from "./types";

function holdOne(exec: Execution, g: Generation) {
  const reads = exec.reads;
  if (reads === undefined) exec.reads = [g];
  else if (reads.includes(g)) return;
  else reads.push(g);
  g.holders += 1;
}

/**
 * The execution now depends on what it just read: that generation is not torn down until
 * the value this execution produces has been. A value with no teardown of its own passes on
 * what it was built on, so the hold reaches through plain derived values.
 */
function hold(upstream: { gen?: Generation; reads?: Generation[] }, exec: Execution) {
  const own = upstream.gen;
  if (own !== undefined) {
    holdOne(exec, own);
    return;
  }
  const through = upstream.reads;
  if (through !== undefined) for (let i = 0; i < through.length; i++) holdOne(exec, through[i]);
}

type GetFactoryArgs<L extends Lane, Res> = {
  deps: RunDeps;
  state: RunState<L, Res>;
  ctx: RunContext<L, Res>;
  taskId: string;
  dependenciesSeen: Set<string>;
  /**
   * The version of each dependency at the moment it was read. Stamped here and not when the task
   * finishes: an overlapping run may replace a dependency while this task is still computing,
   * and the task must then count as built on the old one.
   */
  versionsSeen: Map<string, number>;
  exec: Execution;
};

function ensureValidRef(taskId: string, ref: any) {
  if (!ref || typeof ref !== "object" || !("id" in ref)) {
    throw new Error(`Task "${taskId}" called get() with an invalid ref`);
  }
}

export function createGetForDiscovery<L extends Lane, Res>(args: GetFactoryArgs<L, Res>): Getter {
  const { deps, state, taskId, dependenciesSeen, versionsSeen, exec, ctx } = args;

  return <T>(refAny: any): T => {
    if (exec.workCalled) {
      throw new Error(
        `Task "${taskId}" called get() after work(). Read all dependencies before calling work().`,
      );
    }

    ensureValidRef(taskId, refAny);
    dependenciesSeen.add(refAny.id);

    if (deps.isParam(refAny)) {
      const ref = refAny as ParamRef<any>;
      const node = state.ensureParamRegistered(ref);
      if (!versionsSeen.has(ref.id)) versionsSeen.set(ref.id, node.version);
      return (node.bound ? node.bound.value : ref.get()) as T;
    }

    if (deps.isTask(refAny)) {
      const ref = refAny as TaskRef<any>;
      state.ensureTaskRegistered(ref as any);

      const upstream = state.tasksMap.get(ref.id);
      if (!upstream) throw new deps.UnknownTaskError(ref.id);

      const cache = upstream.ref[TASK_DEF].options.cache ?? ("memo" as CacheStrategy);
      const computedThisRun = (upstream as any).lastComputedRunId === ctx.runId;
      if (
        upstream.state === "ready" &&
        ((cache !== "none" && !state.isTaskDirty(upstream as TaskNodeRuntime<L, Res>)) ||
          computedThisRun)
      ) {
        if (!versionsSeen.has(ref.id)) versionsSeen.set(ref.id, upstream.version);
        hold(upstream, exec);
        return upstream.value as T;
      }

      throw new deps.MissingTaskValueError(ref.id);
    }

    throw new deps.UnknownNodeError(refAny.id);
  };
}

export function createGetForCompiled<L extends Lane, Res>(args: GetFactoryArgs<L, Res>): Getter {
  const { deps, state, taskId, dependenciesSeen, versionsSeen, exec } = args;

  return <T>(refAny: any): T => {
    if (exec.workCalled) {
      throw new Error(
        `Task "${taskId}" called get() after work(). Read all dependencies before calling work().`,
      );
    }

    ensureValidRef(taskId, refAny);
    dependenciesSeen.add(refAny.id);

    if (deps.isParam(refAny)) {
      const ref = refAny as ParamRef<any>;
      const node = state.ensureParamRegistered(ref);
      if (!versionsSeen.has(ref.id)) versionsSeen.set(ref.id, node.version);
      return (node.bound ? node.bound.value : ref.get()) as T;
    }

    if (deps.isTask(refAny)) {
      const ref = refAny as TaskRef<any>;
      const upstream = state.tasksMap.get(ref.id);
      if (!upstream) throw new deps.UnknownTaskError(ref.id);
      if (upstream.state !== "ready") throw new deps.NoComputedValueError(ref.id);
      if (!versionsSeen.has(ref.id)) versionsSeen.set(ref.id, upstream.version);
      hold(upstream, exec);
      return upstream.value as T;
    }

    throw new deps.UnknownNodeError(refAny.id);
  };
}

