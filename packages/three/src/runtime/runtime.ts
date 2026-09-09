import { vec3, type Vec3 } from 'math';

/** Renderer-independent publication and lifetime protocol. */
export interface TerrainRevision {
    readonly instanceId: string;
    readonly productionVersion: number;
    readonly configVersion: number;
    readonly contentVersion: number;
    readonly editVersion: number;
    readonly layoutVersion: number;
}

export interface TerrainView {
    position: Vec3;
    projectionFactor?: number;
}

export type TerrainSampleResult =
    | {
          status: 'available';
          revision: TerrainRevision;
          position: Vec3;
          normal: Vec3;
          elevation: number;
          sampleSpacing: number;
          tile: { space: number; level: number; x: number; y: number };
      }
    | {
          status: 'unavailable';
          reason:
              | 'not-ready'
              | 'outside-coverage'
              | 'ambiguous-projection'
              | 'stale'
              | 'disposed'
              | 'disabled';
          revision: TerrainRevision | null;
      };

export interface TerrainSnapshotData {
    sample(position: Vec3, revision: TerrainRevision): TerrainSampleResult;
    dispose(): void;
}

export interface TerrainProduction<Render> {
    render: Render;
    layoutKey?: string;
    snapshot(): Promise<TerrainSnapshotData>;
    /** Completes only after compute/draw/copies can no longer reference resources. */
    retire(): Promise<void>;
}

export interface TerrainBackend<Config, Render> {
    resolve(config: Config): Config;
    equal(a: Config, b: Config): boolean;
    /** Evaluate view-dependent selection without rebuilding published GPU resources. */
    needsProductionForView?(render: Render, view: TerrainView): Promise<boolean>;
    produce(
        config: Config,
        view: TerrainView,
        revision: TerrainRevision
    ): Promise<TerrainProduction<Render>>;
    dispose(): Promise<void>;
    settle?(): Promise<void>;
    collectRetired?(): Promise<void>;
}

export interface TerrainRuntimeStatus {
    lifecycle: 'created' | 'active' | 'disposing' | 'disposed';
    acceptedEditVersion: number;
    acceptedConfigVersion: number;
    renderRevision: TerrainRevision | null;
    queryRevision: TerrainRevision | null;
    presentationVersion: number;
    productionPending: boolean;
    readbackPending: boolean;
    retainedSnapshotCount: number;
    lastError: unknown;
    queryAvailability: 'disabled' | 'empty' | 'available';
}

export interface TerrainSnapshotLease {
    readonly revision: TerrainRevision;
    sample(position: Vec3): TerrainSampleResult;
    sampleBatch(positions: Float64Array): {
        positions: Float64Array;
        normals: Float64Array;
        elevations: Float64Array;
        valid: Uint8Array;
        revision: TerrainRevision;
    };
    release(): void;
    raycast(origin: Vec3, direction: Vec3, options?: TerrainRaycastOptions): TerrainRaycastSample;
}

export interface TerrainRaycastOptions {
    near?: number;
    far?: number;
    tolerance?: number;
    maxSteps?: number;
}
export type TerrainRaycastSample =
    | {
          status: 'hit';
          sample: Extract<TerrainSampleResult, { status: 'available' }>;
          distance: number;
      }
    | { status: 'incomplete'; reason: 'outside-coverage' | 'work-budget' | 'not-ready' };

