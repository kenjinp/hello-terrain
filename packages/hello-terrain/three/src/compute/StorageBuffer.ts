import { type ShaderNodeObject, storage } from "three/tsl";
import {
  type StorageBufferNode,
  StorageInstancedBufferAttribute,
  type TypedArray,
} from "three/webgpu";

export function inferWGSLType(buffer: TypedArray) {
  switch (buffer.constructor) {
    case Float32Array:
      return "f32";
    case Int32Array:
      return "i32";
    case Uint32Array:
      return "u32";
    case Uint8Array:
      return "u8";
    case Uint16Array:
      return "u16";
    case Int8Array:
      return "i8";
    case Int16Array:
      return "i16";
    default:
      return "i32";
  }
}

export class StorageBuffer {
  private storageBufferAttribute: StorageInstancedBufferAttribute;
  public readonly storageNode: ShaderNodeObject<StorageBufferNode>;

  constructor(
    public readonly buffer: TypedArray,
    public itemSize: number,
    public readonly maxItems: number
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

  update(buffer?: TypedArray) {
    if (buffer) {
      this.storageBufferAttribute.array.set(buffer);
    }
    this.storageBufferAttribute.needsUpdate = true;
  }
}
