---
# hello-terrain-8wob
title: Design terrain runtime architecture in Markdown
status: completed
type: task
priority: normal
created_at: 2026-09-06T18:14:22Z
updated_at: 2026-09-06T18:22:50Z
---

Created packages/three/spec/terrain-runtime-proposal.md and linked it from the spec README. User approved Markdown in place of the unavailable DOCX workflow. Preserved the original System Design reference and used its 12-section structure.

The proposal addresses committee audit hello-terrain-fy7r with instance ownership, a renderer-independent core and explicit Three adapter, local/world coordinate contracts, transactional configuration, coherent production/snapshot revisions, bounded readback and leased snapshots, resource disposal, typed runtime/query API sketches, React lifecycle, projection/stage extension contracts, error/budget diagnostics, alternatives, open experiments, validation scenarios, and phased adoption. Includes apps/docs migration mapping. Existing APIs and published docs remain unchanged; the proposal is explicitly not implemented.

Validation: oxfmt check and git diff whitespace check passed; Markdown rendered to /tmp/hello-terrain-runtime-proposal.html with the installed unified/GFM stack. Verified 12 template sections, 8 tables, 6 code blocks and all 23 local links. No runtime tests were needed for documentation-only changes; browser/GPU tests are specified as implementation acceptance criteria.