/** Conservative result semantics: unbracketed sampled intervals remain incomplete. */
function raycastSample(
    sample: (p: Vec3) => TerrainSampleResult,
    origin: Vec3,
    direction: Vec3,
    options: TerrainRaycastOptions = {}
): TerrainRaycastSample {
    const near = options.near ?? 0,
        far = options.far ?? 10000;
    const tolerance = options.tolerance ?? 0.001,
        budget = options.maxSteps ?? 256;
    if (
        !origin.every(Number.isFinite) ||
        !direction.every(Number.isFinite) ||
        Math.abs(vec3.length(direction) - 1) > 1e-6 ||
        !Number.isFinite(near) ||
        !Number.isFinite(far) ||
        !Number.isFinite(tolerance) ||
        near < 0 ||
        far <= near ||
        !(tolerance > 0) ||
        !Number.isInteger(budget) ||
        budget < 2
    )
        throw new Error('Invalid terrain ray');
    let previous: { t: number; signed: number } | null = null;
    let low = near,
        high = far,
        bracketed = false;
    const point = vec3.create();
    for (let i = 0; i < budget; i++) {
        const t = bracketed ? (low + high) / 2 : near + ((far - near) * i) / (budget - 1);
        vec3.scaleAndAdd(point, origin, direction, t);
        const result = sample(point);
        if (result.status !== 'available')
            return { status: 'incomplete', reason: 'outside-coverage' };
        const difference = vec3.subtract(vec3.create(), point, result.position);
        if (vec3.length(difference) <= tolerance)
            return { status: 'hit', distance: t, sample: { ...result, position: vec3.clone(point) } };
        const signed = vec3.dot(difference, result.normal);
        if (bracketed) {
            if (Math.sign(signed) === Math.sign(previous!.signed)) low = t;
            else high = t;
        } else if (previous && Math.sign(signed) !== Math.sign(previous.signed)) {
            low = previous.t;
            high = t;
            bracketed = true;
        } else previous = { t, signed };
    }
    return { status: 'incomplete', reason: 'work-budget' };
}

