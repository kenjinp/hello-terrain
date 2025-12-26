import type { Node } from "three/webgpu";
import type { StorageBufferNode } from "three/webgpu";
import type { TerrainUniforms } from "../TerrainUniforms";

export type ComputeStageName = string;

export type TypedArrayConstructor =
  | Float32ArrayConstructor
  | Uint32ArrayConstructor
  | Int32ArrayConstructor
  | Uint16ArrayConstructor
  | Uint8ArrayConstructor;

export interface ComputeStageOutputConfig {
  /** Components per element (1 for height, 3 for normal, etc.) */
  components: number;
  /** TypedArray constructor for the buffer */
  type: TypedArrayConstructor;
  /** Optional storage buffer debug name */
  name?: string;
}

export interface ComputeStageContext {
  /** Current node index being processed */
  nodeIndex: Node;
  /** Global vertex index in the flattened buffer (per-vertex, not component-scaled) */
  globalVertexIndex: Node;
  /** Local UV within the tile [0,1] */
  localUV: Node;
  /** Size of one texel */
  texelSize: Node;
  /** Read from a dependency output (read-only) */
  input: (stageName: ComputeStageName) => StorageBufferNode;
  /** Write to this stage's output (exclusive ownership) */
  output: StorageBufferNode;
  /** Terrain uniforms */
  uniforms: TerrainUniforms;
}

export type ComputeStageFn = (ctx: ComputeStageContext) => void;

export interface ComputeStageConfig {
  /** Unique identifier */
  name: ComputeStageName;
  /** Stage names this reads from (read-only access) */
  inputs: ComputeStageName[];
  /** Output configuration - the stage owns this buffer exclusively */
  output: ComputeStageOutputConfig;
  /** Compute function */
  compute: ComputeStageFn;
  /** Optional callback invoked before stage executes (for timing/metrics) */
  onBefore?: VoidFunction;
  /** Optional callback invoked after stage completes (for timing/metrics) */
  onAfter?: VoidFunction;
}
