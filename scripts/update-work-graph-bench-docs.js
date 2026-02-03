import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const ANSI_CSI_RE = new RegExp(String.raw`\x1b\[[0-9;]*[A-Za-z]`, "g");
const ANSI_OSC_RE = new RegExp(String.raw`\x1b\][^\x07]*\x07`, "g");

function stripAnsi(input) {
  // Basic ANSI escape sequence stripping (colors, cursor controls)
  return input.replace(ANSI_CSI_RE, "").replace(ANSI_OSC_RE, "");
}

function filterNoise(text) {
  return text
    .split("\n")
    .filter((line) => !line.startsWith("npm warn Unknown env config "))
    // pnpm/npm script runner banners (not part of benchmark output)
    .filter((line) => !/^>\s*@hello-terrain\/work@.*\bbench\b/.test(line))
    .filter((line) => !/^>\s*npx\s+tsx\b/.test(line))
    .join("\n")
    .trim();
}

function runCmd(cmd, args, { cwd, env }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(cmd, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += String(d)));
    child.stderr.on("data", (d) => (stderr += String(d)));
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else rejectPromise(new Error(`Command failed (${code}): ${cmd} ${args.join(" ")}`));
    });
  });
}

const repoRoot = resolve(process.cwd());
const outPath = resolve(repoRoot, "apps/docs/content/docs/work/benchmarks.mdx");

const { stdout, stderr } = await runCmd(
  "pnpm",
  ["--silent", "--filter", "@hello-terrain/work", "bench"],
  {
    cwd: repoRoot,
    env: {
      // Reduce npm-script runner chatter; benchmark output still prints normally.
      npm_config_loglevel: "silent",
      npm_config_progress: "false",
    },
  },
);

const raw = `${stdout}\n${stderr}`;
const cleaned = filterNoise(stripAnsi(raw));

const generatedAt = new Date().toISOString();
const mdx = `---\n` +
  `title: Benchmarks\n` +
  `description: Mitata benchmarks for graph.run hot loop\n` +
  `---\n\n` +
  `This page is generated from the repo by running:\n\n` +
  `- \`pnpm bench:work:docs\`\n\n` +
  `**Last updated:** ${generatedAt}\n\n` +
  `\`\`\`text\n${cleaned}\n\`\`\`\n`;

await writeFile(outPath, mdx, "utf8");
console.log(`Wrote ${outPath}`);

