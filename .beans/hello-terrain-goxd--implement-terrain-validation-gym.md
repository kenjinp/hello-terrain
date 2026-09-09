---
# hello-terrain-goxd
title: Implement terrain validation gym
status: completed
type: feature
priority: normal
created_at: 2026-09-06T20:28:36Z
updated_at: 2026-09-06T21:16:31Z
---

Implement the agreed terrain gym with a capability probe, production React frame driver, analytic flat stationary-edit scenario, CPU oracles, browser correctness/performance modes, comparable JSON artifacts and replay commands, docs and verification.

## Checklist
- [x] Inspect production driver and prove browser capability
- [x] Implement shared scenarios, oracles and report comparison
- [x] Implement browser runner and first end-to-end scenario
- [x] Add isolation/lifecycle and LOD scenario coverage where supported
- [x] Document workflow and validate success, failure and unsupported outcomes


Verification: all six browser scenarios pass on Chromium software WebGPU; 82 terrain tests pass. Gym typecheck, targeted lint and diff checks pass. Render fault exits 1; unsupported and mismatched baseline exit 2. Three-repeat software performance smoke retains workload counters but is refused as a hardware baseline. Physical-GPU performance and hosted CI execution remain environment-specific verification.
