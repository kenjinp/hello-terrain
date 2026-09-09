import { createRequire } from "node:module";
import { resolve } from "node:path";
const { chromium } = createRequire(new URL("../apps/gym/package.json", import.meta.url))(
  "playwright",
);
import { writeFile, mkdir } from "node:fs/promises";
const baseURL = process.argv[2] ?? "http://127.0.0.1:3101";
const out = resolve(process.argv[3] ?? `.gym/runs/planets-profile-${Date.now()}`);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: [
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan",
    "--use-angle=swiftshader",
    "--use-vulkan=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1100 },
  deviceScaleFactor: 1,
});
page.on("pageerror", (e) => console.log("ERROR", String(e)));
await page.addInitScript(() => {
  const p = (window.__profile = { counts: {}, samples: [], mode: "normal", record: false });
  const inc = (n) => {
    if (p.record) p.counts[n] = (p.counts[n] ?? 0) + 1;
  };
  const wrap = (proto, key, name, skip) => {
    if (!proto?.[key]) return;
    const old = proto[key];
    proto[key] = function (...args) {
      inc(name);
      if (skip?.()) return;
      return old.apply(this, args);
    };
  };
  for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext])
    for (const method of [
      "drawArrays",
      "drawElements",
      "drawArraysInstanced",
      "drawElementsInstanced",
    ])
      wrap(C?.prototype, method, "webglDraw", () => p.mode === "no-background");
  for (const method of ["draw", "drawIndexed", "drawIndirect", "drawIndexedIndirect"])
    wrap(
      window.GPURenderPassEncoder?.prototype,
      method,
      "gpuDraw",
      () => p.mode === "no-terrain-draw",
    );
  for (const method of [
    "createRenderPipeline",
    "createRenderPipelineAsync",
    "createComputePipeline",
    "createComputePipelineAsync",
    "createShaderModule",
    "createBuffer",
    "createTexture",
  ])
    wrap(window.GPUDevice?.prototype, method, method);
  for (const method of ["submit", "writeBuffer", "writeTexture", "onSubmittedWorkDone"])
    wrap(window.GPUQueue?.prototype, method, method);
  for (const method of ["dispatchWorkgroups", "dispatchWorkgroupsIndirect"])
    wrap(window.GPUComputePassEncoder?.prototype, method, method);
  wrap(window.GPUBuffer?.prototype, "mapAsync", "mapAsync");
  let last = 0;
  function tick(t) {
    if (p.record && last) p.samples.push(t - last);
    last = t;
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
});
await page.goto(new URL("/examples/multiple-planets", baseURL).href);
await page.waitForFunction(
  () =>
    [...document.querySelectorAll("[data-planet-status]")].length === 3 &&
    [...document.querySelectorAll("[data-planet-status]")].every((e) =>
      /query edit [0-9]/.test(e.textContent),
    ),
  {},
  { timeout: 120000 },
);
await page.locator("[data-showcase-canvas]").scrollIntoViewIfNeeded();
await page.waitForTimeout(3000);
const cdp = await page.context().newCDPSession(page);
await cdp.send("Profiler.enable");
await cdp.send("Performance.enable");
await writeFile(
  out + "/environment.json",
  JSON.stringify(
    {
      browser: browser.version(),
      viewport: { width: 1440, height: 1100 },
      deviceScaleFactor: 1,
      software: true,
      baseURL,
      platform: process.platform,
      arch: process.arch,
    },
    null,
    2,
  ),
);
const summary = [];
const approach = process.argv.includes("--approach");
for (const mode of approach
  ? ["normal", "approach", "near-stationary", "no-terrain-draw"]
  : ["normal", "no-background", "no-terrain-draw", "orbit-no-background"]) {
  await page.evaluate((mode) => {
    window.__profile.mode = mode === "orbit-no-background" ? "no-background" : mode;
  }, mode);
  await page.waitForTimeout(1000);
  const before = await cdp.send("Performance.getMetrics");
  await cdp.send("Profiler.start");
  await page.evaluate(() => {
    Object.assign(window.__profile, { counts: {}, samples: [], record: true });
  });
  if (mode === "approach") {
    await page.getByRole("button", { name: "Pelagos", exact: true }).click();
    const box = await page.locator("[data-showcase-canvas]").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 18; i++) {
      await page.mouse.wheel(0, -60);
      await page.waitForTimeout(350);
    }
  } else if (mode.startsWith("orbit")) {
    const box = await page.locator("[data-showcase-canvas]").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 0; i < 80; i++) {
      await page.mouse.move(box.x + box.width / 2 + Math.sin(i / 20) * 120, box.y + box.height / 2);
      await page.waitForTimeout(100);
    }
    await page.mouse.up();
  } else await page.waitForTimeout(8000);
  const result = await page.evaluate(() => {
    const p = window.__profile;
    p.record = false;
    const s = p.samples.sort((a, b) => a - b);
    return {
      counts: p.counts,
      frames: s.length,
      meanMs: s.reduce((a, b) => a + b, 0) / s.length,
      p50: s[Math.floor(s.length * 0.5)],
      p95: s[Math.floor(s.length * 0.95)],
      over50: s.filter((x) => x > 50).length,
    };
  });
  const after = await cdp.send("Performance.getMetrics");
  const { profile } = await cdp.send("Profiler.stop");
  await writeFile(`${out}/${mode}.cpuprofile`, JSON.stringify(profile));
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  const hits = new Map();
  for (const id of profile.samples ?? []) {
    const n = nodes.get(id);
    const key = n.callFrame.functionName + " " + n.callFrame.url + ":" + n.callFrame.lineNumber;
    hits.set(key, (hits.get(key) ?? 0) + 1);
  }
  const top = [...hits].sort((a, b) => b[1] - a[1]).slice(0, 18);
  const metric = (m, n) => m.metrics.find((x) => x.name === n)?.value ?? 0;
  summary.push({
    mode,
    ...result,
    taskMs: 1000 * (metric(after, "TaskDuration") - metric(before, "TaskDuration")),
    scriptMs: 1000 * (metric(after, "ScriptDuration") - metric(before, "ScriptDuration")),
    top,
  });
  console.log(JSON.stringify(summary.at(-1)));
}
await writeFile(out + "/summary.json", JSON.stringify(summary, null, 2));
await browser.close();
