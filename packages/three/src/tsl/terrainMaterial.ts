import { float, Fn, normalMap, positionWorld, vec2 } from "three/tsl";
import type { Node } from "three/webgpu";
import type { ControlMapContext } from "../gpu/controlMap";
import type { TextureArrayContext } from "../gpu/textureArray";
import type { TerrainUniformsContext } from "../types";
import { blendAngleCorrectedNormals, vectorSpaceToTextureSpace } from "./materials";
import {
  decodeControlBaseId,
  decodeControlBlend,
  decodeControlOverlayId,
  decodeControlUvScale,
  readControlMapPacked,
} from "./controlMap";
import {
  decodeNormalRG,
  heightBlend,
  sampleTextureArrayLayer,
} from "./textureArraySampling";
import { vGlobalVertexIndex } from "./varyings";

export interface CreateTerrainMaterialNodeParams {
  controlMapContext: ControlMapContext;
  textureArrayContext: TextureArrayContext;
  terrainUniforms: TerrainUniformsContext;
  textureScale?: number;
  heightBlendSharpness?: number;
}

function createWorldUV(textureScale: number, controlUvScale: Node): Node {
  const base = vec2(positionWorld.x, positionWorld.z).div(float(textureScale));
  return base.div(controlUvScale.max(float(1)));
}

export function createTerrainColorNode({
  controlMapContext,
  textureArrayContext,
  textureScale = 3.5,
  heightBlendSharpness = 8,
}: CreateTerrainMaterialNodeParams): Node {
  return Fn(() => {
    const packed = readControlMapPacked(controlMapContext.node, vGlobalVertexIndex);
    const baseId = decodeControlBaseId(packed);
    const overlayId = decodeControlOverlayId(packed);
    const blend = decodeControlBlend(packed);
    const uvScale = decodeControlUvScale(packed);
    const uv = createWorldUV(textureScale, uvScale);
    const base = sampleTextureArrayLayer(
      textureArrayContext.albedoHeight,
      uv,
      baseId,
    );
    const overlay = sampleTextureArrayLayer(
      textureArrayContext.albedoHeight,
      uv,
      overlayId,
    );
    return heightBlend(
      base.rgb,
      overlay.rgb,
      base.a,
      overlay.a,
      blend,
      float(heightBlendSharpness),
    );
  })();
}

export function createTerrainNormalNode({
  controlMapContext,
  textureArrayContext,
  textureScale = 3.5,
}: CreateTerrainMaterialNodeParams): Node {
  return Fn(() => {
    const packed = readControlMapPacked(controlMapContext.node, vGlobalVertexIndex);
    const baseId = decodeControlBaseId(packed);
    const overlayId = decodeControlOverlayId(packed);
    const blend = decodeControlBlend(packed);
    const uvScale = decodeControlUvScale(packed);
    const uv = createWorldUV(textureScale, uvScale);
    const base = sampleTextureArrayLayer(
      textureArrayContext.normalRoughness,
      uv,
      baseId,
    );
    const overlay = sampleTextureArrayLayer(
      textureArrayContext.normalRoughness,
      uv,
      overlayId,
    );
    const n1 = decodeNormalRG(base.rg);
    const n2 = decodeNormalRG(overlay.rg);
    const blended = blendAngleCorrectedNormals(n1, n2);
    const tangentNormal = n1.mix(blended, blend).normalize();
    return normalMap(vectorSpaceToTextureSpace(tangentNormal), vec2(1, 1));
  })();
}

export function createTerrainRoughnessNode({
  controlMapContext,
  textureArrayContext,
  textureScale = 3.5,
}: CreateTerrainMaterialNodeParams): Node {
  return Fn(() => {
    const packed = readControlMapPacked(controlMapContext.node, vGlobalVertexIndex);
    const baseId = decodeControlBaseId(packed);
    const overlayId = decodeControlOverlayId(packed);
    const blend = decodeControlBlend(packed);
    const uvScale = decodeControlUvScale(packed);
    const uv = createWorldUV(textureScale, uvScale);
    const base = sampleTextureArrayLayer(
      textureArrayContext.normalRoughness,
      uv,
      baseId,
    );
    const overlay = sampleTextureArrayLayer(
      textureArrayContext.normalRoughness,
      uv,
      overlayId,
    );
    // In the current texture packing pipeline, roughness is stored in A.
    return base.a.mix(overlay.a, blend);
  })();
}
