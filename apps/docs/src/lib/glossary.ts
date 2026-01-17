export interface GlossaryEntry {
  term: string;
  definition: string;
  aliases?: string[];
}

export const glossary: GlossaryEntry[] = [
  {
    term: "LOD",
    definition:
      "Level of Detail - A technique that reduces the complexity of 3D models as they move away from the viewer, improving rendering performance.",
    aliases: ["Level of Detail"],
  },
  {
    term: "Heightmap",
    definition:
      "A grayscale image where pixel brightness represents elevation data, used to generate terrain geometry.",
    aliases: ["height map", "heightmaps"],
  },
  {
    term: "Quadtree",
    definition:
      "A tree data structure where each node has exactly four children, used to efficiently partition 2D space for terrain LOD management.",
  },
  {
    term: "Frustum Culling",
    definition:
      "An optimization technique that excludes objects outside the camera's view frustum from rendering.",
    aliases: ["frustum culling", "FC"],
  },
  {
    term: "Occlusion Culling",
    definition:
      "A rendering optimization that skips drawing objects hidden behind other geometry.",
    aliases: ["occlusion culling", "OC"],
  },
  {
    term: "WebGPU",
    definition:
      "A modern web graphics API that provides low-level access to GPU capabilities for high-performance rendering and compute.",
    aliases: ["webgpu"],
  },
  {
    term: "Procedural Generation",
    definition:
      "Creating content algorithmically rather than manually, often using mathematical functions like noise to generate terrain, textures, or other data.",
    aliases: ["procedurally", "procedural"],
  },
  {
    term: "Tile",
    definition:
      "A discrete section of terrain geometry, typically square, that can be loaded, rendered, and managed independently.",
    aliases: ["tiles", "terrain tile", "terrain tiles"],
  },
  {
    term: "GPU",
    definition:
      "Graphics Processing Unit - specialized hardware designed for parallel processing of graphics and compute workloads.",
  },
  {
    term: "Normal Map",
    definition:
      "A texture that stores surface direction information per-pixel, enabling detailed lighting without additional geometry.",
    aliases: ["normal maps", "normal mapping"],
  },
  {
    term: "Mesh",
    definition:
      "A collection of vertices, edges, and faces that define the shape of a 3D object.",
    aliases: ["meshes"],
  },
  {
    term: "Vertex",
    definition:
      "A point in 3D space that defines the corners of polygons in a mesh.",
    aliases: ["vertices"],
  },
  {
    term: "Shader",
    definition:
      "A program that runs on the GPU to control how vertices are transformed and pixels are colored.",
    aliases: ["shaders"],
  },
  {
    term: "Terrain Skirt",
    definition:
      "Vertical geometry added to terrain tile edges to hide gaps between tiles at different LOD levels.",
    aliases: ["skirt", "skirts"],
  },
  {
    term: "Clipmap",
    definition:
      "A terrain rendering technique using nested, camera-centered grids at different resolutions for efficient large-scale terrain display.",
    aliases: ["clipmaps", "geometry clipmap"],
  },
];

// Build lookup maps for efficient term matching
export const glossaryByTerm = new Map<string, GlossaryEntry>(
  glossary.map((entry) => [entry.term.toLowerCase(), entry])
);

export const glossaryByAlias = new Map<string, GlossaryEntry>();
glossary.forEach((entry) => {
  entry.aliases?.forEach((alias) => {
    glossaryByAlias.set(alias.toLowerCase(), entry);
  });
});

export function findGlossaryEntry(text: string): GlossaryEntry | undefined {
  const lower = text.toLowerCase();
  return glossaryByTerm.get(lower) ?? glossaryByAlias.get(lower);
}

export function getAllTermsAndAliases(): string[] {
  const terms: string[] = [];
  glossary.forEach((entry) => {
    terms.push(entry.term);
    entry.aliases?.forEach((alias) => terms.push(alias));
  });
  return terms;
}
