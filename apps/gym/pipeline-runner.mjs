#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { cpus, platform, release } from 'node:os';
import { dirname, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

function distribution(values) {
    if (!values.length || values.some(v => typeof v !== 'number' || !Number.isFinite(v)))
        return { count: values.length, available: false };
    const sorted = [...values].sort((a, b) => a - b);
    const percentile = p => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
    return { count: sorted.length, available: true, min: sorted[0], median: percentile(0.5),
        p95: percentile(0.95), p99: percentile(0.99), max: sorted.at(-1),
        mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length };
}

async function bounded(promise, timeoutMs) {
    let timer;
    try {
        return await Promise.race([promise, new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('Pipeline evaluation timed out after ' + timeoutMs + ' ms')), timeoutMs);
        })]);
    } finally { clearTimeout(timer); }
}

function summarize(result) {
    return Object.fromEntries(['lod', 'edit'].map(kind => {
        const samples = result.samples.filter(s => s.phase === 'measured' && s.kind === kind);
        const metrics = Object.fromEntries(['wallMs', 'updateMs', 'gpuEnvelopeMs'].map(key =>
            [key, distribution(samples.map(s => s[key]))]));
        return [kind, { ...metrics, fidelityPassed: result.status === 'passed',
            under2msAtP99: result.status === 'passed' && result.timestampSupported === true && result.adapter != null && samples.length > 0
                && metrics.wallMs.available && metrics.wallMs.p99 < 2
                && metrics.gpuEnvelopeMs.available && metrics.gpuEnvelopeMs.p99 < 2 }];
    }));
}

