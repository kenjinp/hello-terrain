import Node from "three/src/nodes/core/Node.js";
import { float, Fn, instanceIndex, int, vec3 } from "three/tsl";

/** Deterministic pseudo-random RGB from an integer index (GPU-safe hash). */
export function u32ToColor(indexNode: Node) {
  const i = float(indexNode);
  const p = vec3(i, i.add(1.0), i.add(2.0));
  const r = p.dot(vec3(127.1, 311.7, 74.7));
  const g = p.dot(vec3(269.5, 183.3, 246.1));
  const b = p.dot(vec3(113.5, 271.9, 124.6));

  return vec3(r, g, b).sin().mul(43758.5453123).fract();
}

/** One stable hash color per terrain tile `instanceIndex`. */
export const tileInstanceColorNode = Fn(() => u32ToColor(int(instanceIndex)))();

export const tileColorsLevaControl = {
  value: false,
  label: "tile colors",
} as const;

export type TileMaterialColorOptions = {
  tileColors: boolean;
  wireframe: boolean;
  colorNode?: Node;
  /** Material `color` when wireframe is active and tile colors are off. */
  wireframeColor?: string;
};

/** Resolve terrain material appearance; tile colors take priority over wireframe. */
export function resolveTerrainMaterialAppearance(options: TileMaterialColorOptions) {
  const { tileColors, wireframe, colorNode, wireframeColor = "white" } = options;

  if (tileColors) {
    return {
      colorNode: tileInstanceColorNode,
      wireframe: false,
      color: undefined as string | undefined,
    };
  }

  if (wireframe) {
    return {
      colorNode: undefined,
      wireframe: true,
      color: wireframeColor,
    };
  }

  return {
    colorNode,
    wireframe: false,
    color: undefined as string | undefined,
  };
}
