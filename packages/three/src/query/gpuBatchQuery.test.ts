import { vec3, vec4 } from "three/tsl";
import { describe, expect, it, vi } from "vitest";
import { createGpuBatchQueryRunner } from "./gpuBatchQuery.js";

describe("query/gpuBatchQuery", () => {
  it("throws when renderer GPU hooks are unavailable", async () => {
    const runner = createGpuBatchQueryRunner(undefined, {
      sampleElevation: () => vec4(0, 0, 0, 0).x,
      sampleNormal: () => vec3(0, 1, 0),
      sampleTerrain: () => vec4(0, 0, 1, 0),
      sampleValidity: () => vec4(1, 0, 0, 0).x,
      evaluateElevation: () => vec4(0, 0, 0, 0).x,
      evaluateNormal: () => vec3(0, 1, 0),
    });
    await expect(
      runner(new Float32Array([0, 0])),
    ).rejects.toThrow(
      /requires a WebGPURenderer with computeAsync \+ getArrayBufferAsync/i,
    );
  });

  it("uses renderer compute/readback path when runner is invoked", async () => {
    const packed = new Float32Array([
      3, 0, 1, 0, // sample 0
      7, 0, 1, 0, // sample 1
    ]);
    const validPacked = new Float32Array([1, 0]);

    const computeAsync = vi.fn(async () => {});
    const getArrayBufferAsync = vi
      .fn()
      .mockResolvedValueOnce(packed.buffer)
      .mockResolvedValueOnce(validPacked.buffer);
    const renderer = {
      computeAsync,
      getArrayBufferAsync,
    };

    const sampler = {
      sampleElevation: () => vec4(0, 0, 0, 0).x,
      sampleNormal: () => vec3(0, 1, 0),
      sampleTerrain: () => vec4(0, 0, 1, 0),
      sampleValidity: () => vec4(1, 0, 0, 0).x,
      evaluateElevation: () => vec4(0, 0, 0, 0).x,
      evaluateNormal: () => vec3(0, 1, 0),
    };
    const runner = createGpuBatchQueryRunner(renderer as any, sampler as any);
    const result = await runner(new Float32Array([0, 0, 1, 1]));

    expect(computeAsync).toHaveBeenCalledTimes(1);
    expect(getArrayBufferAsync).toHaveBeenCalledTimes(2);
    expect(result.elevations[0]).toBe(3);
    expect(result.elevations[1]).toBe(0);
    expect(result.normals[1]).toBe(1);
    expect(result.valid[0]).toBe(1);
    expect(result.valid[1]).toBe(0);
  });

  it("accepts method='evaluate' option", async () => {
    const packed = new Float32Array([
      9, 0, 1, 0,
    ]);
    const validPacked = new Float32Array([1]);
    const computeAsync = vi.fn(async () => {});
    const getArrayBufferAsync = vi
      .fn()
      .mockResolvedValueOnce(packed.buffer)
      .mockResolvedValueOnce(validPacked.buffer);
    const renderer = { computeAsync, getArrayBufferAsync };
    const sampler = {
      sampleElevation: () => vec4(0, 0, 0, 0).x,
      sampleNormal: () => vec3(0, 1, 0),
      sampleTerrain: () => vec4(0, 0, 1, 0),
      sampleValidity: () => vec4(1, 0, 0, 0).x,
      evaluateElevation: () => vec4(0, 0, 0, 0).x,
      evaluateNormal: () => vec3(0, 1, 0),
    };
    const runner = createGpuBatchQueryRunner(renderer as any, sampler as any);
    const result = await runner(new Float32Array([0, 0]), { method: "evaluate" });
    expect(computeAsync).toHaveBeenCalledTimes(1);
    expect(result.elevations[0]).toBe(9);
    expect(result.valid[0]).toBe(1);
  });

  it("throws when sampler is missing", async () => {
    const runner = createGpuBatchQueryRunner({} as any, undefined);
    await expect(runner(new Float32Array([0, 0]))).rejects.toThrow(
      /requires terrainTasks\.createTerrainSampler/i,
    );
  });
});
