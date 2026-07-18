import { task } from '@hello-terrain/work';

/** Generates a unique instance ID per graph (cached once). */
export const instanceIdTask = task(() => crypto.randomUUID())
    .displayName('instanceIdTask')
    .cache('once');
