import { Fn, float, int, vec2, vec3, vec4 } from "three/tsl";
import type { Node } from "three/webgpu";
import { sampleTerrainField } from "../gpu/terrainFieldStorage";
import {
  cubeFaceBasis,
  cubeFaceFromDirection,
  sphereTangentFrameNormal,
  unpackTangentNormal,
} from "../tsl/cubeSphere";
import { createElevationFunction } from "../tsl/elevation";
import {
  createTileIndexFromDirection,
  createTileIndexFromWorldPosition,
} from "./gpuSpatialIndex";
import type { CreateTerrainSamplerParams, TerrainSampler } from "./types";
import { tileLocalToFieldUV } from "../gpu/tile";

/**
 * Shared sample body: turns a tile-lookup result `vec3(tileIndex, u, v)` into
 * the packed sample `vec4(elevation, nx, ny, nz)` (zeroed when no tile covers
 * the location).
 */
function packedSampleFromTileResult(
  params: CreateTerrainSamplerParams,
  tileResult: Node,
): Node {
  const tileIndex = int(tileResult.x).toVar();
  const safeTileIndex = tileIndex.max(int(0)).toVar();
  const fieldU = tileLocalToFieldUV(
    tileResult.y,
    params.uniforms.uInnerTileSegments,
  ).toVar();
  const fieldV = tileLocalToFieldUV(
    tileResult.z,
    params.uniforms.uInnerTileSegments,
  ).toVar();
  const found = tileIndex.greaterThanEqual(int(0)).toVar();

  const sampled = sampleTerrainField(
    params.terrainFieldStorage,
    fieldU,
    fieldV,
    safeTileIndex,
  ).toVar();
  const normal = unpackTangentNormal(sampled.g, sampled.b);

  const valid = found.select(float(1), float(0)).toVar();
  return vec4(sampled.r, normal.x, normal.y, normal.z).mul(valid);
}

function createTerrainSampleNode(params: CreateTerrainSamplerParams) {
  const tileLookup = createTileIndexFromWorldPosition(
    params.spatialIndex,
    params.uniforms,
    params.maxLevel,
  );
  return Fn(([worldX, worldZ]: [Node, Node]) => {
    const tileResult = tileLookup(worldX, worldZ).toVar();
    return packedSampleFromTileResult(params, tileResult);
  });
}

function createTerrainSampleNodeByDirection(params: CreateTerrainSamplerParams) {
  const tileLookup = createTileIndexFromDirection(params.spatialIndex, params.maxLevel);
  return Fn(([direction]: [Node]) => {
    const tileResult = tileLookup(direction).toVar();
    return packedSampleFromTileResult(params, tileResult);
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
  const sampleNormal = Fn(([worldX, worldZ]: [Node, Node]) => {
    const sample = terrainSampleAt(worldX, worldZ).toVar();
    return vec3(sample.y, sample.z, sample.w);
  });
  const sampleValidity = Fn(([worldX, worldZ]: [Node, Node]) => {
    const sample = terrainSampleAt(worldX, worldZ).toVar();
    return sample.y
      .abs()
      .add(sample.z.abs())
      .add(sample.w.abs())
      .greaterThan(float(0))
      .select(float(1), float(0));
  });
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

  const sampler: TerrainSampler = {
    sampleElevation,
    sampleNormal,
    sampleTerrain,
    sampleValidity,
    evaluateElevation,
    evaluateNormal,
  };

  if (params.projection === "cubeSphere") {
    const terrainSampleByDir = createTerrainSampleNodeByDirection(params);
    sampler.sampleTerrainByDirection = Fn(([direction]: [Node]) =>
      terrainSampleByDir(direction),
    );
    sampler.sampleElevationByDirection = Fn(
      ([direction]: [Node]) => terrainSampleByDir(direction).x,
    );
    sampler.sampleValidityByDirection = Fn(([direction]: [Node]) => {
      const sample = terrainSampleByDir(direction).toVar();
      return sample.y
        .abs()
        .add(sample.z.abs())
        .add(sample.w.abs())
        .greaterThan(float(0))
        .select(float(1), float(0));
    });
    sampler.sampleNormalByDirection = Fn(([direction]: [Node]) => {
      const dir = vec3(direction).normalize().toVar();
      const packed = terrainSampleByDir(direction).toVar();
      const basis = cubeFaceBasis(cubeFaceFromDirection(dir));
      return sphereTangentFrameNormal(dir, basis, vec3(packed.y, packed.z, packed.w));
    });
  }

  return sampler;
}
