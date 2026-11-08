# Fern way back, grace day, check-in and review — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A forgiving return path for Unfurl: grace day on streaks, streaks paused (not lost) on a way back, a one-sentence catch-up, a daily check-in, and a wins-first Fern review with one-tap habit/task suggestions.

**Architecture:** Streak rules change in both copies (TS `shared/prototype`, Python `backend`), pinned by golden fixtures. The way-back pause reuses the existing synced `HabitPause` model. Catch-up and check-in reuse the capture path with new hints. The review is a new on-demand endpoint modelled on `dashboard/miss_analysis.py`.

**Tech Stack:** FastAPI + SQLModel + Alembic (mypy strict, ruff), Expo/React Native (jest-expo, Biome), bun golden scripts.

**Spec:** `docs/superpowers/specs/2026-11-08-fern-way-back-design.md`

## Global Constraints

- Every backend pytest is prefixed with the throwaway-DB export: `POSTGRES_PORT=55440`, the sopfix-pg password, `REDIS_URL=redis://localhost:56390/0`. Never the 55432 dev DB.
- Golden fixtures are regenerated with `TZ=Asia/Manila bun test scripts/golden` and never hand-edited.
- Schema only via Alembic: one revision with a clean up and down.
- After an API change, run `bash scripts/generate-client.sh` and regenerate the mobile client (`mobile/openapi-ts.config.ts`). Never hand-edit `frontend/src/client/`.
- Mobile commands run from `mobile/`: `bun run test`, `bun run typecheck`, `bun run lint`. Lint runs Biome `--unsafe`, so audit `}, [` hook-dep changes afterwards.
- Toasts only for habit/task ticks. Nothing here adds a toast.
- Task and habit titles wrap and never get `numberOfLines`.
- No copy says "lost", "failed" or "broke". The way back shows no red.
- The review never receives weigh-ins, body measurements or calorie targets.
- Cost budget: catch-up is 1 capture turn, check-in is 1 capture turn, review is 1 model call. Nothing runs on a schedule.

## Review Focus

1. **Brand-new user idle two days.** No earlier active day, so no way back. Test in Task 7.
2. **Way back twice inside 30 days.** The second return writes no pause and shows "run of N ended". Test in Task 7.
3. **Catch-up names a day outside the gap** ("on the 1st", last month). The day is clamped into the range, not dropped. Test in Task 3.
4. **The review model cites a record that isn't in the facts, or suggests a weight goal.** That item is dropped server-side. Test in Task 5.
5. **Check-in already sent today.** Today's notification is skipped and tomorrow's is still scheduled. Test in Task 10.

---

### Task 1: Grace day in habit streaks (TS + Python + golden)

**Files:**
- Modify: `shared/prototype/habits/logic.ts:232-270` (`computeStreaks`)
- Modify: `backend/app/modules/habits/logic.py:255-290` (`Streaks`, `streaks`)
- Modify: `scripts/golden/habits.golden.test.ts` (add cases)
- Regenerate: `backend/tests/golden/habits-logic.json`
- Test: `mobile/src/prototype/__tests__/habit-grace.test.ts` (new); `backend/tests/modules/habits/unit/test_logic_golden.py` (existing, must stay green)

**Interfaces:**
- Produces, TS: `streaks(h, idx, today)` returns `{ current: number; best: number; broken: {day,length}[]; graceDays: string[] }`.
- Produces, Python: `Streaks(current, best, broken, grace_days: list[date])`.

**Rule:**
- A `missed` cell is bridged (neutral, not counted) when both hold:
  - the next non-neutral cell after it is `done`, `partial` or today `pending`;
  - no other bridged day in the same run lies within 7 calendar days of it.
- Otherwise it breaks the run.
- The rule applies identically to `current`, `best` and `broken`.
- `graceDays` lists the bridged days in the current run.

