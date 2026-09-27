# M3 Fitness — IA

Date: 2026-09-26 · Module: M3 Fitness (gym · body · nutrition) · Source: [00-intake.md](00-intake.md) · Status: draft for review.

Trace keys: **I-M3a** "Weigh-ins, macros, weights per exercise → progressive overload" · **I-M3b** "Macro logging from meal description/photo via AI… connector to Claude or built-in AI (OpenRouter)" · **C1–C7** hard constraints · **I-M5** chat-first capture · **I-M6** life dashboard / stats / sharing · **I-ENV** PWA realities · **I-FRAME** tentative global frame.

## 1. Jobs to be done

- Log sets (exercise × reps × weight) during a workout without breaking flow — 1 tap per set when repeating last session. (I-M3a, C1)
- Know what to lift today to keep progressing (progressive overload suggestion per exercise). (I-M3a)
- See a lift's progress over time and celebrate PRs. (I-M3a, C2)
- Log a home-cooked meal by photo / voice / text; AI estimates macros; confirm or tweak. (I-M3b, C1, I-M5)
- Know macros left today at a glance. (I-M3a, I-FRAME "macros left")
- Set daily macro targets. (I-M3a)
- Record body weight in ≤2 taps and see the trend, not the daily noise. (I-M3a, I-FRAME "weigh-in prompt", C1)
- Keep using Claude for macros if preferred, with the result landing in the app (connector reading). (I-M3b)
- Share a Strava-style workout card to Instagram stories. (C3)
- Face misses honestly: skipped sessions, stalled lifts, over-target days. (C2)
- Log in a gym with bad signal; never lose a workout to app close/lock. (I-ENV)

## 2. Entities

| Entity | Key fields | Notes |
|---|---|---|
| Exercise | id, name, equipment (barbell/dumbbell/machine/cable/bodyweight), primary muscle, load type (weight / bodyweight+added / reps-only / time), rep range (min–max), weight increment, archived | Seeded library + custom. Rep range + increment drive overload suggestion. |
| WorkoutTemplate | id, name (e.g. "Push A"), ordered exercises with target sets | Optional; "repeat last Push A" works without one (OQ-FIT-3). |
| Workout (session) | id, name, template_id?, started_at, ended_at?, status (in_progress/finished/discarded), notes, client_id | `started_at` timestamps make duration survive app kills. `client_id` for offline idempotent sync. |
| WorkoutExercise | workout_id, exercise_id, order, note | |
| Set | workout_exercise_id, order, reps, weight_kg, kind (warm-up/working/drop/failure), completed_at?, rpe? | `completed_at` null = planned/prefilled, not yet done. RPE optional (Later). |
| RestTimer (client state) | ends_at, duration_s | Timestamp-based; not persisted server-side. |
| WeighIn | id, measured_at, weight_kg, note? | Multiple per day allowed; trend uses daily first/avg (OQ-FIT-6). |
| MacroTarget | effective_from, kcal, protein_g, carbs_g, fat_g, (training-day variant — Later) | Versioned so past adherence uses the target in force then. |
| Meal | id, eaten_at, label (breakfast/lunch/dinner/snack, auto from time), source (photo/voice/text/manual/connector), photo_ref?, raw_input, status (pending_estimate/estimated/confirmed), totals (kcal,P,C,F), ai_confidence | Totals = sum of items; editable at either level. |
| MealItem | meal_id, name, qty + unit, kcal, protein_g, carbs_g, fat_g, ai_assumption (text) | AI shows its assumption ("~1 cup rice, 180 g") so edits are informed. |
| FitnessSettings | units (kg/lb), default rest_s, weekly session target, weigh-in reminder time, AI source (built-in/connector), progression rule | Lives under Me → module config. |

## 3. User journeys