async function main() {
    const { values } = parseArgs({ options: {
        url: { type: 'string' }, executable: { type: 'string' }, out: { type: 'string' },
        blocks: { type: 'string', default: '3' }, samples: { type: 'string', default: '20' },
        warmup: { type: 'string', default: '4' }, segments: { type: 'string', default: 'both' },
        scheduling: { type: 'string', default: 'serial' },
        'timeout-ms': { type: 'string', default: '180000' },
        width: { type: 'string', default: '640' }, height: { type: 'string', default: '480' },
        label: { type: 'string', default: 'unlabeled' }, 'source-hash': { type: 'string' },
        'browser-arg': { type: 'string', multiple: true }, headed: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
    } });
    if (values.help) {
        console.log(`Usage: node apps/gym/pipeline-runner.mjs --url http://127.0.0.1:4173 --out NEW_DIRECTORY
  [--executable INSTALLED_BROWSER] [--blocks 3] [--samples 20] [--warmup 4]
  [--segments 13|61|both] [--width 640] [--height 480] [--label baseline]
  [--source-hash VERIFIED_BUILD_SOURCE_HASH] [--browser-arg=FLAG] [--headed]
  [--timeout-ms 180000] [--scheduling serial|publication-overlap|publication-retirement-fence]
Requires an already-running production server exporting window.runPipelineBench.
Uses installed playwright; TERRAIN_PLAYWRIGHT_MODULE may name an absolute installed
playwright or playwright-core package directory/entry (useful on Windows).
Creates NEW_DIRECTORY exclusively. Never builds, installs browsers, or changes runtime.
Exit 0: all correctness checks pass; 1: correctness failure; 2: harness/unsupported error.
A successful exit does not mean the workload meets the 2 ms budget.`);
        return;
    }
    if (!values.url || !values.out) throw new Error('--url and --out are required');
    const url = new URL(values.url);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('--url must use HTTP(S)');
    const number = (key, min) => {
        const value = Number(values[key]);
        if (!Number.isInteger(value) || value < min) throw new Error(`Invalid --${key}`);
        return value;
    };
    const config = { blocks: number('blocks', 1), samples: number('samples', 1),
        warmup: number('warmup', 0), timeoutMs: number('timeout-ms', 1), width: number('width', 1), height: number('height', 1),
        scheduling: values.scheduling,
        segments: values.segments === 'both' ? [13, 61] : [Number(values.segments)] };
    if (!config.segments.every(v => v === 13 || v === 61)) throw new Error('--segments must be 13, 61, or both');
    if (!['serial', 'publication-overlap', 'publication-retirement-fence'].includes(config.scheduling)) throw new Error('--scheduling must be serial, publication-overlap, or publication-retirement-fence');
    const modulePath = process.env.TERRAIN_PLAYWRIGHT_MODULE;
    if (modulePath && !isAbsolute(modulePath)) throw new Error('TERRAIN_PLAYWRIGHT_MODULE must be absolute');
    const require = createRequire(import.meta.url);
    const { chromium } = require(modulePath || 'playwright');
    const out = resolve(values.out);
    await mkdir(dirname(out), { recursive: true });
    await mkdir(out); // Deliberately rejects an existing directory; no report overwrites.
    const save = (name, value) => writeFile(resolve(out, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
    const app = dirname(fileURLToPath(import.meta.url));
    let localCheckoutCommit = null;
    try { localCheckoutCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: app, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
    const args = ['--enable-unsafe-webgpu', ...(values['browser-arg'] ?? [])];
    const report = { schemaVersion: 1, startedAt: new Date().toISOString(), label: values.label,
        url: url.href, config, declaredBuildSourceHash: values['source-hash'] ?? null,
        localCheckoutCommit, provenanceNote: 'Local checkout commit is metadata only, not proof of served build. Served script hashes are recorded per context.',
        host: { platform: platform(), release: release(), architecture: process.arch, cpu: cpus()[0]?.model ?? null, node: process.version },
        browser: null, launch: { executable: values.executable ?? 'Playwright installed default', headless: !values.headed, args },
        runs: [], error: null };
    let browser;
    try {
        browser = await chromium.launch({ executablePath: values.executable, headless: !values.headed, args });
        report.browser = browser.version();
        for (let block = 0; block < config.blocks; block++) {
            // Alternate workload ordering to reduce order/thermal bias.
            const segments = block % 2 ? [...config.segments].reverse() : config.segments;
            for (const segment of segments) {
                const context = await browser.newContext({ viewport: { width: config.width, height: config.height } });
                const page = await context.newPage();
                const consoleErrors = [], pageErrors = [], scriptRequests = [];
                page.on('pageerror', error => pageErrors.push(error.stack ?? error.message));
                page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
                page.on('response', response => {
                    if (response.request().resourceType() === 'script')
                        scriptRequests.push((async () => {
                            try { return { url: response.url(), status: response.status(),
                                sha256: createHash('sha256').update(await response.body()).digest('hex') }; }
                            catch (error) { return { url: response.url(), error: String(error) }; }
                        })());
                });
                const name = `block-${block + 1}-segments-${segment}`;
                try {
                    await page.goto(url.href, { waitUntil: 'networkidle', timeout: 60000 });
                    await page.waitForFunction(() => typeof window.runPipelineBench === 'function', { }, { timeout: 30000 });
                    const environment = await page.evaluate(() => ({ userAgent: navigator.userAgent,
                        hardwareConcurrency: navigator.hardwareConcurrency, devicePixelRatio, crossOriginIsolated }));
                    const startedAt = new Date().toISOString();
                    const result = await bounded(page.evaluate(options => window.runPipelineBench(options),
                        { segments: segment, width: config.width, height: config.height, samples: config.samples, warmup: config.warmup, scheduling: config.scheduling }), config.timeoutMs);
                    // Older serial builds may omit this field; an overlap
                    // request must never silently measure an older serial server.
                    if ((result.config?.scheduling ?? 'serial') !== config.scheduling)
                        throw new Error('Served harness did not execute requested scheduling mode');
                    const record = { block: block + 1, segments: segment, startedAt,
                        completedAt: new Date().toISOString(), environment, servedScripts: await Promise.all(scriptRequests),
                        pageErrors, consoleErrors, result };
                    await save(name + '.json', record);
                    const unsupported = result.timestampSupported !== true || result.adapter == null;
                    const effectiveStatus = unsupported ? 'unsupported'
                        : result.status !== 'passed' || pageErrors.length || consoleErrors.length ? 'failed' : 'passed';
                    const summary = summarize({ ...result, status: effectiveStatus });
                    report.runs.push({ file: name + '.json', block: block + 1, segments: segment,
                        status: effectiveStatus, adapter: result.adapter, timestampSupported: result.timestampSupported,
                        failures: result.failures, pageErrors, consoleErrors, summary });
                    console.log(JSON.stringify({ name, status: effectiveStatus, summary }));
                    if (unsupported) process.exitCode = 2;
                    else if (effectiveStatus !== 'passed' && process.exitCode !== 2) process.exitCode = 1;
                } catch (error) {
                    await context.close(); // Stop a timed-out evaluate before reporting it.
                    await save(name + '-error.json', { block: block + 1, segments: segment,
                        error: error.stack ?? String(error), pageErrors, consoleErrors, servedScripts: await Promise.all(scriptRequests) });
                    throw error;
                } finally { await context.close(); }
            }
        }
    } catch (error) {
        report.error = error.stack ?? String(error);
        process.exitCode = 2;
    } finally {
        try { await browser?.close(); }
        catch (error) { report.error ??= error.stack ?? String(error); process.exitCode = 2; }
        report.completedAt = new Date().toISOString();
        await save('run.json', report);
        const lines = ['# Complete terrain pipeline benchmark', '',
            `Label: ${report.label}`, `Scheduling: ${config.scheduling}`, `Browser: ${report.browser ?? 'unavailable'}`,
            `Resolution: ${config.width} x ${config.height}; samples per scenario: ${config.samples}; warmup: ${config.warmup}`, '',
            'Times in milliseconds; each block has its own distribution. No pass-duration sums or cold/warm pooling.',
            'Full wall time includes both completed update/readback and draw. In publication scheduling modes GPU envelope ends at draw and may exclude later readback/query completion; it is not the complete-pipeline latency.', ''];
        for (const run of report.runs) for (const [kind, summary] of Object.entries(run.summary)) {
            lines.push(`## Block ${run.block}, segments ${run.segments}, ${kind}`);
            for (const metric of ['wallMs', 'updateMs', 'gpuEnvelopeMs']) {
                const d = summary[metric];
                lines.push(d.available ? `- ${metric}: median ${d.median.toFixed(3)}, p95 ${d.p95.toFixed(3)}, p99 ${d.p99.toFixed(3)}, max ${d.max.toFixed(3)} (n=${d.count})` : `- ${metric}: unavailable`);
            }
            lines.push(`- Correctness: ${run.status}; under 2 ms at p99 (wall and GPU envelope): ${summary.under2msAtP99}`, '');
        }
        if (report.error) lines.push('Harness error: ' + report.error);
        lines.push('Results apply only to the recorded bounded workload and hardware. Inspect raw correctness, revisions, geometry, pixels and source hashes before comparing performance.');
        await writeFile(resolve(out, 'summary.md'), lines.join('\n') + '\n', { flag: 'wx' });
        console.log(`Reports: ${out}`);
    }
}
main().catch(error => { console.error(error.stack ?? error); process.exitCode = 2; });
