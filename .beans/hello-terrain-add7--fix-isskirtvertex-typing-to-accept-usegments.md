---
# hello-terrain-add7
title: Fix isSkirtVertex typing to accept uSegments
status: completed
type: bug
priority: normal
created_at: 2026-01-27T04:30:12Z
updated_at: 2026-01-27T04:59:33Z
---

TypeScript error in docs example calling `isSkirtVertex(uniforms.uSegments)`: "Expected 0 arguments, but got 1".

## Checklist
- [x] Locate `isSkirtVertex` definition/export in `packages/three`
- [x] Fix its TypeScript signature so passing `uSegments` (Node/Uniform) is accepted
- [x] Verify build (`pnpm -F three build`)
- [x] Verify consumer typing via minimal compile using modern TypeScript (`pnpm --package=typescript@latest dlx tsc ...`)