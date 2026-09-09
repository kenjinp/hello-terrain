---
# hello-terrain-06xt
title: Resolve terrain API ownership and readiness contracts
status: draft
type: feature
priority: normal
created_at: 2026-09-06T17:18:23Z
updated_at: 2026-09-06T17:55:31Z
---

Follow-up to hello-terrain-px0d and committee audit hello-terrain-fy7r. Proposals for review, not authorization to implement a redesign.

First establish per-instance uniforms, parameters and default materials; test both multiple terrains and packed consumers with duplicate dependency copies. Choose package identity fixes from evidence. Establish explicit owned/borrowed resource teardown on replacement and shutdown, with pending operations drained or cancelled and late publication prevented.

Publish coherent terrain revisions: elevation, bounds, tile mapping, projection and configuration must correspond. Track content changes independently from topology stamps, submit related GPU copies before awaiting them, and notify raycast/LOD dependents when snapshots publish. Expose render/query readiness, revisions, coverage and actual errors.

Then introduce a framework-neutral terrain definition/runtime contract and one resolved geometry/capacity configuration shared by CPU, GPU and mesh. Treat updates as validated transactions with immutable per-revision config. Unify query displacement units and common position-keyed sampling; distinguish source evaluation, cached field sampling and rendered mesh intersection. Define picking transforms, coverage and approximation guarantees.

Keep React runtime identity stable across rerenders, derive mesh configuration from runtime, and subscribe to status changes. Update React gameplay guards, vanilla setup and query docs alongside adopted API changes. Preserve topology/connectivity and projection/geometry separation; narrow extension integration responsibilities as needed. Move advanced task, storage and shader helpers behind deliberate entry points after runtime contracts settle.

Validate two terrains at different origins, static-camera elevation edits, reconfiguration during readback, repeated mounts, and picking transformed/infinite terrain. Audit findings are source-traced, not runtime-reproduced; missing explicit cleanup does not establish permanent GPU retention.
