# Hello Terrain documentation

The Next.js/Fumadocs application serves current terrain and Work API guides plus interactive examples.

From the repository root:

```sh
pnpm --filter @hello-terrain/work build
pnpm --filter @hello-terrain/three build
pnpm --filter @hello-terrain/react build
pnpm --filter @hello-terrain/docs dev
```

Content lives in `content/docs/`; navigation is defined by adjacent `meta.json` files. Interactive scenes live in `src/examples/`. `src/lib/source.ts` loads MDX and `source.config.ts` configures compilation.

Validate changes with `pnpm --filter @hello-terrain/docs typecheck` and `pnpm --filter @hello-terrain/docs build`. Builds fetch configured web fonts; on hosts with broken IPv6 routing, `NODE_OPTIONS=--dns-result-order=ipv4first` selects IPv4 first.

Document implemented APIs, preserve explicit coverage/precision limits, and keep examples consistent with exported package types. Terrain application examples use the runtime and binding APIs. The independent Work package has its own graph reference under `/work`.

See `content/docs/docs/terrain-gym.mdx` for browser and CPU terrain validation.

The runtime API showcase lives in `src/examples/runtime/`: multiple large planets, stationary edits with snapshot queries, and shared material control maps. With the docs served locally, run `node scripts/check-runtime-examples.mjs http://127.0.0.1:3100` from the repository root. The check uses the gym's installed Chromium and software WebGPU, exercises the controls, checks instance isolation and appearance-only edits, and saves screenshots under `.gym/runs/`. Prefer the production export for this check; development hot reload can trigger unrelated docs-shell hydration diagnostics.
