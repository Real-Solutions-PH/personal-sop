# Screen time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Screen time (lower-bound minutes per user-named app group per day, from DeviceActivity thresholds) as a synced data source, auto-completing habits driven by it, and a seventh Life Score area / eighth hexagon facet.

**Architecture:** A new backend module `screen` (two synced entities, a stats contributor) plus three rule columns on `habit`. Pure rules live twice — `shared/prototype/screen/logic.ts` and `backend/app/modules/screen/logic.py` — pinned together by a golden test, as Focus does. On the phone a local Expo module (`unfurl-screen-time`) and one `device-activity-monitor` extension write threshold events to an App Group; a pure `reconcile()` turns them into `screen_day` rows and `source="screen"` habit logs that go through the existing sync engine. The native part is only prebuilt when `UNFURL_SCREEN_TIME=1`.

**Tech Stack:** FastAPI, SQLModel, Alembic, pytest · TypeScript shared domain, Expo SDK 58, jest-expo, Swift (FamilyControls, DeviceActivity), `@bacons/apple-targets` 5.0.0.

**Spec:** `docs/superpowers/specs/2026-10-29-screen-time-design.md`

**Wiring template:** commit `389a075` (Focus module, #88) touched every list a new module must join. `git show --stat 389a075` is the checklist; follow its shape in each file rather than inventing a new one.

## Global Constraints

- Module key `screen`, label "Screen time", default weight 2, enabled by default, onboarding pre-selected.
- Every displayed minute value from screen time is a lower bound: render as `≥ N min` (or "None yet" for 0 on a zero-limit habit). Never a bare "N min".
- Standard rungs (minutes): `1, 5, 10, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180, 195, 210, 225, 240, 300, 360, 480`; plus `maxMin + 1` for every live rule on the group. Up to 6 custom groups + 1 `all` group.
- Day window: from `day_start_hour` (profile, default 4) local time to one minute before it next day. App-day key = `dayKey` semantics with that hour.
- `screen_day` accepted for `today − 7 … today`; upsert keeps `max(used_min)` and `closed = old OR new`.
- Day score: `1` if `used ≤ budget`, else `max(0, 1 − (used − budget)/budget)`; groups with `budget_min = 0` are not scored.
- Manual habit actions on a rule habit → HTTP 409, code `habit_auto`.
- Backend tests: ALWAYS run with the isolated test DB env (port 55440), never 55432. Mobile: `bun run test` from `mobile/`, never `bun test`. After `bun run lint` (Biome `--unsafe`), audit every `}, [` hook-dependency change in the diff.
- Never hand-edit `frontend/src/client/` or `mobile/src/client/`; regenerate.
- Missing native module / permission denied / no selection must never crash: LockedPreview or "Not tracked".

## Review Focus

1. **Unobserved day passes.** No `start` event for the day, or `hasSelection=false` at start → no log, row shows "Not tracked". Test in Task 1 (`reconcile`).
2. **Duplicate / out-of-order / implausible events.** Same rung twice, events arriving out of order, a rung of 60 at 04:10 → used stays the max plausible rung. Test in Task 1.
3. **Existing manual log on the day.** Reconcile never overwrites a log that already exists for habit+day (any source). Test in Task 1.
4. **Sync replay of a `screen` log for a habit without a rule, or a `tap` log for a rule habit** → rejected. Test in Task 2.
5. **Group archive with live rule habits** → 409 listing them; archiving after the habits change → ok. Test in Task 2.

---

### Task 1: Pure rules (TS + Python, golden-pinned)

**Files:**
- Create: `shared/prototype/screen/logic.ts`, `shared/prototype/screen/data.ts` (types only in this task)
- Create: `backend/app/modules/screen/__init__.py`, `backend/app/modules/screen/logic.py`
- Create: `scripts/golden/screen.golden.test.ts` → writes `backend/tests/golden/screen-logic.json`
- Test: `mobile/src/prototype/__tests__/screen-logic.test.ts`, `backend/tests/modules/screen/unit/test_logic.py`, `backend/tests/modules/screen/unit/test_logic_golden.py`

**Interfaces (Produces):**

```ts
// data.ts
export type ScreenGroupKind = "all" | "custom"
export interface ScreenGroup { id: string; name: string; kind: ScreenGroupKind; budgetMin: number; sortOrder: number; archivedAt?: string }
export interface ScreenDay { id: string; groupId: string; day: string; usedMin: number; closed: boolean; updatedAt: string }
export interface HabitRule { kind: "screen_limit"; groupId: string; maxMin: number }
// What the extension writes to the App Group, one per callback.
export type NativeEvent =
  | { kind: "start"; groupId: string; at: number; hasSelection: boolean }
  | { kind: "end"; groupId: string; at: number }
  | { kind: "rung"; groupId: string; at: number; rungMin: number }
// logic.ts
export const STANDARD_RUNGS: readonly number[]
export function rungsFor(limits: number[]): number[]                 // sorted, unique, standard ∪ {m+1}
export function windowFor(day: string, dayStartHour: number): { startMs: number; endMs: number } // local time
export function dayOf(atMs: number, dayStartHour: number): string    // app-day key containing atMs
export function plausible(rungMin: number, atMs: number, windowStartMs: number): boolean // rungMin*60000 <= atMs - windowStartMs
export interface DayObservation { day: string; groupId: string; observed: boolean; usedMin: number; closed: boolean }
export function observe(events: NativeEvent[], dayStartHour: number): DayObservation[]
export type RuleState =
  | { kind: "untracked" }
  | { kind: "broken"; usedMin: number; overMin: number }
  | { kind: "tracking"; usedMin: number; progress: number }   // progress = elapsed fraction of the window, 0..1
export function ruleState(rule: HabitRule, obs: DayObservation | undefined, nowMs: number, dayStartHour: number): RuleState
export function reconcile(args: { events: NativeEvent[]; habits: Habit[]; logs: HabitLog[]; existingDays: ScreenDay[]; nowMs: number; dayStartHour: number; newId: () => string }): { days: ScreenDay[]; logs: HabitLog[] }
export function dayScore(usedMin: number, budgetMin: number): number
export function areaRate(days: ScreenDay[], groups: ScreenGroup[]): number | null
```

```python
# backend/app/modules/screen/logic.py
STANDARD_RUNGS: tuple[int, ...]
def day_score(used_min: int, budget_min: int) -> float: ...
def area_rate(days: Sequence[tuple[date, uuid.UUID, int, bool]], budgets: Mapping[uuid.UUID, int]) -> float | None: ...  # (day, group_id, used_min, closed)
```

Rules the tests pin:
- `observe`: a (day, group) is `observed` iff a `start` with `hasSelection: true` exists in that day's window; `usedMin` = max `rungMin` over plausible rung events in the window (0 if none); `closed` iff an `end` exists for that window. Events from a day with no `start` produce `observed: false` (still listed if any event exists).
- `ruleState`: no obs or `!observed` → `untracked`; `usedMin > maxMin` → `broken` (`overMin = usedMin − maxMin`); else `tracking` with `progress = clamp((now − start)/(end − start))`.
- `reconcile`: for each observed, closed day within the last 7 app-days: emit/raise a `ScreenDay` (keep `max` with `existingDays`, reuse its id); for each rule habit on that group, if `usedMin ≤ maxMin` and no log exists for that habit+day → a `done` log with `source: "screen"`, `id = derivedId("screen-habit", habit.id, day)` (use the existing `derived_id` helper the workout auto-check uses), `loggedAt` = the `end` event's time. Open (today's) observed days also emit a `ScreenDay` with `closed: false` but no log.
- `areaRate`: per closed day, mean of `dayScore` over groups with `budgetMin > 0` that have a row that day; mean over such days; `null` when none.

