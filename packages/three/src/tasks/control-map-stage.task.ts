import { task } from "@hello-terrain/work";
import { Fn, float, int, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";
import type { ComputePipeline } from "../gpu/compute";
import {
  loadTerrainFieldElevation,
  loadTerrainFieldNormal,
} from "../gpu/terrainFieldStorage";
import {
  packControlU32,
  type TextureControl,
} from "../tsl/textureControl";
import { createControlMapContextTask } from "./control-map.task";
import { tileNodesTask } from "./elevation-field.task";
import { textureControlFn } from "./params";
import { terrainFieldStageTask, createTerrainFieldTextureTask } from "./terrain-field.task";
import { updateUniformsTask } from "./uniforms/uniforms.task";

const createSlopeFromNormal = Fn(([normal]: [Node]) => {
  return normal.y.max(float(0)).min(float(1));
});

export const controlMapStageTask = task((get, work) => {
  const upstream = get(terrainFieldStageTask);
  const controlMapContext = get(createControlMapContextTask);
  const tile = get(tileNodesTask);
  const terrainUniforms = get(updateUniformsTask);
  const terrainFieldStorage = get(createTerrainFieldTextureTask);
  const userTextureControlFn = get(textureControlFn);

  return work((): ComputePipeline => {
    return [
      ...upstream,
      (nodeIndex, globalVertexIndex, _uv, localCoordinates) => {
        const ix = int(localCoordinates.x);
        const iy = int(localCoordinates.y);
        const edgeVertexCount = terrainUniforms.uInnerTileSegments.toVar().add(int(3));

        const tileUV = localCoordinates.toFloat().div(edgeVertexCount.toFloat());
        const rootUV = tile.rootUVCompute(nodeIndex, ix, iy);
        const worldPosition = tile.tileVertexWorldPositionCompute(nodeIndex, ix, iy);

        const normalXZ = loadTerrainFieldNormal(
          terrainFieldStorage,
          ix,
          iy,
          nodeIndex,
        );
        const nx = normalXZ.x;
        const nz = normalXZ.y;
        const nySq = float(1).sub(nx.mul(nx)).sub(nz.mul(nz)).max(float(0));
        const normal = vec3(nx, nySq.sqrt(), nz);
        const slope = createSlopeFromNormal(normal);

        const control = userTextureControlFn
          ? userTextureControlFn({
            worldPosition,
            rootSize: terrainUniforms.uRootSize,
            rootUV,
            tileUV,
            tileLevel: tile.tileLevel(nodeIndex),
            tileSize: tile.tileSize(nodeIndex),
            tileOriginVec2: tile.tileOriginVec2(nodeIndex),
            nodeIndex: int(nodeIndex),
            elevation: loadTerrainFieldElevation(
              terrainFieldStorage,
              ix,
              iy,
              nodeIndex,
            ),
            normal,
            slope,
          })
          : {
            baseTextureId: int(0),
          };

        const packed = packControlU32(control as unknown as TextureControl);
        controlMapContext.node.element(globalVertexIndex).assign(packed);
      },
    ];
  });
}).displayName("controlMapStageTask");