- [ ] **Step 1: Write failing tests** in `habit-grace.test.ts`, using a daily habit and `today = "2026-11-08"`:
  - `bridges one lone miss`: done 11-01..11-04, miss 11-05, done 11-06..11-08 → `current === 7`, `graceDays` equals `["2026-11-05"]`.
  - `two misses in a row break`: miss 11-05 and 11-06 → `current === 2`.
  - `second lone miss within 7 days breaks`: misses 11-03 and 11-06 → `current === 2`, `graceDays` equals `["2026-11-06"]`.
  - `grace held for today pending`: miss 11-07, today pending → `current` counts the run before it, `graceDays` equals `["2026-11-07"]`.
  - `3-day-a-week habit`: unscheduled days stay neutral; one missed scheduled day is bridged.
- [ ] **Step 2:** Run `cd mobile && bun run test habit-grace`. Expected: FAIL.
- [ ] **Step 3:** Implement the rule in `computeStreaks`. Walk forward over `daysBetween(createdAt, today)` and keep a pending-miss flag plus the last bridged day. `current` is the final run's length.
- [ ] **Step 4:** Port the same logic to `logic.py` `streaks()`, adding `grace_days`. Add the five cases to `scripts/golden/habits.golden.test.ts`, then regenerate the fixture.
- [ ] **Step 5:** Run `cd mobile && bun run test habit-grace` and the env-prefixed `uv run pytest tests/modules/habits -q`. Expected: PASS. Also grep the callers of `streaks(` and `.broken` (`habits/stats.py`, `capture/ports.py:175`, `capture/qa.py:342`) and run their tests.
- [ ] **Step 6:** Commit: `feat(habits): grace day bridges one missed day in a streak`.

### Task 2: Grace day in the on-target day streak

**Files:**
- Modify: `shared/prototype/dash/hooks.ts:245-268` (`onTargetStats`)
- Modify: `backend/app/modules/stats/logic.py:181-205` (`on_target_stats`)
- Modify: `scripts/golden/stats.golden.test.ts`; regenerate `backend/tests/golden/stats-day-series.json`
- Test: `mobile/src/prototype/__tests__/on-target-grace.test.ts` (new)

**Interfaces:**
- Produces: `onTargetStats(series)` adds `graceDays: string[]`. Python `OnTargetStats.grace_days: list[date]`.
- The `on_target` / `useOnTarget` results expose `graceDays` (all-time series).

The rule is Task 1's, applied to `onTarget === false` days. Null days stay neutral.

- [ ] **Step 1: Failing tests:**
  - `one off-target day between hits keeps the streak`: series T,T,F,T,T → `current === 4`, one grace day.
  - `two off-target days break it`: T,T,F,F,T → `current === 1`.
  - `null days are neutral and do not consume grace`.