**J1 Log a workout live** — trigger: arrives at gym; Today card "Push A — last done Mon" or Capture "starting push".
1. Today → tap workout card → **FIT-04 Start workout sheet** (Repeat last Push A · Template · Empty).
2. Repeat last → **FIT-05 Active workout**; every set prefilled with last session's reps×weight, or the overload suggestion where one applies (badge "+2.5 kg").
3. Do the set → tap the set's ✓ (1 tap). Rest timer starts in **FIT-08 rest banner**.
4. Did something different → tap the number → **FIT-06 Set edit sheet** (steppers ± increment, ±1 rep) → Done.
5. Add exercise → **FIT-07 Exercise picker** (search, recents first).
6. Finish → **FIT-09 Workout summary** (duration, volume, PRs, vs last time, sets skipped) → Save → optional Share (J7).
- Alt: phone locked / app killed → reopen → **FIT-24 Resume sheet** (resume / finish at last set time / discard).
- Alt: offline → all steps work; sync badge "Saved on device" until reconnect.
- Alt: forgot to start → Capture "did push today, bench 3x8 60, OHP 3x10 35…" → AI builds finished Workout → review in **FIT-09** (backdated).
- Alt: skips a prefilled set → left unchecked → on finish, prompt "3 sets not done — remove / mark done".

**J2 Log a meal by photo** — trigger: plate in front of him.
1. Capture (+) → camera (or Today macros card → 📷) → take photo; optional voice/text hint ("rice is 1 cup, 2 eggs").
2. **FIT-16 Meal estimate review**: items with qty + macros + assumptions, totals, confidence; AI asks ≤1 follow-up only if it can't size something ("Is that fried or boiled?").
3. Confirm (1 tap) → Meal saved → Today macros-left updates.
- Alt: edit an item qty (stepper) → macros scale proportionally.
- Alt: offline → photo queued as Meal `pending_estimate`; shown in **FIT-15** with "estimating when online"; notify/badge when ready to confirm.
- Alt: AI fails / unrecognisable → fall back to text box "describe it" or manual macros.

**J3 Log a meal by chat** — trigger: after eating, no photo.
1. Capture → type/speak "lunch: 1 cup rice, adobo 2 pcs chicken thigh, softdrinks 1 can".
2. AI → **FIT-16** review (same as J2) → Confirm.
- Alt: "same breakfast as yesterday" → AI clones the most recent matching meal → review → Confirm.
- Alt (connector reading, OQ-FIT-1): he chats in the Claude app as today; Claude calls the app's `log_meal` tool; meal appears as `source=connector`, confirmed, visible in **FIT-15**.

**J4 Weigh-in** — trigger: morning; Today weigh-in prompt.
1. Today card "Weigh in" → **FIT-19 Weigh-in sheet** prefilled with last weight, focused numeric keypad/stepper.
2. Adjust → Save (tap 2). Card flips to "72.4 kg · 7-day avg ↓0.3".
- Alt: Capture "72.4" / "weighed 72.4" / photo of scale display → AI writes WeighIn.
- Alt: forgot yesterday → sheet date chip → pick date.

**J5 Review progress on a lift** — trigger: curiosity / plateau.
1. Stats → Fitness → **FIT-26** → tap lift in "Top lifts" (or FIT-05 exercise ⋯ → History, or FIT-10 → exercise).
2. **FIT-11 Exercise detail**: e1RM chart, best set, PR list, last 5 sessions, current suggestion, stall flag.
3. Change range (4w/12w/1y/all).

**J6 Set macro targets** — trigger: first run of nutrition or changing phase (cut/bulk).
1. Me → Fitness settings → **FIT-18 Macro targets** (or empty state on FIT-15 "Set targets").
2. Enter kcal + protein (grams); carbs/fat either entered or auto-split from remaining kcal. Live check P×4 + C×4 + F×9 ≈ kcal.
3. Save → effective from today; past days keep old target.
- Alt: "Help me pick" → AI asks bodyweight/goal and proposes numbers (OQ-FIT-7).

