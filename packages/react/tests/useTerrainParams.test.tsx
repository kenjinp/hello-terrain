// @vitest-environment jsdom

import {
  createTerrainTextureSet, elevationFn, elevationScale, origin, rootSize,
  textureFn, textureSet, type TerrainGraph,
} from "@hello-terrain/three";
import { graph as createGraph, task } from "@hello-terrain/work";
import { cleanup, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { DataTexture } from "three/webgpu";
import { float, uint } from "three/tsl";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TerrainOptions } from "../src/types";
import { useTerrainParams } from "../src/useTerrainParams";

afterEach(cleanup);

function geometryTask() {
  return task((get, work) => {
    const size = get(rootSize) * get(elevationScale);
    const center = get(origin);
    const elevation = get(elevationFn);
    return work(() => ({ minX: center.x - size / 2, maxX: center.x + size / 2, elevation }));
  });
}

function palette(red: number, blue: number) {
  const source = new DataTexture(new Uint8Array([red, 0, blue, 255]), 1, 1);
  const set = createTerrainTextureSet([{ albedo: source }], { resolution: 1 });
  source.dispose();
  return set;
}

function useParams({ graph, options }: { graph: TerrainGraph; options: TerrainOptions }) {
  useTerrainParams(graph, options);
}

describe("React terrain parameter ownership", () => {
  it("rebinds material inputs without rebuilding cached geometry or disposing shared sets", async ({ onTestFinished }) => {
    const graph = createGraph();
    const red = palette(255, 0), blue = palette(0, 255);
    onTestFinished(() => { graph.dispose(); red.dispose(); blue.dispose(); });
    const geometry = geometryTask();
    const color = task((get, work) => {
      const image = get(textureSet)!.albedoHeight.image;
      return work(() => {
        if (!("data" in image) || !image.data) throw new Error("Expected packed pixels");
        return Array.from(image.data).slice(0, 3);
      });
    });
    graph.add(geometry).add(color);
    const options: TerrainOptions = { rootSize: 120, elevation: () => float(7), textureSet: red };
    const view = renderHook(useParams, { initialProps: { graph, options }, wrapper: StrictMode });
    await graph.run({ targets: [geometry, color] });
    const before = graph.get(geometry);
    expect(graph.get(color)).toEqual([255, 0, 0]);

    view.rerender({ graph, options: { ...options, textureSet: blue } });
    await graph.run({ targets: [geometry, color] });
    expect(graph.get(geometry)).toBe(before);
    expect(graph.get(color)).toEqual([0, 0, 255]);

    view.rerender({ graph, options: { ...options, textureSet: blue, textureRender: { heightBlend: true }, textureReadback: true } });
    await graph.run({ targets: [geometry] });
    expect(graph.get(geometry)).toBe(before);
    view.unmount();
    graph.dispose();
    expect(red.disposed).toBe(false);
    expect(blue.disposed).toBe(false);
  });

  it("resets removed owned inputs once and leaves unowned graph parameters alone", async ({ onTestFinished }) => {
    const graph = createGraph();
    onTestFinished(() => graph.dispose());
    graph.set(origin, { x: 23, y: 0, z: 0 });
    const geometry = geometryTask();
    graph.add(geometry);
    const view = renderHook(useParams, { initialProps: { graph, options: { rootSize: 120, elevation: () => float(7) } as TerrainOptions } });
    await graph.run({ targets: [geometry] });
    expect(graph.get(geometry).minX).toBe(23 - 60 * elevationScale.get());

    view.rerender({ graph, options: {} });
    await graph.run({ targets: [geometry] });
    expect(graph.get(geometry).minX).toBe(23 - rootSize.get() * elevationScale.get() / 2);
    expect(graph.get(geometry).elevation).toBe(elevationFn.get());

    graph.set(rootSize, 80);
    await graph.run({ targets: [geometry] });
    const externallyUpdated = graph.get(geometry);
    view.rerender({ graph, options: { textureReadback: true } });
    await graph.run({ targets: [geometry] });
    expect(graph.get(geometry)).toBe(externallyUpdated);
    expect(graph.get(geometry).maxX).toBe(23 + 40 * elevationScale.get());
  });

  it("reapplies inputs to a replacement graph without transferring ownership of removed inputs", async ({ onTestFinished }) => {
    const graphs = [createGraph(), createGraph(), createGraph()] as const;
    onTestFinished(() => graphs.forEach(graph => graph.dispose()));
    const [first, second, third] = graphs;
    const options = { rootSize: 120, elevationScale: 2 };
    const geometry = geometryTask();
    graphs.forEach(graph => graph.add(geometry));
    third.set(rootSize, 80);
    const view = renderHook(useParams, { initialProps: { graph: first, options: options as TerrainOptions } });
    await first.run({ targets: [geometry] });
    expect(first.get(geometry).maxX).toBe(120);

    view.rerender({ graph: second, options });
    await second.run({ targets: [geometry] });
    expect(second.get(geometry).maxX).toBe(120);
    view.rerender({ graph: third, options: {} });
    await third.run({ targets: [geometry] });
    expect(third.get(geometry).maxX).toBe(40 * elevationScale.get());
  });

  it("updates changed geometry and callbacks while preserving explicit same-value graph writes", async ({ onTestFinished }) => {
    const graph = createGraph();
    onTestFinished(() => graph.dispose());
    const elevation = vi.fn(() => float(7)), nextElevation = vi.fn(() => float(9));
    const texture = vi.fn(() => uint(0)), nextTexture = vi.fn(() => uint(1));
    const geometry = geometryTask();
    const control = task((get, work) => {
      const callback = get(textureFn);
      return work(() => callback);
    });
    graph.add(geometry).add(control);
    const options: TerrainOptions = { rootSize: 120, elevationScale: 1, elevation, texture };
    const view = renderHook(useParams, { initialProps: { graph, options } });
    await graph.run({ targets: [geometry, control] });
    const before = graph.get(geometry);

    view.rerender({ graph, options: { ...options, rootSize: 160, origin: { x: 10, y: 0, z: 0 }, elevation: nextElevation, texture: nextTexture } });
    await graph.run({ targets: [geometry, control] });
    expect(graph.get(geometry)).toEqual({ minX: -70, maxX: 90, elevation: nextElevation });
    expect(graph.get(geometry)).not.toBe(before);
    expect(graph.get(control)).toBe(nextTexture);
    expect(elevation).not.toHaveBeenCalled();
    expect(nextElevation).not.toHaveBeenCalled();
    expect(texture).not.toHaveBeenCalled();
    expect(nextTexture).not.toHaveBeenCalled();

    const changed = graph.get(geometry);
    graph.set(rootSize, 160);
    await graph.run({ targets: [geometry] });
    expect(graph.get(geometry)).not.toBe(changed);
    expect(graph.get(geometry).maxX).toBe(90);
  });
});
