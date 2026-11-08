---
# hello-terrain-r990
title: Fix capacity-starved datum detail
status: completed
type: bug
priority: normal
created_at: 2026-11-08T06:07:40Z
updated_at: 2026-11-08T06:26:52Z
---

Prioritize nearby terrain refinement while reserving required 2:1 neighbor splits within the existing node budget. Add near-datum sphere and torus regressions, run CPU and GPU validation, preserve unrelated changes.

## Progress

- Replaced depth-first allocation with camera-priority refinement and atomic 2:1 neighbor split closures.
- Preserved canonical leaf ordering and explicitly rebuilt the published CPU/GPU spatial index.
- Added independent neighbor-balance, local-detail, budget, coverage, determinism, and negative-root tests.
- Independent review found and verified the spatial-index correction; final algorithm review has no further blockers.
- Workspace tests pass: work 70, three 155, React 5, gym 14. Typecheck passes. Lint has zero errors and nine existing warnings.
- Production build passes. Final CPU gym flat-edit, flat-lod and instance-isolation pass.
- GPU L14 validation: 588 samples, zero errors, coherent revisions, complete coverage and neighbor delta at most one. Near-datum camera tiles reach L14.
- Compared matched oblique views at 30m actual terrain clearance at L14, L16 and L18. L16 is visually cleaner, but the user explicitly requested approximately one metre at highest LOD, so selected L18 defaults (~0.797m sphere / ~1.038m torus). L18 source banding remains a stated limitation.
- Intermediate L16 GPU evidence: sphere 29.993m clearance / 3.187m spacing; torus 30.001m / 4.153m. Exact coverage, local L16, neighbor delta at most one, coherent revisions, zero GPU/browser errors.
- One-context supporting settled timings (10 samples): sphere wall 3.3ms / GPU 0.511ms; torus wall 3.6ms / GPU 0.424ms. These are cached draw frames, not transition latency.
- Full L14 validation contains 588 timed samples; L18 comparison contains 462. Artifacts and caveats: .gym/earth-datum18-bench/REPORT.md, .gym/earth-datum-cap-visual/run-1794118747583.
- Limits: authored NOAA color is smooth at these locations; no new source frequencies or texturing added. A short torus seam and subtle shading artifacts persist at all tested caps. This fixes capacity-starved coarse geometry, not every source/edge precision artifact. Tests use isolated production renderer and actual scene shaders, not complete Docs interaction.

- Latest user direction: approximately one-metre resolution at highest LOD. Both scenes now default to L18; node capacity, segment count, all 13 source octaves and terrain appearance parameters remain unchanged.
- Evaluated direct normalized source coordinates to avoid Earth-scale multiply/divide rounding. GPU validation passed (462 samples); heights differed by millimetres/centimetres but visible banding remained. Did not ship this unproven mapping change.
- Final L18 evidence: 30m actual clearance gives sphere 0.7968m and torus 1.0382m nominal spacing. All 462 samples have complete coverage, balanced neighbors and coherent revisions. No GPU/browser errors.

- Final shipped L18 configuration passes all workspace tests (70 work / 155 three / 5 React / 14 gym), full typecheck, lint (zero errors; nine existing warnings), and complete production build.