- [ ] **Step 1: Write failing TS tests** in `screen-logic.test.ts`: `rungsFor([0,30])` contains 1 and 31 once each and is sorted; `plausible(60, start+59*60000, start)` false and `(60, start+60*60000, start)` true; `observe` covers Review Focus 1 and 2; `ruleState` returns each of the three kinds; `reconcile` covers Review Focus 3, emits no log for a broken day, reuses an existing `ScreenDay` id and never lowers `usedMin`; `dayScore(30,60)=1`, `dayScore(90,60)=0.5`, `dayScore(120,60)=0`, `dayScore(500,60)=0`; `areaRate` skips budget-0 groups and returns `null` for no closed days.
- [ ] **Step 2:** `cd mobile && bun run test -- screen-logic` → FAIL (module not found).
- [ ] **Step 3:** Implement `data.ts` + `logic.ts`. Add `"screen"` to `LogSource` and `rule?: HabitRule` to `Habit` in `shared/prototype/habits/data.ts`.
- [ ] **Step 4:** `bun run test -- screen-logic` → PASS.
- [ ] **Step 5:** Golden script `scripts/golden/screen.golden.test.ts` (copy the shape of `scripts/golden/focus.golden.test.ts`): a grid of `dayScore` inputs (used 0..600 step 15 × budget {0,30,60,120}) and 6 `areaRate` cases → JSON.
- [ ] **Step 6:** Python unit tests + golden test (shape of `backend/tests/modules/focus/unit/test_logic_golden.py`) → FAIL, implement `logic.py`, → PASS. Run pytest with the 55440 test-DB env exported (see memory/CLAUDE.md; unit files still import the app config).
- [ ] **Step 7: Commit** `feat(screen): pure screen-time rules with TS/Python golden parity`.

