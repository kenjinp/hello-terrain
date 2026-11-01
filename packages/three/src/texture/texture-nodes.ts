import { Vector4 } from "three";
import {
  Fn, If, atan, cameraWorldMatrix, cos, dFdx, dFdy, float, int, ivec2, mix,
  normalLocal, positionLocal, select, sin, struct, texture, transformNormalToView,
  uint, uniformArray, uv, uvec4, varying, vec2, vec3, vec4,
} from "three/tsl";
import type { Node, NodeMaterial } from "three/webgpu";
import { loadTileField, type TileFieldStorage } from "../gpu/tileFieldStorage";
import { type TileCompute } from "../gpu/tile";
import type { SurfaceProjection } from "../projection/types";
import { decodeTextureControl, type DecodedTextureControl } from "../tsl/texture";
import { tileIndex } from "../tsl/varyings";
import { textureSlotTint, type TerrainTextureSet } from "./texture-set";
import { textureHoleNode } from "./texture-hole";

export interface TerrainTextureRenderOptions {
  heightBlend?: boolean;
  /** 0..1 maps to exponent 4..64. Stable log-space normalization avoids overflow. */
  blendSharpness?: number;
  /** Explicit quality choice. Automatic distance/level policies are not part of phase one. */
  corners?: 1 | 4;
  holes?: "discard" | "collapse" | "none";
}

export interface TerrainTextureNodes {
  albedo: Node;
  normal: Node;
  normalWorld: Node;
  roughness: Node;
  ao: Node;
  height: Node;
  hole: Node;
  control: DecodedTextureControl;
  weightOf(slot: Node | number): Node;
}

export interface TerrainTextureNodeParams {
  textureFieldStorage: TileFieldStorage;
  textureSet: TerrainTextureSet;
  projection: SurfaceProjection;
  tile: TileCompute;
  options?: TerrainTextureRenderOptions;
}

