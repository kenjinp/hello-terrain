type FenceQueue = Pick<GPUQueue, 'submit' | 'onSubmittedWorkDone'>;
type Outcome = { ok: true } | { ok: false; error: unknown };

/** Observe a real queue fence called AFTER a synchronous draw returns.
 * This is not a mapAsync completion inference. Warm samples must supply the
 * runtime retirement fence; cold samples explicitly issue their own fence.
 */
export function observePostDrawFence(queue: FenceQueue, now: () => number) {
    const originalSubmit = queue.submit;
    const originalFence = queue.onSubmittedWorkDone;
    let submissions = 0, armed = false;
    let outcome: Promise<Outcome> | undefined;
    const proof = {
        drawSubmissions: 0,
        fenceObserved: false,
        fenceSource: null as 'runtime-retirement' | 'cold-explicit' | null,
        drawReturnedMs: null as number | null,
        fenceCalledMs: null as number | null,
        fenceCompletedMs: null as number | null,
    };
    queue.submit = function (commands) {
        originalSubmit.call(queue, commands);
        submissions++;
    };
    queue.onSubmittedWorkDone = function () {
        const result = originalFence.call(queue);
        if (armed && !outcome) {
            proof.fenceObserved = true;
            proof.fenceCalledMs = now();
            // Preserve the original promise for the runtime. Observe rejection
            // immediately so failures cannot escape while update is still pending.
            outcome = result.then<Outcome, Outcome>(
                () => { proof.fenceCompletedMs = now(); return { ok: true }; },
                error => ({ ok: false, error }),
            );
        }
        return result;
    };
    return {
        proof,
        draw(render: () => void, cold: boolean) {
            if (armed) throw new Error('Only one draw may arm the retirement fence');
            const before = submissions;
            render();
            proof.drawSubmissions = submissions - before;
            if (!proof.drawSubmissions) throw new Error('Synchronous draw submitted no queue commands');
            proof.drawReturnedMs = now();
            proof.fenceSource = cold ? 'cold-explicit' : 'runtime-retirement';
            armed = true;
            // No additional fence is requested for a warm sample.
            if (cold) void queue.onSubmittedWorkDone();
        },
        async wait() {
            if (!outcome) throw new Error('No post-draw retirement fence observed');
            const result = await outcome;
            if (!result.ok) throw result.error;
            return proof.fenceCompletedMs!;
        },
        async drain() { await outcome; },
        restore() {
            queue.submit = originalSubmit;
            queue.onSubmittedWorkDone = originalFence;
        },
    };
}
