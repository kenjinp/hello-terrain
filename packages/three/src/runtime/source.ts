/** Explicit dependencies for optional managed inputs; raw textures remain valid. */
export interface TerrainSourceConsumer {
    /** Consumers sharing an owner reserve one scheduling boundary. */
    owner?: object;
    hold(): { ready: Promise<void>; release(): void };
    changed(): number;
    retired(editVersion: number): Promise<void>;
}

export function createManagedTerrainSource<Value>(initial: Value) {
    let value = initial,
        version = 0;
    const consumers = new Set<TerrainSourceConsumer>();
    const listeners = new Set<() => void>();
    let queue: Promise<unknown> = Promise.resolve();
    function change(edit: () => Value) {
        const run = async () => {
            const active = [...consumers];
            const holds: ReturnType<TerrainSourceConsumer['hold']>[] = [];
            try {
                const owners = new Set<object>();
                for (const consumer of active) {
                    const owner = consumer.owner ?? consumer;
                    if (owners.has(owner)) continue;
                    owners.add(owner);
                    holds.push(consumer.hold());
                }
                await Promise.all(holds.map((hold) => hold.ready));
                value = edit();
                version++;
                for (const listener of listeners) listener();
                const edits = active.map((consumer) => consumer.changed());
                // Release before requesting retirement, which may itself schedule a build.
                for (const hold of holds) hold.release();
                const retired = Promise.all(
                    active.map((consumer, i) => consumer.retired(edits[i]!))
                ).then(() => {});
                // Callers can await/report retirement; don't create an unhandled rejection
                // when a fire-and-forget editor relies on runtime status for errors.
                void retired.catch(() => {});
                return { version, retired };
            } finally {
                for (const hold of holds) hold.release();
            }
        };
        const result = queue.then(run);
        queue = result.catch(() => {});
        return result;
    }
    return {
        get value() {
            return value;
        },
        get version() {
            return version;
        },
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        /** Mutator must complete synchronously; version metadata cannot freeze external writes. */
        edit(mutator: (value: Value) => void) {
            return change(() => {
                mutator(value);
                return value;
            });
        },
        replace(next: Value) {
            return change(() => next);
        },
        attach(consumer: TerrainSourceConsumer) {
            consumers.add(consumer);
            return () => {
                consumers.delete(consumer);
            };
        },
    };
}

export type ManagedTerrainSource<Value> = ReturnType<typeof createManagedTerrainSource<Value>>;

export function bindTerrainSource<Value>(
    runtime: {
        holdProduction(): { ready: Promise<void>; release(): void };
        invalidateElevation(): number;
        invalidateAppearance(): number;
        whenRetired(edit: number): Promise<void>;
        subscribe?(listener: () => void): () => void;
        getStatus?(): { lifecycle: string };
    },
    source: ManagedTerrainSource<Value>,
    consumers: readonly ('elevation' | 'appearance')[]
) {
    if (!consumers.length) throw new Error('Declare at least one source consumer');
    const detach = source.attach({
        owner: runtime,
        hold: runtime.holdProduction,
        changed() {
            if (consumers.includes('appearance')) runtime.invalidateAppearance();
            return consumers.includes('elevation') ? runtime.invalidateElevation() : 0;
        },
        // Appearance-only borrowed pixels are live. GPU queue completion in hold()
        // is their retirement boundary; geometry needs a replacement publication.
        retired: (edit) => (edit ? runtime.whenRetired(edit) : Promise.resolve()),
    });
    const unsubscribe = runtime.subscribe?.(() => {
        if (runtime.getStatus?.().lifecycle === 'disposing') {
            detach();
            unsubscribe?.();
        }
    });
    return () => {
        detach();
        unsubscribe?.();
    };
}
