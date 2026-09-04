import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guard: the CPU query / raycast / quadtree internals must not depend on
 * three.js at runtime (AGENTS.md: "In library internals, don't use three.js").
 * `import type { ... } from "three"` is allowed; value imports are not.
 */

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

const CPU_INTERNAL_FILES = [
  "query/cpu-raycast.ts",
  "query/elevation-field-sampling.ts",
  "query/tile-lookup.ts",
  "query/tile-elevation-pyramid.ts",
  "query/terrain-snapshot.ts",
  "query/vec3.ts",
];

function listTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      listTsFiles(full, out);
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** Matches `import ... from "three"` (bare specifier only, not `three/tsl` etc). */
const ANY_THREE_IMPORT = /^\s*import\s[^;]*?\sfrom\s+["']three["']/gm;
/** Matches the type-only form `import type ... from "three"`. */
const TYPE_ONLY_THREE_IMPORT = /^\s*import\s+type\s[^;]*?\sfrom\s+["']three["']/;

function valueImportsOfThree(source: string): string[] {
  const offenders: string[] = [];
  for (const match of source.matchAll(ANY_THREE_IMPORT)) {
    const statement = match[0];
    if (!TYPE_ONLY_THREE_IMPORT.test(statement)) offenders.push(statement.trim());
  }
  return offenders;
}

describe("CPU internals stay free of three.js value imports", () => {
  const files = [
    ...CPU_INTERNAL_FILES.map((f) => join(srcDir, f)),
    ...listTsFiles(join(srcDir, "quadtree")),
  ];

  it("covers the expected internal modules", () => {
    expect(files.length).toBeGreaterThan(CPU_INTERNAL_FILES.length);
  });

  for (const file of files) {
    it(`${relative(srcDir, file)} has no value import from "three"`, () => {
      const source = readFileSync(file, "utf8");
      expect(valueImportsOfThree(source)).toEqual([]);
    });
  }

  it("the regex distinguishes type-only from value imports", () => {
    expect(valueImportsOfThree('import type { Vector3 } from "three";\n')).toEqual([]);
    expect(valueImportsOfThree('import { Vector3 } from "three";\n')).toHaveLength(1);
    expect(valueImportsOfThree('import { Vector3 } from "three/webgpu";\n')).toEqual([]);
    expect(
      valueImportsOfThree('import {\n  Vector3,\n  type Ray,\n} from "three";\n'),
    ).toHaveLength(1);
  });
});
