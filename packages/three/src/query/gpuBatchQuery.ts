import { Fn, If, compute, float, globalId, int, storage, uint, vec4 } from "three/tsl";
import type { StorageBufferAttribute, WebGPURenderer } from "three/webgpu";
import { StorageBufferAttribute as WebGPUStorageBufferAttribute } from "three/webgpu";
import type { TerrainSampler, GpuBatchQueryResult } from "./types";

export interface GpuBatchQueryOptions {
  method?: "sample" | "evaluate";
  outElevations?: Float32Array;
  outNormals?: Float32Array;
  outValid?: Uint8Array;
  normalEpsilon?: number;
  workgroupSize?: [number] | [number, number] | [number, number, number];
}

type RendererWithReadback = WebGPURenderer & {
  computeAsync?: (computeNode: unknown) => Promise<unknown>;
  getArrayBufferAsync?: (attribute: StorageBufferAttribute) => Promise<ArrayBuffer>;
};

function writePackedOutput(
  packed: Float32Array,
  validPacked: Float32Array,
  elevations: Float32Array,
  normals: Float32Array,
  valid: Uint8Array,
): void {
  const count = Math.min(
    Math.floor(packed.length / 4),
    elevations.length,
    valid.length,
  );
  for (let i = 0; i < count; i += 1) {
    const base = i * 4;
    const isValid = (validPacked[i] ?? 0) > 0.5 ? 1 : 0;
    valid[i] = isValid;
    elevations[i] = isValid ? (packed[base] ?? 0) : 0;
    if (normals.length >= (i + 1) * 3) {
      normals[i * 3] = isValid ? (packed[base + 1] ?? 0) : 0;
      normals[i * 3 + 1] = isValid ? (packed[base + 2] ?? 0) : 0;
      normals[i * 3 + 2] = isValid ? (packed[base + 3] ?? 0) : 0;
    }
  }
}

function createBatchComputeNode(
  sampler: TerrainSampler,
  positionsNode: ReturnType<typeof storage>,
  outputNode: ReturnType<typeof storage>,
  validNode: ReturnType<typeof storage>,
  method: "sample" | "evaluate",
  normalEpsilon: number,
  count: number,
  workgroupSize: [number] | [number, number] | [number, number, number],
) {
  return compute(
    Fn(() => {
      const idx = int(globalId.x).toVar();
      If(uint(globalId.x).lessThan(uint(count)), () => {
        const position = positionsNode.element(idx).toVar();
        if (method === "evaluate") {
          const height = sampler
            .evaluateElevation(position.x, position.y)
            .toVar();
          const normal = sampler
            .evaluateNormal(position.x, position.y, float(normalEpsilon))
            .toVar();
          validNode.element(idx).assign(int(1).toFloat());
          outputNode.element(idx).assign(
            vec4(height, normal.x, normal.y, normal.z),
          );
        } else {
          validNode.element(idx).assign(sampler.sampleValidity(position.x, position.y));
          outputNode.element(idx).assign(
            sampler.sampleTerrain(position.x, position.y),
          );
        }
      });
    })(),
    count,
    [...workgroupSize],
  );
}

async function queryTerrainBatchGpu(
  renderer: WebGPURenderer | undefined,
  sampler: TerrainSampler,
  positions: Float32Array,
  options: GpuBatchQueryOptions = {},
): Promise<GpuBatchQueryResult> {
  const count = Math.floor(positions.length / 2);
  const elevations = options.outElevations ?? new Float32Array(count);
  const normals = options.outNormals ?? new Float32Array(count * 3);
  const valid = options.outValid ?? new Uint8Array(count);
  valid.fill(0);
  const method = options.method ?? "sample";
  const normalEpsilon = options.normalEpsilon ?? 0.1;
  const workgroupSize = options.workgroupSize ?? [64];

  const maybeRenderer = renderer as RendererWithReadback | undefined;
  if (!maybeRenderer?.computeAsync || !maybeRenderer?.getArrayBufferAsync) {
    throw new Error(
      "queryTerrainBatchGpu requires a WebGPURenderer with computeAsync + getArrayBufferAsync.",
    );
  }

  if (!sampler) {
    throw new Error("queryTerrainBatchGpu requires a terrain sampler.");
  }

  const positionsAttribute = new WebGPUStorageBufferAttribute(positions, 2);
  const positionsNode = storage(positionsAttribute, "vec2", count)
    .toReadOnly()
    .setName("terrainBatchPositions");

  const packedOutput = new Float32Array(count * 4);
  const outputAttribute = new WebGPUStorageBufferAttribute(packedOutput, 4);
  const outputNode = storage(outputAttribute, "vec4", count).setName(
    "terrainBatchOutput",
  );
  const validOutput = new Float32Array(count);
  const validAttribute = new WebGPUStorageBufferAttribute(validOutput, 1);
  const validNode = storage(validAttribute, "float", count).setName(
    "terrainBatchValid",
  );

  const kernel = createBatchComputeNode(
    sampler,
    positionsNode,
    outputNode,
    validNode,
    method,
    normalEpsilon,
    count,
    workgroupSize,
  );

  await maybeRenderer.computeAsync!(kernel);
  const arrayBuffer = await maybeRenderer.getArrayBufferAsync!(outputAttribute);
  const validBuffer = await maybeRenderer.getArrayBufferAsync!(validAttribute);
  writePackedOutput(
    new Float32Array(arrayBuffer),
    new Float32Array(validBuffer),
    elevations,
    normals,
    valid,
  );

  return { elevations, normals, valid };
}

export type GpuBatchQueryRunner = (
  positions: Float32Array,
  options?: GpuBatchQueryOptions,
) => Promise<GpuBatchQueryResult>;

export function createGpuBatchQueryRunner(
  renderer: WebGPURenderer | undefined,
  sampler: TerrainSampler | undefined,
): GpuBatchQueryRunner {
  return async (positions, options) => {
    if (!sampler) {
      throw new Error(
        "gpuBatchQueryTask requires terrainTasks.createTerrainSampler to be available.",
      );
    }
    return queryTerrainBatchGpu(renderer, sampler, positions, options);
  };
}
