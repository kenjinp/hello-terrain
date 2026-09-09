---
# hello-terrain-4kl6
title: Verify skirts in refactored terrain rendering
status: completed
type: task
priority: normal
created_at: 2026-09-07T02:50:08Z
updated_at: 2026-09-07T02:57:06Z
---

Inspected skirt geometry and precision vertex paths. Geometry retains a duplicated, clamped outer ring, but the precision path tested coordinates outside the clamped range and therefore never extruded skirts. Fixed flat, sphere, and torus paths to use the existing vertex-index skirt helper. Added a GPU raster regression verifying zero-depth collapse and nonzero-depth walls on all three topologies, and documented it. Validation: six GPU skirt assertions, 14 geometry/skirt unit tests, gym typecheck, library and docs builds, and flat-edit, flat-lod, instance-isolation GPU checks passed. Exact screenshot gaps may also depend on the demo fixed 300-metre depth; follow-up hello-terrain-3drs tracks planetary LOD depth validation.