---
# hello-terrain-7asn
title: Raycast character controller example
status: completed
type: feature
priority: normal
created_at: 2026-03-19T10:36:10Z
updated_at: 2026-03-19T10:38:26Z
---

Implement a reusable Sketchbook-inspired third-person character controller in the docs app using terrain query and terrain raycast APIs.

## Checklist
- [x] Create keyboard input hook
- [x] Create character controller hook
- [x] Create third-person camera hook
- [x] Create character model component
- [x] Create controller orchestrator component
- [x] Create example scene
- [x] Add docs page and navigation
- [x] Run lints/type-check and fix issues

## Notes

- IDE lint diagnostics are clean for the touched files.
- `pnpm --filter @hello-terrain/docs type-check` could not run successfully in this environment because the docs package does not currently have a runnable `tsc` binary available.