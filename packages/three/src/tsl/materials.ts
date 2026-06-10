import Node from "three/src/nodes/core/Node.js";
import { dot, float, Fn, remap, vec3 } from "three/tsl";

/**
 * Maps a value or node from texture space [0, 1] to vector space [-1, 1].
 *
 * @param value - The node or value in the range [0, 1].
 * @returns A node mapping the input value to the range [-1, 1].
 */
export const textureSpaceToVectorSpace = Fn<[Node]>(([value]: [Node]) => {
  return remap(value, float(0), float(1), float(-1), float(1));
});

/**
 * Maps a value or node from vector space [-1, 1] to texture space [0, 1].
 *
 * @param value - The node or value in the range [-1, 1].
 * @returns A node mapping the input value to the range [0, 1].
 */
export const vectorSpaceToTextureSpace = Fn<[Node]>(([value]: [Node]) => {
  return remap(value, float(-1), float(1), float(0), float(1));
});

/**
 * Blends two normal maps using the Reoriented Normal Mapping technique.
 * This is the same algorithm used by Unreal Engine's BlendAngleCorrectedNormals node.
 *
 * Both inputs should be in vector space [-1, 1].
 *
 * @see https://blog.selfshadow.com/publications/blending-in-detail/
 */
export const blendAngleCorrectedNormals = Fn<[Node, Node]>(([n1, n2]: [Node, Node]) => {
  // t = (n1.xy, n1.z + 1) - base normal with z offset
  const t = vec3(n1.x, n1.y, n1.z.add(1));
  // u = (-n2.xy, n2.z) - detail normal with xy negated
  const u = vec3(n2.x.negate(), n2.y.negate(), n2.z);
  // r = normalize(t * dot(t, u) - u * t.z)
  const r = t.mul(dot(t, u)).sub(u.mul(t.z)).normalize();
  return r;
});

/**
 * Reconstructs the Z component of a normal from the X and Y components.
 *
 * @param normalXY - A vec2 containing the X and Y components of the normal
 * @returns A vec3 with the reconstructed normal (X, Y, derived Z)
 */
export const deriveNormalZ = Fn<[Node]>(([normalXY]: [Node]) => {
  const xy = normalXY.toVar();
  const z = xy.x.mul(xy.x).add(xy.y.mul(xy.y)).oneMinus().max(0).sqrt();
  return vec3(xy.x, xy.y, z);
});
