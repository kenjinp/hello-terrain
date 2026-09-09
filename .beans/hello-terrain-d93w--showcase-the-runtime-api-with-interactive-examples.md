---
# hello-terrain-d93w
title: Showcase the runtime API with interactive examples
status: completed
type: feature
priority: normal
created_at: 2026-09-07T01:20:23Z
updated_at: 2026-09-07T01:40:02Z
---

Implemented and documented three interactive current-API showcases: independently editable large planets placed one billion metres from origin with binding probes; stationary terrain edits and coherent Float64 snapshot batches; a shared managed control map with independent mappings and appearance-only edits. Added navigation and reusable scripts/check-runtime-examples.mjs. Validation passed: production docs build (86 pages and type validation), CPU flat-edit/flat-lod/instance-isolation smoke scenarios, production Chromium software-WebGPU interactions and nonblank render checks for all scenes, planet isolation assertions, map geometry-preservation assertions, mobile layout check, and git diff --check. Screenshots/results: .gym/runs/docs-showcase-5pisJ3/. Static preview running on port 3100. Preserved existing unrelated implementation changes.