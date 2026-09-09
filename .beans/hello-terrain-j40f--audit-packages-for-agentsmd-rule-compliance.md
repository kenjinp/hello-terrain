---
# hello-terrain-j40f
title: Audit packages for AGENTS.md rule compliance
status: completed
type: task
priority: normal
created_at: 2026-09-04T16:32:44Z
updated_at: 2026-09-04T16:47:14Z
---

Thorough audit of packages/three/src, packages/react/src, and packages/work/src against AGENTS.md rules.

## Checklist
- [x] A. Every class declaration (consumer-facing vs not)
- [x] B. Every three.js import, flag pure-logic dirs
- [x] C. Module-scope mutable / shared scratch state
- [x] D. Naming violations (Task, displayName, heightmap*, Surface vs Topology)
- [x] E. TODO/FIXME/HACK/XXX/ts-ignore/as any/eslint-disable comments

Report delivered with path:line references; no source files modified.