import { expect, it, vi } from 'vitest';
import { observePostDrawFence } from './pipelineFence';

function fixture() {
    let resolve!: () => void, reject!: (e: unknown) => void;
    const pending = new Promise<undefined>((yes, no) => { resolve = () => yes(undefined); reject = no; });
    const queue = { submit: vi.fn(), onSubmittedWorkDone: vi.fn(() => pending) };
    let tick = 0;
    const observer = observePostDrawFence(queue, () => ++tick);
    return { queue, observer, resolve, reject };
}
it('uses the original post-draw retirement promise without requesting a second warm fence', async () => {
    const f = fixture();
    f.observer.draw(() => f.queue.submit([]), false);
    expect(f.queue.onSubmittedWorkDone).toBeTypeOf('function');
    expect(f.observer.proof.fenceObserved).toBe(false);
    const runtimeFence = f.queue.onSubmittedWorkDone();
    let completed = false;
    const waited = f.observer.wait().then(() => { completed = true; });
    await Promise.resolve();
    expect(completed).toBe(false);
    f.resolve(); await runtimeFence; await waited;
    expect(f.observer.proof.fenceSource).toBe('runtime-retirement');
    expect(f.observer.proof.fenceCalledMs).toBeGreaterThan(f.observer.proof.drawReturnedMs!);
    f.observer.restore();
    expect(f.queue.onSubmittedWorkDone).toHaveBeenCalledTimes(1);
});
it('does not accept a fence requested before the draw returned', async () => {
    const f = fixture();
    f.observer.draw(() => { f.queue.submit([]); void f.queue.onSubmittedWorkDone(); }, false);
    await expect(f.observer.wait()).rejects.toThrow('No post-draw');
    f.resolve(); f.observer.restore();
});
it('requests exactly one explicit fence for cold production', async () => {
    const f = fixture();
    f.observer.draw(() => f.queue.submit([]), true);
    f.resolve(); await f.observer.wait();
    expect(f.observer.proof.fenceSource).toBe('cold-explicit');
    f.observer.restore();
    expect(f.queue.onSubmittedWorkDone).toHaveBeenCalledTimes(1);
});
it('rejects missing draw submission and missing warm retirement', async () => {
    const f = fixture();
    expect(() => f.observer.draw(() => {}, false)).toThrow('submitted no');
    f.observer.draw(() => f.queue.submit([]), false);
    await expect(f.observer.wait()).rejects.toThrow('No post-draw');
    f.resolve(); f.observer.restore();
});
it('propagates a failed observed fence and restores both queue methods', async () => {
    const f = fixture();
    f.observer.draw(() => f.queue.submit([]), false);
    void f.queue.onSubmittedWorkDone().catch(() => {});
    f.reject(new Error('device lost'));
    await expect(f.observer.wait()).rejects.toThrow('device lost');
    await f.observer.drain();
    f.observer.restore();
    expect(vi.isMockFunction(f.queue.submit)).toBe(true);
    expect(vi.isMockFunction(f.queue.onSubmittedWorkDone)).toBe(true);
});
