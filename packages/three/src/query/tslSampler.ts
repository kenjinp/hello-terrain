import {
  Fn,
  If,
  Loop,
  float,
  int,
  pow,
  uint,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { Node } from "three/webgpu";
import { sampleTerrainField } from "../gpu/terrainFieldStorage";
import { createElevationFunction } from "../tsl/elevation";
import { readGpuSpatialIndexValue } from "./gpuSpatialIndex";
import type {
  CreateTerrainSamplerParams,
  GpuSpatialIndexContext,
  TerrainSampler,
} from "./types";

function createTerrainSampleNode(
  spatialIndex: GpuSpatialIndexContext,
  params: CreateTerrainSamplerParams,
) {
  const slotCount = spatialIndex.data.size;
  const stampGen = uint(spatialIndex.data.stampGen);

  return Fn(([worldX, worldZ]: [Node, Node]) => {
    const rootOrigin = params.uniforms.uRootOrigin.toVar();
    const rootSize = params.uniforms.uRootSize.toVar();
    const halfRoot = float(rootSize).mul(0.5);

    const bestLevel = int(-1).toVar();
    const bestTileIndex = int(0).toVar();
    const bestU = float(0).toVar();
    const bestV = float(0).toVar();
    const found = int(0).toVar();
    const i = int(0).toVar();

    Loop(slotCount, () => {
      const slot = i.toVar();
      const stamp = readGpuSpatialIndexValue(spatialIndex, slot, 0);
      If(stamp.equal(stampGen), () => {
        const level = int(readGpuSpatialIndexValue(spatialIndex, slot, 2)).toVar();
        const tileX = int(readGpuSpatialIndexValue(spatialIndex, slot, 3)).toVar();
        const tileY = int(readGpuSpatialIndexValue(spatialIndex, slot, 4)).toVar();
        const tileIndex = int(
          readGpuSpatialIndexValue(spatialIndex, slot, 5),
        ).toVar();

        const tileSize = float(rootSize).div(pow(float(2), level.toFloat()));
        const minX = rootOrigin.x.add(tileX.toFloat().mul(tileSize)).sub(halfRoot);
        const minZ = rootOrigin.z.add(tileY.toFloat().mul(tileSize)).sub(halfRoot);
        const u = worldX.sub(minX).div(tileSize).toVar();
        const v = worldZ.sub(minZ).div(tileSize).toVar();

        const inTile = u
          .greaterThanEqual(0)
          .and(u.lessThanEqual(1))
          .and(v.greaterThanEqual(0))
          .and(v.lessThanEqual(1));

        If(inTile.and(level.greaterThanEqual(bestLevel)), () => {
          bestLevel.assign(level);
          bestTileIndex.assign(tileIndex);
          bestU.assign(u);
          bestV.assign(v);
          found.assign(1);
        });
      });
      i.addAssign(1);
    });

    const sampled = sampleTerrainField(
      params.terrainFieldStorage,
      bestU,
      bestV,
      bestTileIndex,
    ).toVar();
    const nx = sampled.g.toVar();
    const nz = sampled.b.toVar();
    const ny = float(1).sub(nx.mul(nx)).sub(nz.mul(nz)).max(0).sqrt();

    const valid = found.toFloat();
    return vec4(sampled.r.mul(valid), nx.mul(valid), ny.mul(valid), nz.mul(valid));
  });
}

export function createTerrainSampler(
  params: CreateTerrainSamplerParams,
): TerrainSampler {
  const elevationNode = createElevationFunction(params.elevationCallback);
  const terrainSampleAt = createTerrainSampleNode(params.spatialIndex, params);
  const evaluateElevationAt = Fn(([worldX, worldZ]: [Node, Node]) => {
    const rootOrigin = params.uniforms.uRootOrigin.toVar();
    const rootSize = params.uniforms.uRootSize.toVar();
    const centeredX = worldX.sub(rootOrigin.x);
    const centeredZ = worldZ.sub(rootOrigin.z);
    const rootUV = vec2(
      centeredX.div(rootSize).add(0.5),
      centeredZ.div(rootSize).mul(float(-1)).add(0.5),
    ).toVar();

    return elevationNode({
      worldPosition: vec3(worldX, rootOrigin.y, worldZ),
      rootSize,
      rootUV,
      tileUV: rootUV,
      tileLevel: int(0),
      tileSize: rootSize,
      tileOriginVec2: vec2(0, 0),
      nodeIndex: int(0),
    });
  });

  const sampleTerrain = Fn(([worldX, worldZ]: [Node, Node]) =>
    terrainSampleAt(worldX, worldZ),
  );
  const sampleElevation = Fn(([worldX, worldZ]: [Node, Node]) =>
    terrainSampleAt(worldX, worldZ).x,
  );
  const sampleNormal = Fn(([worldX, worldZ]: [Node, Node]) =>
    vec3(
      terrainSampleAt(worldX, worldZ).y,
      terrainSampleAt(worldX, worldZ).z,
      terrainSampleAt(worldX, worldZ).w,
    ),
  );
  const sampleValidity = Fn(([worldX, worldZ]: [Node, Node]) =>
    terrainSampleAt(worldX, worldZ)
      .y.abs()
      .add(terrainSampleAt(worldX, worldZ).z.abs())
      .add(terrainSampleAt(worldX, worldZ).w.abs())
      .greaterThan(float(0))
      .select(float(1), float(0)),
  );
  const evaluateElevation = Fn(([worldX, worldZ]: [Node, Node]) =>
    evaluateElevationAt(worldX, worldZ),
  );
  const evaluateNormalNode = Fn(([worldX, worldZ, epsilon]: [Node, Node, Node]) => {
    const eps = epsilon ?? float(0.1);
    const elevationScale = params.uniforms.uElevationScale.toVar();
    const hL = evaluateElevationAt(worldX.sub(eps), worldZ).mul(elevationScale);
    const hR = evaluateElevationAt(worldX.add(eps), worldZ).mul(elevationScale);
    const hD = evaluateElevationAt(worldX, worldZ.sub(eps)).mul(elevationScale);
    const hU = evaluateElevationAt(worldX, worldZ.add(eps)).mul(elevationScale);
    const inv2eps = float(0.5).div(eps);
    const dhdx = hR.sub(hL).mul(inv2eps);
    const dhdz = hU.sub(hD).mul(inv2eps);
    return vec3(dhdx.negate(), float(1), dhdz.negate()).normalize();
  });
  const evaluateNormal = (worldX: Node, worldZ: Node, epsilon?: Node) =>
    evaluateNormalNode(worldX, worldZ, epsilon ?? float(0.1));

  return {
    sampleElevation,
    sampleNormal,
    sampleTerrain,
    sampleValidity,
    evaluateElevation,
    evaluateNormal,
  };
}
