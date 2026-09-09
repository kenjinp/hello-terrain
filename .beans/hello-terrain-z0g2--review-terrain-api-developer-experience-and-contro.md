---
# hello-terrain-z0g2
title: Review terrain API developer experience and control-map extensibility
status: completed
type: task
priority: normal
created_at: 2026-09-06T21:17:09Z
updated_at: 2026-09-06T21:27:48Z
---

Completed independent Claude Opus 5 (5f7120e3-c7cc-45c6-971d-36ea46134973) and GPT-6 Astra (e2cbc56a-3fd8-47a3-9d4e-fdf0b04e5021) developer-experience reviews and reconciliation.

Consensus: retain runtime ownership/publication architecture, but specify source and material authoring contracts before freezing API. Ordinary TSL/raw Three textures remain valid for live appearance; optional mapping/weight helpers lower friction. Managed sources add explicit dependencies, input capture/versioned replacement/edit ordering and retirement acknowledgment when terrain production or coherent query data depends on them. Version metadata alone cannot freeze externally mutated texture pixels.

Minimum design changes: TerrainMaterialContext with direct scaled elevation, datum normal and geometric base normal in documented spaces, stable datum/source mapping and correct skirt semantics; SourceMapping distinct from topology, texture ownership, decode and streaming; explicit face selection plus bounded regional coordinates/phase/derivatives for fine planetary detail; source-specific invalidation and accepted-edit freshness targets; preserve user node material composition and compatible identity, independent mapping of shared borrowed textures. Distinguish base vs detail shading normals and verify mapping-correct tangent frames.

Appearance defaults to fragment evaluation, not mandatory baked terrain fields/readback. A source may drive both appearance and geometry; dependency-specific refresh must reuse unaffected geometry. New presentation versions are allowed for appearance edits. Compute texture sampling policy is explicit: mip0 may alias but is not intrinsically source-inconsistent; LOD mip changes are approximation policy. Weight maps, independent masks, categorical IDs and color textures have different semantics; channels/storage do not prescribe meaning.

Defer public generic field/channel snapshot graph, virtual texturing, editor, broad CPU attribute API and owned material/layer engine. Reserve named field/dependency internals and independent source residency. Later CPU attributes may use supported CPU sampling or readback, not automatic arbitrary TSL translation.

DX gate: procedural plane/sphere ordinary TSL; direct elevation/slope masks; painted grass/rock/snow map plus procedural rules with no new graph concepts; stationary appearance edit with zero geometry work/readback; shared map also driving elevation updates declared consumers and query freshness; two terrains share one texture with independent mapping and safe retirement; detail normal composition and material identity across compatible updates; bounded planetary material detail stability.

Reconciliation withdrew mandatory WeightMap/SourceRegion wrappers and generic public snapshots, hard-coded two-counter invalidation, blanket HMR reuse and automatic mip continuity claims. Remaining experimental/product choices: helper scope, managed edit transactions vs versioned replacement, first regional mapping/tangent integration and first queryable attribute.

Analysis only. No code/proposal edits or GPU/browser tests. Current worktree has concurrent implementation changes, so old proposal background evidence needs refreshing when revised.