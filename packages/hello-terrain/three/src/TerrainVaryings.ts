import { varyingProperty } from "three/tsl";

/**
 * Instance-specific varyings for a TerrainMesh.
 * Each TerrainMesh gets its own set of varyings to avoid global state conflicts.
 */
export class TerrainVaryings {
  readonly vGlobalVertexIndex: ReturnType<typeof varyingProperty>;
  readonly vElevation: ReturnType<typeof varyingProperty>;
  readonly vNormal: ReturnType<typeof varyingProperty>;
  // Control map varyings:
  // - IDs are DISCRETE, so keep them flat (int varyings) to avoid interpolating through
  //   unrelated texture indices (causes visible "bands").
  // - Blend is continuous, so keep it interpolated (f32).
  readonly vControlBaseId: ReturnType<typeof varyingProperty>;
  readonly vControlOverlayId: ReturnType<typeof varyingProperty>;
  readonly vControlBlend: ReturnType<typeof varyingProperty>;

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
    // Texture IDs: int (flat)
    this.vControlBaseId = varyingProperty("int", `vControlBaseId${suffix}`);
    this.vControlOverlayId = varyingProperty(
      "int",
      `vControlOverlayId${suffix}`
    );
    // Blend factor: f32 (interpolated)
    this.vControlBlend = varyingProperty("f32", `vControlBlend${suffix}`);
  }
}
