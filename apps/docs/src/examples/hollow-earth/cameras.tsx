"use client";

import type { TerrainHandle } from "@hello-terrain/react";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { MathUtils, type PerspectiveCamera, Vector3 } from "three";
import {
  getBodyPosition,
  type HollowEarthState,
  NYX_INDEX,
  ORBITING_BODIES,
  SELENE_INDEX,
  SHELL_RADIUS,
} from "./world";

const WORLD_Y = new Vector3(0, 1, 0);

/** Scratch vectors owned by one camera component instance. */
function createScratch() {
  return {
    a: new Vector3(),
    b: new Vector3(),
    c: new Vector3(),
    d: new Vector3(),
    up: new Vector3(),
    target: new Vector3(),
  };
}

type Scratch = ReturnType<typeof createScratch>;

interface ShotFrame {
  camera: PerspectiveCamera;
  state: HollowEarthState;
  /** Seconds since this shot was cut to. */
  elapsed: number;
  scratch: Scratch;
}

export interface Shot {
  id: string;
  label: string;
  fov: number;
  /** Minimum height above terrain or sea, in metres (0 = shot is in space). */
  clearance: number;
  update: (frame: ShotFrame) => void;
}

/**
 * In this world "up" always points at the sun: gravity pushes outward, onto
 * the inside of the shell.
 */
function setSunwardUp(position: Vector3, out: Vector3) {
  return out.copy(position).normalize().negate();
}

/** Aim along `forward` pitched `pitchDeg` towards the sun, horizon level. */
function lookAlongSurface(
  camera: PerspectiveCamera,
  forward: Vector3,
  pitchDeg: number,
  s: Scratch,
) {
  setSunwardUp(camera.position, s.up);
  // Remove any radial component so `forward` hugs the ground.
  s.d.copy(forward).addScaledVector(s.up, -forward.dot(s.up)).normalize();
  const pitch = MathUtils.degToRad(pitchDeg);
  s.target
    .copy(camera.position)
    .addScaledVector(s.d, Math.cos(pitch) * 1000)
    .addScaledVector(s.up, Math.sin(pitch) * 1000);
  camera.up.copy(s.up);
  camera.lookAt(s.target);
}