**J7 Share a workout** — trigger: finish screen or past workout.
1. **FIT-09** Share (or **FIT-03** ⋯ → Share) → **FIT-23 Share card composer**.
2. Pick template (Summary / PR highlight / Photo background); toggle fields (bodyweight hidden by default).
3. Share → native share sheet (Web Share API with image file) or Save image.

## 4. Screen inventory

| ID | Screen | Reached from | Purpose | Key content | Actions available |
|---|---|---|---|---|---|
| FIT-01 | Fitness hub | Today cards, Stats, Me → Modules | Module home; segmented **Train · Eat · Body** | Train: next/last workouts, week sessions x/target. Eat: → FIT-15 today. Body: latest weight + trend mini-chart | Start workout, log meal, weigh in, open histories |
| FIT-02 | Workout history | FIT-01 Train | List past workouts | Rows: name, date, duration, volume, PR badge; empty state "No workouts yet — start one"; filter by template/exercise, sort by date | Open, filter, search by name/exercise |
| FIT-03 | Workout detail | FIT-02, FIT-26 | View a finished workout | Exercises + sets, duration, volume, PRs, notes | Edit (→ FIT-05 in edit mode), Repeat, Save as template, Share, Delete (confirm + undo toast) |
| FIT-04 | Start workout sheet | Today card, FIT-01, Capture | Choose how to start | Repeat last X (per template/name, with date), templates, Empty | Start |
| FIT-05 | Active workout | FIT-04, FIT-24, Today "in progress" pill | Live logging | Elapsed (from `started_at`), exercises with set rows prefilled (ghost = last time, badge = suggestion), rest banner, sync state | ✓ set (1 tap), edit set, add/remove set, add/reorder/replace exercise, exercise note, discard, finish |
| FIT-06 | Set edit sheet | FIT-05 set tap | Change reps/weight/kind | Weight stepper (± increment), reps stepper, kind chips, "same as last set" | Save, delete set |
| FIT-07 | Exercise picker | FIT-05, FIT-14 | Find/add exercise | Search, recents, muscle filter; no-results → "Create 'xyz'" | Select (multi), create (→ FIT-12) |
| FIT-08 | Rest timer banner/sheet | Auto after ✓ | Rest countdown | Remaining (from `ends_at`), ±15 s, skip; vibrate/sound on end if foregrounded | Adjust, skip, change default |
| FIT-09 | Workout summary | FIT-05 Finish, Capture backfill | Close the loop, reward | Duration, volume vs last, sets done/planned, PR list, stalled lifts, unfinished-set prompt | Save, edit name/notes, share, discard |
| FIT-10 | Exercise library | Me → Fitness → Exercises | Manage exercises | List grouped by muscle; search; show archived toggle; empty impossible (seeded) | Open, create, archive/unarchive |
| FIT-11 | Exercise detail / progress | FIT-10, FIT-26, FIT-05 ⋯ | Progress on one lift | e1RM chart, PRs, best set, history list, current suggestion, stall flag; empty "No sets logged yet" | Edit (→ FIT-12), range filter, archive |
| FIT-12 | Exercise edit sheet | FIT-10, FIT-11, FIT-07 | Create/edit exercise | Name, equipment, muscle, load type, rep range, increment; duplicate-name warning | Save, archive |
| FIT-13 | Templates list | FIT-01 Train, Me → Fitness | Manage workout templates | Name, exercise count, last used; empty "Save a workout as a template" | Open, create, delete |
| FIT-14 | Template editor | FIT-13, FIT-03 "Save as template" | Define template | Ordered exercises + target sets | Add (FIT-07), reorder, remove, rename, delete |
| FIT-15 | Nutrition day | Today macros card, FIT-01 Eat | Today's intake | Macros-left rings (kcal, P, C, F), meals list with status (pending/estimated), date switcher; empty "Nothing logged — snap your plate"; no-target state → "Set targets" | Log meal (photo/text/voice), recent-meal quick re-log, open meal, change date |
| FIT-16 | Meal estimate review | Capture, FIT-15 | Confirm AI estimate | Photo, items (name, qty, macros, assumption), totals, confidence, follow-up question; error "Couldn't estimate — describe it or enter macros" | Confirm, edit item qty/macros, add/remove item, re-estimate with hint, change time/label, discard |
| FIT-17 | Meal detail/edit | FIT-15 meal tap | View/edit logged meal | Same fields as FIT-16 | Edit, duplicate to today, delete (undo toast) |
| FIT-18 | Macro targets | Me → Fitness, FIT-15 empty state | Set targets | kcal, P, C, F, consistency check, effective date, history of changes | Save, AI-suggest (OQ-FIT-7) |
| FIT-19 | Weigh-in sheet | Today card, FIT-20, Capture | Log weight | Stepper prefilled from last, date/time chip | Save, change date |
| FIT-20 | Body weight | FIT-01 Body, Stats | Trend + log | Chart (raw dots + 7-day avg), weekly rate, list of entries; range filter; empty "First weigh-in sets your baseline" | Add, open entry, range filter |
| FIT-21 | Weigh-in edit sheet | FIT-20 row | Fix an entry | Weight, date/time, note | Save, delete |
| FIT-22 | Fitness settings | Me → Modules → Fitness | Module config | Units, default rest, weekly session target, weigh-in reminder, progression rule, AI source (built-in / Claude connector + token), links to Exercises, Templates, Macro targets | Edit each |
| FIT-23 | Share card composer | FIT-09, FIT-03, FIT-11 (PR), FIT-26 | Make IG-story image | 9:16 preview, template switcher, field toggles, optional photo background | Share (Web Share), save image |
| FIT-24 | Resume workout sheet | App open with `in_progress` workout | Recover | Workout name, started x ago, last set time | Resume, finish (end = last set time), discard |
| FIT-25 | Nutrition history | FIT-15 date switcher "History" | Past days | Calendar/list: kcal & protein vs target per day, colour for hit/over/under; filter range | Open day (FIT-15 at date) |
| FIT-26 | Fitness stats | Stats tab → Fitness | Module analytics | Sessions/week, volume trend, PRs this month, top lifts e1RM, stalls, weight trend, macro adherence, missed sessions | Drill into FIT-11/20/25, share (FIT-23) |