- [ ] **Step 2:** Run the test. Expected: FAIL.
- [ ] **Step 3:** Implement in TS and Python. Add golden cases and regenerate.
- [ ] **Step 4:** Run `bun run test on-target-grace`, then `daily-loop`, `rewards` and `streak-at-risk`. Run the env-prefixed `uv run pytest tests/modules/stats -q`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(stats): grace day in the on-target day streak`.

### Task 3: Capture catch-up and check-in hints

**Files:**
- Modify: `backend/app/modules/capture/schema.py:228-255` (`CaptureIn`)
- Modify: `backend/app/modules/capture/engine.py:188-210,316-322,516-545` (hint plumbing, `Plan`, rules fallback)
- Modify: `backend/app/modules/capture/agent.py:1028-1044` (`Run`), `:1291` (`_offset`), `:2961-3010` (`run_capture_agent`)
- Modify: `shared/prototype/capture/engine.ts:66` (`SendInput`); `mobile/src/live/mappers/capture.ts:319` (`captureToServer`)
- Test: `backend/tests/modules/capture/api/test_catch_up.py` (new); `mobile/src/live/__tests__/capture.test.ts` (add case)

**Interfaces:**
- `CaptureIn.hint` literal gains `"catch_up"` and `"checkin"`.
- New field `CaptureIn.range_from: date | None = None`. It is only valid with `hint == "catch_up"`, and must be before the day of `at`, or the request is a 422 `invalid`.
- `Plan` gains `range_from: date | None`, carried through `ctx.session.info["capture_ranges"]` the same way hints are.
- `run_capture_agent(..., range_: tuple[date, date] | None = None)`. `range_ = (range_from, day_of(at) - 1)`.
- `Run.offset(days_ago: int) -> int` replaces `_offset`. It clamps the resulting day into `range_` when set; otherwise it returns `-days_ago`.
- TS: `SendInput.rangeFrom?: string` (YYYY-MM-DD) maps to `range_from`.

**Prompt addition** (appended to `system` when `range_` is set; exact copy):
```
The person is catching up on {from}..{to}, days they did not log. Log only
what they state. A fact with a day goes on that day. A fact about a span with
no day ("most nights", "a couple of times") becomes ONE journal entry on {to}
with the span in its text. Never create an entry for a day they did not
describe. "Skipped X" or "didn't X" writes nothing.
```

**Rules fallback** (no model, hint `catch_up`): one journal entry on the last range day holding the text. Use the journal path the rules parser already has, with `day_offset` equal to the range end.

- [ ] **Step 1: Failing API tests** in `test_catch_up.py`, using the scripted model seam the capture API tests already use:
  - `test_catch_up_dated_fact_lands_on_its_day`: the model calls habit log with `days_ago=2` → the log's day is `today-2`.
  - `test_catch_up_day_outside_range_is_clamped`: `days_ago=40` with a range of `today-4..today-1` → day `today-4`.
  - `test_catch_up_prompt_carries_range`: the captured system prompt contains `catching up on`.
  - `test_catch_up_rules_fallback_writes_one_journal_entry`: AI off → exactly one journal card, dated `today-1`.
  - `test_range_from_without_catch_up_hint_is_422`.
  - `test_checkin_hint_accepted`: the capture is created and parses normally.
- [ ] **Step 2:** Run the env-prefixed `uv run pytest tests/modules/capture/api/test_catch_up.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement the schema, the plumbing, `Run.offset` (replace every `_offset(a.days_ago)` call site), the prompt and the fallback.
- [ ] **Step 4:** Add the mobile mapper case: `captureToServer({..., rangeFrom: "2026-11-04", hint: "catch_up"})` includes `range_from: "2026-11-04"`. Thread `rangeFrom` through `sendCapture` to the live backend.
- [ ] **Step 5:** Run the capture tests (`uv run pytest tests/modules/capture -q`) and `bun run test capture`. Expected: PASS.
- [ ] **Step 6:** Commit: `feat(capture): catch-up range and check-in hints`.

### Task 4: Schema — `profile.push_checkin` and `fern_review` (one Alembic revision)

**Files:**
- Modify: `backend/app/modules/profile/models.py:99-101`, `schema.py:106-108,146-148,170`
- Modify: `backend/app/modules/companion/models.py` (add `FernReview`)
- Create: `backend/app/alembic/versions/<rev>_way_back_checkin_and_fern_review.py`
- Modify: the mobile profile mapper (`mobile/src/live/mappers/*profile*`), `shared/prototype/dash/data.ts:141,328` (`push` gains `checkin: string`, `lastCheckin: string`)
- Test: `backend/tests/modules/profile/api/` (add a push_checkin round-trip case)

**Interfaces:**
- `Profile.push_checkin: str | None = Field(default=None, max_length=5)`. It is HH:MM and validated with the same `field_validator` as `push_evening`. `None` means off.
- `FernReview(OwnedRow, table=True)`, table `fern_review`, columns:
  - `kind: str` (max 16);
  - `from_day: date`, `to_day: date`;
  - `fingerprint: str` (max 64);
  - `body: dict` (JSONB);
  - unique constraint on `(owner_id, kind, from_day, to_day)`. Mirror `MissAnalysis` for the owner column name.
- DashState `push.checkin` (`""` = off) syncs to `push_checkin`. `push.lastCheckin` is local only and does not sync.

- [ ] **Step 1:** Write a failing profile API test: PATCH `push_checkin="20:30"`, then GET returns it. `"25:00"` → 422.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Add both models. Generate the revision with `make backend-revision MSG="way back checkin and fern review"` against the throwaway DB, and read and reduce it by hand. Run `make backend-migrate` up, then `make backend-downgrade`, then up again, all on 55440.
- [ ] **Step 4:** Run the test. Expected: PASS. Regenerate both clients and add the mobile mapper fields.
- [ ] **Step 5:** Commit: `feat: push_checkin and fern_review schema`.

