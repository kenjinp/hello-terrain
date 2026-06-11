---
# hello-terrain-gbm3
title: Fix broken docs type-check script
status: todo
type: bug
created_at: 2026-06-10T02:28:34Z
updated_at: 2026-06-10T02:28:34Z
---

apps/docs 'type-check' runs 'tsc --noEmit' but typescript is not a dependency of the docs app, so npx resolves a fake tsc (or an outdated one that cannot parse moduleResolution: bundler and chokes on src/components/Metrics/Metrics.tsx generics). Pre-existing; discovered during the CPU/GPU dedupe refactor verification. Add typescript as a devDependency (workspace @config/typescript) or point the script at the workspace tsc.