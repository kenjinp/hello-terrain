import { expect, it, vi } from 'vitest';
import { createTerrainRuntime, type TerrainBackend, type TerrainSnapshotData } from './runtime';

function fixture(readback: 'manual' | 'on-change' = 'manual') {
    const retired: number[] = [];
    const disposed: number[] = [];
    const pending: { height: number; finish: () => void }[] = [];
    const backend: TerrainBackend<{ height: number }, number> = {
        resolve: (config) => Object.freeze({ ...config }),
        equal: (a, b) => a.height === b.height,
        produce: vi.fn(async ({ height }) => {
            if (height === 99) throw new Error('candidate compilation failed');
            return {
                render: height,
                snapshot: () =>
                    new Promise<TerrainSnapshotData>((resolve) =>
                        pending.push({
                            height,
                            finish: () =>
                                resolve({
                                    sample: (point, revision) => ({
                                        status: 'available',
                                        revision,
                                        elevation: height,
                                        position: [point[0], height, point[2]],
                                        normal: [0, 1, 0],
                                        sampleSpacing: 1,
                                        tile: { space: 0, level: 0, x: 0, y: 0 },
                                    }),
                                    dispose: () => {
                                        disposed.push(height);
                                    },
                                }),
                        })
                    ),
                retire: async () => {
                    retired.push(height);
                },
            };
        }),
        dispose: vi.fn(async () => {}),
    };
    const input = { height: 0 };
    const runtime = createTerrainRuntime(backend, input, { readback, maxRetainedSnapshots: 2 });
    return { runtime, backend, input, pending, retired, disposed };
}

it('copies config/view inputs and isolates two terrains', async () => {
    const a = fixture(),
        b = fixture();
    a.input.height = 12;
    const view = { position: [6371007.201, 0, 0] as [number, number, number] };
    const run = a.runtime.update(view);
    view.position[0] = 0;
    await run;
    await b.runtime.update({ position: [1, 2, 3] });
    expect(a.runtime.getRender()).toBe(0);
    expect(a.backend.produce).toHaveBeenCalledWith(
        { height: 0 },
        { position: [6371007.201, 0, 0] },
        expect.anything()
    );
    a.runtime.configure({ height: 5 });
    expect(b.runtime.getStatus().acceptedEditVersion).toBe(1);
    await a.runtime.dispose();
    await b.runtime.dispose();
});

it('preserves last good publication when candidate compilation fails', async () => {
    const { runtime, retired } = fixture();
    await runtime.update({ position: [0, 1, 0] });
    const revision = runtime.getStatus().renderRevision;
    runtime.configure({ height: 99 });
    expect((await runtime.update({ position: [0, 1, 0] })).status).toBe('error');
    expect(runtime.getRender()).toBe(0);
    expect(runtime.getStatus().renderRevision).toBe(revision);
    expect(retired).toEqual([]);
    await runtime.dispose();
});

it('targets accepted stationary edits and pins immutable leases through replacement/disposal', async () => {
    const { runtime, pending, disposed } = fixture();
    await runtime.update({ position: [0, 1, 0] });
    const firstRequest = runtime.requestSnapshot();
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    pending[0].finish();
    await firstRequest;
    const lease = runtime.query.acquireSnapshot()!;
    const edit = runtime.configure({ height: 7 });
    expect(runtime.query.sample([0, 0, 0], { minEditVersion: edit })).toMatchObject({
        reason: 'stale',
    });
    const secondRequest = runtime.requestSnapshot({ minEditVersion: edit });
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    expect(lease.sample([0, 0, 0])).toMatchObject({ elevation: 0 });
    pending[1].finish();
    await secondRequest;
    expect(runtime.query.sample([0, 0, 0])).toMatchObject({ elevation: 7 });
    const batch = lease.sampleBatch(new Float64Array([6371007.201, 0, 0]));
    expect(batch.positions[0]).toBe(6371007.201);
    await runtime.dispose();
    expect(disposed).toEqual([7]);
    expect(lease.sample([0, 0, 0])).toMatchObject({ elevation: 0 });
    lease.release();
    lease.release();
    expect(disposed).toEqual([7, 0]);
    expect(() => lease.sample([0, 0, 0])).toThrow('released');
});

it('appearance invalidation does no geometry production or readback', async () => {
    const { runtime, backend, pending } = fixture();
    await runtime.update({ position: [0, 1, 0] });
    const revision = runtime.getStatus().renderRevision;
    runtime.invalidateAppearance();
    await runtime.update({ position: [0, 1, 0] });
    expect(backend.produce).toHaveBeenCalledTimes(1);
    expect(pending).toEqual([]);
    expect(runtime.getStatus().renderRevision).toBe(revision);
    expect(runtime.getStatus().presentationVersion).toBe(1);
    await runtime.dispose();
});