export const SHOTS: readonly Shot[] = [
  {
    id: "heliocentric",
    label: "Heliocentric",
    fov: 55,
    clearance: 0,
    // Hold station ahead of Nyx on its orbit: the sun dead centre, Nyx
    // side-lit beside it, and the edge of its night shadow on the far wall.
    update: ({ camera, state, elapsed, scratch: s }) => {
      const nyx = ORBITING_BODIES[NYX_INDEX];
      s.a.copy(state.bodyPositions[NYX_INDEX]).normalize();
      getBodyPosition(nyx, state.days + 1e-4, s.b).normalize();
      // Nyx's direction of travel, and the pole of its orbit.
      s.b.sub(s.a).addScaledVector(s.a, -s.b.dot(s.a)).normalize();
      s.c.crossVectors(s.a, s.b).normalize();
      camera.position
        .copy(s.b)
        .addScaledVector(s.c, 0.38)
        .addScaledVector(s.a, 0.22 * Math.sin(elapsed * 0.06))
        .normalize()
        .multiplyScalar(2.9e6);
      camera.up.copy(s.c);
      s.target.copy(s.a).multiplyScalar(350_000);
      camera.lookAt(s.target);
    },
  },
  {
    id: "low-orbit",
    label: "Low orbit",
    fov: 62,
    clearance: 0,
    // 45 km above the sea on a tilted great circle, at the top of the
    // weather. The horizon curves *up* and dissolves into the air instead of
    // falling away.
    update: ({ camera, elapsed, scratch: s }) => {
      const angle = 0.5 + elapsed * 0.012;
      s.a.set(1, 0, 0);
      s.b.set(0, 0.33, 0.944).normalize();
      camera.position
        .copy(s.a)
        .multiplyScalar(Math.cos(angle))
        .addScaledVector(s.b, Math.sin(angle))
        .multiplyScalar(SHELL_RADIUS - 45_000);
      s.c.copy(s.a).multiplyScalar(-Math.sin(angle)).addScaledVector(s.b, Math.cos(angle));
      lookAlongSurface(camera, s.c, -5, s);
    },
  },
  {
    id: "terminator",
    label: "Dusk line",
    fov: 78,
    clearance: 2_500,
    // Ride the trailing edge of Nyx's shadow: the sun is half bitten overhead
    // and night is draining away across the land ahead.
    update: ({ camera, state, scratch: s }) => {
      const nyx = ORBITING_BODIES[NYX_INDEX];
      s.a.copy(state.bodyPositions[NYX_INDEX]).normalize();
      getBodyPosition(nyx, state.days + 1e-4, s.b).normalize();
      // Direction the shadow travels across the shell.
      s.b.sub(s.a).addScaledVector(s.a, -s.b.dot(s.a)).normalize();
      const edge = MathUtils.degToRad(57);
      camera.position
        .copy(s.a)
        .multiplyScalar(Math.cos(edge))
        .addScaledVector(s.b, -Math.sin(edge))
        .normalize()
        .multiplyScalar(SHELL_RADIUS - 16_000);
      // Face the retreating night.
      lookAlongSurface(camera, s.b, 38, s);
    },
  },
  {
    id: "eclipse",
    label: "Eclipse",
    fov: 96,
    clearance: 1_500,
    // Stand in Selene's umbra with a wide lens: a black disc where the sun
    // should be, dark ground underfoot, and the lit world beyond the shadow.
    update: ({ camera, state, scratch: s }) => {
      const selene = ORBITING_BODIES[SELENE_INDEX];
      s.a.copy(state.bodyPositions[SELENE_INDEX]).normalize();
      getBodyPosition(selene, state.days + 1e-4, s.b).normalize();
      s.b.sub(s.a).addScaledVector(s.a, -s.b.dot(s.a)).normalize();
      camera.position.copy(s.a).multiplyScalar(SHELL_RADIUS - 9_000);
      lookAlongSurface(camera, s.b, 46, s);
    },
  },
  {
    id: "moonrider",
    label: "Moonrider",
    fov: 52,
    clearance: 0,
    // Hang sunward of Selene and look past it at the shadow it drags over
    // the shell.
    update: ({ camera, state, scratch: s }) => {
      const selene = ORBITING_BODIES[SELENE_INDEX];
      const centre = state.bodyPositions[SELENE_INDEX];
      s.a.copy(centre).normalize();
      s.b.crossVectors(s.a, WORLD_Y).normalize();
      camera.position
        .copy(centre)
        .addScaledVector(s.a, -4.2 * selene.radius)
        .addScaledVector(s.b, 1.7 * selene.radius)
        .addScaledVector(WORLD_Y, 0.6 * selene.radius);
      camera.up.copy(WORLD_Y);
      s.target.copy(s.a).multiplyScalar(SHELL_RADIUS);
      camera.lookAt(s.target);
    },
  },
  {
    id: "seaside",
    label: "Day & night",
    fov: 66,
    clearance: 1_200,
    // A fixed spot under Nyx's track. Nothing moves but the clock.
    update: ({ camera, scratch: s }) => {
      camera.position
        .set(0.6, 0.08, 0.79)
        .normalize()
        .multiplyScalar(SHELL_RADIUS - 1_200);
      lookAlongSurface(camera, WORLD_Y, 17, s);
    },
  },
];

export type ShotId = (typeof SHOTS)[number]["id"];

/**
 * Radius the camera may not exceed at `position`: the terrain (or the sea,
 * where the terrain is under water) minus `clearance`. Falls back to sea
 * level until the terrain readback has data.
 */
