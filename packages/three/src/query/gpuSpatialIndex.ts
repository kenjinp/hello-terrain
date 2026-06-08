import { storage, Break, Fn, If, Loop, float, int, pow, uint, uniform, vec3 } from "three/tsl";
import { StorageBufferAttribute } from "three/webgpu";
import type { Node } from "three/webgpu";
import type { SpatialIndex } from "../quadtree";
import {
  cubeFaceBasis,
  cubeFaceFromDirection,
  cubeFaceUVFromDirection,
} from "../nodes/cubeSphere";
import type { TerrainUniformsContext } from "../types";
import type { GpuSpatialIndexContext } from "./types";

const SLOT_STRIDE = 6;

function nextPow2(n: number): number {
  let x = 1;
  while (x < n) x <<= 1;
  return x;
}

export function createGpuSpatialIndex(maxEntries: number): GpuSpatialIndexContext {
  const size = nextPow2(Math.max(2, maxEntries * 2));
  const data = new Uint32Array(size * SLOT_STRIDE);
  const attribute = new StorageBufferAttribute(data, SLOT_STRIDE);
  const node = storage(attribute, "u32", 1).toReadOnly().setName("gpuSpatialIndex");
  const stampGen = uniform(uint(1)).setName("uGpuSpatialIndexStampGen");
  return {
    data,
    size,
    mask: size - 1,
    stampGen,
    attribute,
    node,
  };
}

export function uploadGpuSpatialIndex(
  gpuIndex: GpuSpatialIndexContext,
  cpuIndex: SpatialIndex,
): void {
  if (gpuIndex.size !== cpuIndex.size) {
    throw new Error(
      `Spatial index size mismatch (gpu=${gpuIndex.size}, cpu=${cpuIndex.size}).`,
    );
  }

  for (let i = 0; i < cpuIndex.size; i += 1) {
    const base = i * SLOT_STRIDE;
    gpuIndex.data[base] = cpuIndex.stamp[i] ?? 0;
    gpuIndex.data[base + 1] = cpuIndex.keysSpace[i] ?? 0;
    gpuIndex.data[base + 2] = cpuIndex.keysLevel[i] ?? 0;
    gpuIndex.data[base + 3] = cpuIndex.keysX[i] ?? 0;
    gpuIndex.data[base + 4] = cpuIndex.keysY[i] ?? 0;
    gpuIndex.data[base + 5] = cpuIndex.values[i] ?? 0;
  }

  gpuIndex.stampGen.value = cpuIndex.stampGen >>> 0;
  gpuIndex.attribute.needsUpdate = true;
  gpuIndex.node.needsUpdate = true;
}

export function readGpuSpatialIndexValue(
  spatialIndex: GpuSpatialIndexContext,
  slot: Node,
  fieldOffset: number,
): Node {
  const offset = int(slot).mul(int(SLOT_STRIDE)).add(int(fieldOffset));
  return spatialIndex.node.element(offset).toUint();
}

const mix32 = Fn(([x]: [Node]) => {
  const v = uint(x).toVar();
  v.assign(v.bitXor(v.shiftRight(uint(16))));
  v.assign(v.mul(uint(0x7feb352d)));
  v.assign(v.bitXor(v.shiftRight(uint(15))));
  v.assign(v.mul(uint(0x846ca68b)));
  v.assign(v.bitXor(v.shiftRight(uint(16))));
  return v;
});

const hashKey = Fn(([space, level, x, y]: [Node, Node, Node, Node]) => {
  const s = uint(space).bitAnd(uint(0xff));
  const l = uint(level).bitAnd(uint(0xff));
  const h = s.bitXor(l.shiftLeft(uint(8))).bitXor(mix32(uint(x))).bitXor(mix32(uint(y)));
  return mix32(h);
});

const createGpuSpatialLookup = (spatialIndex: GpuSpatialIndexContext) => {
  const slotCount = spatialIndex.size;
  const mask = uint(spatialIndex.mask);
  const stampGen = spatialIndex.stampGen.toUint();
  const emptyValue = int(-1);

  return Fn(([space, level, x, y]: [Node, Node, Node, Node]) => {
    const s = uint(space).bitAnd(uint(0xff));
    const l = uint(level).bitAnd(uint(0xff));
    const xx = uint(x);
    const yy = uint(y);
    const result = emptyValue.toVar();
    const slot = hashKey(s, l, xx, yy).bitAnd(mask).toVar();
    const probes = int(0).toVar();

    Loop(slotCount, () => {
      const stamp = readGpuSpatialIndexValue(spatialIndex, slot, 0);
      If(stamp.notEqual(stampGen), () => {
        Break();
      });

      const ks = readGpuSpatialIndexValue(spatialIndex, slot, 1);
      const kl = readGpuSpatialIndexValue(spatialIndex, slot, 2);
      const kx = readGpuSpatialIndexValue(spatialIndex, slot, 3);
      const ky = readGpuSpatialIndexValue(spatialIndex, slot, 4);

      If(
        ks.equal(s).and(kl.equal(l)).and(kx.equal(xx)).and(ky.equal(yy)),
        () => {
          result.assign(int(readGpuSpatialIndexValue(spatialIndex, slot, 5)));
          Break();
        },
      );

      slot.assign(slot.add(uint(1)).bitAnd(mask));
      probes.addAssign(1);
    });

    return result;
  });
};

