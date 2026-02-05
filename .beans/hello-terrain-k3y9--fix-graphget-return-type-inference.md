---
# hello-terrain-k3y9
title: Fix Graph.get return type inference
status: completed
type: bug
priority: normal
created_at: 2026-02-05T00:26:07Z
updated_at: 2026-02-05T00:32:18Z
---

TypeScript: Graph.get currently returns unknown in tests (e.g. graph.test.ts:74-77 shows 'av' is unknown). Fix typings so ParamRef/outputs infer correctly, then verify via typecheck/tests.