---
# hello-terrain-q9ni
title: Document work graph + publish bench results
status: in-progress
type: task
created_at: 2026-02-02T23:26:45Z
updated_at: 2026-02-02T23:26:45Z
---

Update docs for `@hello-terrain/work` graph runtime changes (DAG id-keyed topology, `cache:"none"` semantics, `dispose()`, perf optimizations) and add an automated way to publish mitata benchmark output into the docs site.

## Checklist
- [x] Find existing docs locations for work/graph
- [x] Update `packages/work/README.md` with new APIs + bench usage
- [x] Add docs page that includes latest Graph bench output
- [x] Add script to run bench and write docs page (strip ANSI)
- [ ] Run the script and ensure docs page renders/builds
- [ ] Run work tests/lints