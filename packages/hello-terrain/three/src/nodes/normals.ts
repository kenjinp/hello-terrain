import type { ShaderNodeObject } from "three/tsl";
import { Fn, dot, int, vec3, vec4 } from "three/tsl";
import type { ConstNode, Vector3 } from "three/webgpu";
import type { TerrainVaryings } from "../TerrainVaryings";
import { normalmapStorageProperty } from "./properties";

// reoriented normal mapping
export const blendNormalsRNM = Fn(
  ([normalA, normalB]: [
    normalA: ShaderNodeObject<ConstNode<Vector3>>,
    normalB: ShaderNodeObject<ConstNode<Vector3>>,
  ]) => {
    const t = normalA
      .toVar()
      .xyz.mul(vec3(2, 2, 2))
      .add(vec3(-1, -1, 0));
    const u = normalB
      .toVar()
      .xyz.mul(vec3(-2, -2, 2))
      .add(vec3(1, 1, -1));
    const r = t.mul(dot(t, u).div(t.z)).sub(u);
    return vec4(r, 1.0).mul(0.5).add(0.5).normalize();
  }
);

export const createReadNormalAtPositionLocal = (varyings: TerrainVaryings) =>
  Fn(() => {
    const globalIndex = varyings.vGlobalVertexIndex.toVar();

    const base = globalIndex.mul(int(3));
    const nx = normalmapStorageProperty.element(base.add(int(0)));
    const ny = normalmapStorageProperty.element(base.add(int(1)));
    const nz = normalmapStorageProperty.element(base.add(int(2)));

    return vec3(nx, ny, nz).normalize();
  });
