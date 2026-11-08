# Public raycast stress benchmark

Run from the repository root with Node 24 and the locked pnpm dependencies:

```sh
pnpm bench:raycast --count 1000 --repeat 5 --warmup 200 --output /tmp/raycast.json
pnpm bench:raycast --scenario thin-ridge --seed 7 --count 10000 --batch-size 100 --output /tmp/raycast-ridge.json
pnpm --filter @hello-terrain/gym test
```

This is a **CPU benchmark of the public runtime raycast over analytic snapshot backends**.
It exercises both `terrain.query.raycast` (acquire/release per ray) and a pinned
snapshot's `lease.raycast` (one lease per workload). It does not benchmark GPU
readback, real tile lookup, LOD, rendered triangle intersection, world transforms,
or end-to-end frame performance. Use the existing browser gym separately for
production compute/render/query integration.

## Scenarios and correctness

The same fixed-seed ray corpus is used for both modes and every repetition.
The suite includes downward and oblique plane rays, Earth-coordinate planes with
fractional heights, sphere intersections, exact tangencies, a thin ridge, a
crossing in the final search interval, missing coverage, and rays directed away
from terrain.

Ordinary plane/sphere fixtures require a hit. Every reported hit, including in
diagnostic scenarios, is checked against independently calculated intersections,
implicit surface residuals, ray membership, range, normal and snapshot revision.
Tests inject bad results to check that the oracle rejects them.

Tangencies, the thin ridge and late brackets intentionally measure the current
algorithm's incomplete outcomes. They are not required to hit: the public API
documents a sampled search, not a complete intersection solver. A successful run
does **not** mean all analytic intersections were found. Reports keep known
intersection counts, completed intersections and completion rate alongside timing.
Coverage gaps require `outside-coverage`; the other diagnostic incomplete results
must be `work-budget`. No result is relabeled as a miss.

The late-bracket case targets the shared scan/refinement budget. The thin ridge
is narrower than the scan intervals over a 10,000-unit range. These are concrete
accuracy-versus-work diagnostics, not silent benchmark wins. No runtime algorithm
is changed by this benchmark.

Unit coverage also checks deterministic seeds, input validation, bounded sample
calls and snapshot lifetime. Analytic fixtures do not prove streamed tile or
GPU resource ownership correctness.

## Reading measurements

Each scenario/mode first passes an untimed correctness preflight, then warms up.
Timed batches include synchronous raycasts and storing their returned results.
Validation, scene construction, JSON collection and disposal are outside timers.
Every measured result is validated afterward. Invalid results fail the run and
suppress the affected repeat's timing.

The report retains raw batch durations and individual repetitions, rays/second,
batch p50/p95/p99, outcomes, sample-call counts and maximum intersection-distance
error. **Batch percentiles are not per-ray latency percentiles.** The default
1000-ray corpus with 100-ray batches gives only ten batches per repetition;
increase count for meaningful tail analysis. An unequal final batch contributes
to total throughput but is excluded from batch percentiles.

Timing uses one Node process; later scenarios may benefit from JIT state, and live
always precedes pinned mode. Do not treat small differences as reliable wins.
Compare multiple runs on an idle matched machine, Node version, scenario, seed,
count, batch size, repeat and warmup settings. Compare completion/error quality
as well as time. No universal performance gate or automatic baseline comparison
is imposed.

JSON records commit, dirty status, source/lockfile hashes, Node, OS and CPU.
Relevant source changes during a run invalidate it. A dirty tree is labeled,
not rejected. Record an absolute output path to avoid ambiguity from pnpm's
package working directory. Seeds and complete command configuration permit replay.

## Options and exits

`--help` lists scenario IDs. Options are `--seed` (uint32), `--count` (rays
per scenario), `--batch-size`, `--repeat`, `--warmup` (rays per mode),
`--scenario` (`all` by default), and `--output`. Without output, JSON goes
to stdout and short progress lines go to stderr. Redirect pnpm stdout only if you
also account for pnpm's command banners; use `--output` for clean reports.

Exit 0 means all required correctness checks passed, including expected incomplete
semantics. Exit 1 means a correctness failure or source change. Exit 2 means invalid
arguments or a harness/runtime error. No authoritative miss or GPU validation is
inferred from a successful run.