it('does not publish a delayed snapshot after disposal', async () => {
    const { runtime, pending, disposed } = fixture('on-change');
    const run = runtime.update({ position: [0, 1, 0] });
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    const finish = runtime.dispose();
    pending[0].finish();
    await run;
    await finish;
    expect(runtime.getStatus().lifecycle).toBe('disposed');
    expect(runtime.getStatus().queryRevision).toBe(null);
    expect(disposed).toEqual([0]);
});

it('reports retention backpressure and retries after a pinned lease is released', async () => {
    const { runtime, pending } = fixture();
    const view = { position: [0, 1, 0] as [number, number, number] };
    await runtime.update(view);
    const first = runtime.requestSnapshot();
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    pending[0].finish();
    await first;
    const a = runtime.query.acquireSnapshot()!;
    runtime.configure({ height: 1 });
    const second = runtime.requestSnapshot();
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    pending[1].finish();
    await second;
    const b = runtime.query.acquireSnapshot()!;
    runtime.configure({ height: 2 });
    await runtime.update(view);
    await expect(runtime.requestSnapshot()).rejects.toThrow('retention limit');
    expect(a.sample([0, 0, 0])).toMatchObject({ elevation: 0 });
    expect(b.sample([0, 0, 0])).toMatchObject({ elevation: 1 });
    a.release();
    const retry = runtime.requestSnapshot();
    await vi.waitFor(() => expect(pending).toHaveLength(3));
    pending[2].finish();
    await retry;
    expect(runtime.query.sample([0, 0, 0])).toMatchObject({ elevation: 2 });
    b.release();
    await runtime.dispose();
});

it('coalesces queued views and cancels publication without discarding last good data', async () => {
    const { runtime, backend } = fixture();
    const a = runtime.update({ position: [0, 1, 0] });
    const b = runtime.update({ position: [0, 2, 0] });
    expect((await a).status).toBe('superseded');
    expect((await b).status).toBe('published');
    expect(backend.produce).toHaveBeenCalledTimes(1);
    const abort = new AbortController();
    abort.abort();
    expect((await runtime.update({ position: [0, 3, 0] }, { signal: abort.signal })).status).toBe(
        'cancelled'
    );
    expect(runtime.getRender()).toBe(0);
    await runtime.dispose();
});

it('retains publication when graph selection says a changed view needs no production', async () => {
    const { runtime, backend } = fixture();
    backend.needsProductionForView = vi.fn(async () => false);
    await runtime.update({ position: [0, 10, 0] });
    const revision = runtime.getStatus().renderRevision;
    const result = await runtime.update({ position: [1, 10, 0] });
    expect(result.status).toBe('unchanged');
    expect(runtime.getStatus().renderRevision).toBe(revision);
    expect(backend.produce).toHaveBeenCalledTimes(1);
    expect(backend.needsProductionForView).toHaveBeenCalledTimes(1);
    await runtime.update({ position: [1, 10, 0] });
    expect(backend.needsProductionForView).toHaveBeenCalledTimes(1);
    runtime.configure({ height: 2 });
    await runtime.update({ position: [2, 10, 0] });
    expect(backend.produce).toHaveBeenCalledTimes(2);
    runtime.invalidateElevation();
    await runtime.update({ position: [3, 10, 0] });
    expect(backend.produce).toHaveBeenCalledTimes(3);
    expect(backend.needsProductionForView).toHaveBeenCalledTimes(1);
    backend.needsProductionForView = vi.fn(async () => true);
    await runtime.update({ position: [4, 10, 0] });
    expect(backend.produce).toHaveBeenCalledTimes(4);
    await runtime.dispose();
});

it('does not accept a superseded view while asynchronous selection finishes', async () => {
    const { runtime, backend } = fixture();
    await runtime.update({ position: [0, 10, 0] });
    let finish!: (changed: boolean) => void;
    backend.needsProductionForView = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
    const pending = runtime.update({ position: [1, 10, 0] });
    await vi.waitFor(() => expect(backend.needsProductionForView).toHaveBeenCalled());
    runtime.configure({ height: 5 });
    finish(false);
    expect((await pending).status).toBe('superseded');
    await runtime.update({ position: [1, 10, 0] });
    expect(runtime.getRender()).toBe(5);
    await runtime.dispose();
});