function getCeilingRadius(terrain: TerrainHandle, position: Vector3, clearance: number) {
  const sample = terrain.runtime.surfaceQuery?.sampleTerrainByPosition(position);
  const ground = sample?.valid ? sample.position.length() : SHELL_RADIUS;
  return Math.min(ground, SHELL_RADIUS) - clearance;
}

/** Plays one of the scripted {@link SHOTS}. */
export function CinematicCamera({
  shotId,
  state,
  terrain,
}: {
  shotId: string;
  state: HollowEarthState;
  terrain: TerrainHandle;
}) {
  const camera = useThree((three) => three.camera) as PerspectiveCamera;
  const scratch = useMemo(createScratch, []);
  const elapsed = useRef(0);
  const shot = SHOTS.find((candidate) => candidate.id === shotId) ?? SHOTS[0];

  useEffect(() => {
    elapsed.current = 0;
    camera.fov = shot.fov;
    camera.updateProjectionMatrix();
  }, [camera, shot]);

  useFrame((_, delta) => {
    elapsed.current += delta;
    shot.update({ camera, state, elapsed: elapsed.current, scratch });

    if (shot.clearance > 0) {
      const ceiling = getCeilingRadius(terrain, camera.position, shot.clearance);
      if (camera.position.length() > ceiling) camera.position.setLength(ceiling);
    }
  });

  return null;
}

export interface WalkerCameraProps {
  terrain: TerrainHandle;
  /** Eye height above the ground, in metres. */
  eyeHeight?: number;
  /** Ground speed in m/s. Hold Shift for `sprintMultiplier`×. */
  walkSpeed?: number;
  sprintMultiplier?: number;
  /** Outward gravitational acceleration, m/s². */
  gravity?: number;
  jumpSpeed?: number;
  lookSensitivity?: number;
}

/** Evenly spread unit directions, used to look for dry land to spawn on. */
function fibonacciDirection(index: number, count: number, out: Vector3) {
  const y = 1 - (2 * (index + 0.5)) / count;
  const ring = Math.sqrt(1 - y * y);
  const azimuth = index * Math.PI * (3 - Math.sqrt(5));
  return out.set(Math.cos(azimuth) * ring, y, Math.sin(azimuth) * ring);
}

/**
 * First-person camera pinned to the inside of the shell. Gravity points away
 * from the centre, so the player's feet are on the wall and their head points
 * at the sun wherever they walk. Click to capture the mouse, WASD to move,
 * Space to jump, Shift to sprint, Esc to release.
 *
 * The player's state is a position plus a heading tangent to the ground. As
 * they move, "up" changes, so each frame the heading is re-flattened against
 * the new up — parallel transport along the sphere — which keeps the view
 * steady while walking all the way round the world.
 */
