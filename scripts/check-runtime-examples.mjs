import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const gymRequire = createRequire(new URL("../apps/gym/package.json", import.meta.url));
const docsRequire = createRequire(new URL("../apps/docs/package.json", import.meta.url));
const { chromium } = gymRequire("playwright");
const { decode } = docsRequire("fast-png");
const baseURL = process.argv[2] ?? "http://127.0.0.1:3100";
const runs = resolve(".gym/runs");
await mkdir(runs, { recursive: true });
const output = await mkdtemp(resolve(runs, "docs-showcase-"));
const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  // Keep Vulkan surface presentation enabled for actual canvas screenshots.
  args: [
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan",
    "--use-angle=swiftshader",
    "--use-vulkan=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.setDefaultTimeout(120000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  for (const route of ["runtime-editing", "material-maps", "multiple-planets"]) {
    console.log(`Checking ${route}`);
    await page.goto(new URL(`/examples/${route}`, baseURL).href);
    await page.locator("[data-showcase-canvas]").scrollIntoViewIfNeeded();
    if (route === "runtime-editing") {
      await page.waitForFunction(() =>
        document.querySelector("[data-edit-status]")?.textContent.includes("4/4 probes placed"),
      );
      const before = await page.locator("[data-edit-status]").textContent();
      await page.getByRole("button", { name: "Flatten terrain" }).click();
      await page.waitForFunction((old) => {
        const text = document.querySelector("[data-edit-status]")?.textContent;
        return text !== old && text?.includes("4/4 probes placed");
      }, before);
      results.push({
        route,
        before,
        after: await page.locator("[data-edit-status]").textContent(),
      });
    } else if (route === "material-maps") {
      await page.waitForFunction(() =>
        /B: geometry edit [0-9]/.test(
          document.querySelector("[data-map-status]")?.textContent ?? "",
        ),
      );
      const before = await page.locator("[data-map-status]").textContent();
      await page.getByRole("button", { name: "Repaint shared map" }).click();
      await page.waitForFunction(() =>
        /Map edit 1 · ready.*A: geometry edit \d+, appearance 1.*B: geometry edit \d+, appearance 1/.test(
          document.querySelector("[data-map-status]")?.textContent ?? "",
        ),
      );
      const after = await page.locator("[data-map-status]").textContent();
      assert.deepEqual(after.match(/geometry edit \d+/g), before.match(/geometry edit \d+/g));
      results.push({ route, before, after });
    } else {
      await page.waitForFunction(() => {
        const entries = [...document.querySelectorAll("[data-planet-status]")];
        return (
          entries.length === 3 &&
          entries.every((entry) => /query edit [0-9]/.test(entry.textContent))
        );
      });
      const before = await page.locator("[data-planet-status]").allTextContents();
      const oldEdit = Number(before[0].match(/query edit (\d+)/)[1]);
      await page.getByRole("slider", { name: "Pelagos relief" }).fill("200000");
      await page.waitForFunction(
        (old) =>
          Number(
            document
              .querySelector('[data-planet-status="Pelagos"]')
              ?.textContent.match(/query edit (\d+)/)?.[1],
          ) > old,
        oldEdit,
      );
      const after = await page.locator("[data-planet-status]").allTextContents();
      assert.deepEqual(
        after.slice(1),
        before.slice(1),
        "Unedited planets must retain their edits and samples",
      );
      results.push({ route, before, after });
    }
    await page.locator("[data-showcase-canvas]").scrollIntoViewIfNeeded();
    await page.waitForTimeout(1000);
    const png = await page
      .locator("[data-showcase-canvas]")
      .screenshot({ path: resolve(output, `${route}.png`) });
    const pixels = decode(png);
    let colored = 0;
    for (let i = 0; i < pixels.data.length; i += pixels.channels) {
      if (pixels.data[i] > 40 || pixels.data[i + 1] > 40 || pixels.data[i + 2] > 40) colored++;
    }
    assert(colored > pixels.width * pixels.height * 0.01, `${route}: canvas appears blank`);
  }
  // Check the planet focus control and a narrower mobile viewport as well.
  await page.getByRole("button", { name: "Ember", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 900 });
  await page.locator("[data-showcase-canvas]").scrollIntoViewIfNeeded();
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    "Mobile page overflows",
  );
  await page.screenshot({ path: resolve(output, "mobile-planets.png") });
  assert.deepEqual(errors, [], "Browser errors");
  await writeFile(
    resolve(output, "results.json"),
    JSON.stringify({ status: "passed", results }, null, 2),
  );
  console.log(`All three examples passed. Screenshots and results: ${output}`);
} finally {
  await browser.close();
}
