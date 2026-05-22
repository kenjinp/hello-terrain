import {
  Fn,
  If,
  abs,
  atomicAdd,
  float,
  globalId,
  int,
  log2,
  max,
  pow,
  uint,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { StorageBufferNode } from "three/webgpu";
import type {
  TerrainCullingUniformsContext,
  TerrainUniformsContext,
} from "../types";
import type { RenderIndirectionState } from "./renderIndirection";
import type { HiZTextureLevel } from "./hiZ";
import { sampleHiZDepth, screenRectSizeInPixels } from "./hiZ";

function emitVisibleTile(
  tileIndex: ReturnType<typeof int>,
  renderIndirection: RenderIndirectionState,
) {
  const slot = atomicAdd(
    renderIndirection.visibleCounterNode.element(int(0)),
    uint(1),
  );
  renderIndirection.node.element(slot.toInt()).assign(tileIndex);
}

export function buildFinalizeIndirectKernel(
  renderIndirection: RenderIndirectionState,
) {
  return Fn(() => {
    const visibleCount = atomicAdd(
      renderIndirection.visibleCounterNode.element(int(0)),
      uint(0),
    );
    renderIndirection.indirectNode
      .element(int(1))
      .assign(visibleCount);
  })().computeKernel([1, 1, 1]);
}

export function buildFrustumCullKernel(
  leafNode: StorageBufferNode,
  boundsNode: StorageBufferNode,
  renderIndirection: RenderIndirectionState,
  terrainUniforms: TerrainUniformsContext,
  cullingUniforms: TerrainCullingUniformsContext,
) {
  return Fn(() => {
    const tileIndex = int(globalId.z);
    const leafOffset = tileIndex.mul(int(4));
    const nodeLevel = leafNode.element(leafOffset).toInt();
    const nodeX = leafNode.element(leafOffset.add(int(1))).toFloat();
    const nodeY = leafNode.element(leafOffset.add(int(2))).toFloat();

    const rootSize = terrainUniforms.uRootSize.toVar();
    const rootOrigin = terrainUniforms.uRootOrigin.toVar();
    const half = float(0.5);
    const size = rootSize.div(pow(float(2), nodeLevel.toFloat()));
    const halfSize = size.mul(half);
    const halfRoot = rootSize.mul(half);
    const centerX = rootOrigin.x.add(nodeX.add(half).mul(size)).sub(halfRoot);
    const centerZ = rootOrigin.z.add(nodeY.add(half).mul(size)).sub(halfRoot);

    const boundsOffset = tileIndex.mul(int(2));
    const minWorldY = rootOrigin.y.add(
      boundsNode.element(boundsOffset).mul(terrainUniforms.uElevationScale),
    );
    const maxWorldY = rootOrigin.y.add(
      boundsNode
        .element(boundsOffset.add(int(1)))
        .mul(terrainUniforms.uElevationScale),
    );
    const centerY = minWorldY.add(maxWorldY).mul(half);
    const extentY = abs(maxWorldY.sub(minWorldY)).mul(half);
    const center = vec3(centerX, centerY, centerZ);
    const extents = vec3(halfSize, extentY.max(float(0.001)), halfSize);
    const visible = int(1).toVar("visible");

    for (const plane of cullingUniforms.uFrustumPlanes) {
      If(visible.equal(int(1)), () => {
        const normal = vec3(plane.x, plane.y, plane.z);
        const radius = abs(normal.x)
          .mul(extents.x)
          .add(abs(normal.y).mul(extents.y))
          .add(abs(normal.z).mul(extents.z));
        const distance = normal.dot(center).add(plane.w);
        If(distance.add(radius).lessThan(float(0)), () => {
          visible.assign(int(0));
        });
      });
    }

    If(visible.equal(int(1)), () => {
      emitVisibleTile(tileIndex, renderIndirection);
    });
  })().computeKernel([1, 1, 1]);
}

export function buildFrustumHiZCullKernel(
  leafNode: StorageBufferNode,
  boundsNode: StorageBufferNode,
  renderIndirection: RenderIndirectionState,
  terrainUniforms: TerrainUniformsContext,
  cullingUniforms: TerrainCullingUniformsContext,
  hiZLevels: readonly HiZTextureLevel[],
  baseResolution: number,
) {
  const maxMipLevel = Math.max(0, hiZLevels.length - 1);

  return Fn(() => {
    const tileIndex = int(globalId.z);
    const leafOffset = tileIndex.mul(int(4));
    const nodeLevel = leafNode.element(leafOffset).toInt();
    const nodeX = leafNode.element(leafOffset.add(int(1))).toFloat();
    const nodeY = leafNode.element(leafOffset.add(int(2))).toFloat();

    const rootSize = terrainUniforms.uRootSize.toVar();
    const rootOrigin = terrainUniforms.uRootOrigin.toVar();
    const half = float(0.5);
    const size = rootSize.div(pow(float(2), nodeLevel.toFloat()));
    const halfSize = size.mul(half);
    const halfRoot = rootSize.mul(half);
    const centerX = rootOrigin.x.add(nodeX.add(half).mul(size)).sub(halfRoot);
    const centerZ = rootOrigin.z.add(nodeY.add(half).mul(size)).sub(halfRoot);

    const boundsOffset = tileIndex.mul(int(2));
    const minWorldY = rootOrigin.y.add(
      boundsNode.element(boundsOffset).mul(terrainUniforms.uElevationScale),
    );
    const maxWorldY = rootOrigin.y.add(
      boundsNode
        .element(boundsOffset.add(int(1)))
        .mul(terrainUniforms.uElevationScale),
    );
    const centerY = minWorldY.add(maxWorldY).mul(half);
    const extentY = abs(maxWorldY.sub(minWorldY)).mul(half);
    const center = vec3(centerX, centerY, centerZ);
    const extents = vec3(halfSize, extentY.max(float(0.001)), halfSize);
    const sphereRadius = extents.length().max(float(0.001));
    const visible = int(1).toVar("visible");

    for (const plane of cullingUniforms.uFrustumPlanes) {
      If(visible.equal(int(1)), () => {
        const normal = vec3(plane.x, plane.y, plane.z);
        const radius = abs(normal.x)
          .mul(extents.x)
          .add(abs(normal.y).mul(extents.y))
          .add(abs(normal.z).mul(extents.z));
        const distance = normal.dot(center).add(plane.w);
        If(distance.add(radius).lessThan(float(0)), () => {
          visible.assign(int(0));
        });
      });
    }

    If(visible.equal(int(1)), () => {
      const centerClip = cullingUniforms.uCameraProjectionViewMatrix
        .mul(vec4(center, float(1)))
        .toVar();
      const xOffsetClip = cullingUniforms.uCameraProjectionViewMatrix
        .mul(vec4(center.add(vec3(sphereRadius, float(0), float(0))), float(1)))
        .toVar();
      const yOffsetClip = cullingUniforms.uCameraProjectionViewMatrix
        .mul(vec4(center.add(vec3(float(0), sphereRadius, float(0))), float(1)))
        .toVar();
      const centerView = cullingUniforms.uCameraViewMatrix
        .mul(vec4(center, float(1)))
        .toVar();
      const viewDepth = centerView.z.negate();
      const nearestDepth = viewDepth.sub(sphereRadius);

      If(nearestDepth.greaterThan(float(0.0001)), () => {
        const centerUv = centerClip.xy
          .div(centerClip.w)
          .mul(float(0.5))
          .add(vec2(float(0.5), float(0.5)))
          .toVar();
        const xUv = xOffsetClip.xy
          .div(xOffsetClip.w)
          .mul(float(0.5))
          .add(vec2(float(0.5), float(0.5)))
          .toVar();
        const yUv = yOffsetClip.xy
          .div(yOffsetClip.w)
          .mul(float(0.5))
          .add(vec2(float(0.5), float(0.5)))
          .toVar();
        const radiusUv = vec2(
          abs(xUv.x.sub(centerUv.x)),
          abs(yUv.y.sub(centerUv.y)),
        ).toVar();
        const minUv = vec2(
          centerUv.x.sub(radiusUv.x).max(float(0)).min(float(1)),
          centerUv.y.sub(radiusUv.y).max(float(0)).min(float(1)),
        ).toVar();
        const maxUv = vec2(
          centerUv.x.add(radiusUv.x).max(float(0)).min(float(1)),
          centerUv.y.add(radiusUv.y).max(float(0)).min(float(1)),
        ).toVar();
        const rectSizePx = screenRectSizeInPixels(
          minUv,
          maxUv,
          baseResolution,
        );
        const mipLevel = log2(rectSizePx)
          .floor()
          .toInt()
          .max(int(0))
          .min(int(maxMipLevel))
          .toVar();
        const sampleA = sampleHiZDepth(hiZLevels, mipLevel, minUv);
        const sampleB = sampleHiZDepth(
          hiZLevels,
          mipLevel,
          vec2(maxUv.x, minUv.y),
        );
        const sampleC = sampleHiZDepth(
          hiZLevels,
          mipLevel,
          vec2(minUv.x, maxUv.y),
        );
        const sampleD = sampleHiZDepth(hiZLevels, mipLevel, maxUv);
        const farthestDepth = max(max(sampleA, sampleB), max(sampleC, sampleD));

        If(nearestDepth.greaterThan(farthestDepth), () => {
          visible.assign(int(0));
        });
      });
    });

    If(visible.equal(int(1)), () => {
      emitVisibleTile(tileIndex, renderIndirection);
    });
  })().computeKernel([1, 1, 1]);
}
