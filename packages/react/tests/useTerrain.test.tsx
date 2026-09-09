// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { expect, it, vi } from 'vitest';
import { float } from 'three/tsl';

const state = vi.hoisted(() => {
    Object.assign(globalThis, { GPUShaderStage: { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 } });
    return { gl: { backend: {} } };
});
vi.mock('@react-three/fiber', () => ({
    useFrame: vi.fn(),
    useThree: (select: (state: unknown) => unknown) => select(state),
}));
import { useTerrain } from '../src/useTerrain';

it('preserves accepted imperative edits across prop identity churn and retires the exact renderer generation', async () => {
    const elevation = () => float(1),
        replacement = () => float(2);
    const { result, rerender, unmount } = renderHook(
        ({ maxLevel }: { maxLevel: number | undefined }) => useTerrain({ elevation, elevationRange: { min: 0, max: 2 }, maxLevel }),
        { initialProps: { maxLevel: 8 as number | undefined }, wrapper: StrictMode }
    );
    const first = result.current.controller;
    act(() => {
        first.configure({ elevation: replacement });
    });
    rerender({ maxLevel: 9 });
    expect(result.current.controller).toBe(first);
    expect(first.getConfig().elevation).toBe(replacement);
    expect(first.getConfig().maxLevel).toBe(9);
    expect(first.getStatus().lifecycle).not.toBe('disposed');
    rerender({ maxLevel: undefined });
    expect(first.getConfig().maxLevel).toBe(16);
    expect(first.getConfig().elevation).toBe(replacement);
    state.gl = { backend: {} };
    rerender({ maxLevel: 9 });
    const second = result.current.controller;
    expect(second).not.toBe(first);
    await waitFor(() => expect(first.getStatus().lifecycle).toBe('disposed'));
    expect(second.getStatus().lifecycle).not.toBe('disposed');
    unmount();
    await waitFor(() => expect(second.getStatus().lifecycle).toBe('disposed'));
});
