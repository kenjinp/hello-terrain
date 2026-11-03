import {
  HalfFloatType,
  UnsignedByteType,
  UnsignedIntType,
  RGBAFormat,
  RedFormat,
  NearestFilter,
} from "three";
import { float, int } from "three/tsl";
import type { WebGPURenderer } from "three/webgpu";
import { describe, expect, it } from "vitest";
import { createTileFieldStorage } from "./tileFieldStorage";

describe("tile field storage", () => {
  it.each(["array-texture", "atlas"] as const)(
    "%s preserves the GPU format contract",
    (backend) => {
      for (const [format, type, channels] of [
        ["rgba16float", HalfFloatType, RGBAFormat],
        ["r32uint", UnsignedIntType, RedFormat],
        ["rgba8unorm", UnsignedByteType, RGBAFormat],
      ] as const) {
        const field = createTileFieldStorage(4, 8, undefined, { backend, format });
        expect([field.texture.type, field.texture.format]).toEqual([type, channels]);
        expect(field.texture.generateMipmaps).toBe(false);
        field.texture.dispose();
      }
    },
  );

  it("uses the device layer limit, including the last supported layer", () => {
    const renderer = {
      backend: { device: { limits: { maxTextureArrayLayers: 8 } } },
    } as unknown as WebGPURenderer;
    const array = createTileFieldStorage(4, 8, renderer);
    const atlas = createTileFieldStorage(4, 9, renderer);
    expect(array.backendType).toBe("array-texture");
    expect(array.texture.image).toMatchObject({ depth: 8 });
    expect(atlas.backendType).toBe("atlas");
    expect(atlas.texture.image).toMatchObject({ width: 12, height: 12 });
    array.texture.dispose();
    atlas.texture.dispose();
  });

  it.each(["array-texture", "atlas"] as const)("%s cannot interpolate integer IDs", (backend) => {
    const field = createTileFieldStorage(4, 8, undefined, { backend, format: "r32uint" });
    expect(field.texture.minFilter).toBe(NearestFilter);
    expect(field.texture.magFilter).toBe(NearestFilter);
    expect(() => field.sample(float(0.5), float(0.5), int(0))).toThrow("loadTileField");
    expect(() =>
      createTileFieldStorage(4, 8, undefined, { backend, format: "r32uint", filter: "linear" }),
    ).toThrow("nearest");
    field.texture.dispose();
  });

  it.each(["array-texture", "atlas"] as const)(
    "%s resizes the existing texture and releases its previous allocation",
    (backend) => {
      const field = createTileFieldStorage(4, 4, undefined, { backend });
      const texture = field.texture;
      let disposals = 0;
      texture.addEventListener("dispose", () => disposals++);
      field.resize(8, 8, 9);
      expect(field.texture).toBe(texture);
      expect([field.edgeVertexCount, field.tileCount]).toEqual([8, 9]);
      const size = backend === "atlas" ? 24 : 8;
      expect(texture.image).toMatchObject({ width: size, height: size });
      expect(disposals).toBe(1);
      texture.dispose();
    },
  );
});