### Task 5: `POST /companion/review`

**Files:**
- Create: `backend/app/modules/companion/review.py`
- Modify: `backend/app/modules/companion/routes.py` (route), `schema.py` (I/O models)
- Test: `backend/tests/modules/companion/api/test_review.py` (new)

**Interfaces:**
- `ReviewIn`:
  - `kind: Literal["way_back","weekly"]`;
  - `from_day: date`, `to_day: date` (≤ 31 days apart, `to_day ≤ ctx.today`);
  - `dismissed: list[str]` (max 50, each ≤ 60 chars).
- `ReviewOut`: `wins: list[ReviewPoint]` (1–3), `gaps: list[ReviewGap]` (0–2), `source: Literal["ai","rules"]`.
- `ReviewPoint`: `text: str`.
- `ReviewGap`:
  - `text: str`, `how: str`;
  - `suggestion: Suggestion`, where `Suggestion = {kind: Literal["habit","task"], title: str (≤60), days_per_week: int | None (1..7)}`.
- `def review(ctx: Ctx, data: ReviewIn) -> ReviewOut`.

**Behaviour:**
- Facts come from `stats_public` for `from_day-7 .. to_day`: day series, habit streaks with `grace_days`, misses, task completions, workouts and focus minutes. Each fact gets an id like `f1`.
- Weigh-ins, body and calorie data are never read.
- One call through `ai.resolve_model(ctx, "chat")` + `record_usage`, using the same budget/AI-switch gate and 503 `review_failed` path as `miss_analysis`.
- Model JSON shape: `{"wins":[{"text","fact_ids"}],"gaps":[{"text","how","suggestion","fact_ids"}]}`.
- Server validation drops any item that:
  - has an empty `fact_ids` or one not in the input;
  - has a gap/suggestion matching `BODY_TERMS`, a module constant (weight, kg, lbs, fat, calorie, diet, BMI, body, slim, belly, …) matched by case-insensitive word;
  - has a suggestion title equal (case-insensitive) to a dismissed title, an active habit name or an open task title.
- Gaps are capped at 2.
- Cached in `FernReview` by key + sha256 fingerprint of the facts JSON. A matching fingerprint returns the cached body with no model call.
- Rules fallback (AI off, cap or no model; not cached):
  - wins: up to 2 of "N on-target days", "longest streak X: N", "best day";
  - gaps: the two habits most missed in range, with suggestion `{kind:"habit", title: habit name, days_per_week: max(2, done_days_in_range + 1)}` and how "Start with {n} days a week — a smaller target you can hit";
  - if the habit already exists, the suggestion is the task "Plan when to do {habit} this week".

- [ ] **Step 1: Failing API tests** in `test_review.py` (scripted model seam as in `test_yesterday_analysis.py`):
  - `test_review_wins_first_and_two_gaps_max` (the model returns 3 gaps → 2 come back);
  - `test_review_drops_item_citing_unknown_fact`;
  - `test_review_drops_body_suggestion` ("lose 2 kg");
  - `test_review_drops_dismissed_and_existing_titles`;
  - `test_review_never_reads_weigh_ins` (seed a weigh-in; assert no weight value appears in the prompt);
  - `test_review_cached_by_fingerprint` (a second call makes no model call; a new habit log changes the fingerprint and re-calls);
  - `test_review_rules_when_ai_off`;
  - `test_review_503_on_provider_failure`;
  - `test_review_range_over_31_days_is_422`.
