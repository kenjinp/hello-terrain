#!/usr/bin/env node
/**
 * Validation Gym CDP runner (spec/validation-gym.md).
 *
 * Launches Chrome (real or software WebGPU), opens the /gym page, runs
 * scenarios through `window.__helloTerrainGym`, and exits non-zero if any
 * invariant was violated. Writes the full JSON results as an artifact.
 *
 *   pnpm gym                                # smoke: surface-walk
 *   pnpm gym -- --suite                     # all scenarios
 *   pnpm gym -- --scenario teleport-shock --seed 99 --headed
 *   pnpm gym -- --software-webgpu           # SwiftShader (CI)
 */
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

const DEFAULT_URL = "http://127.0.0.1:3000/gym";

function parseArgs(argv) {
  const args = {
    url: process.env.HELLO_TERRAIN_GYM_URL ?? DEFAULT_URL,
    scenarios: null, // null => default smoke scenario
    suite: false,
    seed: null,
    frames: null,
    port: 9223,
    chrome: process.env.HELLO_TERRAIN_CHROME ?? "",
    headless: true,
    softwareWebgpu: false,
    output: "",
    timeoutMs: 10 * 60 * 1000,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--url" && next) args.url = argv[(i += 1)];
    else if (arg === "--scenario" && next) {
      args.scenarios = [...(args.scenarios ?? []), argv[(i += 1)]];
    } else if (arg === "--suite") args.suite = true;
    else if (arg === "--seed" && next) args.seed = Number(argv[(i += 1)]);
    else if (arg === "--frames" && next) args.frames = Number(argv[(i += 1)]);
    else if (arg === "--port" && next) args.port = Number(argv[(i += 1)]);
    else if (arg === "--chrome" && next) args.chrome = argv[(i += 1)];
    else if (arg === "--headed") args.headless = false;
    else if (arg === "--software-webgpu") args.softwareWebgpu = true;
    else if (arg === "--output" && next) args.output = argv[(i += 1)];
    else if (arg === "--timeout-ms" && next) args.timeoutMs = Number(argv[(i += 1)]);
    else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      printUsage();
      process.exit(2);
    }
  }
  return args;
}

function printUsage() {
  console.log(`Usage: pnpm gym [-- options]

  --url <url>          Gym page URL (default: ${DEFAULT_URL})
  --scenario <name>    Scenario to run (repeatable; default: surface-walk)
  --suite              Run every scenario the page lists
  --seed <n>           Seed override (applies to every selected scenario)
  --frames <n>         Frame-count override (shorter smoke runs)
  --headed             Launch a visible browser (watch the run)
  --software-webgpu    SwiftShader WebGPU (no GPU required; CI)
  --chrome <path>      Chrome/Chromium executable
  --port <n>           Chrome remote debugging port (default: 9223)
  --output <path>      Write full JSON results to a file
  --timeout-ms <n>     Per-scenario timeout (default: 600000)
`);
}

function candidateChromePaths() {
  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
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
    return candidate; // PATH-resolved name on Linux.
  }
  throw new Error("Could not locate Chrome. Pass --chrome <path>.");
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return response.json();
}

async function waitForDevTools(port, timeoutMs = 15000) {
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
  const profileDir = await mkdtemp(path.join(tmpdir(), "hello-terrain-gym-"));
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
  if (args.softwareWebgpu) {
    chromeArgs.unshift(
      "--use-webgpu-adapter=swiftshader",
      "--enable-features=Vulkan",
      "--disable-vulkan-surface",
      "--no-sandbox",
    );
  }
  if (args.headless) chromeArgs.unshift("--headless=new");

  const child = spawn(chrome, chromeArgs, { stdio: ["ignore", "ignore", "pipe"] });
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

async function waitForGymReady(client, timeoutMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const state = await evaluate(
      client,
      `(() => {
        const gym = window.__helloTerrainGym;
        if (!gym) return "missing";
        return gym.ready ? "ready" : "initializing";
      })()`,
    );
    if (state === "ready") return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    "Gym page never became ready (WebGPU unavailable? Check the page status at the gym URL).",
  );
}

function summarize(result) {
  const failing = result.invariants.filter((invariant) => !invariant.pass);
  const flag = result.ok ? "PASS" : "FAIL";
  const detail = failing.length
    ? ` [${failing.map((invariant) => `${invariant.name}×${invariant.violationCount}`).join(", ")}]`
    : "";
  return `${flag} ${result.scenario} seed=${result.seed} frames=${result.frames} wall=${result.wallTimeMs}ms${detail}`;
}

async function main() {
  const args = parseArgs(process.argv);
  const chromeProcess = await launchChrome(args);
  let client = null;
  const results = [];
  let exitCode = 0;

  try {
    client = await createPage(args.port, args.url);
    await waitForGymReady(client);

    const available = await evaluate(client, "window.__helloTerrainGym.listScenarios()");
    const names = args.suite
      ? available.map((scenario) => scenario.name)
      : (args.scenarios ?? ["surface-walk"]);

    for (const name of names) {
      const options = {};
      if (args.seed !== null) options.seed = args.seed;
      if (args.frames !== null) options.frames = args.frames;
      process.stdout.write(`running ${name}...\n`);
      const result = await evaluate(
        client,
        `window.__helloTerrainGym.run(${JSON.stringify(name)}, ${JSON.stringify(options)})`,
        args.timeoutMs,
      );
      results.push(result);
      process.stdout.write(`${summarize(result)}\n`);
      if (!result.ok) {
        exitCode = 1;
        const repro = `${args.url}?scenario=${encodeURIComponent(name)}&seed=${result.seed}&autorun=1`;
        process.stdout.write(`  repro (headed): ${repro}\n`);
        for (const violation of result.violations.slice(0, 10)) {
          process.stdout.write(
            `  [frame ${violation.frame}] ${violation.invariant}: ${violation.message}\n`,
          );
        }
      }
    }
  } finally {
    client?.close();
    chromeProcess.kill();
  }

  if (args.output) {
    await writeFile(args.output, JSON.stringify({ results }, null, 2));
    process.stdout.write(`wrote ${args.output}\n`);
  }
  process.exit(exitCode);
}

main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exit(2);
});
