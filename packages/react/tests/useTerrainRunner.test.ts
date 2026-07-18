// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Matrix4, PerspectiveCamera, Vector3 } from "three";

const { readCameraView } = vi.hoisted(() => ({
  readCameraView: vi.fn(
    (
      camera: { uuid: string },
      out: { cameraOrigin: { x: number; y: number; z: number } },
      origin: { x: number; y: number; z: number },
    ) => {
      out.cameraOrigin.x = origin.x;
      out.cameraOrigin.y = origin.y;
      out.cameraOrigin.z = origin.z;
      return out;
    },
  ),
}));

vi.mock("@react-three/fiber", () => ({
  useFrame: vi.fn(),
}));

vi.mock("@hello-terrain/three", () => ({
  cameraView: "cameraView",
  residencyAnchors: "residencyAnchors",
  readCameraView,
  cloneResidencyAnchors: vi.fn((anchors: unknown) => anchors ?? []),
  createCameraViewEquals: vi.fn(() => () => false),
  createResidencyAnchorsEquals: vi.fn(() => () => false),
  DEFAULT_CAMERA_ORIGIN_HYSTERESIS: 0.05,
  DEFAULT_RESIDENCY_HYSTERESIS: 0.05,
}));

import { useFrame } from "@react-three/fiber";
import { cameraView, residencyAnchors } from "@hello-terrain/three";
import { useTerrainRunner } from "../src/useTerrainRunner.js";

function createGraph() {
  const graph = {
    set: vi.fn().mockReturnThis(),
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
    readCameraView.mockClear();
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
    await frame?.(createRootState(canvasCamera) as never, 0);

    expect(readCameraView).toHaveBeenCalled();
    const activeCamera = readCameraView.mock.calls[0]?.[0];
    expect(activeCamera?.uuid).toBe(canvasCamera.uuid);
    expect(graph.set).toHaveBeenCalledWith(cameraView, expect.any(Object));
    expect(graph.run).toHaveBeenCalled();
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
    await frame?.(createRootState(canvasCamera) as never, 0);

    const activeCamera = readCameraView.mock.calls[0]?.[0];
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
    await frame?.(createRootState(canvasCamera) as never, 0);

    const origin = readCameraView.mock.calls[0]?.[2];
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
        culling: {
          getCameraOrigin: () => trackedOrigin,
        },
      }),
    );

    const frame = vi.mocked(useFrame).mock.calls.at(-1)?.[0];
    await frame?.(createRootState(canvasCamera) as never, 0);

    const origin = readCameraView.mock.calls[0]?.[2];
    expect(origin).toEqual({ x: 99, y: 1, z: -4 });
  });

  it("updates cameraView when the custom camera moves", async () => {
    const graph = createGraph();
    const canvasCamera = createCamera([0, 0, 10]);
    const customCamera = createCamera([5, 0, 10]);
    const cameraRef = { current: customCamera };

    renderHook(() =>
      useTerrainRunner({
        graph: graph as never,
        cameraRef,
        culling: {
          originHysteresis: 0,
        },
      }),
    );

    const frame = vi.mocked(useFrame).mock.calls.at(-1)?.[0];
    await frame?.(createRootState(canvasCamera) as never, 0);
    readCameraView.mockClear();
    graph.set.mockClear();

    customCamera.position.set(80, 0, 10);
    customCamera.updateMatrixWorld();
    customCamera.projectionMatrix.copy(new Matrix4().makePerspective(-0.2, 0.2, 0.2, -0.2, 1, 100));
    await frame?.(createRootState(canvasCamera) as never, 0);

    expect(graph.set).toHaveBeenCalledWith(cameraView, expect.any(Object));
    expect(readCameraView).toHaveBeenCalled();
  });

  it("sets residency anchors when provided", async () => {
    const graph = createGraph();
    const canvasCamera = createCamera([0, 0, 10]);
    const cameraRef = { current: undefined as PerspectiveCamera | undefined };

    renderHook(() =>
      useTerrainRunner({
        graph: graph as never,
        cameraRef,
        residency: {
          getAnchors: () => [{ position: { x: 1, y: 2, z: 3 }, radius: 4 }],
        },
      }),
    );

    const frame = vi.mocked(useFrame).mock.calls.at(-1)?.[0];
    await frame?.(createRootState(canvasCamera) as never, 0);

    expect(graph.set).toHaveBeenCalledWith(residencyAnchors, expect.any(Array));
  });
});