/** Two-array material shading. Every filtered read uses gradients computed before divergent selection. */
export function terrainTextureNodes(params: TerrainTextureNodeParams): TerrainTextureNodes {
  const { textureFieldStorage: field, textureSet: set, projection, tile, options = {} } = params;
  if (set.disposed) throw new Error("Cannot shade with a disposed terrain texture set");
  const buildFrame = projection.gpu.textureFrame;
  if (!buildFrame) throw new Error(`Projection ${projection.kind} must supply gpu.textureFrame for texturing`);
  const sharpness = 4 + 60 * Math.max(0, Math.min(1, options.blendSharpness ?? 0.5));
  const corners = options.corners ?? 4;
  const detiling = set.slots.some(slot => slot.antiTiling === "detile");
  const edge = field.edgeVertexCount;
  const index = tileIndex();
  const face = tile.tileFace(index);
  const position = varying(positionLocal, "vTerrainTexturePosition");
  const normalVarying = varying(normalLocal, "vTerrainTextureNormal");
  const frame = buildFrame(position, face);
  const grid = vec2(uv().x, uv().y.oneMinus()).mul(edge - 1).clamp(0, edge - 1);
  const hole = textureHoleNode(field, grid, index, options.holes ?? "discard");
  const nearest = ivec2(grid.round());
  const control = decodeTextureControl(loadTileField(field, nearest.x, nearest.y, index).r);
  const albedoArray = texture(set.albedoHeight);
  const normalArray = texture(set.normalRoughAo);
  const parameters = uniformArray(set.slots.map(slot => new Vector4(
    slot.uvScale ?? 10, slot.normalStrength ?? 1, slot.roughnessOffset ?? 0, slot.aoStrength ?? 1,
  )));
  const details = uniformArray(set.slots.map(slot => new Vector4(
    slot.antiTiling === "detile" ? slot.detiling?.rotation ?? Math.PI : 0,
    slot.antiTiling === "detile" ? slot.detiling?.shift ?? 1 : 0,
    slot.heightOffset ?? 0, slot.heightScale ?? 1,
  )));
  const tints = uniformArray(set.slots.map(slot => {
    const tint = textureSlotTint(slot);
    return new Vector4(tint.r, tint.g, tint.b, slot.projection === "vertical" ? 1 : 0);
  }));
  const Material = struct({ color: "vec3", normal: "vec3", roughness: "float", ao: "float", height: "float" });
  const Result = struct({ color: "vec3", normal: "vec3", roughness: "float", ao: "float", height: "float", base: "uvec4", overlay: "uvec4", baseWeights: "vec4", overlayWeights: "vec4" });

  const result = Fn(() => {
    // The face/tile itself can differ across a quad. Derive from continuous position,
    // not a dynamically selected face UV, and project those derivatives analytically.
    // toVar is lazy. Explicitly append shared values so a skipped corner/slot cannot
    // leave a cached projection conditional uninitialized for another branch.
    const geometricNormal = normalVarying.normalize().toVar().toStack();
    const surfaceUV = frame.uv.toVar().toStack();
    const surfaceHeight = frame.height.toVar().toStack();
    const up = frame.up.toVar().toStack();
    const surfaceU = frame.tangentU.toVar().toStack();
    const surfaceV = frame.tangentV.toVar().toStack();
    const positionDx = dFdx(position).toVar().toStack();
    const positionDy = dFdy(position).toVar().toStack();
    const uvDx = frame.uvGradient(positionDx).toVar().toStack();
    const uvDy = frame.uvGradient(positionDy).toVar().toStack();
    const heightDx = positionDx.dot(up).toVar().toStack();
    const heightDy = positionDy.dot(up).toVar().toStack();
    const sumColor = vec3(0).toVar(), sumNormal = vec3(0).toVar();
    const sumRoughness = float(0).toVar(), sumAo = float(0).toVar(), sumHeight = float(0).toVar();
    const baseIds = uvec4(0).toVar(), overlayIds = uvec4(0).toVar();
    const baseWeights = vec4(0).toVar(), overlayWeights = vec4(0).toVar();
    const lower = ivec2(grid.floor().min(edge - 2));
    const fraction = grid.sub(vec2(lower));

    function sampleSlot(slot: Node, decoded: DecodedTextureControl, anchor: Node): Node {
      const safeSlot = int(slot.min(set.slots.length - 1));
      const p = parameters.element(safeSlot), detail = details.element(safeSlot), tint = tints.element(safeSlot);
      const vertical = tint.w.greaterThan(0).and(geometricNormal.dot(up).abs().lessThan(Math.SQRT1_2));
      const angle = atan(geometricNormal.dot(surfaceV), geometricNormal.dot(surfaceU)).mul(4 / Math.PI).round().mul(Math.PI / 4);
      const horizontal = vec2(sin(angle).negate(), cos(angle));
      const materialUV = select(vertical, vec2(surfaceUV.dot(horizontal), surfaceHeight), surfaceUV);
      const dx = select(vertical, vec2(uvDx.dot(horizontal), heightDx), uvDx);
      const dy = select(vertical, vec2(uvDy.dot(horizontal), heightDy), uvDy);
      const tangentU = select(vertical, surfaceU.mul(horizontal.x).add(surfaceV.mul(horizontal.y)), surfaceU);
      const tangentV = select(vertical, up, surfaceV);
      const random = detiling ? sin(anchor.mul(1000).round().dot(vec2(12.9898, 78.233)).add(slot.toFloat().mul(37.719))).mul(43758.5453).fract() : float(0);
      const rotation = decoded.uvRotation.add(random.mul(2).sub(1).mul(detail.x));
      const c = cos(rotation), s = sin(rotation);
      const rotate = (v: Node) => vec2(v.x.mul(c).sub(v.y.mul(s)), v.x.mul(s).add(v.y.mul(c)));
      const scale = decoded.uvScale.div(p.x);
      const sampleUV = rotate(materialUV.mul(scale)).add(vec2(random, random.mul(7.13).fract()).mul(detail.y));
      const gradientX = rotate(dx.mul(scale)), gradientY = rotate(dy.mul(scale));
      const albedoSampler = texture(albedoArray, sampleUV);
      const normalSampler = texture(normalArray, sampleUV);
      albedoSampler.depthNode = normalSampler.depthNode = safeSlot;
      const a = albedoSampler.grad(gradientX, gradientY).toVar();
      const n = normalSampler.grad(gradientX, gradientY).toVar();
      const encodedXY = n.rg.mul(2).sub(1).mul(p.y);
      // Undo the sampling rotation before moving the tangent normal into terrain coordinates.
      const xy = vec2(encodedXY.x.mul(c).add(encodedXY.y.mul(s)), encodedXY.y.mul(c).sub(encodedXY.x.mul(s)));
      const z = float(1).sub(xy.dot(xy)).max(0).sqrt();
      const rawU = tangentU.sub(geometricNormal.mul(tangentU.dot(geometricNormal)));
      const u = select(rawU.dot(rawU).greaterThan(1e-8), rawU, up.cross(geometricNormal)).normalize();
      const rawV = tangentV.sub(geometricNormal.mul(tangentV.dot(geometricNormal))).sub(u.mul(tangentV.dot(u)));
      const v = select(rawV.dot(rawV).greaterThan(1e-8), rawV, u.cross(geometricNormal)).normalize();
      const normal = u.mul(xy.x).add(v.mul(xy.y)).add(geometricNormal.mul(z)).normalize();
      return Material(a.rgb.mul(tint.rgb), normal, n.a.add(p.z).clamp(), mix(float(1), n.b, p.w).clamp(), a.a.mul(detail.w).add(detail.z));
    }

    for (let corner = 0; corner < corners; corner++) {
      const cell = corners === 1 ? nearest : lower.add(ivec2(corner % 2, Math.floor(corner / 2)));
      const weight = corners === 1 ? float(1) : (corner % 2 ? fraction.x : fraction.x.oneMinus()).mul(corner >= 2 ? fraction.y : fraction.y.oneMinus());
      const decoded = decodeTextureControl(loadTileField(field, cell.x, cell.y, index).r);
      baseIds.element(int(corner)).assign(decoded.base);
      overlayIds.element(int(corner)).assign(decoded.overlay);
      If(weight.greaterThan(0), () => {
        const anchor = detiling ? buildFrame(tile.tileVertexWorldPositionCompute(index, cell.x, cell.y), face).uv.toVar().toStack() : vec2(0);
        const base = Material(vec3(0), geometricNormal, float(0), float(0), float(0)).toVar();
        const overlay = Material(vec3(0), geometricNormal, float(0), float(0), float(0)).toVar();
        const blend = select(decoded.base.equal(decoded.overlay), float(0), decoded.blend).toVar();
        If(blend.lessThan(1), () => { base.assign(sampleSlot(decoded.base, decoded, anchor)); });
        If(blend.greaterThan(0), () => { overlay.assign(sampleSlot(decoded.overlay, decoded, anchor)); });
        if (options.heightBlend !== false) {
          If(blend.greaterThan(0).and(blend.lessThan(1)), () => {
            const wb = blend.oneMinus(), wo = blend;
            const scoreB = wb.add(base.get("height")).max(1e-8).log2().mul(sharpness).add(wb.log2());
            const scoreO = wo.add(overlay.get("height")).max(1e-8).log2().mul(sharpness).add(wo.log2());
            const maxScore = scoreB.max(scoreO);
            const b = float(2).pow(scoreB.sub(maxScore));
            const o = float(2).pow(scoreO.sub(maxScore));
            blend.assign(o.div(b.add(o)));
          });
        }
        const b = weight.mul(blend.oneMinus()), o = weight.mul(blend);
        baseWeights.element(int(corner)).assign(b); overlayWeights.element(int(corner)).assign(o);
        sumColor.addAssign(base.get("color").mul(b).add(overlay.get("color").mul(o)));
        sumNormal.addAssign(base.get("normal").mul(b).add(overlay.get("normal").mul(o)));
        sumRoughness.addAssign(base.get("roughness").mul(b).add(overlay.get("roughness").mul(o)));
        sumAo.addAssign(base.get("ao").mul(b).add(overlay.get("ao").mul(o)));
        sumHeight.addAssign(base.get("height").mul(b).add(overlay.get("height").mul(o)));
      });
    }
    return Result(sumColor, sumNormal.normalize(), sumRoughness, sumAo, sumHeight, baseIds, overlayIds, baseWeights, overlayWeights);
  })().toVar();
  const normal = transformNormalToView(result.get("normal")).normalize();
  return {
    albedo: Fn(() => {
      const color = result.get("color").toVar();
      // Also reached when three's shadow override reads colorNode.a.
      hole.discard();
      return vec4(color, 1);
    })(),
    normal,
    normalWorld: cameraWorldMatrix.mul(vec4(normal, 0)).xyz.normalize(),
    roughness: result.get("roughness"), ao: result.get("ao"), height: result.get("height"),
    hole, control,
    weightOf(slot) {
      return Fn(() => {
        const id = typeof slot === "number" ? uint(slot) : uint(slot);
        const weight = float(0).toVar();
        for (let i = 0; i < corners; i++) {
          weight.addAssign(select(result.get("base").element(int(i)).equal(id), result.get("baseWeights").element(int(i)), float(0)));
          weight.addAssign(select(result.get("overlay").element(int(i)).equal(id), result.get("overlayWeights").element(int(i)), float(0)));
        }
        return weight;
      })();
    },
  };
}

/** Works with standard/physical node materials; colorNode alone also carries the hole discard. */
export function applyTerrainTextureNodes(material: NodeMaterial, nodes: TerrainTextureNodes): void {
  material.colorNode = nodes.albedo;
  material.normalNode = nodes.normal;
  Object.assign(material, { roughnessNode: nodes.roughness, aoNode: nodes.ao });
  material.needsUpdate = true;
}
