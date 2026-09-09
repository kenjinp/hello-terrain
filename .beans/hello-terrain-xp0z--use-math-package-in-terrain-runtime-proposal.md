---
# hello-terrain-xp0z
title: Use math package in terrain runtime proposal
status: completed
type: task
priority: normal
created_at: 2026-09-06T19:32:04Z
updated_at: 2026-09-06T19:35:39Z
---

Updated packages/three/spec/terrain-runtime-proposal.md to use math@1.0.0-canary-37519dcd-20260903 as the selected direct CPU math dependency. Verified exact npm metadata and published tarball declarations without installing or executing package scripts.

Replaced bespoke Vec3 with imports from math; selected package vectors/matrices/quaternions and math/shapes bounds/helpers; changed raycast input to origin/direction Vec3 arguments because the selected version exports no standalone Ray type. Documented tuple ownership, output-first operations, per-instance scratch, float64 batch adapters, explicit Three matrix/vector conversions, fromArray result assignment, CPU/TSL boundary, version pinning, and migration/validation guidance.

Validation: package declaration names and signatures inspected, oxfmt check and git diff whitespace check passed, local links checked, obsolete vector/ray signatures removed. Proposal-only change; no dependency manifests or runtime code modified.
