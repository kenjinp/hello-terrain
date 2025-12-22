import { storage } from "three/tsl";
import {
  StorageBufferAttribute,
  type StorageBufferNode,
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
  public readonly storageBufferAttribute: StorageBufferAttribute;
  public readonly storageNode: StorageBufferNode;

  constructor(
    public readonly name: string,
    public readonly buffer: TypedArray,
    public itemSize: number,
    public readonly maxItems: number
  ) {
    this.storageBufferAttribute = new StorageBufferAttribute(buffer, itemSize);
    const wgslType = inferWGSLType(buffer);
    this.storageNode = storage(
      this.storageBufferAttribute,
      wgslType,
      this.buffer.length
    ).setName(name);
  }

  update(buffer?: TypedArray) {
    if (buffer) {
      this.storageBufferAttribute.array.set(buffer);
    }
    this.storageBufferAttribute.needsUpdate = true;
  }
}
