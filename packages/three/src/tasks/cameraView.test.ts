import { describe, expect, it } from "vitest";
import {
  createCameraViewEquals,
  createInitialCameraView,
  type CameraView,
} from "./cameraView.js";

function setMatrix(view: CameraView, value: number): void {
  for (let i = 0; i < 16; i += 1) view.viewProjectionMatrix[i] = value;
}

describe("createCameraViewEquals", () => {
  it("detects mutations on a reused scratch (prev === next)", () => {
    const equals = createCameraViewEquals();
    const scratch = createInitialCameraView();

    // First observation of a scratch is always treated as changed.
    setMatrix(scratch, 1);
    expect(equals(scratch, scratch)).toBe(false);

    // Same contents pushed again → unchanged.
    expect(equals(scratch, scratch)).toBe(true);

    // Mutate the *same* object (the scratch-reuse pattern) → detected as changed
    // even though prev and next are the same reference.
    scratch.cameraOrigin.x = 5;
    expect(equals(scratch, scratch)).toBe(false);

    // Settled again.
    expect(equals(scratch, scratch)).toBe(true);

    // A view-projection-only change (e.g. pure camera rotation) is still caught.
    setMatrix(scratch, 2);
    expect(equals(scratch, scratch)).toBe(false);
    expect(equals(scratch, scratch)).toBe(true);
  });

  it("keeps change-detection state isolated per object instance", () => {
    const equals = createCameraViewEquals();
    const a = createInitialCameraView();
    const b = createInitialCameraView();

    a.cameraOrigin.x = 1;
    b.cameraOrigin.x = 2;

    // Seed both scratches.
    expect(equals(a, a)).toBe(false);
    expect(equals(b, b)).toBe(false);

    // Each settles independently; pushing one does not disturb the other's baseline.
    expect(equals(a, a)).toBe(true);
    expect(equals(b, b)).toBe(true);

    a.cameraOrigin.x = 3;
    expect(equals(a, a)).toBe(false);
    expect(equals(b, b)).toBe(true);
  });

  it("compares independent objects directly (prev !== next)", () => {
    const equals = createCameraViewEquals();
    const prev = createInitialCameraView();
    const next = createInitialCameraView();

    expect(equals(prev, next)).toBe(true);

    next.cameraOrigin.z = 10;
    expect(equals(prev, next)).toBe(false);
  });

  it("honors the origin hysteresis threshold", () => {
    const equals = createCameraViewEquals({ originHysteresis: 1 });
    const scratch = createInitialCameraView();

    expect(equals(scratch, scratch)).toBe(false);
    expect(equals(scratch, scratch)).toBe(true);

    // Sub-threshold drift is ignored.
    scratch.cameraOrigin.x = 0.5;
    expect(equals(scratch, scratch)).toBe(true);

    // Crossing the threshold registers as a change.
    scratch.cameraOrigin.x = 1.5;
    expect(equals(scratch, scratch)).toBe(false);
  });
});