### Task 2: Backend module, habit rule, migration

**Files:**
- Create: `backend/app/modules/screen/{models,schema,services,public,sync,stats,main}.py` (mirror `focus/` naming; `routes.py` only if `main.py` needs a router to mount — sync is the write path, no REST writes)
- Modify: `backend/app/modules/habits/{models,schema,services,sync}.py`, `stats/{contract,logic,models,services}.py`, `profile/{models,public,schema}.py`, `sync/registry.py`, `db/models.py`, `api/v1.py` (only if a router exists), `iam/permissions/seed.py`, `iam/rbac/seed.py` (as Focus did)
- Create: `backend/app/alembic/versions/<rev>_screen_time.py` (down_revision `ed6795f25585` unless master moved — re-check head first)
- Test: `backend/tests/modules/screen/api/test_screen_sync.py`, `backend/tests/modules/habits/api/test_habit_rules.py`, update `backend/tests/modules/stats/*` and golden facets fixtures via `scripts/golden/stats.golden.test.ts`

**Interfaces (Produces):**
- Tables: `screen_group(id, owner_id, name ≤40, kind CHECK in ('all','custom'), budget_min int ≥0 default 60, sort_order int, archived_at tstz null)` + partial unique `(owner_id) WHERE kind='all' AND deleted_at IS NULL`; `screen_day(id, owner_id, group_id FK screen_group ON DELETE CASCADE, day date, used_min int ≥0, closed bool, updated_at)` unique `(owner_id, group_id, day)`.
- `habit.rule_kind` (`'screen_limit'` or NULL), `habit.rule_group_id` (FK `screen_group` ON DELETE RESTRICT), `habit.rule_max_min` (int ≥ 0); CHECK all-null or all-set. `LOG_SOURCES` += `"screen"`.
- Sync entities `screen_group` (create_required `name`, `kind`), `screen_day` (natural key: an upsert whose `(group_id, day)` already has a row lands on that row, like `target_adjustment`'s `day`). `HabitSyncIn`/`HabitPublic` gain `rule_kind`, `rule_group_id`, `rule_max_min`.
- Error codes: `habit_auto` (409) manual action on a rule habit; `screen_source_mismatch` (422) `screen` log for a non-rule habit; `screen_group_in_use` (409, details list habit ids+names); `screen_day_out_of_range` (422).
- `ModuleKey` += `"screen"` everywhere the Focus commit added `"focus"`; `DEFAULT_WEIGHTS["screen"] = 2`; contributor `ScreenContributor` with `key="screen"`, `label="Screen time"`, `href="/screen"`, `area_rate` from `logic.area_rate`, `day_progress` = groups with budget>0 within budget per closed day (due = scored groups, done = within budget), `facets` empty (the facet comes from `compose_facets` area rate), `metrics`: `screen.used` (main group lower bound, unit min).
- `compose_facets` gains the eighth facet `("screen", "Screen time", "screen", r(rates,"screen"))` after Focus, before Finance? — **after Finance**, so existing corner positions don't move.

- [ ] **Step 1:** Write failing API/sync tests: push `screen_group` + `screen_day` via `/sync/push`; pull returns them; second push with lower `used_min` keeps the higher; `day` 8 days ago → `screen_day_out_of_range`; Review Focus 4 and 5; each of `check`, `log`, `increment`, `skip`, `DELETE log`, timer start on a rule habit → 409 `habit_auto`; a habit with only `rule_kind` set → 422; stats overview includes area `screen` with weight 2 and the Life Score ignores it when it has no data.
- [ ] **Step 2:** Run with test-DB env → FAIL.
- [ ] **Step 3:** Implement models/services/sync/stats; wire module lists; guard in `habits/services.py` with one `_require_manual(habit)` called from each manual entry point.
- [ ] **Step 4:** Migration: `make backend-revision MSG="screen time"` against the disposable test DB, then hand-reduce (enum CHECK rewrites for `habit_log.source` and `module_pref.module`, the partial index, FK ondelete). Verify `alembic upgrade head` → `downgrade -1` → `upgrade head` on the test DB.
- [ ] **Step 5:** Re-run goldens (`scripts/golden/stats.golden.test.ts`) and full backend suite → PASS. `make backend-lint` clean.
- [ ] **Step 6:** Regenerate clients: `bash scripts/generate-client.sh`; copy the spec to `mobile/openapi.json`; `cd mobile && bun run generate-client`.
- [ ] **Step 7: Commit** `feat(screen): backend module, habit screen rules, migration`.

### Task 3: Shared domain store + sync mappers (TS)

**Files:**
- Create: `shared/prototype/screen/{store,actions,index}.ts`, `mobile/src/live/mappers/screen.ts`
- Modify: `shared/prototype/{contract,modules}.ts`, `shared/prototype/dash/{data,facets,hooks,onboarding,server-stats,store}.ts`, `shared/prototype/design/tokens.ts` (accent `scr`), `shared/prototype/habits/{actions,logic}.ts`, `mobile/src/live/mappers/habits.ts`, `mobile/src/live/{blank,runtime}.ts`, `mobile/src/prototype/theme.ts`, and the frontend `frontend/src/proto/{contract.ts,dash/data.ts,...}` lists only where TypeScript requires the new key.
- Test: `mobile/src/prototype/__tests__/screen-module.test.tsx`, update `habit-progress.test.ts`, `mobile/src/live/__tests__/habits.test.ts`, `stats.test.ts`, `first-run.test.tsx`.

**Interfaces:**
- Consumes Task 1 types/logic and Task 2 wire names (snake_case on the wire, camelCase in the store, as other mappers do).
- Produces: `useScreen()` store with `groups: ScreenGroup[]`, `days: ScreenDay[]`; actions `addGroup(name, budgetMin) → id`, `updateGroup(id, patch)`, `archiveGroup(id)` (throws `screen_group_in_use` message locally too), `ensureAllGroup()`, `applyReconcile({days, logs})`. `module` export implementing `ModuleContract` for key `screen`.
- Habits: `checkHabit`, `logHabit`, `incrementCount`, `skipHabit`, `clearLog` are no-ops returning the unchanged state for a habit with `rule` (UI never offers them; this is the safety net). `progressOf(h, log, ruleState?)`: with a rule, `done` log → 1, otherwise `tracking.progress`, `broken`/`untracked` → 0.

- [ ] Steps: failing tests (module contract registered, Life Score skips `screen` with no data, mapper round-trips a rule habit and both entities, manual actions refused on a rule habit, `progressOf` with each RuleState) → FAIL → implement → PASS → commit `feat(screen): shared screen-time store, module contract, sync mappers`.

### Task 4: Native bridge, monitor extension, build gating

**Files:**
- Create: `mobile/modules/unfurl-screen-time/{expo-module.config.json,package.json,index.ts,ios/UnfurlScreenTime.podspec,ios/UnfurlScreenTimeModule.swift,ios/Shared.swift}`
- Create: `mobile/targets/activity-monitor/{expo-target.config.js,ActivityMonitor.swift,Info.plist}`
- Create: `mobile/app.config.js` (reads `app.json`; when `process.env.UNFURL_SCREEN_TIME === "1"` adds entitlements `com.apple.developer.family-controls: true` and `com.apple.security.application-groups: ["group.com.schadenkai.personal-sop"]`, and lets `@bacons/apple-targets` include `activity-monitor`; otherwise excludes that target)
- Create: `mobile/src/prototype/screen-time.ts` (JS wrapper, `health.ts` pattern: lazy `requireOptionalNativeModule`, sample events in Expo Go)
- Test: `mobile/src/prototype/__tests__/screen-time.test.ts`, `mobile/src/__tests__/app-config.test.ts`

**Interfaces (Produces, JS):**
```ts
export type ScreenAuth = "approved" | "denied" | "notDetermined" | "unavailable"
export function screenTimeAvailable(): boolean
export function authorizationStatus(): Promise<ScreenAuth>
export function requestScreenTime(): Promise<ScreenAuth>
export function pickApps(groupId: string): Promise<boolean>        // true if a non-empty selection was saved
export function hasSelection(groupId: string): Promise<boolean>
export function startMonitoring(plan: { groupId: string; kind: ScreenGroupKind; rungs: number[] }[], dayStartHour: number): Promise<void>
export function stopMonitoring(): Promise<void>
export function readEvents(): Promise<NativeEvent[]>
export function syncScreenTime(): Promise<void>  // foreground hook: readEvents → reconcile → applyReconcile; reschedules only when the plan hash changed
```
Swift: activity name `screen.<groupId>`, event name `rung.<min>`; `kind: "all"` → event with empty selection (counts all usage); `includesPastActivity: true`; schedule `DateComponents(hour: dayStartHour, minute: 0)` → `(hour: (dayStartHour+23)%24, minute: 59)`, `repeats: true`. The extension appends JSON lines `{kind, groupId, at, rungMin?, hasSelection?}` to App Group `UserDefaults(suiteName: "group.com.schadenkai.personal-sop")` key `screen.events` (cap 2,000 entries, drop oldest). It does nothing else (no network). Reference: `react-native-device-activity` 0.6.1 (MIT) `DeviceActivityMonitorExtension.swift`, `ScreenTimeActivityPicker.swift`.

- [ ] Steps: failing jest tests for the wrapper (unavailable module → `"unavailable"`, `readEvents` → `[]`, never throws; `syncScreenTime` calls reconcile and skips reschedule on unchanged plan) and for `app.config.js` (env unset → no family-controls entitlement and no activity-monitor target; env `1` → both) → FAIL → implement → PASS. Then `UNFURL_SCREEN_TIME=1 bunx expo prebuild --platform ios --clean` in a scratch copy and `xcodebuild -scheme ... -sdk iphonesimulator build` to prove the Swift compiles; plain prebuild proves the gated-off build is unchanged. `bunx expo install --check` clean. Commit `feat(mobile): Screen Time bridge and activity monitor extension (gated)`.

### Task 5: Mobile screens

**Files:**
- Create: `mobile/src/prototype/screens/screen-settings.tsx`, `mobile/src/prototype/screens/screen-card.tsx`, route `mobile/src/app/(sop)/screen/index.tsx`
- Modify: habit editor (find via `habit-detail.tsx` / the habit form), `screens/today.tsx` (`TodayHabit`), `screens/habits.tsx` (`HabitRow`), `screens/stats-home.tsx`, `screens/onboarding.tsx` (icon/colour for `screen`), `app-launcher.tsx` if every module has a tile, `mobile/src/app/(sop)/_layout.tsx`, app foreground hook calling `syncScreenTime()`.
- Test: extend `screen-module.test.tsx`: rule habit row renders no check button and an "auto" mark with label `≥ N of M min`; broken shows "Over by ≥ N min"; untracked shows "Not tracked"; settings without native module renders LockedPreview, with denied permission renders retry; habit editor saving "Completes from screen time" writes `rule` and hides target/step fields.

- [ ] Steps: failing tests → implement within the brand system (`docs/brand`, tokens) → PASS → simulator screenshots of: settings (sample data), Today with a rule habit tracking and broken, stats with the Screen time corner → commit `feat(mobile): screen-time settings, auto habits, stats corner`.

### Task 6: Docs, full verification, PR

- [ ] ADR `docs/adr/0027-screen-time.md` (sandbox constraint, lower bound, observed-day rule, entitlement gating, library choice) + index in `docs/adr/README.md`; `docs/README.md` index if a doc is added.
- [ ] Full runs: backend suite (test-DB env), `make backend-lint`, mobile `bun run typecheck`, `bun run test`, `bun run lint` (audit hook deps), root `bun run lint` for frontend/e2e, golden scripts.
- [ ] PR to `master`: labels `feature`, `backend`, `mobile`, `frontend` (if touched), plus any flag labels the repo uses for migrations/native; enable auto-merge. Body lists the Apple portal steps for Kai.
