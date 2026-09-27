# M6 Dashboard, Stats, Rewards & Sharing — IA

Date: 2026-09-26 · Source: [00-intake.md](00-intake.md) (cited as `L<n>`) · Status: draft for IA review.
Scope: Today tab, Stats tab ("player profile"), goals, rewards, misses/leaks, periodic reviews, share cards, Me tab (profile, settings shell, module-config entry points), first-run onboarding, and the global frame.
M6 **owns no source data**. It reads aggregates that M1–M5 expose through named **metric slots** (§7) and owns only Goals, Achievements, Reviews, ShareCards, ProfileSettings and LifeAreas.

---

## 1. Jobs to be done

- **See today at a glance, then act in one tap.** Open the app and in under 5 s know what is due and what is left, with every item one tap from done. (L65 "home … main dashboard of his life"; L80–82 Today contents; L17–21 C1)
- **Close the day with little effort.** An evening wrap-up that confirms what happened and flags what slipped, without manual re-entry. (L17–21 C1; L22–24 "reflection on negative")
- **Know how I'm doing, like a game account page.** A profile of real life metrics (on-target rate, streaks, PRs, savings rate) over time ranges, compared with the previous period. (L10–13 Mobile Legends profile; L22–24 C2; L85)
- **Set goals on metrics and improve them.** Any headline metric can become a target, and progress is shown. (L22–24 "metrics he can set goals on and improve")
- **Get rewarded for real progress.** PRs, streak milestones, personal bests and goals hit are marked and celebrated, all tied to real stats. (L22–24 "rewards for positive behaviour")
- **See misses honestly.** One place for missed habits, overdue tasks, budget overruns and macro misses, where nothing is hidden and nothing shames. (L22–24 "clear, non-hidden reflection on negative behaviour")
- **Review periodically.** A weekly and monthly recap that shows what went right and wrong and asks for one improvement. (L57 look-back evaluation, generalised; L22–24)
- **Brag with good-looking share cards.** Export Strava-style IG story cards without leaking private numbers. (L12–13; L25–26 C3)
- **(Wish) interact with others.** (L25–26 "social interaction … mentioned as a wish") The intake gives two readings; see OQ-DSH-1.
- **Configure once, then forget it.** Profile, notifications, enabled modules, and entry points to each module's config. (L86)
- **Get set up on a phone.** Install the PWA and enable notifications, because iOS push only works when the app is installed. (L74–76)
- **Cover every life area he named.** Productivity, physical, career, work, company, finances, habits, routines, journal and identity must appear somewhere without each needing its own module. (L66–67; L28 C5)

## 2. Entities

| Entity | Key fields | Notes |
|---|---|---|
| **MetricSlot** (read-only contract) | `key` (e.g. `habits.completion_rate`), `source_module`, `unit` (%, count, ₱, kg, min), `direction` (higher/lower better), `aggregation` (sum/avg/latest/rate), `goalable`, `shareable`, `sensitive` | This is a registry, not a table the user edits. Each module registers its slots, and M6 renders whatever is registered and enabled. |
| **Goal** | `id`, `metric_key`, `target_value`, `comparator` (≥/≤), `period` (day/week/month/by-date), `start_date`, `end_date?`, `area_id?`, `status` (active/hit/missed/archived), `created_via` (manual/AI) | Goals exist only on MetricSlots where `goalable = true`. There are no free-text goals (those are tasks, M2). |
| **Achievement** | `id`, `type` (PR / streak_milestone / personal_best / goal_hit / first), `metric_key`, `value`, `previous_best?`, `achieved_at`, `source_ref` (e.g. set id), `seen` | Created by rules, never by hand. Holds no points and no XP. |
| **Review** | `id`, `period` (week/month), `range_start`, `range_end`, `snapshot` (frozen metric values + deltas), `wins[]`, `misses[]`, `reflection_text?`, `next_focus?`, `ai_summary?`, `completed_at?` | The snapshot is frozen so the review does not drift when data is edited later. The reflection text doubles as the **journal** (OQ-DSH-4). |
| **DaySummary** (derived) | `date` (local, with day boundary), `due_count`, `done_count`, `on_target` (bool), `logged` (bool), per-slot values | Cached aggregate behind Today, on-target rate, streaks and misses. |
| **Miss** (derived) | `date`, `kind` (habit_missed / task_overdue / budget_over / macro_off / goal_behind / no_log), `ref`, `module`, `resolution?` (rescheduled / adjusted / dismissed / noted) | Drives the Misses & Leaks view. The user can annotate a miss but cannot delete it. |
| **LifeArea** | `id`, `name`, `icon`, `enabled`, `order` | Seeded with the 10 named areas (L66–67). Habits, tasks and goals can carry an `area_id` tag. See OQ-DSH-3. |
| **IdentityStatement** | `id`, `text` ("I'm someone who trains 4×/week"), `linked_goal_ids[]` | Shown in the profile header, which is the "identity" area (OQ-DSH-4). Maximum of 3. |
| **ShareCard** (ephemeral) | `template`, `format` (9:16 / 1:1), `range`, `fields_visible{}`, `theme`, `show_handle` | Rendered on the client and not stored server-side (OQ-DSH-8). Only the last-used privacy toggles persist, per template. |
| **ProfileSettings** | `display_name`, `handle`, `avatar`, `timezone`, `day_start_hour`, `week_start`, `currency` (PHP), `units` (kg), `target_threshold`, `enabled_modules[]`, `notification_prefs{}`, `share_privacy_defaults{}`, `theme`, `onboarded_at` | One row per user, since this is a single-user app (L3). |

