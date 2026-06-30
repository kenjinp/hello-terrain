---
# hello-terrain-ip94
title: Refactor occlusion to projection injection
status: completed
type: task
priority: normal
created_at: 2026-06-27T22:13:14Z
updated_at: 2026-06-27T22:21:29Z
---

Remove projection-kind switching from terrain visibility occlusion, move occlusion capability behind projection dependency injection, and update spec/docs guidance so future agents follow the no-internal-switching principle.

## Checklist

- [x] Inspect projection interfaces and occlusion/visibility call sites.
- [x] Add projection-provided occlusion capability and refactor visibility to use it.
- [x] Update specs/docs to state the no internal projection switching principle.
- [x] Run focused type/tests/lint checks.
- [x] Record results and complete the bean.

## Verification

- `CI=true pnpm --filter @hello-terrain/three run typecheck`
- `CI=true pnpm --filter @hello-terrain/three exec vitest run src/quadtree/visibility.test.ts src/quadtree/tileSlotCache.test.ts`
- `CI=true pnpm --filter @hello-terrain/docs run typecheck`
- `CI=true pnpm exec oxlint packages/three/src/projection/types.ts packages/three/src/projection/cubeSphere.ts packages/three/src/quadtree/visibility.ts packages/three/src/quadtree/visibility.test.ts packages/three/src/quadtree/types.ts`
- `CI=true pnpm --filter @hello-terrain/docs run build`
- `git diff --check`
- `beans check`
