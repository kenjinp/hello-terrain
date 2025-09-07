import { type ShaderNodeObject, storage } from "three/tsl";
import {
  type StorageBufferNode,
  StorageInstancedBufferAttribute,
  type TypedArray,
} from "three/webgpu";

export function inferWGSLType(buffer: TypedArray): "i32" | "u32" | "f32" {
  if (buffer instanceof Float32Array) return "f32";
  if (buffer instanceof Int32Array) return "i32";
  if (
    buffer instanceof Uint32Array ||
    buffer instanceof Uint16Array ||
    buffer instanceof Uint8Array
  )
    return "u32";
  if (buffer instanceof Int16Array || buffer instanceof Int8Array) return "i32";

  // Default to i32 if unknown, matching common index/flag usage
  return "i32";
}

export class StorageBuffer {
  private storageBufferAttribute: StorageInstancedBufferAttribute;
  public readonly storageNode: ShaderNodeObject<StorageBufferNode>;

  constructor(
    public readonly buffer: TypedArray,
    itemSize: number,
    maxItems: number
  ) {
    this.storageBufferAttribute = new StorageInstancedBufferAttribute(
      buffer,
      itemSize
    );
    const wgslType = inferWGSLType(buffer);
    this.storageNode = storage(
      this.storageBufferAttribute,
      wgslType,
      maxItems * itemSize
    );
  }

  update(buffer: TypedArray) {
    this.storageBufferAttribute.array.set(buffer);
    this.storageBufferAttribute.needsUpdate = true;
  }
}
