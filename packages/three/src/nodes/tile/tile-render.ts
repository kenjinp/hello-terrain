/**
 * Render-path (vertex/fragment) tile functions.
 *
 * These functions may use `.setLayout()` safely because the vertex/fragment
 * pipeline directly references the same storage buffers and uniforms
 * elsewhere (e.g. in worldPosition.ts), so TSL already includes them in
 * the bind group.
 */

import { Fn, positionWorld, vec2 } from "three/tsl";
import type { TerrainUniformsContext } from "../../tasks/uniforms/terrainUniforms";

export function createTileRender(uniforms: TerrainUniformsContext) {
  // Fragment shader version that uses Three.js built-in positionWorld.
  // This works even with custom positionNode because Three.js computes
  // positionWorld from the modelWorldMatrix * position.
  const rootUV = Fn(() => {
    const worldX = positionWorld.x;
    const worldZ = positionWorld.z;
    const centeredX = worldX.sub(uniforms.uRootOrigin.x);
    const centeredZ = worldZ.sub(uniforms.uRootOrigin.z);
    return vec2(
      centeredX.div(uniforms.uRootSize).add(0.5),
      centeredZ.div(uniforms.uRootSize).mul(-1.0).add(0.5),
    );
  }).setLayout({
    name: "rootUV",
    type: "vec2",
    inputs: [],
  });

  return {
    rootUV,
  };
}
