import { type ShaderNodeObject, uniform } from "three/tsl";
import type { UniformNode } from "three/webgpu";

export const uSkirtLength: ShaderNodeObject<UniformNode<number>> =
  uniform(0).setName("uSkirtLength");
export const uSegments: ShaderNodeObject<UniformNode<number>> =
  uniform(0).setName("uSegments");
