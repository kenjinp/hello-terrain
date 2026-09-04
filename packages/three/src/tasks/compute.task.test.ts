import { describe, expect, it } from "vitest";
import {
  compileComputeTask,
  createComputePipelineTasks,
  executeComputeTask,
} from "./compute.task";
import { terrainFieldStageTask } from "./terrain-field.task";

describe("createComputePipelineTasks", () => {
  it("uses the default display names when no name is given", () => {
    const { compile, execute } = createComputePipelineTasks(terrainFieldStageTask);
    expect(compile.name).toBe("compileComputeTask");
    expect(execute.name).toBe("executeComputeTask");
    expect(compileComputeTask.name).toBe("compileComputeTask");
    expect(executeComputeTask.name).toBe("executeComputeTask");
  });

  it("derives `${name}CompileTask` / `${name}ExecuteTask` from options.name", () => {
    const { compile, execute } = createComputePipelineTasks(terrainFieldStageTask, {
      name: "erosion",
    });
    expect(compile.name).toBe("erosionCompileTask");
    expect(execute.name).toBe("erosionExecuteTask");
    // Distinct refs from the built-in pipeline so both can coexist in a graph.
    expect(compile.id).not.toBe(compileComputeTask.id);
    expect(execute.id).not.toBe(executeComputeTask.id);
  });
});