**CRUD coverage check**

| Entity | Create | List | Detail | Edit | Delete/Archive | Empty | Error | Search/filter/sort | Settings |
|---|---|---|---|---|---|---|---|---|---|
| Workout | FIT-04/05, Capture→09 | 02 | 03 | 05 (edit mode) | 03, 05 discard | 02, 26 | 05 sync badge, 24 | 02 | 22 |
| Set | 05 | 05, 03 | 06 | 06 | 06 | 05 "Add set" | 06 validation | — | 22 (rest, rule) |
| Exercise | 12 via 07/10 | 10 | 11 | 12 | 10/12 archive | 11, 07 no-results | 12 duplicate name | 07, 10 | 22 |
| Template | 13, 03 | 13 | 14 | 14 | 13/14 | 13 | 14 empty template | — | 22 |
| Meal / MealItem | Capture→16, 15 | 15, 25 | 17 | 16/17 | 17 | 15 | 16 estimate fail, pending state | 25 range | 22 (AI source) |
| WeighIn | 19 | 20 | 21 | 21 | 21 | 20 | 19 out-of-range confirm | 20 range | 22 reminder |
| MacroTarget | 18 | 18 history | 18 | 18 | — (superseded) | 15 no-target | 18 kcal mismatch warn | — | 22 |

## 5. Function inventory

