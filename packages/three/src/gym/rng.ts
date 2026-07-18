/**
 * Deterministic seeded RNG (mulberry32). Every gym scenario derives all of
 * its randomness (paths, teleport targets, heading noise) from one seed so a
 * run is exactly reproducible from `{ scenario, seed }`.
 */
export type GymRng = () => number;

export function createGymRng(seed: number): GymRng {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
