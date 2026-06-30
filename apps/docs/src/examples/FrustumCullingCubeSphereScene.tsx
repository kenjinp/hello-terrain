"use client";

import {
  CUBE_SPHERE_FRUSTUM_CULLING_CONFIG,
  FrustumCullingDemo,
} from "@/examples/frustumCulling/shared";

export default function FrustumCullingCubeSphereScene() {
  return <FrustumCullingDemo config={CUBE_SPHERE_FRUSTUM_CULLING_CONFIG} />;
}
