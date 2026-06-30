"use client";

import {
  FLAT_FRUSTUM_CULLING_CONFIG,
  FrustumCullingDemo,
} from "@/examples/frustumCulling/shared";

export default function FrustumCullingScene() {
  return <FrustumCullingDemo config={FLAT_FRUSTUM_CULLING_CONFIG} />;
}
