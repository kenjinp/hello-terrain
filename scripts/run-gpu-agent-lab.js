#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const DEFAULT_URL = "http://127.0.0.1:3000/agent-gpu-lab";
const DEFAULT_PORT = 9222;
const ORBIT_SURFACE_SCENARIOS = [
  "earth-sphere-orbit-surface-center",
  "earth-sphere-orbit-surface-edge",
  "earth-sphere-orbit-surface-corner",
];

function parseArgs(argv) {
  const args = {
    url: DEFAULT_URL,
    scenario: "flat-sine-smoke",
    warmupFrames: undefined,
    measureFrames: undefined,
    readback: true,
    timeoutMs: 2500,
    computeBudgetMs: undefined,
    overrides: {},
    scenarios: null,
    port: DEFAULT_PORT,
    headless: true,
    launch: true,
    chrome: process.env.HELLO_TERRAIN_CHROME ?? "",
    output: "",
    summary: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--url" && next) {
      args.url = next;
      i += 1;
    } else if (arg === "--scenario" && next) {
      args.scenario = next;
      args.scenarios = null;
      i += 1;
    } else if (arg === "--orbit-surface-suite") {
      args.scenarios = ORBIT_SURFACE_SCENARIOS;
    } else if (arg === "--warmup-frames" && next) {
      args.warmupFrames = Number(next);
      i += 1;
    } else if (arg === "--measure-frames" && next) {
      args.measureFrames = Number(next);
      i += 1;
    } else if (arg === "--timeout-ms" && next) {
      args.timeoutMs = Number(next);
      i += 1;
    } else if (arg === "--budget-ms" && next) {
      args.computeBudgetMs = Number(next);
      i += 1;
    } else if (arg === "--max-nodes" && next) {
      args.overrides.maxNodes = Number(next);
      i += 1;
    } else if (arg === "--inner-tile-segments" && next) {
      args.overrides.innerTileSegments = Number(next);
      i += 1;
    } else if (arg === "--distance-factor" && next) {
      args.overrides.distanceFactor = Number(next);
      i += 1;
    } else if (arg === "--port" && next) {
      args.port = Number(next);
      i += 1;
    } else if (arg === "--chrome" && next) {
      args.chrome = next;
      i += 1;
    } else if (arg === "--output" && next) {
      args.output = next;
      i += 1;
    } else if (arg === "--summary") {
      args.summary = true;
    } else if (arg === "--no-readback") {
      args.readback = false;
    } else if (arg === "--headed") {
      args.headless = false;
    } else if (arg === "--no-launch") {
      args.launch = false;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage: pnpm agent:gpu [options]

Options:
  --url <url>                GPU lab URL (default: ${DEFAULT_URL})
  --scenario <name>          Scenario name: flat-sine-smoke, flat-zero-smoke,
                             earth-sphere-load, earth-sphere-surface-load,
                             earth-sphere-orbit-surface-center,
                             earth-sphere-orbit-surface-edge,
                             earth-sphere-orbit-surface-corner,
                             earth-torus-load, earth-torus-surface-load
                             (default: flat-sine-smoke)
  --orbit-surface-suite      Run center, edge, and corner orbit-to-surface stress scenarios
  --warmup-frames <n>        Warmup graph runs before measuring
                             (default: scenario-specific)
  --measure-frames <n>       Measured graph runs (default: scenario-specific)
  --timeout-ms <n>           Readback wait timeout per frame
  --budget-ms <n>            Assert measured computeMs samples are <= this budget
  --max-nodes <n>            Override scenario maxNodes
  --inner-tile-segments <n>  Override scenario inner tile segment count
  --distance-factor <n>      Override scenario quadtree distance factor
  --port <n>                 Chrome remote debugging port
  --chrome <path>            Chrome/Chromium executable
  --output <path>            Write the full JSON result to a file
  --summary                  Print a compact JSON summary instead of the full result
  --headed                   Launch a visible browser
  --no-launch                Connect to an already-running browser
  --no-readback              Skip direct GPU buffer readback hashes
`);
}

function candidateChromePaths() {
  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ];
  }
  if (process.platform === "win32") {
    return [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    ];
  }
  return ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"];
}

async function fileExists(file) {
  try {
    const { access } = await import("node:fs/promises");
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function resolveChrome(explicitPath) {
  if (explicitPath) return explicitPath;
  for (const candidate of candidateChromePaths()) {
    if (candidate.includes(path.sep)) {
      if (await fileExists(candidate)) return candidate;
      continue;
    }
    return candidate;
  }
  throw new Error("Could not resolve a Chrome executable. Pass --chrome <path>.");
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} from ${url}`);
  }
  return response.json();
}