| ID | Function | Screen(s) | Notes |
|---|---|---|---|
| F-FIT-01 | Start workout (repeat last / template / empty) | FIT-04 | Sets `started_at`; persisted locally first |
| F-FIT-02 | Prefill sets from last session of same template/exercise | FIT-05 | Ghost values = last time |
| F-FIT-03 | Progressive overload suggestion | FIT-05, FIT-11 | Default double progression (OQ-FIT-2) |
| F-FIT-04 | Complete set in 1 tap | FIT-05 | Writes `completed_at`; triggers rest timer |
| F-FIT-05 | Edit/add/delete set | FIT-05, FIT-06 | Steppers use exercise increment |
| F-FIT-06 | Add/reorder/replace/remove exercise in workout | FIT-05, FIT-07 | |
| F-FIT-07 | Rest timer (timestamp-based) | FIT-08 | Recomputes from `ends_at` on resume; local notification only if supported (OQ-FIT-8) |
| F-FIT-08 | Persist in-progress workout across close/lock | FIT-05, FIT-24 | Local store every change |
| F-FIT-09 | Offline logging + sync queue | FIT-05, FIT-15, FIT-19 | Idempotent via `client_id`; "Saved on device" badge |
| F-FIT-10 | Finish workout + summary + PR detection | FIT-09 | PR types in §7 |
| F-FIT-11 | Backfill workout from chat | Capture → FIT-09 | AI parses "bench 3x8 60" |
| F-FIT-12 | Workout history view/edit/delete | FIT-02, FIT-03 | Editing recomputes PRs |
| F-FIT-13 | Exercise library CRUD + archive | FIT-10, FIT-12 | Seeded list; archive keeps history |
| F-FIT-14 | Exercise progress chart & PR list | FIT-11 | |
| F-FIT-15 | Template CRUD, save workout as template | FIT-13, FIT-14, FIT-03 | |
| F-FIT-16 | Meal capture: photo (browser camera / file) | Capture, FIT-15 | `<input capture>` / getUserMedia; compress before upload |
| F-FIT-17 | Meal capture: voice / text | Capture, FIT-15 | Voice → transcript → same parser |
| F-FIT-18 | AI macro estimate with itemised assumptions + ≤1 follow-up | FIT-16 | Built-in via OpenRouter (existing AI module) |
| F-FIT-19 | Confirm/edit estimate; proportional scaling on qty edit | FIT-16, FIT-17 | |
| F-FIT-20 | Quick re-log recent/same meal | FIT-15, Capture | "same as yesterday" |
| F-FIT-21 | Queue meal estimate when offline | FIT-15 | `pending_estimate` status |
| F-FIT-22 | Macros-left computation | FIT-15, Today | target − Σ confirmed+estimated meals of the day |
| F-FIT-23 | Macro target set/version | FIT-18 | Consistency check P4/C4/F9 |
| F-FIT-24 | Weigh-in log/edit/delete | FIT-19, FIT-21 | Prefill last; plausibility guard |
| F-FIT-25 | Weight trend (7-day avg, weekly rate) | FIT-20, FIT-26 | |
| F-FIT-26 | Nutrition history & adherence | FIT-25 | |
| F-FIT-27 | Fitness stats & player-profile feed | FIT-26, Stats | §7 metrics |
| F-FIT-28 | Share card render + Web Share / save | FIT-23 | Client-side image render |
| F-FIT-29 | Claude connector (MCP tools: log_meal, log_weigh_in, log_workout, get_today_macros) | FIT-22 | Per OQ-FIT-1 |
| F-FIT-30 | Weigh-in reminder / workout-day nudge | FIT-22, Today | Web Push only if installed (iOS) |
| F-FIT-31 | Fitness settings | FIT-22 | |

## 6. Today-card & Capture hooks

**Today cards** (each hides when irrelevant):
- **Workout** — "Push A · last Mon · suggested +2.5 kg bench" → Start (FIT-04). While in progress: sticky pill "Push A · 34:12 · 3/5" → FIT-05. After finishing: "Done ✓ 52 min · 1 PR" → share.
- **Macros left** — kcal + protein remaining rings; 📷 and ✏️ shortcuts; pending-estimate count.
- **Weigh-in** — shown until today's weigh-in exists (morning window, OQ-FIT-6); after: weight + 7-day avg arrow.
- **Honest nudge** (weekly) — "2 of 4 sessions this week", "Protein under target 4/7 days".

