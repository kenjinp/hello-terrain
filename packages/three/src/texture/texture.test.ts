import { DataArrayTexture, DataTexture, RedFormat, RGBAFormat, SRGBColorSpace, UnsignedByteType } from "three";
import { describe, expect, it } from "vitest";
import { TerrainGeometry } from "../geometry/TerrainGeometry";
import { packTextureControl, unpackTextureControl } from "./control";
import { isTextureHole } from "./texture-hole";
import { createTerrainTextureSet, terrainTextureSetFromArrays, type TerrainTextureSet } from "./texture-set";

function pixels(data: number[], width = 1, height = 1) {
  return new DataTexture(new Uint8Array(data), width, height, RGBAFormat, UnsignedByteType);
}

function arrayPixels(texture: TerrainTextureSet["albedoHeight"]) {
  const image = texture.image;
  if (!("data" in image) || image.data === null) throw new Error("Expected runtime-packed pixel data");
  return Array.from(image.data);
}

describe("native texture control data", () => {
  it("keeps unsigned high bits and leaves reserved bits clear", () => {
    expect(packTextureControl({ base: 31, overlay: 31, blend: 1, uvRotation: 15 * Math.PI / 8,
      uvScale: 0.5, hole: true, nav: true, auto: true })).toBe(0xffffff87);
    expect(unpackTextureControl(0xffffffff)).toEqual({ base: 31, overlay: 31, blend: 1,
      uvRotation: 15 * Math.PI / 8, uvScale: 0.5, hole: true, nav: true, auto: true });
  });

  it("quantizes half steps toward positive infinity for authored blend and rotation", () => {
    expect(packTextureControl({ base: 0, blend: 0.5 / 255, uvRotation: Math.PI / 16 })).toBe(0x4400);
    expect(packTextureControl({ base: 0, uvRotation: -3 * Math.PI / 16 })).toBe(0x3c00);
  });

  it("clamps slots and blend, wraps rotations, and quantizes scale", () => {
    expect(unpackTextureControl(packTextureControl({ base: -7, overlay: 99, blend: 2, uvRotation: -Math.PI / 2, uvScale: 100 })))
      .toEqual({ base: 0, overlay: 31, blend: 1, uvRotation: 3 * Math.PI / 2, uvScale: 8, hole: false, nav: false, auto: false });
    expect(unpackTextureControl(packTextureControl({ base: 7, blend: 0.5, uvScale: 0 })).blend).toBe(128 / 255);
    expect(unpackTextureControl(packTextureControl({ base: 7, uvScale: 0 })).uvScale).toBe(1 / 16);
  });
});

describe("texture hole coverage", () => {
  it.each([2, 3])("matches every actual geometry triangle, including skirts, with %i inner segments", (segments) => {
    const geometry = new TerrainGeometry(segments);
    const edge = segments + 3, offset = edge * edge;
    const controls = new Uint32Array(offset * 2);
    const indices = geometry.index!.array;
    for (let hole = 0; hole < offset; hole++) {
      controls.fill(0); controls[offset + hole] = 4;
      for (let i = 0; i < indices.length; i += 3) {
        const vertices = [indices[i]!, indices[i + 1]!, indices[i + 2]!];
        const gx = vertices.reduce((sum, vertex) => sum + vertex % edge, 0) / 3;
        const gy = vertices.reduce((sum, vertex) => sum + Math.floor(vertex / edge), 0) / 3;
        expect(isTextureHole(controls, offset, edge, gx, gy, "collapse")).toBe(vertices.includes(hole));
      }
    }
    geometry.dispose();
  });

  it("uses nearest texels for discard and ignores control flags when holes are disabled", () => {
    const controls = new Uint32Array(25); controls[12] = 4;
    expect(isTextureHole(controls, 0, 5, 1.49, 2, "discard")).toBe(false);
    expect(isTextureHole(controls, 0, 5, 1.51, 2, "discard")).toBe(true);
    expect(isTextureHole(controls, 0, 5, 2, 2, "none")).toBe(false);
  });
});

describe("runtime texture set packing", () => {
  it("resizes sRGB in linear space while preserving scalar channel meanings", () => {
    const albedo = pixels([0, 0, 0, 0, 255, 255, 255, 255], 2);
    albedo.colorSpace = SRGBColorSpace;
    const height = pixels([64, 0, 0, 255, 192, 0, 0, 255], 2);
    const normal = pixels([64, 192, 255, 255]);
    const ao = pixels([17, 0, 0, 255]);
    const roughness = pixels([223, 0, 0, 255]);
    const set = createTerrainTextureSet([{ albedo, height, normal, ao, roughness }], { resolution: 1 });
    expect(arrayPixels(set.albedoHeight)).toEqual([188, 188, 188, 128]);
    expect(arrayPixels(set.normalRoughAo)).toEqual([64, 192, 17, 223]);
    set.dispose(); [albedo, height, normal, ao, roughness].forEach(source => source.dispose());
  });

  it("copies source pixels, respects image orientation, and owns only its output arrays", () => {
    const source = pixels([255, 0, 0, 255, 0, 0, 255, 255], 1, 2);
    source.colorSpace = SRGBColorSpace; source.flipY = true;
    let sourceDisposals = 0, outputDisposals = 0;
    source.addEventListener("dispose", () => sourceDisposals++);
    const set = createTerrainTextureSet([{ albedo: source }], { resolution: 2 });
    set.albedoHeight.addEventListener("dispose", () => outputDisposals++);
    set.normalRoughAo.addEventListener("dispose", () => outputDisposals++);
    source.image.data!.fill(0);
    expect(arrayPixels(set.albedoHeight).slice(0, 3)).toEqual([0, 0, 255]);
    expect(arrayPixels(set.albedoHeight).slice(8, 11)).toEqual([255, 0, 0]);
    set.dispose(); set.dispose();
    expect(outputDisposals).toBe(2); expect(sourceDisposals).toBe(0);
    expect(set.disposed).toBe(true);
    source.dispose();
  });

  it("rejects incompatible packed dimensions, mip chains, color spaces, and channel formats", () => {
    const a = new DataArrayTexture(new Uint8Array(64), 4, 4, 1);
    const b = new DataArrayTexture(new Uint8Array(64), 4, 4, 1);
    expect(() => terrainTextureSetFromArrays({ albedoHeight: a, normalRoughAo: b }, [{}, {}])).toThrow("one layer per slot");
    a.generateMipmaps = true;
    expect(() => terrainTextureSetFromArrays({ albedoHeight: a, normalRoughAo: b }, [{}])).toThrow("matching mip counts");
    a.generateMipmaps = false; b.colorSpace = SRGBColorSpace;
    expect(() => terrainTextureSetFromArrays({ albedoHeight: a, normalRoughAo: b }, [{}])).toThrow("linear data");
    b.colorSpace = ""; b.format = RedFormat;
    expect(() => terrainTextureSetFromArrays({ albedoHeight: a, normalRoughAo: b }, [{}])).toThrow("RGBA unsigned-byte");
    a.dispose(); b.dispose();
  });
});
