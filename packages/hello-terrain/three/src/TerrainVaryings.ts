import { varyingProperty } from "three/tsl";

/**
 * Instance-specific varyings for a TerrainMesh.
 * Each TerrainMesh gets its own set of varyings to avoid global state conflicts.
 */
export class TerrainVaryings {
  readonly vGlobalVertexIndex: ReturnType<typeof varyingProperty>;
  readonly vElevation: ReturnType<typeof varyingProperty>;
  readonly vNormal: ReturnType<typeof varyingProperty>;
  // Node metadata varyings for 4-vertex control map sampling:
  // These are flat (non-interpolating) so all fragments in a triangle
  // can correctly calculate neighboring vertex indices.
  // Control data is read directly from storage in the fragment shader.
  readonly vNodeIndex: ReturnType<typeof varyingProperty>;
  readonly vNodeOrigin: ReturnType<typeof varyingProperty>;
  readonly vNodeSize: ReturnType<typeof varyingProperty>;

  constructor(instanceId?: string) {
    // Sanitize instanceId to be WGSL-compliant (replace hyphens with underscores)
    const sanitizedId = instanceId?.replace(/-/g, "_");
    const suffix = sanitizedId ? `_${sanitizedId}` : "";

    this.vGlobalVertexIndex = varyingProperty(
      "int",
      `vGlobalVertexIndex${suffix}`
    );
    this.vElevation = varyingProperty("f32", `vElevation${suffix}`);
    this.vNormal = varyingProperty("vec3", `vNormal${suffix}`);
    // Node metadata for 4-vertex control map sampling (all flat/non-interpolating)
    this.vNodeIndex = varyingProperty("int", `vNodeIndex${suffix}`);
    this.vNodeOrigin = varyingProperty("vec2", `vNodeOrigin${suffix}`);
    this.vNodeSize = varyingProperty("f32", `vNodeSize${suffix}`);
  }
}