- [ ] **Step 2:** Run the env-prefixed `uv run pytest tests/modules/companion/api/test_review.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement `review.py` and the route. Prompt rules (exact):
  - wins first;
  - at most two gaps;
  - each suggestion is a small first step with a frequency ("10-minute walk after lunch, 3 days a week"), never an outcome goal;
  - a missing fact is unknown, not zero;
  - never mention weight, body or appearance;
  - cite fact ids.
- [ ] **Step 4:** Run the tests and then `make backend-lint`. Expected: PASS and clean. Regenerate the clients.
- [ ] **Step 5:** Commit: `feat(companion): Fern review with wins, gaps and suggestions`.

### Task 6: Miss copy — `streakMiss`, `streakNote`, `StreakChip`, sweep

**Files:**
- Modify: `mobile/src/prototype/rewards.ts:29-75` (`streakLost` → `streakMiss`, `yesterdayRecap` copy data)
- Modify: `mobile/src/prototype/motion.tsx:572-660` (`StreakChip`)
- Modify the call sites: `screens/today.tsx:487,538,560,642`, `screens/habit-detail.tsx:245,440,490`
- Modify the copy: `daily-strips.tsx:35`, `habit-share.tsx:160,344`, `habits-home.tsx:492`, `screens/yesterday.tsx` (any "lost"), `local-reminders.ts:506`
- Test: `__tests__/daily-loop.test.tsx:336-346` (update), `__tests__/rewards.test.ts` (add)

**Interfaces:**
- `streakMiss(st: {current, broken, graceDays}, today): { missed: number; run: number } | null`. It returns non-null only when `current === 0` and a run broke yesterday. `missed` is the count of consecutive missed scheduled days ending yesterday.
- `streakNote(h: Habit, st, today): string | null`:
  - `"paused N days"` while the habit's latest `way_back` pause ended after its last done day, where N is the pause length;
  - otherwise `"grace day used"` when `st.graceDays` is non-empty and the last grace is within 7 days;
  - otherwise null.
- `StreakChip({ streak, from?, miss?: {missed, run} | null, note?: string | null })`. The `lost` prop is removed.

**Exact copy:**
- Chip with streak and note: `{n} · {note}`. a11y: `{n}-day streak, {note}`.
- Miss chip: `{missed} day(s) missed · run of {run} ended`, colour `t.muted` on `alpha(t.muted, 0.1)`. a11y: `{missed} days missed, {run}-day run ended`. testID `streak-miss`.
- `daily-strips`: `Yesterday: off target · run of {n} ended`.
- `habits-home`: "Broken streaks" → `Runs that ended`.
- `habit-share`: "streak ended there" → `run ended there`; "N habits lost their streak" → `{n} runs ended`.
- Habit detail pause history: a pause with `reason === "way_back"` reads `Away · {n} days`.
- `local-reminders` at-risk body: append ` — a grace day covers one miss` when no grace was used in the last 7 days.

- [ ] **Step 1:** Update `daily-loop.test.tsx`:
  - `renders 2 days missed · run of 12 ended`, with label `2 days missed, 12-day run ended`, testID `streak-miss`, and no `t.bad` colour;
  - `renders 12 · grace day used`;
  - `renders 12 · paused 3 days`.
- [ ] **Step 1b:** Add `rewards.test.ts` cases for `streakMiss` and `streakNote` (way_back pause, grace, none).
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement, update the call sites and sweep the copy. Afterwards, `grep -rniE "streak lost|lost their streak|lost \\$\\{|Broken streaks" mobile/src shared/prototype` must return nothing.
- [ ] **Step 4:** Run `bun run test` (whole suite) and `bun run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(mobile): misses show their cost, never "lost"`.

### Task 7: Way-back detection and streak pause (pure logic)

**Files:**
- Create: `shared/prototype/way-back.ts`
- Test: `mobile/src/prototype/__tests__/way-back.test.ts` (new)

**Interfaces:**
- `lastActiveDay(s: ActivityStores, today: string): string | null`. It is the latest business day before `today` with any of:
  - a habit log;
  - a task completion event;
  - a finance record;
  - a workout, run or meal;
  - a journal entry or capture.
  `ActivityStores` is a plain object of those arrays, so the function stays pure.
- `wayBackGap(last: string | null, today: string): { from: string; to: string; days: number } | null`. It returns non-null when `last` is set and `today - last ≥ 3`, with `from = last+1` and `to = today-1`.
- `shouldShowWayBack(gap, seenFor: string | null, last): boolean`. It is false when `seenFor === last`.
- `wayBackPauses(habits: Habit[], gap, today): { habitId: string; from: string; to: string }[]`.
  - It is empty when any habit has a pause with `reason === "way_back"` and `from ≥ today-30`.
  - Otherwise it covers every habit not archived and not paused on `gap.to`.
- `applyWayBack(gap, today)` (actions): appends the pauses through `updateHabit` with `reason: "way_back"`, then sets `dashStore.wayBackSeenFor = last`.
- `wayBackLines(...)`: the three "Here's where you are" strings, with exact formats:
  - `{habit}: {days} days missed · streak paused at {n}`, or `{habit}: {days} days missed · run of {n} ended` when no pause was written, or `{habit}: 🔥 {n} · grace day used`. Top two habits by run.
  - `Today: {h} habits and {t} tasks`.
  - Win: `Your last on-target day was {weekday}` or `Best run so far: {habit}, {n} days`.

- [ ] **Step 1: Failing tests:**
  - `no way back for a fresh install with no activity`;
  - `no way back for one empty day` (today - last = 2);
  - `way back after two empty days` (gap from/to/days);
  - `shown once per lastActiveDay`;
  - `pauses every active habit across the gap`;
  - `pause resumes the streak`: a 12-day run, 3 days away, pauses applied → `streaks().current === 12`;
  - `second way back within 30 days writes no pause` → the lines say `run of 12 ended`;
  - `catch-up log on a gap day still counts`;
  - `wayBackLines formats`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. Add `wayBackSeenFor: string | null` to DashState; it stays local.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: way-back detection and forgiving streak pause`.