**Capture examples**

| Input | Resulting record(s) |
|---|---|
| Photo of plate (rice, adobo, egg) | Meal (photo, lunch by time) + 3 MealItems → FIT-16 confirm |
| "breakfast 2 eggs, 2 pandesal, coffee w/ sugar" | Meal + 3 items → FIT-16 |
| "same lunch as yesterday but half rice" | Clone yesterday's lunch, rice qty ×0.5 → FIT-16 |
| "72.4" / "weighed 72.4 this morning" | WeighIn 72.4 kg now → toast with undo |
| Photo of scale display | WeighIn from OCR → FIT-19 prefilled to confirm |
| "starting push" | FIT-04 with "Repeat last Push A" highlighted |
| "did legs: squat 3x5 100, RDL 3x8 80, leg press 3x12 160" | Finished Workout backdated to today → FIT-09 |
| "bench 5 reps 62.5" (during active workout) | Set appended/checked on bench in active workout |
| "how much protein left?" | Answer card (no record) |

## 7. Metrics for Stats & share cards

| Metric | Formula | Shown where | Good/bad framing |
|---|---|---|---|
| Estimated 1RM (e1RM) | Epley: weight × (1 + reps/30), best working set per session, reps ≤ 12 | FIT-11, FIT-26 top lifts, share | ↑ = strength gain |
| PR (per exercise) | New max of: e1RM, heaviest weight for ≥1 rep, most reps at a given weight, session volume | FIT-09, FIT-11, share cards, Stats profile | 🏆 reward badge; count "PRs this month" |
| Session volume | Σ (reps × weight) over completed working sets (bodyweight: reps × (bodyweight + added)) | FIT-09, FIT-03, share | vs last same workout: ↑ green, ↓ neutral grey (not red — deloads exist) |
| Weekly volume per muscle | Σ session volume by exercise primary muscle / ISO week | FIT-26 (Later) | Informational |
| Sessions this week | count finished workouts in ISO week vs weekly target | Today nudge, FIT-26, profile | Hit = streak +1; miss shown plainly "2/4" |
| Training consistency streak | consecutive weeks with sessions ≥ target | FIT-26, profile, share | Reward; broken streak shown, not hidden |
| Missed sessions | max(0, target − sessions) per week, summed over period | FIT-26 | Honest negative |
| Stalled lift | exercise with no e1RM increase across last 3 sessions (≥3 weeks) | FIT-11, FIT-26 | Negative + suggestion (deload/rep change) |
| Overload rate | % of active exercises with e1RM ↑ over last 4 weeks | FIT-26, profile | Headline training stat |
| Weight trend | 7-day moving avg of daily weigh-ins | FIT-20, Today, profile | Good/bad relative to goal direction (OQ-FIT-5) |
| Weekly rate of change | (avg this 7d − avg prev 7d) kg and % of bodyweight | FIT-20, FIT-26 | Flag if faster than ~1%/wk either way |
| Weigh-in consistency | days with weigh-in / days in period | FIT-20, FIT-26 | |
| Calorie adherence | days with kcal within ±10% of target / logged days | FIT-25, FIT-26, profile | Over = "over target" honest count |
| Protein hit rate | days protein ≥ 90% of target / logged days | FIT-25, FIT-26, profile | Reward streak |
| Over-target days | days kcal > target × 1.10 | FIT-25, FIT-26 | Honest negative |
| Logging coverage | days with ≥2 confirmed meals / days in period | FIT-26 | Low coverage = adherence stats labelled "incomplete" |
| Workout duration | ended_at − started_at | FIT-09, share | Informational |

