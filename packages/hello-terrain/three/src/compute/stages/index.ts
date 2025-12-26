import { Fn, float, int, max, min, pow, select, uint, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";
import type { TerrainUniforms } from "../../TerrainUniforms";
import type { ControlReturn } from "../../nodes/ControlFn";
import type { ElevationReturn } from "../../nodes/ElevationFn";
import { createHeight } from "../../nodes/height";
import { nodeStorageProperty } from "../../nodes/properties";
import {
  createRootUVCompute,
  createTileIsLeaf,
  createTileLevel,
  createTileOriginVec2,
  createTileSize,
  createTileVertexWorldPositionCompute,
} from "../../nodes/tile";
import type { ComputeStageConfig, ComputeStageContext } from "../ComputeStage";

export function createHeightmapStage(params: {
  uniforms: TerrainUniforms;
  elevationFn: ElevationReturn;
  setMetric: (name: string, value: string) => void;
}): ComputeStageConfig {
  const heightFn = createHeight(params.uniforms, params.elevationFn);
  let startTime = 0;
  return {
    name: "heightmap",
    onBefore: () => {
      startTime = performance.now();
    },
    onAfter: () => {
      const endTime = performance.now();
      params.setMetric("heightmapComputeTime", `${endTime - startTime}ms`);
    },
    inputs: [],
    output: { components: 1, type: Float32Array, name: "heightmapStorage" },
    compute: (ctx: ComputeStageContext) => {
      const h = heightFn(ctx.nodeIndex, ctx.localUV, ctx.texelSize);
      ctx.output.element(ctx.globalVertexIndex).assign(h);
    },
  };
}

export function createNormalmapStage(params: {
  uniforms: TerrainUniforms;
  tileEdgeVertexCount: number;
  /** Name of the stage that provides height input (default: 'heightmap') */
  heightInputStage?: string;
  setMetric: (name: string, value: string) => void;
}): ComputeStageConfig {
  const tileIsLeaf = createTileIsLeaf();
  const tileLevel = createTileLevel();
  const heightStage = params.heightInputStage ?? "heightmap";
  const edge = params.tileEdgeVertexCount;
  let startTime = 0;
  return {
    name: "normalmap",
    onBefore: () => {
      startTime = performance.now();
    },
    onAfter: () => {
      const endTime = performance.now();
      params.setMetric("normalmapComputeTime", `${endTime - startTime}ms`);
    },
    inputs: [heightStage],
    output: { components: 3, type: Float32Array, name: "normalmapStorage" },
    compute: (ctx: ComputeStageContext) => {
      const edgeVertexCount = int(edge);
      const lastVertexIndex = edgeVertexCount.sub(int(1));

      const uVertexIndex = ctx.localUV.x
        .mul(edgeVertexCount.toFloat())
        .floor()
        .toInt();
      const vVertexIndex = ctx.localUV.y
        .mul(edgeVertexCount.toFloat())
        .floor()
        .toInt();

      // Clamp center to inner ring [1, last-1], allow neighbors in skirt [0,last]
      const innerMin = int(1);
      const innerMax = lastVertexIndex.sub(int(1));
      const uCenter = max(min(uVertexIndex, innerMax), innerMin);
      const vCenter = max(min(vVertexIndex, innerMax), innerMin);
      const uLeft = uCenter.sub(int(1));
      const uRight = uCenter.add(int(1));
      const vDown = vCenter.sub(int(1));
      const vUp = vCenter.add(int(1));

      const numVerticesPerNode = edgeVertexCount.mul(edgeVertexCount);
      const nodeVertexBaseIndex = int(ctx.nodeIndex).mul(numVerticesPerNode);

      const heightNode = ctx.input(heightStage);
      const heightScale = params.uniforms.uHeightmapScale.toVar();

      const idx = (u: Node, v: Node) =>
        nodeVertexBaseIndex.add(v.mul(edgeVertexCount).add(u));

      const hLm = heightNode.element(idx(uLeft, vCenter)).mul(heightScale);
      const hRp = heightNode.element(idx(uRight, vCenter)).mul(heightScale);
      const hDm = heightNode.element(idx(uCenter, vDown)).mul(heightScale);
      const hUp = heightNode.element(idx(uCenter, vUp)).mul(heightScale);

      const isNodeActive = nodeStorageProperty
        .element(ctx.nodeIndex.mul(4).add(3))
        .equal(int(1));
      const isNodeLeaf = tileIsLeaf(ctx.nodeIndex);

      // World-space step for inner grid (S = edge - 3)
      const nodeLevel = tileLevel(ctx.nodeIndex);
      const tileSizeWorld = params.uniforms.uRootSize
        .toVar()
        .div(pow(float(2), nodeLevel.toFloat()));
      const innerSegments = float(edge).sub(float(3));
      const stepWorld = tileSizeWorld.div(innerSegments);
      const inv2Step = float(0.5).div(stepWorld);

      const dX = hRp.sub(hLm).mul(inv2Step);
      const dZ = hUp.sub(hDm).mul(inv2Step);

      const computedNormal = vec3(
        dX.negate(),
        float(1),
        dZ.negate()
      ).normalize();
      const finalNormal = select(
        isNodeActive.and(isNodeLeaf),
        computedNormal,
        vec3(0, 0, 0)
      );

      const normalOutputBaseIndex = int(ctx.globalVertexIndex).mul(int(3));
      ctx.output
        .element(normalOutputBaseIndex.add(int(0)))
        .assign(finalNormal.x);
      ctx.output
        .element(normalOutputBaseIndex.add(int(1)))
        .assign(finalNormal.y);
      ctx.output
        .element(normalOutputBaseIndex.add(int(2)))
        .assign(finalNormal.z);
    },
  };
}

export function createControlmapStage(params: {
  uniforms: TerrainUniforms;
  controlFn: ControlReturn;
  /** Name of the stage that provides height input (default: 'heightmap') */
  heightInputStage?: string;
  /** Name of the stage that provides normal input (default: 'normalmap') */
  normalInputStage?: string;
  setMetric: (name: string, value: string) => void;
}): ComputeStageConfig {
  const heightStage = params.heightInputStage ?? "heightmap";
  const normalStage = params.normalInputStage ?? "normalmap";

  const tileIsLeaf = createTileIsLeaf();
  const rootUVCompute = createRootUVCompute(params.uniforms);
  const tileVertexWorldPositionCompute = createTileVertexWorldPositionCompute(
    params.uniforms
  );
  const tileOriginVec2 = createTileOriginVec2();
  const tileSize = createTileSize(params.uniforms);
  const tileLevel = createTileLevel();
  let startTime = 0;
  return {
    name: "controlmap",
    onBefore: () => {
      startTime = performance.now();
    },
    onAfter: () => {
      const endTime = performance.now();
      params.setMetric("controlmapComputeTime", `${endTime - startTime}ms`);
    },
    inputs: [heightStage, normalStage],
    output: { components: 1, type: Uint32Array, name: "controlmapStorage" },
    compute: (ctx: ComputeStageContext) => {
      const isActive = nodeStorageProperty
        .element(ctx.nodeIndex.mul(4).add(3))
        .equal(int(1));
      const isLeaf = tileIsLeaf(ctx.nodeIndex);

      const resolveControl = Fn(() => {
        const rootUV = rootUVCompute(ctx.nodeIndex, ctx.localUV);
        const worldPosition = tileVertexWorldPositionCompute(
          ctx.nodeIndex,
          ctx.localUV
        ).setName("worldPositionControl");

        const rootSize = params.uniforms.uRootSize.toVar();

        const height = ctx
          .input(heightStage)
          .element(ctx.globalVertexIndex)
          .toVar();

        const normalBaseIdx = int(ctx.globalVertexIndex).mul(int(3));
        const normalNode = ctx.input(normalStage);
        const nx = normalNode.element(normalBaseIdx);
        const ny = normalNode.element(normalBaseIdx.add(int(1)));
        const nz = normalNode.element(normalBaseIdx.add(int(2)));
        const normal = vec3(nx, ny, nz).toVar();

        return params.controlFn({
          worldPosition,
          rootSize,
          rootUV,
          tileOriginVec2: tileOriginVec2(ctx.nodeIndex),
          tileSize: tileSize(ctx.nodeIndex),
          tileLevel: tileLevel(ctx.nodeIndex),
          nodeIndex: int(ctx.nodeIndex),
          tileUV: ctx.localUV,
          height,
          normal,
        });
      });

      const packed = select(isActive.and(isLeaf), resolveControl(), uint(0));
      ctx.output.element(ctx.globalVertexIndex).assign(packed);
    },
  };
}
