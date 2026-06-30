import { describe, expect, it } from "vitest";
import {
  copyMatrix16,
  didCameraOriginMove,
  didViewProjectionMatrixChange,
} from "../src/cameraSync.js";

function matrix16(value: number): Float64Array {
  return new Float64Array(Array.from({ length: 16 }, () => value));
}

describe("cameraSync", () => {
  it("uses hysteresis for camera origin movement", () => {
    const origin = { x: 10, y: 2, z: -4 };

    expect(didCameraOriginMove(null, origin, 0.5)).toBe(true);
    expect(didCameraOriginMove(origin, { x: 10.1, y: 2, z: -4 }, 0.5)).toBe(false);
    expect(didCameraOriginMove(origin, { x: 10.6, y: 2, z: -4 }, 0.5)).toBe(true);
  });

  it("detects view-projection changes independently of origin movement", () => {
    const last = matrix16(0);
    const next = matrix16(0);

    expect(didViewProjectionMatrixChange(null, next)).toBe(true);
    expect(didViewProjectionMatrixChange(last, next)).toBe(false);

    next[5] = 1e-10;
    expect(didViewProjectionMatrixChange(last, next)).toBe(false);

    next[5] = 0.25;
    expect(didViewProjectionMatrixChange(last, next)).toBe(true);
  });

  it("copies matrix snapshots without sharing mutable camera state", () => {
    const source = matrix16(1);
    const target = matrix16(0);

    copyMatrix16(target, source);
    source[3] = 9;

    expect(target[0]).toBe(1);
    expect(target[3]).toBe(1);
  });
});
