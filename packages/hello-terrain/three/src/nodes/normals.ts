import { Fn, dot, int, vec3, vec4 } from "three/tsl";
import type { Node } from "three/webgpu";
import { normalmapStorageProperty } from "./properties";

// reoriented normal mapping
export const blendNormalsRNM = Fn(([normalA, normalB]: [normalA: Node, normalB: Node]) => {
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

/**
 * Creates a function to read the normal at a vertex position from the normalmap storage.
 *
 * @param globalVertexIndexNode - The computed global vertex index (nodeIndex * verticesPerNode + vertexIndex).
 *                                This must be passed explicitly because varyings cannot be read
 *                                in the same shader stage they are written.
 */
export const createReadNormalAtPositionLocal = (globalVertexIndexNode: Node) =>
  Fn(() => {
    const globalIndex = globalVertexIndexNode.toVar();

    const base = globalIndex.mul(int(3));
    const nx = normalmapStorageProperty.element(base.add(int(0)));
    const ny = normalmapStorageProperty.element(base.add(int(1)));
    const nz = normalmapStorageProperty.element(base.add(int(2)));

    return vec3(nx, ny, nz).normalize();
  });
