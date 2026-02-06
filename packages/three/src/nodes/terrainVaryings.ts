import { varyingProperty } from "three/tsl";

/**
 * Instance-specific varyings for a TerrainMesh.
 * Each TerrainMesh gets its own set of varyings to avoid global state conflicts.
 */
export function terrainVaryings(instanceId?: number) {
  // Sanitize instanceId to be WGSL-compliant (replace hyphens with underscores)
  const sanitizedId = String(instanceId)?.replace(/-/g, "_");
  const suffix = sanitizedId ? `_${sanitizedId}` : "";

  return {
    vGlobalVertexIndex: varyingProperty("int", `vGlobalVertexIndex${suffix}`),
    vElevation: varyingProperty("f32", `vElevation${suffix}`),
    vNormal: varyingProperty("vec3", `vNormal${suffix}`),
    vNodeIndex: varyingProperty("int", `vNodeIndex${suffix}`),
    vNodeOrigin: varyingProperty("vec2", `vNodeOrigin${suffix}`),
    vNodeSize: varyingProperty("f32", `vNodeSize${suffix}`),
  };
}
