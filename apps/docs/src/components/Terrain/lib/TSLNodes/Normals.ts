import type { ShaderNodeObject } from "three/tsl";
import { Fn, dot, int, max, min, vec3, vec4 } from "three/tsl";
import type { ConstNode, Node, Vector3 } from "three/webgpu";

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

// Read XYZ normal by deriving the per-node vertex index from positionLocal.xz
export const readNormalAtPositionLocal = (
  normalmapStorage: ShaderNodeObject<Node>,
  edgeVertexCount: number,
  positionLocal: ShaderNodeObject<Node>
) =>
  Fn(() => {
    const intEdge = int(edgeVertexCount);
    const edgeF = intEdge.toFloat();
    const last = intEdge.sub(int(1));

    // Map positionLocal.xz in [-0.5, 0.5] to [0, edge)
    const u = positionLocal.x.add(0.5);
    const v = positionLocal.z.add(0.5);

    const x = u.mul(edgeF).floor().toInt();
    const y = v.mul(edgeF).floor().toInt();

    const xClamped = max(min(x, last), int(0));
    const yClamped = max(min(y, last), int(0));

    const perNodeVertexIndex = yClamped.mul(intEdge).add(xClamped);

    const base = perNodeVertexIndex.mul(int(3));
    const nx = normalmapStorage.element(base.add(int(0)));
    const ny = normalmapStorage.element(base.add(int(1)));
    const nz = normalmapStorage.element(base.add(int(2)));

    return vec4(vec3(nx, ny, nz).normalize(), 1);
  });
