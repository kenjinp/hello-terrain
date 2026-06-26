#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const DEFAULT_URL = "http://127.0.0.1:3000/agent-gpu-lab";
const DEFAULT_PORT = 9222;

function parseArgs(argv) {
  const args = {
    url: DEFAULT_URL,
    scenario: "flat-sine-smoke",
    warmupFrames: 4,
    measureFrames: 8,
    readback: true,
    timeoutMs: 2500,
    port: DEFAULT_PORT,
    headless: true,
    launch: true,
    chrome: process.env.HELLO_TERRAIN_CHROME ?? "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--url" && next) {
      args.url = next;
      i += 1;
    } else if (arg === "--scenario" && next) {
      args.scenario = next;
      i += 1;
    } else if (arg === "--warmup-frames" && next) {
      args.warmupFrames = Number(next);
      i += 1;
    } else if (arg === "--measure-frames" && next) {
      args.measureFrames = Number(next);
      i += 1;
    } else if (arg === "--timeout-ms" && next) {
      args.timeoutMs = Number(next);
      i += 1;
    } else if (arg === "--port" && next) {
      args.port = Number(next);
      i += 1;
    } else if (arg === "--chrome" && next) {
      args.chrome = next;
      i += 1;
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
                             earth-torus-load, earth-torus-surface-load
                             (default: flat-sine-smoke)
  --warmup-frames <n>        Warmup graph runs before measuring
  --measure-frames <n>       Measured graph runs
  --timeout-ms <n>           Readback wait timeout per frame
  --port <n>                 Chrome remote debugging port
  --chrome <path>            Chrome/Chromium executable
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

    const scenarioInput = {
      scenario: args.scenario,
      warmupFrames: args.warmupFrames,
      measureFrames: args.measureFrames,
      readback: args.readback,
      timeoutMs: args.timeoutMs,
    };
    const result = await evaluate(
      client,
      `window.__helloTerrainAgent.runScenario(${JSON.stringify(scenarioInput)})`,
      120000,
    );
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
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
