import type { ShaderNodeObject } from 'three/tsl';
import { Fn, dot, vec3, vec4 } from 'three/tsl';
import type { ConstNode, Vector3 } from 'three/webgpu';

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
  },
);
