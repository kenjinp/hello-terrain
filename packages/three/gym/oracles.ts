import type { AnalyticField, Scenario } from "./scenarios";

export type Assertion = {
  checkpoint: string;
  name: string;
  pass: boolean;
  actual: unknown;
  expected: unknown;
  tolerance?: number;
  coordinates?: number[];
};

export function analyticElevation(field: AnalyticField, x: number, z: number): number {
  return field.offset + field.slopeX * x + field.slopeZ * z;
}

export function analyticNormal(field: AnalyticField): number[] {
  const length = Math.hypot(field.slopeX, 1, field.slopeZ);
  return [-field.slopeX / length, 1 / length, -field.slopeZ / length];
}

export function elevationTolerance(
  field: AnalyticField,
  rootSize: number,
  packed: boolean,
): number {
  // Linear fixtures have no bilinear reconstruction error. Float32 arithmetic
  // gets a conservative 32-operation error allowance. Packing normalizes each
  // tile into half float: one full ULP over the entire root's elevation span
  // bounds any tile, including its one-texel apron (2x span allowance).
  const span = rootSize * (Math.abs(field.slopeX) + Math.abs(field.slopeZ));
  const floatError = 32 * 2 ** -23 * Math.max(1, Math.abs(field.offset) + span);
  return floatError + (packed ? Math.max(1e-4, span * 2) * 2 ** -10 : 0);
}

export function numericAssertion(
  checkpoint: string,
  name: string,
  actual: number | null,
  expected: number,
  tolerance: number,
  coordinates?: number[],
): Assertion {
  return {
    checkpoint,
    name,
    actual,
    expected,
    tolerance,
    coordinates,
    pass: actual !== null && Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
  };
}

export type Leaf = { space: number; level: number; x: number; y: number };

/** Independent geometric partition check; does not reuse the production seam/index code. */
export function flatPartitionAssertions(
  leaves: Leaf[],
  budget: number,
  checkpoint: string,
  domainWidth = 1,
): Assertion[] {
  let area = 0;
  let overlap = false;
  let balanced = true;
  let valid = leaves.length > 0 && leaves.length <= budget;
  const boxes = leaves.map((leaf) => {
    const size = 2 ** -leaf.level;
    valid &&=
      leaf.space === 0 &&
      Number.isInteger(leaf.level) &&
      leaf.level >= 0 &&
      Number.isInteger(leaf.x) &&
      Number.isInteger(leaf.y) &&
      leaf.x >= 0 &&
      leaf.y >= 0 &&
      (leaf.x + 1) * size <= domainWidth &&
      (leaf.y + 1) * size <= 1;
    area += size * size;
    return {
      x: leaf.x * size,
      y: leaf.y * size,
      right: (leaf.x + 1) * size,
      bottom: (leaf.y + 1) * size,
      level: leaf.level,
    };
  });
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i],
        b = boxes[j];
      const dx = Math.min(a.right, b.right) - Math.max(a.x, b.x);
      const dy = Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y);
      if (dx > 0 && dy > 0) overlap = true;
      if ((dx === 0 && dy > 0) || (dy === 0 && dx > 0))
        balanced &&= Math.abs(a.level - b.level) <= 1;
    }
  return [
    {
      checkpoint,
      name: "leaf-budget-and-addresses",
      pass: valid,
      actual: leaves.length,
      expected: `valid flat addresses; 1..${budget} leaves`,
    },
    {
      checkpoint,
      name: "partition",
      pass: valid && !overlap && area === domainWidth,
      actual: { area, overlap },
      expected: { area: domainWidth, overlap: false },
    },
    { checkpoint, name: "balance-2to1", pass: balanced, actual: balanced, expected: true },
  ];
}

export function scenarioPartitionAssertions(
  scenario: Scenario,
  leaves: Leaf[],
  checkpoint: string,
): Assertion[] {
  const spaces = scenario.shape === "cubeSphere" ? 6 : 1;
  const width =
    scenario.shape === "torus"
      ? Math.max(1, Math.round(scenario.majorRadius / scenario.minorRadius))
      : 1;
  return [
    {
      checkpoint,
      name: "total-leaf-budget",
      pass:
        leaves.length > 0 &&
        leaves.length <= scenario.maxNodes &&
        leaves.every((l) => l.space >= 0 && l.space < spaces),
      actual: leaves.length,
      expected: `1..${scenario.maxNodes} leaves in ${spaces} spaces`,
    },
    ...Array.from({ length: spaces }, (_, space) =>
      flatPartitionAssertions(
        leaves.filter((l) => l.space === space).map((l) => ({ ...l, space: 0 })),
        scenario.maxNodes,
        `${checkpoint}/space-${space}`,
        width,
      ),
    ).flat(),
  ];
}

export function surfaceProbes(scenario: Scenario): number[][] {
  if (scenario.shape === "cubeSphere")
    return [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
      ...[-1e-5, 1e-5].flatMap((d) => [
        [1 + d, 1, 0],
        [0, 1 + d, 1],
        [1, 0, 1 + d],
        [-1 + d, 1, 0],
      ]),
    ].map((p) => p.map((v) => (v / Math.hypot(...p)) * scenario.radius));
  return [-1e-5, 1e-5, Math.PI / 2, Math.PI].flatMap((u) =>
    [-1e-5, 1e-5, Math.PI / 2].map((v) => [
      (scenario.majorRadius + scenario.minorRadius * Math.cos(v)) * Math.cos(u),
      scenario.minorRadius * Math.sin(v),
      (scenario.majorRadius + scenario.minorRadius * Math.cos(v)) * Math.sin(u),
    ]),
  );
}

/** Independent implicit-surface distance and gradient; no projection helpers. */
export function surfaceReference(scenario: Scenario, position: number[]) {
  const [x, y, z] = position;
  if (scenario.shape === "cubeSphere") {
    const distance = Math.hypot(x, y, z);
    return {
      elevation: distance - scenario.radius,
      normal: [x / distance, y / distance, z / distance],
    };
  }
  const radial = Math.hypot(x, z);
  const tubeX = radial - scenario.majorRadius;
  const distance = Math.hypot(tubeX, y);
  return {
    elevation: distance - scenario.minorRadius,
    normal: [(tubeX * x) / radial / distance, y / distance, (tubeX * z) / radial / distance],
  };
}

export function surfaceTolerances(scenario: Scenario, field: AnalyticField, level: number) {
  const cells = scenario.innerTileSegments * 2 ** level;
  const step = (scenario.shape === "cubeSphere" ? 2 : 2 * Math.PI) / cells;
  // Conservative second-derivative bounds for chord interpolation and centered
  // differences. Torus uses the worst principal radius, ignoring anisotropic
  // root subdivision to retain a conservative bound on both periodic axes.
  const radius =
    scenario.shape === "cubeSphere"
      ? scenario.radius + field.offset
      : scenario.majorRadius + scenario.minorRadius + field.offset;
  return { position: 2 * radius * step * step + 1e-4, normal: 4 * step * step + 2 ** -8 };
}
