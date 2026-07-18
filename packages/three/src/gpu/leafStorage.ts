import { storage } from 'three/tsl';
import { StorageBufferAttribute } from 'three/webgpu';
import type { WebGPURenderer } from 'three/webgpu';
import type { LeafStorageState, VisibleSlotStorageState } from '../types';
import { disposeStorageBufferState } from './dispose';

function createSlotIndexStorage(
    maxNodes: number,
    name: string,
    renderer?: WebGPURenderer
): VisibleSlotStorageState {
    const data = new Uint32Array(maxNodes);
    const attribute = new StorageBufferAttribute(data, 1);
    attribute.name = name;
    const node = storage(attribute, 'u32', 1).toReadOnly().setName(name);
    const state: VisibleSlotStorageState = { data, attribute, node };
    state.dispose = () => disposeStorageBufferState(renderer, state);
    return state;
}

export function createLeafStorage(maxNodes: number, renderer?: WebGPURenderer): LeafStorageState {
    const data = new Int32Array(maxNodes * 4);
    const attribute = new StorageBufferAttribute(data, 4);
    attribute.name = 'slotTileStorage';
    const node = storage(attribute, 'i32', 1).toReadOnly().setName('slotTileStorage');
    const state: LeafStorageState = { data, attribute, node };
    state.dispose = () => disposeStorageBufferState(renderer, state);
    return state;
}

export function createVisibleSlotStorage(
    maxNodes: number,
    renderer?: WebGPURenderer
): VisibleSlotStorageState {
    return createSlotIndexStorage(maxNodes, 'visibleSlotStorage', renderer);
}

export function createDirtyVisibleSlotStorage(
    maxNodes: number,
    renderer?: WebGPURenderer
): VisibleSlotStorageState {
    return createSlotIndexStorage(maxNodes, 'dirtyVisibleSlotStorage', renderer);
}
