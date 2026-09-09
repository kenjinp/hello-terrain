import { texture, float } from 'three/tsl';
import type { Node, Texture } from 'three/webgpu';
import { createManagedTerrainSource } from '../runtime/source';

/** Optional texture source; sampler nodes retain identity on compatible replacement. */
export function createManagedTerrainTexture(initial: Texture) {
    const source = createManagedTerrainSource(initial);
    const root = texture(initial);
    const unsubscribe = source.subscribe(() => {
        root.value = source.value;
    });
    const schema = (value: Texture) =>
        `${value.type}:${value.format}:${value.colorSpace}:${'isCubeTexture' in value}`;
    return {
        ...source,
        get value() {
            return source.value;
        },
        get version() {
            return source.version;
        },
        sample(uv: Node, stage: 'fragment' | 'compute' = 'fragment') {
            const node = root.sample(uv) as typeof root;
            return stage === 'compute' ? node.level(float(0)) : node;
        },
        replace(next: Texture) {
            if (schema(next) !== schema(source.value))
                throw new Error(
                    'Texture schema changed; construct a new managed source and material mapping'
                );
            return source.replace(next);
        },
        /** Releases sampler references only. All textures are borrowed. Detach consumers first. */
        releaseSamplers() {
            unsubscribe();
        },
    };
}
