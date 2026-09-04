import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guard for the "no module-scope variables" rule (AGENTS.md).
 *
 * Multiple terrain instances can coexist, so library internals must not keep
 * mutable state or scratch objects at module scope. This scans every source
 * file under `src/` (tests excluded) for top-level `let`/`var` declarations and
 * top-level `const` bindings that allocate a mutable container.
 *
 * Pure declarations (TSL nodes, frozen constants, lookup tables) are fine and
 * are not matched. Justified exceptions go in `ALLOWLIST` with a reason.
 */

const SRC_DIR = fileURLToPath(new URL("../src", import.meta.url));

/** `src`-relative path -> reason. Keep this empty unless there is a real justification. */
const ALLOWLIST: Record<string, string> = {};

const TOP_LEVEL_LET_OR_VAR = /^(export )?(let|var) /;
const TOP_LEVEL_MUTABLE_CONTAINER =
  /^(export )?const \w+(: [^=]+)? = new (Vector[234]|Matrix[34]|Float(32|64)Array|Uint\d+Array|Int\d+Array|Map|Set|WeakMap)\(/;

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(full, out);
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

function findViolations(source: string): string[] {
  const violations: string[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (TOP_LEVEL_LET_OR_VAR.test(line) || TOP_LEVEL_MUTABLE_CONTAINER.test(line)) {
      violations.push(`${i + 1}: ${line.trim()}`);
    }
  }
  return violations;
}

describe("no module-scope mutable state in @hello-terrain/three", () => {
  const files = collectSourceFiles(SRC_DIR);

  it("scans a non-trivial number of source files", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("has no top-level let/var or shared scratch allocations", () => {
    const report: string[] = [];
    for (const file of files) {
      const rel = relative(SRC_DIR, file).split("\\").join("/");
      const violations = findViolations(readFileSync(file, "utf8"));
      if (violations.length === 0) continue;
      if (rel in ALLOWLIST) continue;
      report.push(`${rel}\n  ${violations.join("\n  ")}`);
    }
    expect(report, `Module-scope state found:\n${report.join("\n")}`).toEqual([]);
  });

  it("does not keep stale allowlist entries", () => {
    const stale = Object.keys(ALLOWLIST).filter((rel) => {
      const file = join(SRC_DIR, rel);
      return !files.includes(file) || findViolations(readFileSync(file, "utf8")).length === 0;
    });
    expect(stale).toEqual([]);
  });
});
