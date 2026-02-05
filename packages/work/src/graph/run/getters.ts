import type { ParamRef } from "../../param/param.types";
import type { Getter, TaskRef } from "../../tasks/task.types";
import { TASK_DEF } from "../../tasks/task.types";
import type { CacheStrategy, Lane } from "../../types";
import type { RunContext, RunDeps, RunState, TaskNodeRuntime } from "./types";

type WorkCalledRef = { value: boolean };

type GetFactoryArgs<L extends Lane, Res> = {
  deps: RunDeps;
  state: RunState<L, Res>;
  ctx: RunContext<L, Res>;
  taskId: string;
  dependenciesSeen: Set<string>;
  workCalled: WorkCalledRef;
};

function ensureValidRef(taskId: string, ref: any) {
  if (!ref || typeof ref !== "object" || !("id" in ref)) {
    throw new Error(`Task "${taskId}" called get() with an invalid ref`);
  }
}

export function createGetForDiscovery<L extends Lane, Res>(args: GetFactoryArgs<L, Res>): Getter {
  const { deps, state, taskId, dependenciesSeen, workCalled, ctx } = args;

  return <T>(refAny: any): T => {
    if (workCalled.value) {
      throw new Error(
        `Task "${taskId}" called get() after work(). Read all dependencies before calling work().`,
      );
    }

    ensureValidRef(taskId, refAny);
    dependenciesSeen.add(refAny.id);

    if (deps.isParam(refAny)) {
      const ref = refAny as ParamRef<any>;
      state.ensureParamRegistered(ref);
      return ref.get() as T;
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
        return upstream.value as T;
      }

      throw new deps.MissingTaskValueError(ref.id);
    }

    throw new deps.UnknownNodeError(refAny.id);
  };
}

export function createGetForCompiled<L extends Lane, Res>(args: GetFactoryArgs<L, Res>): Getter {
  const { deps, state, taskId, dependenciesSeen, workCalled } = args;

  return <T>(refAny: any): T => {
    if (workCalled.value) {
      throw new Error(
        `Task "${taskId}" called get() after work(). Read all dependencies before calling work().`,
      );
    }

    ensureValidRef(taskId, refAny);
    dependenciesSeen.add(refAny.id);

    if (deps.isParam(refAny)) {
      const ref = refAny as ParamRef<any>;
      state.ensureParamRegistered(ref);
      return ref.get() as T;
    }

    if (deps.isTask(refAny)) {
      const ref = refAny as TaskRef<any>;
      const upstream = state.tasksMap.get(ref.id);
      if (!upstream) throw new deps.UnknownTaskError(ref.id);
      if (upstream.state !== "ready") throw new deps.NoComputedValueError(ref.id);
      return upstream.value as T;
    }

    throw new deps.UnknownNodeError(refAny.id);
  };
}

