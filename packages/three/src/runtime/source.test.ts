import { expect, it } from 'vitest';
import { bindTerrainSource, createManagedTerrainSource } from './source';
import { createTerrainRuntime } from './runtime';

it('orders shared source edits after consumers and acknowledges retired replacement resources', async () => {
    const source = createManagedTerrainSource({ height: 2 });
    const events: string[] = [];
    const create = (id: string) =>
        createTerrainRuntime(
            {
                resolve: (config: number) => config,
                equal: (a, b) => a === b,
                async produce() {
                    const height = source.value.height;
                    events.push(`${id}:produce:${height}`);
                    return {
                        render: height,
                        snapshot: async () => {
                            throw new Error('manual');
                        },
                        retire: async () => {
                            events.push(`${id}:retire:${height}`);
                        },
                    };
                },
                settle: async () => {
                    events.push(`${id}:settle`);
                },
                dispose: async () => {},
            },
            0
        );
    const a = create('a'),
        b = create('b');
    await a.update({ position: [0, 1, 0] });
    await b.update({ position: [0, 1, 0] });
    const detachA = bindTerrainSource(a, source, ['elevation']),
        detachB = bindTerrainSource(b, source, ['elevation']);
    const detachAppearance = bindTerrainSource(a, source, ['appearance']);
    const receipt = await source.replace({ height: 7 });
    await receipt.retired;
    expect(a.getRender()).toBe(7);
    expect(b.getRender()).toBe(7);
    expect(events).toContain('a:retire:2');
    expect(events).toContain('b:retire:2');
    expect(events.indexOf('a:settle')).toBeLessThan(events.indexOf('a:produce:7'));
    expect(source.version).toBe(1);
    expect(a.getStatus().presentationVersion).toBe(1);
    detachA();
    detachB();
    detachAppearance();
    await a.dispose();
    await b.dispose();
    // Runtime disposal also detaches bindings the author has not removed manually.
    const c = create('c');
    bindTerrainSource(c, source, ['appearance']);
    await c.dispose();
    await source.replace({ height: 9 });
});
