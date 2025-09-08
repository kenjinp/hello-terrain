import { type ShaderNodeObject, uniform, vec3 } from "three/tsl";
import type { UniformNode, Vector3 } from "three/webgpu";

export const uSkirtLength: ShaderNodeObject<UniformNode<number>> =
  uniform(0).setName("uSkirtLength");
export const uSegments: ShaderNodeObject<UniformNode<number>> =
  uniform(0).setName("uSegments");
export const uRootSize: ShaderNodeObject<UniformNode<number>> =
  uniform(0).setName("uRootSize");
export const uRootOrigin: ShaderNodeObject<UniformNode<Vector3>> = uniform(
  vec3(0, 0, 0)
).setName("uRootOrigin");