**Workout share card (Strava-style, 9:16)** — workout name + date, duration, total volume (kg), sets completed, exercise list with best set each (top 5, "+2 more"), PR badges with lift + value, week tally "Session 3/4 this week" / streak, app mark. Templates: *Summary* (above), *PR highlight* (one big PR number + e1RM mini-chart), *Photo* (user photo background + stats overlay). Bodyweight and macros off by default. Also: *Weight progress* card (Later, opt-in).

## 8. Edge cases

| Case | Expected behaviour |
|---|---|
| App killed / phone locked mid-workout | State in local storage; on reopen FIT-24 resume; elapsed and rest recomputed from timestamps |
| Workout left in progress for hours (forgot to finish) | After 3 h idle since last set, FIT-24 offers "finish at last set time" (default) |
| Two devices/tabs with same active workout | One active workout at a time; second tab shows read-only "in progress elsewhere" (OQ-FIT-9) |
| No signal in gym | Full logging offline; sync on reconnect; never block ✓ on network |
| Offline meal photo | Saved as pending; estimate runs when online; counts toward macros only after estimate (shown as "+1 pending") |
| Rest timer ends while app backgrounded | No guaranteed alert on PWA; banner shows "Rest over 0:42 ago" on return; Web Push/local notif if supported |
| First time doing an exercise | No prefill; one set row with blank weight and reps = rep-range min; first ✓ requires a weight |
| Exercise renamed/archived | History kept; archived hidden from picker, still in charts |
| Unit change kg↔lb | Stored in kg; display converts; increments snap to unit's plate step |
| Bodyweight/reps-only exercises | Volume uses bodyweight from latest weigh-in; if none, reps only; e1RM skipped for reps-only |
| Warm-up sets | Excluded from volume, PRs, e1RM |
| Typo weight (e.g. 600 instead of 60) | Confirm if > 2× previous best; PR not awarded until confirmed |
| Weigh-in outlier (±3 kg vs 7d avg) | Ask "Sure?" once; keep in raw dots, trend smooths it |
| Multiple weigh-ins same day | All stored; trend uses first of day (OQ-FIT-6) |
| Meal after midnight | Belongs to calendar date of `eaten_at`; editable (OQ-FIT-10 day boundary) |
| AI unsure of portion | One follow-up question max; else default typical PH serving and state assumption |
| AI returns nonsense / fails | Show error state in FIT-16 with text/manual fallback; nothing saved without confirm |
| No macro targets set | Macros card shows totals eaten, "Set targets" CTA; adherence metrics hidden |
| Target changed mid-period | Adherence per day uses target effective that day |
| Deleting a workout that held a PR | PRs recomputed; badge removed; undo toast |
| Days with no meal logs | Excluded from adherence, counted in logging coverage (no fake 100%) |
| Camera permission denied | Fall back to file picker / gallery; explain how to re-enable |
| Connector write from Claude with missing fields | Stored as `estimated`, needs confirm in FIT-15 (OQ-FIT-1) |

## 9. Open questions

