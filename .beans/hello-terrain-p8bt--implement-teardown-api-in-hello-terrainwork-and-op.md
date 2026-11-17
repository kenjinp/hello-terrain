---
# hello-terrain-p8bt
title: Implement teardown API in @hello-terrain/work and open PR
status: completed
type: feature
priority: normal
created_at: 2026-11-17T19:12:36Z
updated_at: 2026-11-17T20:04:29Z
---

Turn the teardown prototype (local, not in the repository) into the final design and open a PR against main.

## Checklist
- [x] Final API names and cuts in src (teardown, dispose helper, ctx.scope, teardownPrevious, typed work(prev), teardown:* events, options reduced to schedule/timeoutMs, graph asyncDispose, meta.teardown.held)
- [x] Close cascade re-scheduling gap
- [x] managed() on a subpath
- [x] Tests ported to final names, reviewer repros moved into src
- [x] apps/docs updated
- [x] Typecheck, tests, lint, build pass
- [x] Branch from main, commit, push, open PR

## Summary of Changes

- `packages/work/src`: `.teardown(fn)`, `dispose` helper, `ctx.scope.{use,adopt,defer}`, `ctx.teardownPrevious()` (dependents are re-scheduled in the same run), typed `work(prev)`, `graph({ teardown: { schedule, timeoutMs } })`, `g.settled()`, async `g.dispose()`, `g[Symbol.asyncDispose]`, `g.use()` leases, `teardown:finish` / `teardown:error` events, `meta.teardown` counters, `TeardownTimeoutError`, and `managed()` on the `@hello-terrain/work/managed` subpath.
- Tests: 11 files, 122 tests.
- Docs: new `work/teardown` page, `task.mdx`, `graph.mdx`, `index.mdx`, package README.
- Hot path: a regression on recomputing tasks without a teardown was found with the mitata bench and removed (no per-run Sets in the compiled scheduler, `run` is not an async function, `ctx.scope` is a plain property, the invalidation hook is passed as an argument instead of being stored on the run context).

## Not done (follow-ups)

- Terminal `dispose()`, deadlock detection for `dispose()`/`settled()` awaited inside a task or lease, dedupe of in-flight executions across overlapping runs, `peek()` hiding a live value while its task is in the error state, a `createTaskContext()` test helper, allocation budgets in CI.
- `eventPrefix` in `src/events/events.ts` costs 12 to 15% of a dirty run with no listeners, on main as well.
