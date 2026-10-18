# ADR-0014: One aggregate statistic across modules

- **Date:** 2026-10-18
- **Status:** accepted
- **Deciders:** owner, tech lead

## Context

The owner wants one number that sums up the user across every module. Every screen that shows an overall statistic must read it. Today the Life Score (IA decision OQ-DSH-2: the weighted mean of the Habits, Tasks, Fitness and Finance area rates) is recomputed on the device by several hooks, alongside the on-target streak, facets, misses and achievements.

## Decision

1. **Every domain module registers a `StatsContributor`** in its own `stats.py` (`app/modules/stats/contract.py`), mirroring the prototype's `ModuleContract`:
   - `area_rate`
   - `day_progress`
   - `metrics`
   - `calendar`
   - `misses`
   - `achievements`
   - `facets`

   Modules never compute a cross-module number themselves.

2. **The stats module owns the aggregation.**
   - Life Score = `round(Σ wₖ·clamp(rateₖ) / Σ wₖ · 100)` over the enabled areas with a weight above zero.
   - The level bands are 0, 40, 55, 65, 75 and 85.
   - The delta compares against the previous window of equal length.
   - The on-target rate and streaks use the user's `target_threshold`.
   - It also produces the facets and headline metrics.

3. **`GET /stats/overview?range=7d|30d|90d|1y`** is the one endpoint for the overall statistic. Today, Stats, the social scorecard, share cards, Sol insights and trackers all read it, or `stats.public.overview`.

4. **Rollups.** Results are materialised per day in `daily_module_stat` and `life_score_daily`. These tables are caches, rebuildable from the module tables.
   - Writes call `stats.public.mark_dirty(module, day)`, which queues a debounced recompute.
   - A nightly job seals yesterday.

5. **Golden fixtures.** The expected values in tests come from running the prototype's TypeScript calculations over a fixed seed (`scripts/gen-golden.ts`), never from the Python under test.

## Constitution clause deviated from

None.

## Consequences

**Positive:**
- One definition of the user's overall number.
- New modules plug in by registering a contributor.
- The social scorecard and share cards cannot disagree with Stats.

**Negative:**
- Rollups can lag a write by the debounce window. `overview` recomputes "today" live to hide that lag.