### Task 8: Way-back screen

**Files:**
- Create: `mobile/src/app/(sop)/today/welcome-back/index.tsx`, `mobile/src/prototype/screens/welcome-back.tsx`
- Modify: `mobile/src/prototype/screens/today.tsx` (on mount: if `shouldShowWayBack`, `router.push("/today/welcome-back")`)
- Test: `mobile/src/prototype/__tests__/welcome-back.test.tsx` (new)

**Interfaces:**
- Consumes: Task 7 (`wayBackGap`, `applyWayBack`, `wayBackLines`), `sendCapture({text, source, hint:"catch_up", rangeFrom: gap.from})`, live dictation, and the `FernReviewCard` from Task 9.
- `WelcomeBack({ onDone }: { onDone: () => void })`. `onDone` defaults to `router.replace("/today")` and is the future paywall hook.

**Layout and copy (exact):**
- Fern sprite in calm mood.
- `Welcome back.`, then `You were away {N} days. Tell me roughly how they went and I'll fill them in — or skip and start from today.`
- Input with mic. Placeholder: `e.g. last week was chaos — skipped gym, ate takeaway most nights`.
- Primary button `Catch me up` (send icon). Secondary `Start from today`.
- After sending: the capture cards (the existing card component), then the heading `Here's where you are` with the three lines, then `FernReviewCard kind="way_back"` for the gap, then a check-in offer row `Want Fern to ask each evening?` with a switch that sets `push.checkin` to `push.evening || "21:00"`, then `Back to today`.
- "Start from today" calls `applyWayBack` and goes straight to `onDone`.
- No red anywhere on the screen.