## 3. User journeys

**J1 Morning glance.** Trigger: the user opens the app, or taps the morning push.
1. **DSH-10 Today** (morning variant) opens with a greeting, then the day status ring (0/N done), Next up, the routine CTA, and the rest of the cards (§6).
2. The user taps ✓ on a habit chip. It completes inline and the ring updates.
3. The user taps **Start routine**, which opens M1's routine player. When the player finishes, the user returns to DSH-10.
- Alt A, weigh-in pending: the user taps the weigh-in card, a DSH-15 quick-number sheet opens, the user saves, and the card collapses.
- Alt B, nothing scheduled: **DSH-11** shows the empty day (§6).
- Alt C, offline: cards render from cache, taps queue, and the **DSH-50** banner shows.

**J2 Evening wrap-up.** Trigger: the evening push at the configured time, or the "Wrap up" card on DSH-10 after 18:00.
1. **DSH-12 Wrap-up sheet** lists the day's still-open items with 1-tap ✓ / ✗ / → tomorrow for each.
2. It shows the day result: "On target" or "Off target", the done/due count, spend today, and macros hit or missed.
3. An optional one-line "How was today?" is typed or spoken, which is the journal (OQ-DSH-4).
4. The user taps Done. The day is sealed, the streak updates, and any new Achievement appears in **DSH-25**.
- Alt A: the user skips the wrap-up. Items stay open and auto-seal at the day boundary, and unticked items become Misses without penalising the logging streak twice.
- Alt B: the user taps "See misses" to open **DSH-13**.