async function waitForDevTools(port, timeoutMs = 10000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      return await fetchJson(`http://127.0.0.1:${port}/json/version`);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`Timed out waiting for Chrome DevTools: ${lastError}`);
}

async function launchChrome(args) {
  const chrome = await resolveChrome(args.chrome);
  const profileDir = await mkdtemp(path.join(tmpdir(), "hello-terrain-gpu-lab-"));
  const chromeArgs = [
    `--remote-debugging-port=${args.port}`,
    `--user-data-dir=${profileDir}`,
    "--enable-unsafe-webgpu",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ];
  if (args.headless) chromeArgs.unshift("--headless=new");

  const child = spawn(chrome, chromeArgs, {
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr.on("data", (chunk) => {
    const text = String(chunk);
    if (!text.includes("DevTools listening")) process.stderr.write(text);
  });
  await waitForDevTools(args.port);
  return child;
}

class CdpClient {
  constructor(webSocketUrl) {
    this.webSocketUrl = webSocketUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.socket = null;
  }

  async connect() {
    this.socket = new WebSocket(this.webSocketUrl);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => this.handleMessage(event));
    this.socket.addEventListener("close", () => {
      for (const { reject } of this.pending.values()) {
        reject(new Error("CDP socket closed"));
      }
      this.pending.clear();
    });
  }

  handleMessage(event) {
    const message = JSON.parse(String(event.data));
    if (message.id && this.pending.has(message.id)) {
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
      return;
    }
    if (message.method) {
      const listeners = this.listeners.get(message.method);
      if (listeners) for (const listener of listeners) listener(message.params);
    }
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(payload);
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? new Set();
    listeners.add(listener);
    this.listeners.set(method, listeners);
    return () => listeners.delete(listener);
  }

  close() {
    this.socket?.close();
  }
}

function waitForCdpEvent(client, method, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for CDP event ${method}`));
    }, timeoutMs);
    const unsubscribe = client.on(method, (params) => {
      clearTimeout(timeout);
      unsubscribe();
      resolve(params);
    });
  });
}

async function createPage(port, url) {
  const target = await fetchJson(`http://127.0.0.1:${port}/json/new?about:blank`, {
    method: "PUT",
  });
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  const loaded = waitForCdpEvent(client, "Page.loadEventFired");
  await client.send("Page.navigate", { url });
  await loaded;
  return client;
}

async function evaluate(client, expression, timeoutMs = 30000) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    timeout: timeoutMs,
  });
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text ??
        "Runtime.evaluate failed",
    );
  }
  return result.result.value;
}

function roundMs(value) {
  return typeof value === "number" ? Math.round(value * 1000) / 1000 : value;
}

function summarizeStats(stats) {
  if (!stats || typeof stats !== "object") return null;
  return {
    count: stats.count,
    min: roundMs(stats.min),
    max: roundMs(stats.max),
    mean: roundMs(stats.mean),
    p50: roundMs(stats.p50),
    p95: roundMs(stats.p95),
    p99: roundMs(stats.p99),
  };
}

function summarizeComputePasses(result) {
  const samples = Array.isArray(result.frames?.samples) ? result.frames.samples : [];
  const groups = new Map();

  for (const frame of samples) {
    if (!frame?.measured || !Array.isArray(frame.gpu?.computePasses)) continue;
    for (const pass of frame.gpu.computePasses) {
      const name = pass.name ?? "unknown";
      const group =
        groups.get(name) ??
        {
          name,
          count: 0,
          totalMs: 0,
          maxMs: 0,
          dispatchSize: pass.dispatchSize ?? null,
        };
      const durationMs = typeof pass.durationMs === "number" ? pass.durationMs : 0;
      group.count += 1;
      group.totalMs += durationMs;
      group.maxMs = Math.max(group.maxMs, durationMs);
      group.dispatchSize = pass.dispatchSize ?? group.dispatchSize;
      groups.set(name, group);
    }
  }

  return Array.from(groups.values())
    .map((group) => ({
      name: group.name,
      count: group.count,
      totalMs: roundMs(group.totalMs),
      meanMs: roundMs(group.totalMs / Math.max(1, group.count)),
      maxMs: roundMs(group.maxMs),
      dispatchSize: group.dispatchSize,
    }))
    .sort((a, b) => b.totalMs - a.totalMs);
}

