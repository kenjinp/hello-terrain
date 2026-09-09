---
# hello-terrain-p5dj
title: Design agent terrain validation gym with committee
status: completed
type: task
priority: normal
created_at: 2026-09-06T18:11:20Z
updated_at: 2026-09-06T18:47:22Z
---

Committee completed with Claude Opus 5 and GPT-6-Astra after explicit user approval for repository inspection through both providers.

Consensus: build a small terrain validation gym, with shared scenario definitions, independent numeric oracles, reports and a thin browser adapter. Begin with a bounded WebGPU/Three capability and production-driver spike, then one analytic flat terrain scenario including stationary elevation edits through graph, compute, packing, diagnostic rendering and CPU queries. Reuse production scheduling; a replacement scheduler must not silently diverge.

Correctness uses fixed-step checkpoints with observable completion and bounded timeouts. Realistic performance uses continuous time-based motion, records actual applied poses/missed updates and preserves async scheduling. Report CPU submission/task time, GPU timing only where available, frame-time tails, query latency in milliseconds plus meaningful revision lag, achieved detail and bounded owned-resource growth. Compare matched environments with scenario/configuration/build fingerprints; gate correctness and explicit budgets, not universal exact counters.

Artifacts: JSON verdict and concise report, expected/actual/tolerance per assertion, seed/checkpoint/coordinates and reproduction command, bounded diagnostic snapshots and screenshots. Derive tolerances from numeric format and resolution rather than accepting existing errors. Exit 0 pass, 1 behavior failure, 2 environment/harness failure; unsupported GPU must fail a job that requires GPU.

Expand next to two-instance isolation, disposal/reconfiguration during pending work, LOD/root crossings, then curved seams and feature-specific workloads. Keep pure oracles near packages/three and browser driver in apps/gym; document agent workflow in apps/docs. Existing runtime proposal remains proposed and is not a prerequisite.

Resolved disagreements: broad Node-first suite vs browser-first resolved to minimal vertical GPU slice with Node oracles; fixed poses only vs realistic scheduling resolved to distinct modes; screenshot goldens replaced with numeric render checks and diagnostic screenshots. Cross-tier identical counters, universal path-independent leaves/zero allocations and observationally chosen tolerances were rejected as overly broad. Legacy quadtree benchmark imports removed APIs and needs separate follow-up; no deletion or repair performed here.

No gym implementation changes made.