| OQ-FIT-n | Question | Proposed default | Why it matters |
|---|---|---|---|
| OQ-FIT-1 | "Connector to Claude" meaning. **(A)** App exposes an MCP server (remote, token/OAuth) added to his Claude app as a custom connector; Claude does the estimating and calls `log_meal` / `log_weigh_in` / `log_workout` / `get_today_macros`. **(B)** Built-in AI in the app's Capture via OpenRouter (existing AI module) doing photo/text estimation. | **B first** (one app, offline queue, Today card loop, reuses `docs/22-ai-module.md`); **A as phase 2** thin layer over the same write endpoints — cheap once B's API exists. | Decides whether meal review UI (FIT-16) is primary or whether the app is mostly a store behind Claude. |
| OQ-FIT-2 | Progressive overload rule | Double progression: when every working set hits rep-range max, suggest +1 increment next session; otherwise +1 rep target. Shown as suggestion, never forced. | Core of "→ progressive overload"; wrong rule = ignored feature. |
| OQ-FIT-3 | Are workout templates / a split (PPL, Upper/Lower) needed, or is "repeat last workout named X" enough? | Lightweight templates (FIT-13/14) + "save workout as template"; no program scheduling. | Adds 2 screens; scheduling programs would be over-engineering (C5). |
| OQ-FIT-4 | Should planned gym days live in M1 Habits schedule (e.g. habit "Gym" Mon/Wed/Fri) or in Fitness? | Weekly session **count** target in Fitness; specific days via M1 habit if he wants reminders. | Avoids two schedulers; affects "missed session" definition. |
| OQ-FIT-5 | Body goal (cut / maintain / bulk, goal weight)? | Optional goal direction + goal weight in FIT-22; without it trend is neutral-coloured. | Needed for good/bad framing of weight trend. |
| OQ-FIT-6 | Which weigh-in counts per day? | First of day (morning); others kept. | Trend accuracy; Today card logic. |
| OQ-FIT-7 | Should the app compute/suggest macro targets (TDEE)? | AI-suggest on request only; he enters final numbers. | Health-advice sensitivity; C5. |
| OQ-FIT-8 | Rest-timer alert when screen off | Best effort: Web Push if installed; otherwise visual only. Accept limitation. | iOS PWA can't reliably fire; sets expectations. |
| OQ-FIT-9 | Multi-device live workout (phone + tablet)? | Single device; others read-only. | Conflict handling complexity. |
| OQ-FIT-10 | Day boundary for meals/stats (he works two jobs — late shifts?) | Calendar midnight, global setting to shift (e.g. 4 am) — decide app-wide. | Adherence and "today" accuracy across modules. |
| OQ-FIT-11 | Meal photos: keep or discard after estimate? | Keep (compressed) for review/edits; auto-delete after 90 days. | Storage cost, privacy. |
| OQ-FIT-12 | Track micros, water, fibre? | No — kcal + P/C/F only. | Scope (C5). |
| OQ-FIT-13 | Units default | kg, 2.5 kg barbell / 2 kg dumbbell increments (PH gyms). | Prefill correctness. |
| OQ-FIT-14 | Cardio (runs, treadmill) in scope? | Time/distance-only load type exists, no GPS/pace. | Strava analogy could imply running; intake says gym. |
| OQ-FIT-15 | Wearables / Apple Health / smart scale integration? | Out of scope. | C5; no third-party integrations stated. |

## 10. Later / out of scope

- Later: MCP Claude connector (if OQ-FIT-1 default holds); weight-progress & monthly-recap share cards; weekly volume per muscle; RPE/RIR capture; training-day vs rest-day macro targets; saved foods library/barcode (labels not the use case); plate calculator; superset grouping; AI weekly fitness review ("where you went wrong"); social comparison/feed (C3 wish — cross-module decision).
- Out: program periodisation builder, wearables/Health sync, micronutrients, GPS cardio, body-fat/measurements & progress photos (not in intake — add via OQ if wanted).

## 11. Frame feedback

- **Active workout needs a persistent surface**: a sticky "workout in progress" pill above the tab bar (like a music mini-player) so switching to Today/Capture mid-workout never loses the session. Propose as a global pattern (M1 routine mode / habit timer need the same).
- **Capture is context-aware**: during an active workout, Capture should default to logging sets into it; otherwise to meal/weigh-in. Needs a global rule.
- **Fitness hub (FIT-01) placement**: not a tab; reachable from Today cards, Stats → Fitness, and Me → Modules. Suggest Stats → module sections double as module entry points to avoid a hidden hub.
- **Day boundary** (OQ-FIT-10) and **units/locale** should be global settings, not per module.
- **Me holds config** (exercises, templates, targets) as the frame says, but day-to-day entry points to FIT-10/13 also live on FIT-01 so config isn't buried.
