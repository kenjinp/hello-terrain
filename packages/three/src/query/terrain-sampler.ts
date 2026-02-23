import { Fn, float, int, vec2, vec3, vec4 } from "three/tsl";
import type { Node } from "three/webgpu";
import { sampleTerrainField } from "../gpu/terrainFieldStorage";
import { maxLevel } from "../tasks/params";
import { createElevationFunction } from "../tsl/elevation";
import { createTileIndexFromWorldPosition } from "./gpuSpatialIndex";
import type { CreateTerrainSamplerParams, TerrainSampler } from "./types";
import { tileLocalToFieldUV } from "../gpu/tile";

function createTerrainSampleNode(params: CreateTerrainSamplerParams) {
  const tileLookup = createTileIndexFromWorldPosition(
    params.spatialIndex,
    params.uniforms,
    maxLevel.get(),
  );
  return Fn(([worldX, worldZ]: [Node, Node]) => {
    const tileResult = tileLookup(worldX, worldZ).toVar();
    const tileIndex = int(tileResult.x).toVar();
    const safeTileIndex = tileIndex.max(int(0)).toVar();
    const u = tileResult.y.toVar();
    const v = tileResult.z.toVar();
    const fieldU = tileLocalToFieldUV(
      u,
      params.uniforms.uInnerTileSegments,
    ).toVar();
    const fieldV = tileLocalToFieldUV(
      v,
      params.uniforms.uInnerTileSegments,
    ).toVar();
    const found = tileIndex.greaterThanEqual(int(0)).toVar();

    const sampled = sampleTerrainField(
      params.terrainFieldStorage,
      fieldU,
      fieldV,
      safeTileIndex,
    ).toVar();
    const nx = sampled.g.toVar();
    const nz = sampled.b.toVar();
    const ny = float(1).sub(nx.mul(nx)).sub(nz.mul(nz)).max(0).sqrt();

    const valid = found.select(float(1), float(0)).toVar();
    return vec4(
      sampled.r.mul(valid),
      nx.mul(valid),
      ny.mul(valid),
      nz.mul(valid),
    );
  });
}

export function createTerrainSampler(
  params: CreateTerrainSamplerParams,
): TerrainSampler {
  const elevationNode = createElevationFunction(params.elevationCallback);
  const terrainSampleAt = createTerrainSampleNode(params);
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
  const sampleElevation = Fn(
    ([worldX, worldZ]: [Node, Node]) => terrainSampleAt(worldX, worldZ).x,
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
  const evaluateNormalNode = Fn(
    ([worldX, worldZ, epsilon]: [Node, Node, Node]) => {
      const eps = epsilon ?? float(0.1);
      const elevationScale = params.uniforms.uElevationScale.toVar();
      const hL = evaluateElevationAt(worldX.sub(eps), worldZ).mul(
        elevationScale,
      );
      const hR = evaluateElevationAt(worldX.add(eps), worldZ).mul(
        elevationScale,
      );
      const hD = evaluateElevationAt(worldX, worldZ.sub(eps)).mul(
        elevationScale,
      );
      const hU = evaluateElevationAt(worldX, worldZ.add(eps)).mul(
        elevationScale,
      );
      const inv2eps = float(0.5).div(eps);
      const dhdx = hR.sub(hL).mul(inv2eps);
      const dhdz = hU.sub(hD).mul(inv2eps);
      return vec3(dhdx.negate(), float(1), dhdz.negate()).normalize();
    },
  );
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