function summarizeResult(result) {
  const innerTileSegments = result.terrain?.innerTileSegments;
  const tileVertexCount =
    typeof innerTileSegments === "number" ? innerTileSegments + 3 : null;
  const verticesPerTile =
    typeof tileVertexCount === "number" ? tileVertexCount * tileVertexCount : null;
  const leafCount =
    typeof result.terrain?.leafCount === "number" ? result.terrain.leafCount : null;
  const finalVertexCount =
    typeof leafCount === "number" && typeof verticesPerTile === "number"
      ? leafCount * verticesPerTile
      : null;
  const failedAssertions = Array.isArray(result.assertions)
    ? result.assertions.filter((assertion) => !assertion.pass)
    : [];

  return {
    scenario: result.scenario,
    ok: result.ok,
    measuredFrames: result.measureFrames,
    terrain: {
      surfaceKind: result.terrain?.surfaceKind,
      topologyKind: result.terrain?.topologyKind,
      radius: result.terrain?.radius,
      leafCount,
      leafCapacity: result.terrain?.leafCapacity,
      maxLevel: result.terrain?.maxLevel,
      finalMaxLeafLevel: result.terrain?.levelStats?.max,
      finalLeavesAtMaxLevel: result.terrain?.levelStats?.leavesAtMaxLevel,
      innerTileSegments,
      tileVertexCount,
      verticesPerTile,
      finalVertexCount,
      incremental: result.terrain?.incremental ?? null,
    },
    frames: {
      wallMs: summarizeStats(result.frames?.summary?.wallMs),
      leafCount: summarizeStats(result.frames?.summary?.leafCount),
      maxLeafLevel: summarizeStats(result.frames?.summary?.maxLeafLevel),
      visibleCount: summarizeStats(result.frames?.summary?.incremental?.visibleCount),
      activeSlotCount: summarizeStats(
        result.frames?.summary?.incremental?.activeSlotCount,
      ),
      horizonCulledCount: summarizeStats(
        result.frames?.summary?.incremental?.horizonCulledCount,
      ),
      dirtyVisibleCount: summarizeStats(
        result.frames?.summary?.incremental?.dirtyVisibleCount,
      ),
      visibleRatio: summarizeStats(result.frames?.summary?.incremental?.visibleRatio),
      dirtyVisibleRatio: summarizeStats(
        result.frames?.summary?.incremental?.dirtyVisibleRatio,
      ),
      reuseRatio: summarizeStats(result.frames?.summary?.incremental?.reuseRatio),
      gpuComputeMs: summarizeStats(result.frames?.summary?.gpuComputeMs),
      gpuTotalMs: summarizeStats(result.frames?.summary?.gpuTotalMs),
    },
    computePasses: summarizeComputePasses(result),
    failedAssertions,
  };
}

function summarizeOutput(output) {
  if (Array.isArray(output.results)) {
    return {
      ok: output.ok,
      scenarios: output.results.map((result) => summarizeResult(result)),
    };
  }
  return summarizeResult(output);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let browser = null;
  let client = null;
  try {
    if (args.launch) browser = await launchChrome(args);
    else await waitForDevTools(args.port);

    client = await createPage(args.port, args.url);
    await evaluate(
      client,
      `new Promise((resolve, reject) => {
        const start = Date.now();
        const tick = () => {
          if (window.__helloTerrainAgent?.ready) resolve(true);
          else if (Date.now() - start > 30000) reject(new Error("GPU agent lab did not become ready"));
          else setTimeout(tick, 100);
        };
        tick();
      })`,
      35000,
    );

    const scenarios = args.scenarios ?? [args.scenario];
    const results = [];
    for (const scenario of scenarios) {
      const scenarioInput = {
        scenario,
        warmupFrames: args.warmupFrames,
        measureFrames: args.measureFrames,
        readback: args.readback,
        timeoutMs: args.timeoutMs,
        computeBudgetMs: args.computeBudgetMs,
        overrides: args.overrides,
      };
      const result = await evaluate(
        client,
        `window.__helloTerrainAgent.runScenario(${JSON.stringify(scenarioInput)})`,
        120000,
      );
      results.push(result);
    }

    const output =
      results.length === 1
        ? results[0]
        : {
            ok: results.every((result) => result.ok),
            scenarios: results.map((result) => result.scenario),
            results,
          };
    if (args.output) await writeFile(args.output, `${JSON.stringify(output, null, 2)}\n`);
    console.log(JSON.stringify(args.summary ? summarizeOutput(output) : output, null, 2));
    process.exitCode = output.ok ? 0 : 1;
  } finally {
    try {
      if (client && browser) await client.send("Browser.close");
    } catch {
      // ignore
    }
    client?.close();
    browser?.kill();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