export function createTerrainRuntime<Config, Render>(
    backend: TerrainBackend<Config, Render>,
    initialConfig: Config,
    options: { readback?: 'on-change' | 'manual' | 'disabled'; maxRetainedSnapshots?: number } = {}
) {
    let config = backend.resolve(initialConfig);
    const instanceId = crypto.randomUUID();
    const listeners = new Set<() => void>();
    const retention = options.maxRetainedSnapshots ?? 3;
    if (!Number.isInteger(retention) || retention < 1) throw new Error('Invalid snapshot retention');
    let status: Readonly<TerrainRuntimeStatus> = Object.freeze({
        lifecycle: 'created',
        acceptedEditVersion: 1,
        acceptedConfigVersion: 1,
        renderRevision: null,
        queryRevision: null,
        presentationVersion: 0,
        productionPending: false,
        readbackPending: false,
        retainedSnapshotCount: 0,
        lastError: null,
        queryAvailability: options.readback === 'disabled' ? 'disabled' : 'empty',
    });
    let contentVersion = 0;
    let productionVersion = 0;
    let latestRequest = 0;
    let layoutVersion = 0,
        layoutKey: string | undefined;
    let published: TerrainProduction<Render> | null = null;
    let lastView: TerrainView | null = null;
    let publishedView: TerrainView | null = null;
    let queue: Promise<unknown> = Promise.resolve();
    let disposal: Promise<void> | null = null;
    type Record = { revision: TerrainRevision; data: TerrainSnapshotData; leases: number };
    let currentSnapshot: Record | null = null;
    const records = new Set<Record>();
    const waiters = new Set<{
        edit: number;
        resolve: (r: TerrainRevision) => void;
        reject: (e: unknown) => void;
    }>();
    let readback: Promise<void> | null = null;

    function emit(patch: Partial<TerrainRuntimeStatus>) {
        status = Object.freeze({ ...status, ...patch });
        for (const listener of listeners) listener();
    }
    function assertActive() {
        if (disposal || status.lifecycle === 'disposing' || status.lifecycle === 'disposed')
            throw new Error('Terrain runtime is disposed');
    }
    function collect() {
        for (const record of records) {
            if (record !== currentSnapshot && record.leases === 0) {
                record.data.dispose();
                records.delete(record);
            }
        }
        emit({ retainedSnapshotCount: records.size });
    }
    function rejectWaiters(error: unknown) {
        for (const waiter of waiters) waiter.reject(error);
        waiters.clear();
    }
    async function capture() {
        if (readback || !published || !status.renderRevision) return readback;
        if (currentSnapshot?.revision === status.renderRevision) return;
        collect();
        // A replaceable current record does not consume a retained-record slot.
        const pinned = [...records].filter((record) => record.leases > 0).length;
        if (pinned >= retention) {
            const error = new Error('Terrain snapshot retention limit reached; release a lease');
            emit({ lastError: error });
            rejectWaiters(error);
            return;
        }
        const source = published;
        const revision = status.renderRevision;
        emit({ readbackPending: true });
        readback = (async () => {
            try {
                const data = await source.snapshot();
                if (disposal) {
                    data.dispose();
                    return;
                }
                const record = { revision, data, leases: 0 };
                currentSnapshot = record;
                records.add(record);
                collect();
                emit({ queryRevision: revision, queryAvailability: 'available', lastError: null });
                for (const waiter of waiters) {
                    if (revision.editVersion >= waiter.edit) {
                        waiters.delete(waiter);
                        waiter.resolve(revision);
                    }
                }
            } catch (error) {
                emit({ lastError: error });
                rejectWaiters(error);
            } finally {
                readback = null;
                emit({ readbackPending: false });
            }
        })();
        return readback;
    }
    function sameView(a: TerrainView | null, b: TerrainView) {
        return (
            a &&
            a.projectionFactor === b.projectionFactor &&
            a.position.every((v, i) => v === b.position[i])
        );
    }
    function acquireSnapshot(): TerrainSnapshotLease | null {
        if (disposal || !currentSnapshot) return null;
        const record = currentSnapshot;
        record.leases++;
        let released = false;
        const sample = (position: Vec3) => {
            if (released) throw new Error('Terrain snapshot lease is released');
            return record.data.sample(position, record.revision);
        };
        return {
            revision: record.revision,
            sample,
            raycast: (origin, direction, options) =>
                raycastSample(sample, origin, direction, options),
            sampleBatch(input) {
                if (input.length % 3) throw new Error('Expected xyz triples');
                const count = input.length / 3;
                const positions = new Float64Array(input.length),
                    normals = new Float64Array(input.length);
                const elevations = new Float64Array(count),
                    valid = new Uint8Array(count);
                const point: Vec3 = vec3.create();
                for (let i = 0; i < count; i++) {
                    vec3.fromBuffer(point, input, i * 3);
                    const value = sample(point);
                    if (value.status !== 'available') continue;
                    positions.set(value.position, i * 3);
                    normals.set(value.normal, i * 3);
                    elevations[i] = value.elevation;
                    valid[i] = 1;
                }
                return { positions, normals, elevations, valid, revision: record.revision };
            },
            release() {
                if (released) return;
                released = true;
                record.leases--;
                collect();
            },
        };
    }
    const api = {
        getStatus: () => status,
        getConfig: () => config,
        getRender: () => published?.render ?? null,
        async settle() {
            await queue;
            await readback;
            await backend.settle?.();
        },
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        configure(next: Config) {
            assertActive();
            const resolved = backend.resolve(next);
            if (backend.equal(config, resolved)) return status.acceptedEditVersion;
            config = resolved;
            emit({
                acceptedConfigVersion: status.acceptedConfigVersion + 1,
                acceptedEditVersion: status.acceptedEditVersion + 1,
                lastError: null,
            });
            return status.acceptedEditVersion;
        },
        invalidateElevation() {
            assertActive();
            contentVersion++;
            emit({ acceptedEditVersion: status.acceptedEditVersion + 1, lastError: null });
            return status.acceptedEditVersion;
        },
        invalidateAppearance() {
            assertActive();
            emit({ presentationVersion: status.presentationVersion + 1 });
            return status.presentationVersion;
        },
        /** Reserve an edit boundary. Already queued work finishes; later updates wait. */
        holdProduction() {
            assertActive();
            const preceding = queue;
            let release!: () => void;
            const gate = new Promise<void>((resolve) => {
                release = resolve;
            });
            queue = preceding.then(() => gate);
            return {
                ready: preceding.then(async () => {
                    await readback;
                    await backend.settle?.();
                }),
                release,
            };
        },
        async whenRetired(editVersion: number) {
            assertActive();
            if (editVersion > status.acceptedEditVersion)
                throw new Error('Unknown terrain edit version');
            if ((status.renderRevision?.editVersion ?? 0) < editVersion) {
                await new Promise<void>((resolve, reject) => {
                    const unsubscribe = api.subscribe(() => {
                        if (status.lifecycle === 'disposing' || status.lifecycle === 'disposed') {
                            unsubscribe();
                            resolve();
                        } else if ((status.renderRevision?.editVersion ?? 0) >= editVersion) {
                            unsubscribe();
                            resolve();
                        } else if (status.lastError) {
                            unsubscribe();
                            reject(status.lastError);
                        }
                    });
                    if (lastView) void api.update(lastView);
                });
            }
            await queue;
            await readback;
            await backend.collectRetired?.();
            await backend.settle?.();
        },
        update(view: TerrainView, request: { signal?: AbortSignal } = {}) {
            assertActive();
            if (!view.position.every(Number.isFinite)) throw new Error('Terrain view must be finite');
            const capturedView = { ...view, position: vec3.clone(view.position) };
            const requestId = ++latestRequest;
            lastView = capturedView;
            const capturedConfig = config;
            const editVersion = status.acceptedEditVersion,
                configVersion = status.acceptedConfigVersion;
            const capturedContent = contentVersion;
            const run = async () => {
                if (disposal || request.signal?.aborted) return { status: 'cancelled' as const };
                if (requestId !== latestRequest || editVersion !== status.acceptedEditVersion)
                    return { status: 'superseded' as const };
                if (
                    status.renderRevision?.editVersion === editVersion &&
                    sameView(publishedView, capturedView)
                ) {
                    if (waiters.size || options.readback === 'on-change') await capture();
                    return { status: 'unchanged' as const, revision: status.renderRevision };
                }
                emit({ productionPending: true });
                let candidate: TerrainProduction<Render> | null = null;
                try {
                    if (
                        published &&
                        status.renderRevision?.editVersion === editVersion &&
                        backend.needsProductionForView &&
                        !(await backend.needsProductionForView(published.render, capturedView))
                    ) {
                        if (disposal || request.signal?.aborted)
                            return { status: 'cancelled' as const };
                        if (requestId !== latestRequest || editVersion !== status.acceptedEditVersion)
                            return { status: 'superseded' as const };
                        publishedView = capturedView;
                        if (waiters.size || options.readback === 'on-change') await capture();
                        return { status: 'unchanged' as const, revision: status.renderRevision };
                    }
                    const revision = {
                        instanceId,
                        productionVersion: ++productionVersion,
                        configVersion,
                        editVersion,
                        contentVersion: capturedContent,
                        layoutVersion,
                    };
                    candidate = await backend.produce(capturedConfig, capturedView, revision);
                    if (
                        disposal ||
                        request.signal?.aborted ||
                        editVersion !== status.acceptedEditVersion
                    ) {
                        await candidate.retire();
                        return {
                            status: request.signal?.aborted
                                ? ('cancelled' as const)
                                : ('superseded' as const),
                        };
                    }
                    const previous = published;
                    // Pending copies pin the old production until mapping completes.
                    await readback;
                    if (
                        disposal ||
                        request.signal?.aborted ||
                        editVersion !== status.acceptedEditVersion
                    ) {
                        await candidate.retire();
                        return {
                            status: request.signal?.aborted
                                ? ('cancelled' as const)
                                : ('superseded' as const),
                        };
                    }
                    if (!published || candidate.layoutKey !== layoutKey) {
                        layoutVersion++;
                        layoutKey = candidate.layoutKey;
                    }
                    revision.layoutVersion = layoutVersion;
                    Object.freeze(revision);
                    published = candidate;
                    publishedView = capturedView;
                    emit({ lifecycle: 'active', renderRevision: revision, lastError: null });
                    if (previous) await previous.retire();
                    if (waiters.size || options.readback === 'on-change') await capture();
                    return { status: 'published' as const, revision };
                } catch (error) {
                    if (candidate && candidate !== published) await candidate.retire();
                    emit({ lastError: error });
                    rejectWaiters(error);
                    return { status: 'error' as const, error };
                } finally {
                    emit({ productionPending: false });
                }
            };
            const result = queue.then(run);
            queue = result.catch(() => {});
            return result;
        },
        requestSnapshot(request: { minEditVersion?: number; signal?: AbortSignal } = {}) {
            assertActive();
            if (options.readback === 'disabled')
                return Promise.reject(new Error('Terrain readback is disabled'));
            const edit = request.minEditVersion ?? status.acceptedEditVersion;
            if (edit > status.acceptedEditVersion)
                return Promise.reject(new Error('Unknown terrain edit version'));
            if (request.signal?.aborted) return Promise.reject(request.signal.reason);
            if (currentSnapshot && currentSnapshot.revision.editVersion >= edit)
                return Promise.resolve(currentSnapshot.revision);
            const promise = new Promise<TerrainRevision>((resolve, reject) => {
                const cleanup = () => request.signal?.removeEventListener('abort', abort);
                const waiter = {
                    edit,
                    resolve: (revision: TerrainRevision) => {
                        cleanup();
                        resolve(revision);
                    },
                    reject: (error: unknown) => {
                        cleanup();
                        reject(error);
                    },
                };
                const abort = () => {
                    waiters.delete(waiter);
                    waiter.reject(request.signal!.reason);
                };
                waiters.add(waiter);
                request.signal?.addEventListener('abort', abort, { once: true });
            });
            if (lastView) void api.update(lastView);
            return promise;
        },
        query: {
            acquireSnapshot,
            raycast(
                origin: Vec3,
                direction: Vec3,
                options?: TerrainRaycastOptions
            ): TerrainRaycastSample {
                const lease = acquireSnapshot();
                if (!lease) return { status: 'incomplete', reason: 'not-ready' };
                try {
                    return lease.raycast(origin, direction, options);
                } finally {
                    lease.release();
                }
            },
            sample(position: Vec3, request: { minEditVersion?: number } = {}): TerrainSampleResult {
                if (disposal) return { status: 'unavailable', reason: 'disposed', revision: null };
                if (!currentSnapshot)
                    return {
                        status: 'unavailable',
                        reason: options.readback === 'disabled' ? 'disabled' : 'not-ready',
                        revision: null,
                    };
                if ((request.minEditVersion ?? 0) > currentSnapshot.revision.editVersion)
                    return {
                        status: 'unavailable',
                        reason: 'stale',
                        revision: currentSnapshot.revision,
                    };
                return currentSnapshot.data.sample(position, currentSnapshot.revision);
            },
        },
        dispose(): Promise<void> {
            if (disposal) return disposal;
            emit({ lifecycle: 'disposing' });
            rejectWaiters(new Error('Terrain runtime is disposed'));
            disposal = (async () => {
                await queue;
                await readback;
                await published?.retire();
                published = null;
                await backend.dispose();
                currentSnapshot = null;
                collect();
                emit({
                    lifecycle: 'disposed',
                    renderRevision: null,
                    queryRevision: null,
                    queryAvailability: 'empty',
                });
                listeners.clear();
            })();
            return disposal;
        },
    };
    return api;
}