export function WalkerCamera({
  terrain,
  eyeHeight = 12,
  walkSpeed = 60,
  sprintMultiplier = 25,
  gravity = 9.81,
  jumpSpeed = 14,
  lookSensitivity = 0.0025,
}: WalkerCameraProps) {
  const camera = useThree((three) => three.camera) as PerspectiveCamera;
  const renderer = useThree((three) => three.renderer);
  const scratch = useMemo(createScratch, []);
  const player = useMemo(
    () => ({
      position: new Vector3(0.62, 0.1, 0.78).normalize().multiplyScalar(SHELL_RADIUS - 500),
      heading: new Vector3(0, 1, 0),
      pitch: 0.15,
      /** Height of the feet above the ground, towards the sun. */
      height: 500,
      verticalSpeed: 0,
      spawned: false,
      keys: new Set<string>(),
      yawInput: 0,
    }),
    [],
  );

  useEffect(() => {
    camera.fov = 68;
    camera.updateProjectionMatrix();
  }, [camera]);

  useEffect(() => {
    const canvas = renderer.domElement as HTMLCanvasElement;
    let dragging = false;

    const onMouseDown = () => {
      dragging = true;
      if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
    };
    const onMouseUp = () => {
      dragging = false;
    };
    const onMouseMove = (event: MouseEvent) => {
      if (document.pointerLockElement !== canvas && !dragging) return;
      player.yawInput -= event.movementX * lookSensitivity;
      player.pitch = MathUtils.clamp(
        player.pitch - event.movementY * lookSensitivity,
        -Math.PI * 0.47,
        Math.PI * 0.47,
      );
    };
    const onKeyDown = (event: KeyboardEvent) => {
      player.keys.add(event.code);
      if (event.code === "Space" && document.pointerLockElement === canvas) {
        event.preventDefault();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => player.keys.delete(event.code);
    const onBlur = () => player.keys.clear();

    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    document.addEventListener("mousemove", onMouseMove);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      player.keys.clear();
      if (document.pointerLockElement === canvas) document.exitPointerLock();
    };
  }, [renderer, player, lookSensitivity]);

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.1);
    const s = scratch;
    const query = terrain.runtime.surfaceQuery;

    // Once terrain data arrives, move the spawn to the nearest dry land.
    if (!player.spawned && query) {
      const here = query.sampleTerrainByPosition(player.position);
      if (here.valid) {
        player.spawned = true;
        s.a.copy(player.position).normalize();
        let best = -Infinity;
        const count = 400;
        for (let i = 0; i < count; i++) {
          fibonacciDirection(i, count, s.b);
          const sample = query.sampleTerrainByPosition(s.c.copy(s.b).multiplyScalar(SHELL_RADIUS));
          if (!sample.valid) continue;
          const elevation = SHELL_RADIUS - sample.position.length();
          if (elevation < 30 || elevation > 1_500) continue;
          const closeness = s.b.dot(s.a);
          if (closeness > best) {
            best = closeness;
            player.position.copy(s.b).multiplyScalar(SHELL_RADIUS - 500);
          }
        }
        player.height = 40;
      }
    }

    // --- Orientation ------------------------------------------------------
    setSunwardUp(player.position, s.up);
    player.heading.addScaledVector(s.up, -player.heading.dot(s.up));
    if (player.heading.lengthSq() < 1e-8) player.heading.set(1, 0, 0).cross(s.up);
    player.heading.normalize();
    if (player.yawInput !== 0) {
      player.heading.applyAxisAngle(s.up, player.yawInput);
      player.yawInput = 0;
    }
    // forward × up = right, for a camera looking down -Z with +Y up.
    s.a.crossVectors(player.heading, s.up).normalize();

    // --- Movement ---------------------------------------------------------
    const keys = player.keys;
    const forward =
      (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) -
      (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
    const strafe =
      (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) -
      (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
    if (forward !== 0 || strafe !== 0) {
      const sprint = keys.has("ShiftLeft") || keys.has("ShiftRight") ? sprintMultiplier : 1;
      s.b
        .set(0, 0, 0)
        .addScaledVector(player.heading, forward)
        .addScaledVector(s.a, strafe)
        .normalize();
      player.position.addScaledVector(s.b, walkSpeed * sprint * delta);
    }

    // --- Gravity (outward) ------------------------------------------------
    const grounded = player.height <= 0;
    if (grounded && keys.has("Space")) {
      player.verticalSpeed = jumpSpeed;
    } else if (!grounded) {
      player.verticalSpeed -= gravity * delta;
    }
    player.height = Math.max(0, player.height + player.verticalSpeed * delta);
    if (player.height === 0 && player.verticalSpeed < 0) player.verticalSpeed = 0;

    // Feet rest on the terrain, or on the sea where the terrain is drowned.
    const groundRadius = getCeilingRadius(terrain, player.position, 0);
    player.position.setLength(groundRadius - player.height - eyeHeight);

    // --- Camera -----------------------------------------------------------
    setSunwardUp(player.position, s.up);
    s.target
      .copy(player.position)
      .addScaledVector(player.heading, Math.cos(player.pitch))
      .addScaledVector(s.up, Math.sin(player.pitch));
    camera.position.copy(player.position);
    camera.up.copy(s.up);
    camera.lookAt(s.target);
  });

  return null;
}