- [ ] **Step 1: Failing tests** (mock `sendCapture` and the review client):
  - `shows days away and both buttons`;
  - `catch me up sends catch_up hint with rangeFrom`;
  - `start from today applies pauses and leaves`;
  - `after catch-up shows three lines then review`;
  - `check-in switch sets push.checkin`;
  - `leaving without a button writes nothing`;
  - `today opens welcome-back once`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(mobile): way-back screen`.

### Task 9: `FernReviewCard`, live client, prototype rules, weekly button

**Files:**
- Create: `mobile/src/prototype/companion/review-card.tsx`, `mobile/src/live/review.ts`, `shared/prototype/companion/review-rules.ts` (TS port of the Task 5 rules fallback)
- Modify: `mobile/src/prototype/screens/dash-reviews.tsx` (the `Ask Fern for a review` button that mounts the card)
- Test: `mobile/src/prototype/__tests__/review-card.test.tsx`, `mobile/src/live/__tests__/review.test.ts`

**Interfaces:**
- `fetchReview(input: {kind, fromDay, toDay}): Promise<ReviewOut>`. In live mode it POSTs `/companion/review` with `dismissed` from local storage. In prototype mode it returns `reviewRules(stores, input)`.
- `FernReviewCard({ kind, fromDay, toDay })` renders pending (skeleton), error (the one shared error display with Retry) and loaded states.
- Dismissals are stored at storage key `fern-review-dismissed` as `{title, at}[]`; entries older than 30 days are dropped on read.

**Loaded layout:**
- `Wins`: each line with a green check icon.
- Per gap: `text`, then `how`, then a button.
  - Habit: `Make it a habit` (repeat icon) calls `createHabit({name: title, schedule})`, where `schedule` covers `days_per_week` days spread over the week.
  - Task: `Make it a task` (checkbox icon) calls `createTask({title})`.
  - An × dismiss icon with a11y label `Dismiss suggestion`.
- After a create, the row shows `Added to habits ✓` / `Added to tasks ✓` and links to the item. No toast.

- [ ] **Step 1: Failing tests:**
  - `wins render before gaps`;
  - `make it a habit creates habit with days_per_week schedule and shows Added ✓`;
  - `no toast on create`;
  - `dismiss hides the gap and stores the title`;
  - `stale dismissals expire after 30 days`;
  - `error shows retry`;
  - `long title wraps (no numberOfLines)`;
  - `weekly screen shows Ask Fern button, card only after tap`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(mobile): Fern review card with one-tap habit/task`.

### Task 10: Daily check-in

**Files:**
- Modify: `mobile/src/prototype/local-reminders.ts:69-90` (`MoreReminders.checkin?: { at: string; lastCheckin: string | null }`), `:189` (`planReminders`), and the `syncReminders` inputs
- Modify: `mobile/src/prototype/screens/dash-profile.tsx:772+` (a `Daily check-in` row with a switch and `time-input`)
- Modify: `mobile/src/app/(sop)/capture/index.tsx` and its prototype screen (handle `checkin=1`)
- Test: `__tests__/local-reminders.test.ts` (add), `__tests__/checkin.test.tsx` (new)

**Interfaces:**
- The planned entry has id `checkin` and a `daily {hour, minute}` trigger from `push.checkin`.
  - Title: `How did today go?`
  - Body: `Tell Fern in a sentence — it logs it for you.`
  - href: `/capture?checkin=1`
- When `lastCheckin === today`, emit a one-off `at` entry for tomorrow at that time instead of the daily trigger. The daily entry returns on the next rebuild.
- Quiet hours apply via `inQuiet`.
- The capture screen with `checkin=1` shows Fern's static bubble `How did today go?` (no model call), opens with the mic ready, and sends with `hint: "checkin"`. A send sets `push.lastCheckin = today`.

- [ ] **Step 1: Failing tests:**
  - `plans daily check-in at chosen time`;
  - `no check-in when off`;
  - `skips today when already checked in, schedules tomorrow`;
  - `respects quiet hours`;
  - `checkin link shows Fern question and sends checkin hint`;
  - `settings row toggles and picks time`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(mobile): daily Fern check-in`.

### Task 11: Full verification, screenshots, PR

- [ ] **Step 1:** Run the gates:
  - `make backend-lint`;
  - the env-prefixed full backend suite: `make backend-test`, with POSTGRES_PORT=55440 exported and the Supabase test stack up;
  - `cd mobile && bun run typecheck && bun run lint && bun run test`;
  - `bun run lint` at the root.
  
  All green. Audit the lint diff for hook-dep rewrites.
- [ ] **Step 2:** Take simulator screenshots of the way-back screen (before and after catch-up), the check-in drawer and the review card. Read each one at phone width and check: titles wrap, no red, spacing.
- [ ] **Step 3:** Merge `origin/master`, then open the PR with `gh pr create --repo Real-Solutions-PH/personal-sop --head <branch>`. Use labels `feature`, `mobile`, `backend`. Enable auto-merge.
- [ ] **Step 4:** After the merge, remove the worktree and delete the branch.
