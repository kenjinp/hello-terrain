/**
 * Kinematic gym probe — the library's grounding contract made executable.
 *
 * Mirrors the contract a character controller relies on (hold vertical
 * position until the terrain query first reports valid ground, then gravity +
 * ground snap), without being any app's controller. If the probe ends up
 * below analytic ground truth, that is a library bug by definition.
 */
export type GroundSample = {
    valid: boolean;
    elevation: number;
};

export type GymProbeState = {
    x: number;
    y: number;
    z: number;
    verticalVelocity: number;
    /** True once any valid ground report has been seen since the last reset. */
    groundKnown: boolean;
    grounded: boolean;
    /** Update frames since the probe was placed/teleported. */
    framesSincePlaced: number;
    /** Frames until the first valid ground sample after placement (-1 until known). */
    framesToGround: number;
};

export type GymProbeOptions = {
    gravity?: number;
    rideHeight?: number;
    fixedDt?: number;
};

const DEFAULTS = { gravity: 18, rideHeight: 1.2, fixedDt: 1 / 60 };

export function createGymProbe(x: number, y: number, z: number): GymProbeState {
    return {
        x,
        y,
        z,
        verticalVelocity: 0,
        groundKnown: false,
        grounded: false,
        framesSincePlaced: 0,
        framesToGround: -1,
    };
}

/** Teleport/placement: horizontal + vertical jump that resets grounding. */
export function placeGymProbe(state: GymProbeState, x: number, y: number, z: number): void {
    state.x = x;
    state.y = y;
    state.z = z;
    state.verticalVelocity = 0;
    state.groundKnown = false;
    state.grounded = false;
    state.framesSincePlaced = 0;
    state.framesToGround = -1;
}

/**
 * One fixed-timestep integration. `moveX/moveZ` are this frame's horizontal
 * displacement (already speed*dt scaled by the scenario); `ground` is the
 * terrain query's report at the probe's (new) horizontal position.
 */
export function stepGymProbe(
    state: GymProbeState,
    moveX: number,
    moveZ: number,
    ground: GroundSample,
    options: GymProbeOptions = {}
): void {
    const gravity = options.gravity ?? DEFAULTS.gravity;
    const rideHeight = options.rideHeight ?? DEFAULTS.rideHeight;
    const dt = options.fixedDt ?? DEFAULTS.fixedDt;

    state.framesSincePlaced += 1;
    state.x += moveX;
    state.z += moveZ;

    if (ground.valid && !state.groundKnown) {
        state.groundKnown = true;
        state.framesToGround = state.framesSincePlaced;
    }

    if (!state.groundKnown) {
        // Hold-until-valid: terrain hasn't reported ground here yet — freeze
        // vertical motion instead of falling into the void.
        state.verticalVelocity = 0;
        return;
    }

    state.verticalVelocity -= gravity * dt;
    state.y += state.verticalVelocity * dt;

    if (ground.valid) {
        const standY = ground.elevation + rideHeight;
        if (state.y <= standY && state.verticalVelocity <= 0) {
            state.y = standY;
            state.verticalVelocity = 0;
            state.grounded = true;
        } else if (state.y > standY + 0.2) {
            state.grounded = false;
        }
    }
}
