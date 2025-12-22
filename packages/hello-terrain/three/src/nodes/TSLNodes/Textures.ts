import {
  Fn,
  float,
  normalLocal,
  positionLocal,
  smoothstep,
  triplanarTexture,
  vec3,
} from 'three/tsl';
import type { Node, TextureNode } from 'three/webgpu';

export const slopeTextureBlend = Fn(
  ([textureA, textureB, slopeTransitionStart, slopeTransitionEnd, slope]: [
    textureA: Node,
    textureB: Node,
    slopeTransitionStart: number,
    slopeTransitionEnd: number,
    slope: number,
  ]) => {
    const start = float(slopeTransitionStart);
    const end = float(slopeTransitionEnd);
    const slopeValue = float(slope);

    const blendFactor = smoothstep(start, end, slopeValue);

    // When slope is low (flat terrain), textureA dominates
    // When slope is high (steep terrain), textureB dominates
    const blendedTexture = textureA
      .mul(blendFactor.oneMinus())
      .add(textureB.mul(blendFactor));

    return blendedTexture.saturate();
  },
);

export const heightBlend = Fn(
  ([textureA, textureB, heightMapA, heightMapB, blendFactor, contrast = 4.0]: [
    textureA: Node,
    textureB: Node,
    heightMapA: TextureNode,
    heightMapB: TextureNode,
    blendFactor: Node,
    contrast?: number,
  ]) => {
    const contrastValue = float(contrast);

    // Sample heightmaps at current position
    const heightA = heightMapA.r;
    const heightB = heightMapB.r;

    // Generate base weights (inverse of each other for two textures)
    const weightA = blendFactor.oneMinus();
    const weightB = blendFactor;

    // Apply height bias using the algorithm from the GLSL example
    // weights * pow(heights + 1.0, contrast)
    // Scale height influence by the base weight to reduce impact when weight is low
    const heightInfluenceA = heightA.add(float(1.0)).pow(contrastValue);
    const heightInfluenceB = heightB.add(float(1.0)).pow(contrastValue);

    // Apply height influence only proportionally to the base weight
    // When weight is 0, no height influence is applied (result = 0)
    const heightWeightA = weightA.mul(heightInfluenceA);
    const heightWeightB = weightB.mul(heightInfluenceB);

    // Normalize weights to sum to 1
    const totalWeight = heightWeightA.add(heightWeightB);
    const normalizedWeightA = heightWeightA.div(totalWeight);
    const normalizedWeightB = heightWeightB.div(totalWeight);

    // Blend textures using the height-adjusted weights
    const blendedTexture = textureA
      .mul(normalizedWeightA)
      .add(textureB.mul(normalizedWeightB))
      .saturate();

    return blendedTexture;
  },
);

export const slerp = Fn(
  ([textureA, textureB, blendFactor]: [textureA: TextureNode, textureB: TextureNode, blendFactor: Node]) => {
    const dotAB = textureA.dot(textureB).clamp(-1, 1);
    const theta = dotAB.acos().mul(blendFactor);
    const relativeVec = textureB.sub(textureA.mul(dotAB)).normalize();
    return textureA.mul(theta.cos()).add(relativeVec.mul(theta.sin()));
  },
);

// TODO I can't get this function to work
export const slerpTriplanarTexture = Fn(
  ([
    textureXNode,
    textureYNode = textureXNode,
    textureZNode = textureXNode,
    scaleNode = float(1),
    positionNode = positionLocal,
    normalNode = normalLocal,
  ]: [
    textureXNode: TextureNode,
    textureYNode?: TextureNode | null,
    textureZNode?: TextureNode | null,
    scaleNode?: Node,
    positionNode?: Node,
    normalNode?: Node,
  ]) => {
    const bf = normalNode.abs().normalize();
    const bg = bf.div(bf.dot(vec3(1.0)));

    const tx = positionNode.yz.mul(scaleNode);
    const ty = positionNode.zx.mul(scaleNode);
    const tz = positionNode.xy.mul(scaleNode);

    // Base color
    const textureX = textureXNode;
    const textureY = textureYNode !== null ? textureYNode : textureX;
    const textureZ = textureZNode !== null ? textureZNode : textureX;

    const cx = textureX.sample(tx);
    const cy = textureY.sample(ty);
    const cz = textureZ.sample(tz);

    const ab = slerp(cx, cy, bg.x.div(bg.x.add(bg.y)));
    const abc = slerp(ab, cz, bg.z.div(bg.x.add(bg.y).add(bg.z)));
    return abc;
  },
);

export const createTriplanarTextureBlend = Fn(
  ([
    grassTexture,
    cliffTexture,
    grassHeightTexture,
    cliffHeightTexture,
    textureScale,
    worldPosition,
    normal,
    slopeTransitionStart = 0.18,
    slopeTransitionEnd = 0.25,
    contrast = 1.0,
  ]: [
    grassTexture: TextureNode,
    cliffTexture: TextureNode,
    grassHeightTexture: TextureNode,
    cliffHeightTexture: TextureNode,
    textureScale: Node,
    worldPosition: Node,
    normal: Node,
    slopeTransitionStart?: number,
    slopeTransitionEnd?: number,
    contrast?: number,
  ]) => {
    const slope = normal.y.oneMinus();

    const grassTriplanar = triplanarTexture(
      grassTexture,
      grassTexture,
      grassTexture,
      textureScale,
      worldPosition,
      normal,
    );

    const cliffTriplanar = triplanarTexture(
      cliffTexture,
      cliffTexture,
      cliffTexture,
      textureScale,
      worldPosition,
      normal,
    );

    const grassHeightTriplanar = triplanarTexture(
      grassHeightTexture,
      grassHeightTexture,
      grassHeightTexture,
      textureScale,
      worldPosition,
      normal,
    );

    const cliffHeightTriplanar = triplanarTexture(
      cliffHeightTexture,
      cliffHeightTexture,
      cliffHeightTexture,
      textureScale,
      worldPosition,
      normal,
    );

    // Calculate the slope-based blend factor as a scalar
    const slopeBlendFactor = smoothstep(
      float(slopeTransitionStart),
      float(slopeTransitionEnd),
      slope,
    );

    const heightBlendedTexture = heightBlend(
      grassTriplanar,
      cliffTriplanar,
      grassHeightTriplanar,
      cliffHeightTriplanar,
      slopeBlendFactor,
      contrast,
    );

    return heightBlendedTexture;
  },
);
