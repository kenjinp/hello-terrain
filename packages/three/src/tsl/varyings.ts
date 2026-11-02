import { instanceIndex, int, varying } from "three/tsl";

/**
 * Current leaf/storage index, not a persistent quadtree ID. Evaluated in the
 * vertex stage and passed flat to fragments only when consumed. Flat does not
 * imply derivative-uniform control flow across a fragment quad.
 */
export function tileIndex() {
  return varying(int(instanceIndex), "vTileIndex").setInterpolation("flat");
}