**J3 Set a goal on a metric.** Trigger: the ⊕ Goal action on any metric.
1. From **DSH-20 Stats** or **DSH-21 Metric detail**, the user taps **Set goal**.
2. **DSH-23 Goal editor** opens, prefilled with a suggested target (the last period's value +10%, rounded) and the period.
3. The user saves, and a goal progress bar appears on DSH-21, DSH-20 and (if the goal is daily or weekly) the Today goals card.
- Alt A: the user types "goal: save 30% this month" in Capture. M5 creates the goal draft and DSH-23 opens for confirmation.
- Alt B: the metric is not goalable (for example, raw weight is sensitive). DSH-23 offers the change-based variant ("lose 2 kg by Dec 1").

**J4 Hit a PR or milestone.** Trigger: data saved in any module crosses a rule.
1. The rule fires and creates an Achievement.
2. If the user is in-app, a toast appears. The next open of Today or Stats shows **DSH-25 Achievement sheet** with the value, previous best and date.
3. The user taps **Share**, which opens **DSH-30** prefilled with the matching template, or taps Close.
4. The achievement lives in **DSH-24 Trophy case**.
- Alt A: several achievements fire at once and DSH-25 pages through them (maximum 3, the rest go to DSH-24).
- Alt B: an edit revokes a PR (bad data). The achievement is marked revoked and hidden from the case, with no notification.

**J5 Weekly review.** Trigger: a push at the week-start day and hour (default Sunday 19:00), or the Review card on Today.
1. **DSH-27 Review** opens, with the headline deltas vs the previous week first.
2. **Wins**: achievements, goals hit, best day.
3. **Misses & leaks**: the top 3 by impact, each with a Recover action (reschedule, adjust target, note).
4. An optional **AI summary** (M5) gives two sentences and one suggestion.
5. **Next focus**: pick 1 metric, which offers to set or adjust its goal (goes to DSH-23).
6. The user marks the review done. It is archived in **DSH-26**, and the user can share it (DSH-30, weekly recap template).
- Alt A: the monthly review follows the same flow with month range, adding the finance look-back section (M4 slots).
- Alt B: the user misses the review. It stays "Pending" on DSH-26 and the Today card appears for 2 days, then it auto-archives unreviewed (the snapshot is still frozen).

**J6 Share a recap to an IG story.** Trigger: Share from a review, achievement, metric, or DSH-40.
1. **DSH-30 Share composer** opens with the template picker (§8), the format toggle (9:16 / 1:1), the range, and a live preview.
2. The user adjusts field toggles. Sensitive fields are off by default.
3. The user taps **Share**, which opens **DSH-31 Privacy check** (J8), and then taps **Confirm**.
4. The client renders a PNG and calls the Web Share API with the file, and the user picks Instagram then Story.
- Alt A: the Web Share API with files is unsupported. The PNG downloads and **DSH-32** shows "Saved, open Instagram → Story → pick from gallery".
- Alt B: rendering fails. DSH-32 shows the error with a Retry button.

**J7 First-run onboarding.** Trigger: the first sign-in.
1. **DSH-01 Welcome** gives a one-line value prop and hands off to Supabase sign-in (platform-owned).
2. **DSH-02 Install app** shows platform instructions (iOS: Share → Add to Home Screen; Android: native prompt). The user can skip.
3. **DSH-03 Notifications** explains the morning, evening and review pushes and requests permission. This step appears only if the app is installed on iOS. Otherwise the user sees "enable after install".
4. **DSH-04 Pick modules** shows toggles for Habits, Tasks, Fitness and Finance. Capture is always on.
5. **DSH-05 Starter targets** offers ≤1 target per enabled module (e.g. habits/day, daily protein, monthly budget) with skippable, sensible defaults.
6. **DSH-06 You're set** lands on DSH-10 (first-day state).
- Alt A: the user opens the app in a browser, not installed. A persistent install nudge appears on DSH-40 plus a one-time banner on Today (L74–75).
- Alt B: the user denies notifications. Settings shows how to re-enable, and Today works without push.

**J8 Privacy check before sharing.** Trigger: the user taps Share in DSH-30.
1. **DSH-31** shows the exact final image plus a checklist of what's visible: name or handle, date range, and each metric, flagged "sensitive" where applicable (₱ amounts, body weight, task titles, journal text).
2. If any sensitive field is on, it is highlighted with "This shows ₱ amounts, continue?".
3. The user taps Confirm, which proceeds to the share, or taps Edit, which returns to DSH-30.
- Alt A: the user taps "Remember these as defaults for this template", which updates `share_privacy_defaults`.

## 4. Screen inventory

This is a closed list. Module screens (M1 routine player, M2 task detail, M3 exercise log, M4 accounts, M5 chat) are owned by their siblings and only linked from here.

| ID | Screen | Reached from | Purpose | Key content | Actions available |
|---|---|---|---|---|---|
| DSH-01 | Welcome | First launch | Entry and auth handoff | Value prop, sign-in button | Sign in |
| DSH-02 | Install app | DSH-01; DSH-40 nudge | Get the app installed as a PWA | Platform-specific steps, illustration | Install (Android prompt), I did it, Skip |
| DSH-03 | Enable notifications | DSH-02 | Request push permission | What pushes are sent (morning, evening, review, reminders) | Allow, Not now |
| DSH-04 | Pick modules | DSH-03 | Enable modules | 4 toggles (Capture fixed on) | Toggle, Next |
| DSH-05 | Starter targets | DSH-04 | Seed ≤1 goal per module | Prefilled targets per enabled module | Edit value, Skip, Next |
| DSH-06 | You're set | DSH-05 | Close onboarding | Summary, tip to use Capture | Go to Today |
| DSH-10 | Today | Tab; push; app open | Glanceable, actionable day | Cards per §6; header with date, day ring, bell | 1-tap per card; open module; open inbox |
| DSH-11 | Today: empty day | DSH-10 when nothing is due | Avoid a blank screen | Empty illustration, suggestions | Add habit, Add task, Capture, Plan tomorrow |
| DSH-12 | Evening wrap-up (sheet) | DSH-10 card; evening push | Seal the day | Open items, day result, 1-line reflection | ✓/✗/→ per item, Voice note, Done |
| DSH-13 | Misses & leaks | DSH-12; DSH-20; DSH-27; Today misses chip | Honest negative view | Misses grouped by module, range selector, trend vs prior period | Reschedule, Adjust target, Add note, Open source |
| DSH-14 | Notifications inbox | Bell (global header) | History of pushes and in-app alerts | List: reminders, achievements, reviews due | Open item, Mark all read |
| DSH-15 | Quick-number sheet | Today weigh-in / quick-log cards | 1-field log without leaving Today | Number pad, unit, last value | Save, Open module |
| DSH-20 | Stats profile | Tab | "Player profile" | Profile header, headline stats, area sections, range + compare (§7) | Change range, Open metric, Set goal, Share, Misses, Trophy case, Reviews |
| DSH-21 | Metric detail | DSH-20; DSH-27; goal card | Deep view of one metric | Chart, current vs prior, best, goal progress, contributing items | Change range, Set/edit goal, Share, Open source module |
| DSH-22 | Goals | DSH-20; DSH-40 | All goals | Active, Hit, Missed/archived tabs with progress bars | Open, Edit, Archive, New goal |
| DSH-23 | Goal editor (sheet) | DSH-21; DSH-22; DSH-27; Capture | Create or edit a goal | Metric, comparator, target, period, dates, area | Save, Delete (active only), Cancel |
| DSH-24 | Trophy case | DSH-20; DSH-40 | Every earned achievement | Grouped by type (PRs, streaks, bests, goals), dated | Open, Share |
| DSH-25 | Achievement unlocked (sheet) | Rule firing; DSH-24 | Celebrate one real stat | Value, prior best, delta, date, source | Share, Close, View metric |
| DSH-26 | Reviews | DSH-20; DSH-40; Today card | Review archive | Week/month list, pending badge | Open, Start pending |
| DSH-27 | Review (week/month) | DSH-26; push; Today card | Guided recap | Deltas, wins, misses top-3, AI summary, reflection, next focus | Recover per miss, Set focus goal, Share, Mark done |
| DSH-29 | Stats: not enough data | DSH-20/21 when data <3 days | Explain empty stats | "Stats appear after 3 logged days", checklist | Go to Today, Capture |
| DSH-30 | Share composer | Share from DSH-20/21/24/25/27/40 | Build a card | Template picker, format, range, field toggles, theme, live preview | Switch template/format, Toggle fields, Share, Download |
| DSH-31 | Privacy check (sheet) | DSH-30 Share | Final consent on visible data | Exact image plus a visible-fields checklist with sensitive flags | Confirm, Edit, Remember as defaults |
| DSH-32 | Share result / fallback | DSH-31 | Outcome feedback | Shared, saved (with IG steps), or error | Done, Retry, Open image |
| DSH-40 | Me | Tab | Profile hub | Avatar, name, handle, identity statements, install nudge, links | Edit profile, Share profile card, Goals, Trophies, Reviews, Settings, Modules |
| DSH-41 | Edit profile | DSH-40 | Identity and card identity | Name, handle, avatar, ≤3 identity statements | Save, Link statement to goal |
| DSH-42 | Settings | DSH-40 | Settings hub (shell) | Sections → DSH-43 to DSH-48 | Navigate |
| DSH-43 | Notification settings | DSH-42; DSH-03 denied | Push schedule | Morning/evening/review times, per-module toggles, permission status | Toggle, Set times, Test push |
| DSH-44 | Modules & config | DSH-42; DSH-40 | Enable modules and enter module config | Module toggles; links to M1 habits/routines, M2 lists, M3 exercises/macros targets, M4 accounts/categories/budgets | Toggle, Open module config |
| DSH-45 | Sharing & privacy defaults | DSH-42; DSH-31 | Default field visibility | Per-template toggles, handle on/off, watermark | Toggle, Reset |
| DSH-46 | Day & time | DSH-42 | Day definitions | Timezone, day-start hour, week start, on-target threshold | Edit |
| DSH-47 | Life areas | DSH-42; DSH-41 | Manage areas | 10 seeded areas, enabled/disabled, order | Toggle, Reorder, Rename |
| DSH-48 | Data & account | DSH-42 | Account shell | Export (JSON/CSV), sign out, delete account | Export, Sign out, Delete (confirm) |
| DSH-50 | Offline banner (global state) | Any screen | Signal cached or queued data | "Offline, N changes queued" | Retry |
| DSH-51 | Card/metric error state (global state) | Any card or metric | Localised failure | "Couldn't load X" inline | Retry |

**Total: 35 screens** (DSH-28 intentionally unused; the Misses period view is DSH-13 with a range).

## 5. Function inventory

| ID | Function | Screen(s) | Notes |
|---|---|---|---|
| F-DSH-01 | Render Today cards from enabled modules' slots | DSH-10 | Card order per §6. Disabled modules' cards are hidden. |
| F-DSH-02 | 1-tap complete / skip / snooze on a card item | DSH-10, DSH-12 | Writes through to the owning module (M1/M2). Optimistic and offline-queued. |
| F-DSH-03 | Morning/evening Today variant switch | DSH-10 | Based on local time vs day-start hour and the evening wrap-up time. |
| F-DSH-04 | Quick-number log (weigh-in etc.) | DSH-15 | Writes to M3. |
| F-DSH-05 | Seal day (wrap-up or auto at boundary) | DSH-12 | Computes DaySummary, `on_target`, streaks and Misses. |
| F-DSH-06 | Day reflection (text or voice) | DSH-12, DSH-27 | Voice goes through M5 transcription. Stored as the journal entry (OQ-DSH-4). |
| F-DSH-07 | Compute DaySummary / on-target day | background | `on_target = done/due ≥ target_threshold` (default 80%). A day with nothing due is neutral. |
| F-DSH-08 | Streak computation (on-target streak, logging streak, per-habit via M1) | DSH-20, DSH-10 | Neutral days neither break nor extend a streak. |
| F-DSH-09 | Derive Misses | DSH-13 | Rules per kind (§9). Misses are annotatable, not deletable. |
| F-DSH-10 | Recover a miss (reschedule / adjust target / note) | DSH-13, DSH-27 | Reschedule and adjust call into the owning module. |
| F-DSH-11 | Notifications inbox | DSH-14 | Stores the last 30 days. |
| F-DSH-12 | Stats profile render with range + compare | DSH-20 | Ranges are 7d / 30d / 90d / YTD / All. Compare against the previous equal period. |
| F-DSH-13 | Metric detail chart + contributors | DSH-21 | Contributors are the top items driving the value (e.g. which habits dragged the rate down). |
| F-DSH-14 | Create/edit/archive goal | DSH-22, DSH-23 | Suggested target is the prior period ×1.1 for higher-better and ×0.9 for lower-better. |
| F-DSH-15 | Goal progress evaluation | DSH-10, DSH-20–22 | Status transitions: active → hit/missed at period end. Recurring goals roll over. |
| F-DSH-16 | Achievement rule engine | background → DSH-25 | Rule types: PR, streak milestone (7/30/100/365), personal best (best week/month of a metric), goal hit, first-time. |
| F-DSH-17 | Achievement sheet + queue | DSH-25 | Shows at most 3 per open. The rest go to the trophy case. |
| F-DSH-18 | Trophy case | DSH-24 | |
| F-DSH-19 | Generate review snapshot (weekly/monthly) | DSH-26, DSH-27 | Runs at the period boundary in the user's timezone and is frozen once generated. |
| F-DSH-20 | Review AI summary + suggestion | DSH-27 | Calls M5/AI. Optional, can be hidden. |
| F-DSH-21 | Set next focus from a review | DSH-27 → DSH-23 | |
| F-DSH-22 | Share: template render (client-side DOM → PNG) | DSH-30 | Renders at 1080×1920 (9:16) and 1080×1080 (1:1). |
| F-DSH-23 | Share: field privacy toggles + defaults | DSH-30, DSH-31, DSH-45 | Sensitive slots are off by default. |
| F-DSH-24 | Share: privacy check | DSH-31 | Always shown before sharing. Cannot be disabled (OQ-DSH-9). |
| F-DSH-25 | Share: Web Share API (files) / download fallback | DSH-31, DSH-32 | Checks `navigator.canShare({files})`, otherwise downloads the PNG. |
| F-DSH-26 | Profile + identity statements | DSH-40, DSH-41 | |
| F-DSH-27 | PWA install detection + instructions | DSH-02, DSH-40 | Uses display-mode standalone detection. Android uses `beforeinstallprompt`. iOS gets manual steps. |
| F-DSH-28 | Push permission + subscription | DSH-03, DSH-43 | On iOS, requires the app to be installed (L74–75). |
| F-DSH-29 | Scheduled pushes (morning, evening, review) | DSH-43 | Module reminders (M2) are owned by M2. This only covers the M6 digest pushes. |
| F-DSH-30 | Module enable/disable + config entry points | DSH-04, DSH-44 | Disabling a module hides it and keeps its data. |
| F-DSH-31 | Day & time settings | DSH-46 | Changing the timezone or day start recomputes only future days (§9). |
| F-DSH-32 | Life areas manage + tag aggregation | DSH-47, DSH-20 | See OQ-DSH-3. |
| F-DSH-33 | Data export | DSH-48 | JSON or CSV of all modules. |
| F-DSH-34 | Offline cache + queued writes indicator | DSH-50 | Actual capture queueing is owned by M5. |
| F-DSH-35 | Onboarding flow + starter targets | DSH-01–06 | Starter targets create Goals. |

**Total: 35 functions.**

## 6. Today layout

The header shows the date, a **day ring** (done/due, e.g. 5/8), the current on-target streak 🔥n, and the bell (DSH-14). Cards follow, in this order. Each card hides itself when its module is disabled or it has nothing to show.

1. **Next up.** The single most time-relevant item: the next scheduled habit or task, or a reminder due within 2 h. **1-tap:** ✓ Done (or ▶ Start timer for a timed habit, M1).
2. **Routine CTA.** The routine scheduled for now (M1): name, step count and estimated duration. **1-tap:** ▶ Start routine.
3. **Habits due.** Chips for today's habits, grouped by time of day. **1-tap:** tap a chip to toggle done, long-press for skip or partial.
4. **Tasks due / overdue.** Up to 3 tasks plus "+N more" (M2). **1-tap:** ✓ per task. Tapping the header opens Plan.
5. **Macros left.** Remaining kcal, P, C and F as rings (M3). **1-tap:** 📷 Log meal, which opens Capture in photo mode (M5).
6. **Weigh-in.** Shown only on scheduled weigh-in days or if no weigh-in in 7 days (M3). **1-tap:** opens DSH-15.
7. **Spend today.** ₱ spent today vs daily allowance derived from the budget, plus the projected month-end savings delta (M4). **1-tap:** 🎤 Log expense, which opens Capture in voice mode.
8. **Goals in play.** Up to 2 daily or weekly goals with progress bars. **1-tap:** open DSH-21.
9. **Contextual card** (one at a time): a pending review, a new achievement, a misses nudge ("3 misses yesterday"), or an install nudge. **1-tap:** Open.

Morning and evening differ as follows:

| | Morning (day start → 17:59) | Evening (18:00 → day end, configurable) |
|---|---|---|
| Top | Next up + Routine CTA (morning routine) | **Wrap-up card**: "N items open, wrap up" → opens DSH-12 |
| Emphasis | What's due | What's left, today's result so far |
| Macros/Spend | Budget for the day | Remaining vs target, with over or under stated plainly |
| Contextual | Weigh-in, review due | Tomorrow preview (first 3 items) |

**Empty-day state (DSH-11)** has three cases:
- **New user:** "Your dashboard fills as you log," followed by 3 starter actions: Add a habit, Capture anything, Set a budget.
- **Existing user, nothing due:** "Free day." The day is neutral and the streak is safe. Actions: Plan tomorrow, Capture, and optionally Log a workout.
- **All done:** the ring is full with "Target hit ✓". Actions: Share streak (goes to DSH-30) and Wrap up.

## 7. Stats profile

**Stance (C2, L22–24).** The profile shows stats, not game mechanics. It has **no XP or XP levels, no avatars or cosmetics, no coins, no leaderboards**. The Mobile Legends analogy is carried by *framing* (a profile header with headline numbers and records) rather than by game systems. OQ-DSH-2 considers a single composite score, and the default is **no**.

**Layout of DSH-20:**
1. **Profile header**: avatar, name, handle, up to 3 identity statements, and "Member since".
2. **Headline row (4 hero stats, the "account page")**: **On-target rate** · **Current / best on-target streak** · **Habit completion %** · **Savings rate %**. If a module is disabled, the next enabled hero stat takes its slot (order: task completion %, training days, macro adherence %).
3. **Records strip**: the latest 3 achievements, linking to DSH-24.
4. **Area sections**: collapsible sections for Habits & Routines, Productivity (Tasks), Physical, and Finance. Each shows 3–4 metrics plus a link to the module's own analytics screen (owned by M1–M4).
5. **Misses & leaks** summary: count by kind vs the prior period, linking to DSH-13.
6. **Goals**: active goal progress, linking to DSH-22.

**Time ranges** are 7d (default), 30d, 90d, YTD and All. **Comparison** is always against the previous equal-length period, shown as ▲/▼ with absolute and % delta. Green or red is based on the metric's direction (e.g. spend ▲ is red).

| Metric | Source module | Formula | Goal-able? | Shareable? |
|---|---|---|---|---|
| On-target rate | M6 (over M1+M2) | on-target days ÷ non-neutral days in range; on target = done/due ≥ threshold (80%) | Yes | Yes |
| On-target streak (current/best) | M6 | consecutive on-target days; neutral days skipped | Yes | Yes |
| Logging streak | M6 (all) | consecutive days with ≥1 record in any module | No | Yes |
| Habit completion rate | M1 | habit check-ins done ÷ scheduled | Yes | Yes |
| Per-habit streak | M1 | M1-defined | Yes | Yes |
| Routine completion rate | M1 | routines finished ÷ routines started or scheduled | Yes | Yes |
| Focus time | M1 (timers) | Σ timed durations | Yes | Yes |
| Task completion rate | M2 | tasks completed by due date ÷ tasks due in range | Yes | Yes |
| Tasks completed | M2 | count done in range | Yes | Yes |
| Overdue count | M2 | open tasks past due at range end | Yes (≤) | No |
| Training days | M3 | days with ≥1 workout | Yes | Yes |
| Volume lifted | M3 | Σ sets × reps × weight | Yes | Yes |
| PRs set | M3 | count of new per-exercise best (e1RM or weight × reps) | No | Yes |
| Macro adherence | M3 | days within ±10% of kcal and protein target ÷ days logged | Yes | Yes |
| Protein avg | M3 | mean daily grams | Yes | Yes |
| Body weight / change | M3 | latest; Δ vs range start | Yes (change) | Change only, off by default (sensitive) |
| Savings rate | M4 | (income − expense) ÷ income | Yes | Yes (% only) |
| Spend vs budget | M4 | Σ expense ÷ Σ budget (%) | Yes (≤) | Yes (% only) |
| Budgets kept | M4 | budgets ≤100% ÷ active budgets | Yes | Yes |
| No-spend days | M4 | days with 0 discretionary expense | Yes | Yes |
| Projected month-end savings | M4 | M4 projection | Yes | % of target only |
| Net spend ₱ | M4 | Σ expense | Yes (≤) | No (sensitive) |
| Reviews completed | M6 | reviews done ÷ reviews due | Yes | No |
| Reflection days (journal) | M6 | days with a reflection entry | Yes | No (text never shared) |

M4 owns the per-module analytics for finance (the look-back, L57) and M1 owns the habit heatmaps. DSH-20 shows only the summary slots above.

## 8. Share card templates

All cards are rendered on the client (DOM → PNG at 1080×1920 or 1080×1080) and shared via the Web Share API with files, falling back to a download. Each card carries the app mark (can be switched off) and the handle (off by default). There are two themes, dark (default, IG-friendly) and light.

| Template | Content | Formats | Privacy defaults |
|---|---|---|---|
| **Weekly recap** | Week range; on-target rate, habit %, training days, savings rate %; ▲/▼ vs last week; top achievement | 9:16, 1:1 | ₱ amounts are never available; body weight off; handle off |
| **Monthly recap** | Month; the 4 hero stats; PR count; best streak; one "month highlight" line | 9:16, 1:1 | Same as weekly |
| **Streak** | Big number (on-target streak or a chosen habit streak), a 30-day dot grid, habit name | 9:16, 1:1 | Habit name on (it can be generic, e.g. "Morning routine") |
| **Workout** | Date, session name, duration, volume, top 3 lifts (sets × reps × kg), PR badges | 9:16, 1:1 | Body weight off; lift weights on |
| **PR / achievement** | The achievement value, previous best, delta, date | 9:16, 1:1 | On |
| **Finance %** | Savings rate, spend vs budget %, budgets kept, no-spend days; trend sparkline without a y-axis scale | 9:16, 1:1 | **Percentages only. ₱ amounts cannot be shown on any card** (OQ-DSH-7) |
| **Player profile** | Profile header, 4 hero stats (all-time or YTD), records strip | 9:16 | Identity statements off |
| **Goal hit** | Goal, target, achieved value, timeframe | 9:16, 1:1 | Finance goals shown as % of target |

Rules that apply to every template: task titles, journal text and account names are **never** renderable. Sensitive slots (`sensitive = true`) start off, and each one needs a toggle plus the DSH-31 privacy check.

## 9. Edge cases

| Case | Expected behaviour |
|---|---|
| New user, no data | Today shows DSH-11 new-user state; Stats shows DSH-29 until 3 logged days; no achievements are awarded in the first 24 h except "first" types; comparisons are hidden until a full prior period exists. |
| Missing days (app not opened) | Days auto-seal at the boundary. Unticked habits become misses, but a day with no activity at all counts as **off target** only if items were due. Logging streak breaks. There is no backfill nag: one Today card offers "Fill in yesterday?" for 24 h only. |
| Late-night user (two jobs) | `day_start_hour` defaults to 04:00, so 01:30 still counts as "yesterday" (OQ-DSH-5). |
| Timezone change / travel | Days are computed in `ProfileSettings.timezone`, which updates on detection only with a prompt. Past DaySummaries are never recomputed. A day may be 23 h or 25 h long. |
| Retroactive edit (e.g. correcting a lift) | DaySummary and stats recompute. A PR that no longer holds is revoked silently. Frozen review snapshots are **not** changed, but get an "edited since" marker. |
| One module disabled | Its cards, headline stat, area section, share-card fields and misses are hidden. On-target rate recomputes without its items from the disable date. Past data is kept, and re-enabling restores it. |
| All modules disabled except Capture | Today shows the Capture CTA plus the logging streak only. Stats shows the logging streak and reviews. |
| Nothing due today | Neutral day: it does not affect on-target rate or streak (§6 empty state). |
| Very high item count (e.g. 20 habits) | Habits card shows the time-of-day group due now plus "+N". The ring still counts all of them. |
| Goal target already met at creation | The goal is saved as active and marked hit at the next evaluation. There is no instant achievement spam. |
| Many achievements at once (import, backfill) | Imports (e.g. M4 statement import, M3 history) do **not** fire achievement sheets; they land in the trophy case silently. |
| Offline | Today renders from cache, 1-tap actions queue, DSH-50 banner shows. Sharing still works (rendered locally) if the data is cached. |
| Web Share with files unsupported (desktop, old browser) | Download the PNG and show DSH-32 with instructions. |
| Push unavailable (iOS not installed / denied) | Everything works in-app. Today surfaces the wrap-up card and pending review. DSH-40 shows install or permission nudges. |
| Currency | PHP only. ₱ values are formatted with no decimals on cards and 2 decimals in detail. |
| Division by zero (no income, no due items) | Show "—" rather than 0% or 100%. The value is excluded from comparisons. |

## 10. Open questions

| OQ-DSH-n | Question | Proposed default | Why it matters |
|---|---|---|---|
| OQ-DSH-1 | "Social interaction with others" (L25–26): **A** share-card export only, or **B** friends/follow/kudos feed? | **A for v1.** B moves to Later and would be revisited only if the owner names specific people or use cases. | B needs accounts for others, a privacy model, moderation and a feed, which is the biggest scope multiplier in the app and conflicts with C5 and single-user (L3). A satisfies "brag" via IG, where his audience already is. |
| OQ-DSH-2 | Should there be a single headline "life score"? | **No composite score.** On-target rate is the headline stat and its formula is transparent. If the owner wants one number, it would be a weighted mean of area completion rates, with the weights shown on tap. | A composite score becomes a game number that cannot be acted on (C2). On-target rate is honest and goal-able. |
| OQ-DSH-3 | How do the 10 named areas (productivity, physical, career, work, company, finances, habits, routines, journal, identity) appear? | **Areas are tags**, not modules. Seed all 10. Habits, tasks and goals carry an optional `area_id`. Stats sections are by **module** (Habits & Routines, Productivity, Physical, Finance). An "By area" filter shows tagged-item completion % per area. There are no per-area scores in v1. | Career, work and company have no data source of their own (they are really tasks and habits). Per-area scores would be invented numbers. Tags cover them at near-zero cost. |
| OQ-DSH-4 | What are "journal" and "identity" (L66–67)? | **Journal** is the 1-line daily reflection in the wrap-up plus the review reflections, captured by text or voice through M5, with a simple list on DSH-26. **Identity** is ≤3 identity statements on the profile, each linked to a goal. | Both were named but not described. A full journaling module would be over-engineering if the owner only wants reflection, and under-delivers if he wants a real journal. |
| OQ-DSH-5 | When does the day end? | `day_start_hour = 04:00` local (Asia/Manila), configurable. | Two jobs means late nights. Midnight rollover would falsely break streaks and misfile logs. |
| OQ-DSH-6 | What is an "on-target day", and what threshold? | ≥80% of due habits **and** tasks done. Neutral if nothing is due. Configurable in DSH-46. | On-target rate and streaks, the headline stats, all derive from this definition. |
| OQ-DSH-7 | Can finance cards ever show ₱ amounts? | **Never** on cards. Only percentages and ratios. | L25 wants cards shareable, and the prompt's intent is "finance % without amounts". A hard rule removes the risk of mis-sharing. |
| OQ-DSH-8 | Should share cards be stored and shown as a history? | No. They are rendered on demand and only toggles persist. | Adds storage and a screen for little value. |
| OQ-DSH-9 | Should the privacy check (DSH-31) be skippable? | Always shown, as the final preview. It costs one tap. | The single guard against leaking weight or finance data publicly. |
| OQ-DSH-10 | Review cadence and timing | Weekly on Sunday 19:00 and monthly on the 1st at 19:00. Both optional. No daily review beyond the wrap-up. | The owner is time-poor (L17), and too many ritual prompts would get ignored. |
| OQ-DSH-11 | Should the AI summary in reviews be on by default? | On, 2 sentences plus 1 suggestion, hideable. It uses M5 or the existing AI module. | Finance advice framing (L58–59) is owned by M4. M6 only summarises and does not advise. |
| OQ-DSH-12 | Achievement set scope | Only 5 rule types (PR, streak milestone 7/30/100/365, personal best week/month, goal hit, first-time). There are no badges for mere usage (e.g. "opened 10 times"). | Keeps rewards meaningful (C2) rather than noise. |
| OQ-DSH-13 | Should misses be dismissible? | Misses can be annotated ("sick", "rest day") and an annotated miss is excluded from the misses count, but it **stays visible** in the list and still counts in on-target rate. | This balances "non-hidden" (L23–24) against "not shaming". |
| OQ-DSH-14 | Does onboarding require install? | No, but it is strongly nudged. Push features are clearly marked as needing install on iOS. | Blocking install would lose the first session. Not nudging would lose reminders (L43, L74). |

## 11. Later / out of scope

- **Social B**: friends, follow, kudos, feed, leaderboards, public profiles (OQ-DSH-1).
- Composite life score (OQ-DSH-2); per-area scores (OQ-DSH-3).
- Customisable or reorderable Today cards. v1 uses the fixed order in §6.
- Home-screen widgets and Live Activities, which PWAs cannot do reliably.
- Video or animated share cards; custom card designer; share-card history.
- Year-in-review ("Wrapped") recap. This would reuse the monthly template for a year.
- Global search (see §12).
- Full journaling module (rich text, prompts, mood tracking).
- Correlation insights across modules (e.g. "you spend more on days you skip the gym").
- Themes beyond light and dark; avatar customisation.

**Out of scope, never:** XP or XP levels, coins, avatar cosmetics, loot, lives or hearts mechanics (C2).

## 12. Frame recommendation

**The tentative frame is validated, with two adjustments.** The final frame is: **Today · Plan · (+) Capture · Stats · Me**.

| Slot | Content | Change vs tentative |
|---|---|---|
| **Today** | DSH-10 life dashboard (§6) | None |
| **Plan** | Tasks plus habit schedule/calendar (M1/M2 own it) | None. The "tomorrow preview" on evening Today links here. |
| **(+) Capture** | **A center action button, not a tab page.** Tap opens the Capture sheet (chat input with 🎤 and 📷). Long-press starts voice directly. The chat thread is full-screen from the sheet. | Adjusted: Capture is a modal sheet over the current tab, so context (e.g. "log this meal" from the Macros card) is preserved and the owner never loses his place. |
| **Stats** | DSH-20 player profile, plus links to per-module analytics | None. Reviews, Goals and Trophy case are reachable from here **and** from Me. |
| **Me** | DSH-40 profile, share, goals, trophies, reviews, settings, module config | Adjusted: Me holds only "you and your setup". Brag and review content lives primarily in Stats. |

**Global elements:**
- **Capture button**: this is the center tab and needs no separate FAB. A floating FAB on top of a center + tab would duplicate it. Module screens pass context into Capture (e.g. the Finance screen preselects "expense").
- **Notifications inbox**: a bell in the Today header (DSH-14) rather than in every tab header, because Today is where pushes land.
- **Search**: none in v1 (Later). Each module list has its own filter, and Capture chat covers "find X" queries via AI (M5), which fits C1 better than a search UI.
- **Offline banner** (DSH-50) is global, above the tab bar.
- **Share** is an action on stats objects (metric, achievement, review, profile), never a tab.

**Rationale.** Today is the default landing because the product promise is "the main dashboard of his life" (L65). Capture sits at the thumb-center because logging effort is the #1 churn cause (L17–21). Stats is a peer tab because the payoff, rich and bragable stats (L10–13, L22), must be one tap away to reinforce logging. Five tabs is the iOS and Android comfortable maximum, and no module needs its own tab because modules are reached through Today cards, Plan and Stats sections (L87–88), which keeps the bar stable when modules are disabled.
