export type Pose = { x: number; y: number; z: number };
export type AnalyticField = { offset: number; slopeX: number; slopeZ: number };
export type GymMode = "cpu" | "probe" | "check" | "perf";
export type Scenario = {
  id: string;
  shape: "flat" | "cubeSphere" | "torus";
  version: number;
  description: string;
  tags: string[];
  rootSize: number;
  radius: number;
  majorRadius: number;
  minorRadius: number;
  maxNodes: number;
  maxLevel: number;
  innerTileSegments: number;
  terrainFieldFilter: "linear" | "nearest";
  initial: AnalyticField;
  edited: AnalyticField;
};

// Factories keep all scenario state owned by a run. No shared mutable defaults.
export function scenarios(): Scenario[] {
  return [
    { id: "terrain-skirts", description: "Precision vertex paths extrude skirt walls on flat, sphere and torus terrain", tags: ["gpu", "precision", "skirts"] },
    { id: "material-authoring", description: "Shared painted weights, procedural masks, appearance-only edits and detail normals", tags: ["gpu", "material", "sources", "isolation"] },
    {
      id: "earth-precision",
      description: "Constant Earth datum normals on real WebGPU at levels 14 through 20",
      tags: ["gpu", "precision", "cubeSphere"],
    },
    {
      id: "flat-edit",
      description: "Stationary elevation edit through compute, render and CPU query",
      tags: ["gpu", "query", "react", "packing"],
    },
    {
      id: "flat-lod",
      description: "Flyover and teleport across flat LOD boundaries",
      tags: ["quadtree", "lod", "gpu"],
    },
    {
      id: "flat-nearest",
      description: "Nearest-filtered terrain-field rendering at mesh texel centers",
      tags: ["gpu", "packing", "filter"],
    },
    {
      id: "instance-isolation",
      description: "Interleaved terrains and surviving a peer unmount",
      tags: ["lifecycle", "react", "isolation"],
    },
    {
      id: "sphere-seams",
      description: "Cube-face edges and poles on an analytically displaced sphere",
      tags: ["projection", "cubeSphere", "seams", "query"],
    },
    {
      id: "torus-wrap",
      description: "Both periodic seams of an analytically displaced torus",
      tags: ["projection", "torus", "seams", "query"],
    },
  ].map((entry) => ({
    ...entry,
    shape:
      entry.id === "sphere-seams"
        ? ("cubeSphere" as const)
        : entry.id === "torus-wrap"
          ? ("torus" as const)
          : ("flat" as const),
    version: 1,
    rootSize: 64,
    radius: 24,
    majorRadius: 24,
    minorRadius: 8,
    maxNodes: 256,
    maxLevel: 5,
    innerTileSegments: 13,
    terrainFieldFilter: entry.id === "flat-nearest" ? ("nearest" as const) : ("linear" as const),
    initial: {
      offset: 2,
      slopeX: entry.id === "sphere-seams" || entry.id === "torus-wrap" ? 0 : 0.0625,
      slopeZ: entry.id === "sphere-seams" || entry.id === "torus-wrap" ? 0 : -0.03125,
    },
    edited: {
      offset: 7,
      slopeX: entry.id === "sphere-seams" || entry.id === "torus-wrap" ? 0 : -0.03125,
      slopeZ: entry.id === "sphere-seams" || entry.id === "torus-wrap" ? 0 : 0.0625,
    },
  }));
}

export function getScenario(id: string): Scenario {
  const value = scenarios().find((entry) => entry.id === id);
  if (!value)
    throw new Error(
      `Unknown scenario ${id}. Choose: ${scenarios()
        .map((entry) => entry.id)
        .join(", ")}`,
    );
  return value;
}

export function cameraPose(t: number): Pose {
  return {
    x: Math.sin(t * Math.PI * 2) * 27,
    y: 12 + 18 * (1 + Math.cos(t * Math.PI * 2)),
    z: Math.cos(t * Math.PI * 2) * 27,
  };
}

export function probePoints(seed: number, count = 12): [number, number][] {
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  return [
    [0, 0],
    ...Array.from({ length: count }, (): [number, number] => [
      (random() - 0.5) * 24,
      (random() - 0.5) * 24,
    ]),
  ];
}
