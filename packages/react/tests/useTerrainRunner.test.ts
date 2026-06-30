// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Matrix4, PerspectiveCamera, Vector3 } from "three";

const { writeUpdateParamsFromCamera } = vi.hoisted(() => ({
  writeUpdateParamsFromCamera: vi.fn(
    (params: unknown, camera: { uuid: string }, origin: { x: number; y: number; z: number }) => ({
      ...(params as object),
      camera,
      origin,
    }),
  ),
}));

vi.mock("@react-three/fiber", () => ({
  useFrame: vi.fn(),
}));

vi.mock("@hello-terrain/three", () => ({
  quadtreeUpdate: "quadtreeUpdate",
  writeUpdateParamsFromCamera,
  writeViewProjectionMatrix: vi.fn((out: Float64Array) => {
    for (let i = 0; i < 16; i += 1) out[i] = i * 0.01;
    return out;
  }),
}));

import { useFrame } from "@react-three/fiber";
import { useTerrainRunner } from "../src/useTerrainRunner.js";

function createGraph() {
  const graph = {
    set: vi.fn((_param: unknown, value: unknown) => {
      if (typeof value === "function") {
        value({
          cameraOrigin: { x: 0, y: 0, z: 0 },
          mode: "distance",
          distanceFactor: 1.5,
        });
      }
      return graph;
    }),
    run: vi.fn().mockResolvedValue({ status: "ok" }),
  };
  return graph;
}

function createRootState(canvasCamera: PerspectiveCamera) {
  return {
    camera: canvasCamera,
    gl: { backend: {} },
  };
}

function createCamera(position: [number, number, number]) {
  const camera = new PerspectiveCamera(50, 1, 0.1, 1000);
  camera.position.set(position[0], position[1], position[2]);
  camera.updateMatrixWorld();
  return camera;
}

describe("useTerrainRunner camera selection", () => {
  beforeEach(() => {
    vi.mocked(useFrame).mockClear();
    writeUpdateParamsFromCamera.mockClear();
  });

  it("uses the canvas camera when cameraRef is unset", async () => {
    const graph = createGraph();
    const canvasCamera = createCamera([0, 0, 10]);
    const cameraRef = { current: undefined as PerspectiveCamera | undefined };

    renderHook(() =>
      useTerrainRunner({
        graph: graph as never,
        cameraRef,
      }),
    );

    const frame = vi.mocked(useFrame).mock.calls.at(-1)?.[0];
    expect(frame).toBeTypeOf("function");
    await frame?.(createRootState(canvasCamera) as never);

    expect(writeUpdateParamsFromCamera).toHaveBeenCalled();
    const activeCamera = writeUpdateParamsFromCamera.mock.calls[0]?.[1];
    expect(activeCamera?.uuid).toBe(canvasCamera.uuid);
  });

  it("uses the custom camera from cameraRef instead of the canvas camera", async () => {
    const graph = createGraph();
    const canvasCamera = createCamera([0, 0, 10]);
    const customCamera = createCamera([40, 5, -12]);
    const cameraRef = { current: customCamera };

    renderHook(() =>
      useTerrainRunner({
        graph: graph as never,
        cameraRef,
      }),
    );

    const frame = vi.mocked(useFrame).mock.calls.at(-1)?.[0];
    await frame?.(createRootState(canvasCamera) as never);

    expect(writeUpdateParamsFromCamera).toHaveBeenCalled();
    const activeCamera = writeUpdateParamsFromCamera.mock.calls[0]?.[1];
    expect(activeCamera?.uuid).toBe(customCamera.uuid);
    expect(activeCamera?.uuid).not.toBe(canvasCamera.uuid);
  });

  it("defaults camera origin to the active custom camera position", async () => {
    const graph = createGraph();
    const canvasCamera = createCamera([0, 0, 10]);
    const customCamera = createCamera([12, 3, -7]);
    const cameraRef = { current: customCamera };

    renderHook(() =>
      useTerrainRunner({
        graph: graph as never,
        cameraRef,
      }),
    );

    const frame = vi.mocked(useFrame).mock.calls.at(-1)?.[0];
    await frame?.(createRootState(canvasCamera) as never);

    const origin = writeUpdateParamsFromCamera.mock.calls[0]?.[2];
    expect(origin).toEqual({ x: 12, y: 3, z: -7 });
  });

  it("prefers getCameraOrigin over the active camera position", async () => {
    const graph = createGraph();
    const canvasCamera = createCamera([0, 0, 10]);
    const customCamera = createCamera([12, 3, -7]);
    const cameraRef = { current: customCamera };
    const trackedOrigin = new Vector3(99, 1, -4);

    renderHook(() =>
      useTerrainRunner({
        graph: graph as never,
        cameraRef,
        getCameraOrigin: () => trackedOrigin,
      }),
    );

    const frame = vi.mocked(useFrame).mock.calls.at(-1)?.[0];
    await frame?.(createRootState(canvasCamera) as never);

    const origin = writeUpdateParamsFromCamera.mock.calls[0]?.[2];
    expect(origin).toEqual({ x: 99, y: 1, z: -4 });
  });

  it("detects view-projection changes from the custom camera", async () => {
    const graph = createGraph();
    const canvasCamera = createCamera([0, 0, 10]);
    const customCamera = createCamera([5, 0, 10]);
    const cameraRef = { current: customCamera };

    renderHook(() =>
      useTerrainRunner({
        graph: graph as never,
        cameraRef,
        cameraHysteresis: 0,
      }),
    );

    const frame = vi.mocked(useFrame).mock.calls.at(-1)?.[0];
    await frame?.(createRootState(canvasCamera) as never);
    writeUpdateParamsFromCamera.mockClear();
    graph.set.mockClear();

    customCamera.position.set(80, 0, 10);
    customCamera.updateMatrixWorld();
    customCamera.projectionMatrix.copy(new Matrix4().makePerspective(-0.2, 0.2, 0.2, -0.2, 1, 100));
    await frame?.(createRootState(canvasCamera) as never);

    expect(graph.set).toHaveBeenCalled();
    expect(writeUpdateParamsFromCamera).toHaveBeenCalled();
  });
});
