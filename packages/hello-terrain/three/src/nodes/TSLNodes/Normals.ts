import { Fn, dot, vec3, vec4 } from 'three/tsl';
import type { Node } from 'three/webgpu';

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
  },
);
