---
# hello-terrain-aybw
title: ""
status: completed
type: task
priority: normal
created_at: 2026-02-02T00:42:09Z
updated_at: 2026-02-02T00:42:11Z
---

# hello-terrain-aybw
title: Add tests for DAG
status: in-progress
type: task
created_at: 2026-02-02T00:36:54Z
updated_at: 2026-02-02T00:36:54Z
---

Create unit tests for `packages/work/src/dag/dag.ts`.

## Checklist
- [x] Inspect `dag.ts` API and current behavior
- [x] Match existing test framework/style in `packages/work`
- [x] Add comprehensive DAG tests (happy paths + edge cases)
- [x] Run DAG tests via `pnpm -C packages/work exec vitest run src/dag/dag.test.ts` (did not address unrelated failures)