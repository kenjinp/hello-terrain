import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { cpus, platform, release } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import { build, preview } from "vite";
import { runCpu } from "../../packages/three/gym/cpu";
import {
  compareReports,
  exitCode,
  summarize,
  type GymReport,
  type GymResult,
} from "../../packages/three/gym/report";
import { getScenario, scenarios, type GymMode } from "../../packages/three/gym/scenarios";

async function hashFiles(paths: string[], outputDirectory?: string): Promise<string> {
  const hash = createHash("sha256");
  async function visit(path: string) {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (["node_modules", "dist", ".git", ".gym"].includes(entry.name)) continue;
      const child = join(path, entry.name);
      if (child === outputDirectory) continue;
      if (entry.isDirectory()) await visit(child);
      else if (/\.(tsx?|json|mjs)$/.test(entry.name)) {
        hash.update(entry.name);
        hash.update(await readFile(child));
      }
    }
  }
  for (const path of paths) await visit(path);
  return hash.digest("hex");
}

async function main() {
  const app = dirname(fileURLToPath(import.meta.url));
  const repo = resolve(app, "../..");
  const { values } = parseArgs({
    options: {
      mode: { type: "string", default: "check" },
      scenario: { type: "string", default: "flat-edit" },
      seed: { type: "string", default: "7" },
      duration: { type: "string", default: "4000" },
      warmup: { type: "string", default: "1000" },
      repeat: { type: "string" },
      baseline: { type: "string" },
      out: { type: "string" },
      checkpoint: { type: "string" },
      fault: { type: "string" },
      software: { type: "boolean", default: false },
      headed: { type: "boolean", default: false },
      list: { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "pnpm gym [--mode cpu|probe|check|perf] [--scenario ID] [--seed N] [--checkpoint initial|stationary-edit]\n  [--duration MS] [--warmup MS] [--repeat N] [--baseline /path/run.json] [--out DIR]\n  [--software] [--headed] [--list]\n  --fault render|unsupported validates harness failure paths. Never use for baselines.",
    );
    return;
  }
  if (values.list) {
    console.log(
      scenarios()
        .map((s) => `${s.id}: ${s.description}`)
        .join("\n"),
    );
    return;
  }
  const mode = values.mode as GymMode;
  if (!["cpu", "probe", "check", "perf"].includes(mode)) throw new Error(`Unknown mode ${mode}`);
  const scenario = getScenario(values.scenario!);
  const number = (value: string | undefined, fallback: number, min: number, max: number) => {
    const n = Number(value ?? fallback);
    if (!Number.isInteger(n) || n < min || n > max)
      throw new Error(`Expected integer in ${min}..${max}: ${value}`);
    return n;
  };
  const seed = number(values.seed, 7, 0, 4294967295);
  const duration = number(values.duration, 4000, 100, 60000);
  const warmup = number(values.warmup, 1000, 0, 60000);
  const repeat = number(values.repeat, mode === "perf" ? 3 : 1, 1, 10);
  if (values.checkpoint && !["initial", "stationary-edit"].includes(values.checkpoint))
    throw new Error(
      "Checkpoint must be initial or stationary-edit (later checkpoints replay the complete scenario)",
    );
  if (values.fault && !["render", "unsupported"].includes(values.fault))
    throw new Error("Unknown fault");
  const folder = values.out
    ? resolve(repo, values.out)
    : join(
        repo,
        ".gym",
        "runs",
        `${new Date().toISOString().replaceAll(":", "-")}-${scenario.id}-${mode}`,
      );
  await mkdir(folder, { recursive: true });
  const git = (...args: string[]) => {
    try {
      return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
    } catch {
      // Sandboxed agents may read source but not spawn git. The content hash
      // still identifies the measured tree; never invent a commit identity.
      return "unavailable";
    }
  };
  const fingerprint: Record<string, unknown> = {
    scenario,
    seed,
    mode,
    duration,
    warmup,
    repeat,
    checkpoint: values.checkpoint ?? null,
    fault: values.fault ?? null,
    lockfileHash: createHash("sha256")
      .update(await readFile(join(repo, "pnpm-lock.yaml")))
      .digest("hex"),
    harnessHash: await hashFiles([app, join(repo, "packages/three/gym")], folder),
    os: `${platform()} ${release()}`,
    cpu: cpus()[0]?.model ?? "unavailable",
    node: process.version,
    viewport: [640, 480],
    dpr: 1,
    antialias: false,
    softwareRequested: values.software,
    headed: values.headed,
  };
  const source = {
    commit: git("rev-parse", "HEAD"),
    treeHash: await hashFiles([join(repo, "packages"), app], folder),
  };
  const repro = `pnpm gym --mode ${mode} --scenario ${scenario.id} --seed ${seed} --duration ${duration} --warmup ${warmup} --repeat ${repeat}${values.software ? " --software" : ""}${values.headed ? " --headed" : ""}${values.checkpoint ? ` --checkpoint ${values.checkpoint}` : ""}${values.fault ? ` --fault ${values.fault}` : ""}`;
  const report: GymReport = {
    schemaVersion: 1,
    scenario: scenario.id,
    seed,
    mode,
    fingerprint,
    source,
    repro,
    result: { status: "error", assertions: [], metrics: {}, samples: [] },
  };
  const results: GymResult[] = [];
  let server: Awaited<ReturnType<typeof preview>> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    if (mode === "cpu") {
      for (let i = 0; i < repeat; i++) results.push(runCpu(scenario));
    } else {
      await build({ root: app, configFile: join(app, "vite.config.ts"), logLevel: "error" });
      server = await preview({
        root: app,
        configFile: join(app, "vite.config.ts"),
        logLevel: "error",
        preview: { host: "127.0.0.1", port: 0 },
      });
      browser = await chromium.launch({
        channel: "chromium",
        headless: !values.headed,
        args: [
          "--enable-unsafe-webgpu",
          ...(values.software
            ? [
                "--enable-features=Vulkan",
                "--use-angle=vulkan",
                "--use-vulkan=swiftshader",
                "--disable-vulkan-surface",
                "--enable-unsafe-swiftshader",
              ]
            : []),
        ],
      });
      fingerprint.browser = browser.version();
      for (let i = 0; i < repeat; i++) {
        const context = await browser.newContext({
          viewport: { width: 680, height: 560 },
          deviceScaleFactor: 1,
        });
        try {
          const page = await context.newPage();
          page.setDefaultTimeout(120000);
          const logs: string[] = [];
          page.on("pageerror", (error) => logs.push(String(error)));
          page.on("console", (message) => {
            if (message.type() === "error") logs.push(message.text());
          });
          await page.goto(server.resolvedUrls!.local[0]);
          await page.waitForFunction(() => typeof window.runGym === "function");
          // Playwright evaluate has no execution timeout; bound a hung GPU/driver explicitly.
          let timeout: ReturnType<typeof setTimeout> | undefined;
          const result = await Promise.race([
            page.evaluate((options) => window.runGym(options), {
              scenario: scenario.id,
              seed,
              mode,
              duration,
              warmup,
              checkpoint: values.checkpoint,
              fault: values.fault,
            }),
            new Promise<never>((_, reject) => {
              timeout = setTimeout(
                () => reject(new Error("Browser scenario exceeded 120 seconds")),
                120000,
              );
            }),
          ]).finally(() => clearTimeout(timeout));
          if (logs.length) {
            result.assertions.push({
              checkpoint: "browser",
              name: "no-console-errors",
              pass: false,
              actual: logs.slice(0, 30),
              expected: [],
            });
            if (result.status === "passed") result.status = "failed";
          }
          results.push(result);
          for (const image of result.images ?? []) {
            const name = image.name.replace(/[^a-zA-Z0-9_-]/g, "_");
            await writeFile(
              join(folder, `repeat-${i + 1}-${name}.png`),
              Buffer.from(image.dataUrl.split(",")[1], "base64"),
            );
          }
          delete result.images;
          await writeFile(join(folder, `repeat-${i + 1}.json`), JSON.stringify(result, null, 2));
          await page.screenshot({ path: join(folder, `repeat-${i + 1}.png`) });
          if (result.status === "unsupported" || result.status === "error") break;
        } finally {
          await context.close();
        }
      }
    }
    const worst =
      results.find((r) => r.status === "error" || r.status === "unsupported") ??
      results.find((r) => r.status === "failed") ??
      results[0];
    report.result = {
      ...worst,
      assertions: results.flatMap((r, i) =>
        r.assertions.map((a) => ({
          ...a,
          checkpoint: repeat > 1 ? `repeat-${i + 1}/${a.checkpoint}` : a.checkpoint,
        })),
      ),
      samples: results.map((r, i) => ({ repeat: i + 1, metrics: r.metrics, samples: r.samples })),
      metrics: {},
    };
    for (const key of new Set(results.flatMap((r) => Object.keys(r.metrics)))) {
      const samples = results
        .map((r) => r.metrics[key])
        .filter((v): v is number => typeof v === "number");
      report.result.metrics[key] = summarize(samples).median;
      if (repeat > 1 && samples.length)
        report.result.metrics[`${key}.range`] = Math.max(...samples) - Math.min(...samples);
    }
    fingerprint.capabilities = report.result.capabilities ?? null;
  } catch (error) {
    report.result = { ...report.result, status: "error", error: String(error), samples: results };
  } finally {
    await browser?.close();
    await new Promise<void>((done) => (server ? server.httpServer.close(() => done()) : done()));
  }
  if (source.treeHash !== (await hashFiles([join(repo, "packages"), app], folder))) {
    report.result.status = "error";
    report.result.error = "Source files changed during this run. Rerun on a stable working tree.";
  }
  let code = exitCode(report.result.status);
  let comparison: ReturnType<typeof compareReports> | undefined;
  if (values.baseline) {
    try {
      comparison = compareReports(
        JSON.parse(await readFile(resolve(repo, values.baseline), "utf8")),
        report,
      );
      if (!comparison.comparable) code = code || 2;
    } catch (error) {
      comparison = { comparable: false, reason: `Invalid baseline: ${String(error)}`, deltas: {} };
      code = code || 2;
    }
    await writeFile(join(folder, "comparison.json"), JSON.stringify(comparison, null, 2));
  }
  await writeFile(join(folder, "run.json"), JSON.stringify(report, null, 2));
  const failures = report.result.assertions.filter((a) => !a.pass);
  const summary = [
    `# ${scenario.id}: ${report.result.status}`,
    "",
    `Mode: ${mode}. Exit code: ${code}.`,
    "",
    report.result.error ?? "",
    ...failures
      .slice(0, 40)
      .map(
        (a) =>
          `- ${a.checkpoint}: ${a.name} at ${JSON.stringify(a.coordinates ?? [])}; actual ${JSON.stringify(a.actual)}, expected ${JSON.stringify(a.expected)}, tolerance ${a.tolerance ?? "exact"}`,
      ),
    "",
    "## Reproduce",
    "",
    "```sh",
    repro,
    "```",
    "",
    "Replay the full input prefix; never jump directly into a stateful failing frame.",
    "",
    `Interactive replay: pnpm --filter @hello-terrain/gym dev, then /?scenario=${scenario.id}&seed=${seed}`,
    "",
    comparison ? JSON.stringify(comparison, null, 2) : "",
    "Full assertions, raw samples, metadata and diagnostics: run.json; browser images: repeat-*.png.",
  ].join("\n");
  await writeFile(join(folder, "summary.md"), summary);
  console.log(
    `${scenario.id}: ${report.result.status}; ${failures.length} failed assertions\n${folder}/summary.md\n${folder}/run.json${comparison ? `\nComparison: ${comparison.reason}` : ""}`,
  );
  process.exitCode = code;
}

void main().catch((error) => {
  console.error(String(error));
  process.exitCode = 2;
});