export const createTileIndexFromWorldPosition = (
  spatialIndex: GpuSpatialIndexContext,
  uniforms: TerrainUniformsContext,
  maxLevel: number,
) => {
  const lookup = createGpuSpatialLookup(spatialIndex);
  const levelCount = Math.max(1, maxLevel + 1);

  return Fn(([worldX, worldZ]: [Node, Node]) => {
    const rootOrigin = uniforms.uRootOrigin.toVar();
    const rootSize = uniforms.uRootSize.toVar();
    const halfRoot = rootSize.mul(float(0.5));
    const tileIndex = int(-1).toVar();
    const tileU = float(0).toVar();
    const tileV = float(0).toVar();
    const i = int(0).toVar();

    Loop(levelCount, () => {
      const level = int(maxLevel).sub(i).toVar();
      const scale = pow(float(2), level.toFloat());
      const tileSize = rootSize.div(scale);
      const tileX = worldX
        .sub(rootOrigin.x)
        .add(halfRoot)
        .div(tileSize)
        .floor()
        .toInt();
      const tileY = worldZ
        .sub(rootOrigin.z)
        .add(halfRoot)
        .div(tileSize)
        .floor()
        .toInt();
      const maybeIndex = lookup(int(0), level, tileX, tileY).toVar();

      If(maybeIndex.greaterThanEqual(int(0)), () => {
        const minX = rootOrigin.x.add(tileX.toFloat().mul(tileSize)).sub(halfRoot);
        const minZ = rootOrigin.z.add(tileY.toFloat().mul(tileSize)).sub(halfRoot);
        tileIndex.assign(maybeIndex);
        tileU.assign(worldX.sub(minX).div(tileSize));
        tileV.assign(worldZ.sub(minZ).div(tileSize));
        Break();
      });

      i.addAssign(1);
    });

    return vec3(tileIndex.toFloat(), tileU, tileV);
  });
};

/**
 * Cube-sphere counterpart of {@link createTileIndexFromWorldPosition}: maps a
 * direction from the planet center to `(tileIndex, faceU, faceV)`. The face
 * index becomes the spatial-index `space` key.
 */
export const createTileIndexFromDirection = (
  spatialIndex: GpuSpatialIndexContext,
  maxLevel: number,
) => {
  const lookup = createGpuSpatialLookup(spatialIndex);
  const levelCount = Math.max(1, maxLevel + 1);

  return Fn(([direction]: [Node]) => {
    const dir = vec3(direction).normalize().toVar();
    const face = cubeFaceFromDirection(dir).toVar();
    const basis = cubeFaceBasis(face);
    const faceUV = cubeFaceUVFromDirection(basis, dir).toVar();
    const u = faceUV.x.toVar();
    const v = faceUV.y.toVar();

    const tileIndex = int(-1).toVar();
    const tileU = float(0).toVar();
    const tileV = float(0).toVar();
    const i = int(0).toVar();

    Loop(levelCount, () => {
      const level = int(maxLevel).sub(i).toVar();
      const n = pow(float(2), level.toFloat()).toVar();
      const nInt = int(n).toVar();
      const tileX = u.mul(n).floor().toInt().max(int(0)).min(nInt.sub(int(1))).toVar();
      const tileY = v.mul(n).floor().toInt().max(int(0)).min(nInt.sub(int(1))).toVar();
      const maybeIndex = lookup(face, level, tileX, tileY).toVar();

      If(maybeIndex.greaterThanEqual(int(0)), () => {
        tileIndex.assign(maybeIndex);
        tileU.assign(u.mul(n).sub(tileX.toFloat()));
        tileV.assign(v.mul(n).sub(tileY.toFloat()));
        Break();
      });

      i.addAssign(1);
    });

    return vec3(tileIndex.toFloat(), tileU, tileV);
  });
};
