import { Fn, int, vec4 } from "three/tsl";
import { type ComputeNode, type Node, WebGPURenderer } from "three/webgpu";
import { describe, expect, it } from "vitest";
import {
  type TerrainFieldStorageBackendType,
  createTerrainFieldStorage,
  storeTerrainField,
} from "./terrainFieldStorage";

type ComputeNodeBuilder = {
  compute: ComputeNode;
  computeShader: string;
  build(): void;
};

type RendererWithNodeBuilder = WebGPURenderer & {
  backend: {
    createNodeBuilder(object: ComputeNode, renderer: WebGPURenderer): ComputeNodeBuilder;
  };
};

/**
 * Generates the WGSL compute shader for `kernel` without a GPU device: the
 * WebGPU backend's node builder only needs a canvas-shaped object, and feature
 * queries are answered as "unsupported".
 */
function buildComputeWgsl(kernel: ComputeNode): string {
  const canvas = {
    style: {},
    addEventListener() {},
    removeEventListener() {},
  } as unknown as HTMLCanvasElement;
  const renderer = new WebGPURenderer({ canvas }) as RendererWithNodeBuilder;
  renderer.hasFeature = () => false;
  const builder = renderer.backend.createNodeBuilder(kernel, renderer);
  builder.compute = kernel;
  builder.build();
  return builder.computeShader;
}

/** Top-level arguments of the first `textureStore( ... )` call in `wgsl`. */
function textureStoreArgs(wgsl: string): string[] {
  const start = wgsl.indexOf("textureStore(");
  expect(start).toBeGreaterThanOrEqual(0);
  const args: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of wgsl.slice(start + "textureStore(".length)) {
    if (char === "(") depth++;
    if (char === ")" && depth-- === 0) break;
    if (char === "," && depth === 0) {
      args.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  args.push(current.trim());
  return args;
}

function storeWgsl(backend: TerrainFieldStorageBackendType, tileIndex: number): string {
  const storage = createTerrainFieldStorage(4, 8, undefined, { backend });
  const kernel = Fn(() => {
    storeTerrainField(storage, int(1), int(2), int(tileIndex), vec4(0.25) as unknown as Node);
  })().compute(1);
  return buildComputeWgsl(kernel);
}

describe("storeTerrainField WGSL", () => {
  it.each(["array-texture", "texture-3d"] as const)(
    "%s backend writes the tile into its array layer",
    (backend) => {
      const wgsl = storeWgsl(backend, 5);
      expect(wgsl).toContain("texture_storage_2d_array<rgba16float, write>");
      // textureStore(texture_storage_2d_array, coords: vec2, array_index, value)
      const args = textureStoreArgs(wgsl);
      expect(args).toHaveLength(4);
      expect(args[2]).toBe("5");
    },
  );

  it("atlas backend writes a 2D texel with no array layer", () => {
    const wgsl = storeWgsl("atlas", 5);
    expect(wgsl).toContain("texture_storage_2d<rgba16float, write>");
    expect(textureStoreArgs(wgsl)).toHaveLength(3);
  });
});
