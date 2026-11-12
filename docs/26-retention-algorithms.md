# 26 — Retention algorithms (proposal)

2026-11-12. **Status: Slice 1 built (2026-11-12, see [§7.1](#71-slice-1-as-built)); Slices 2 and 3 proposed.** How Unfurl brings each person back to open the app every day, personalised from their behaviour, with Duolingo-style mechanics adapted to a personal-life app. A build session can start from [Slice 1](#7-build-plan) directly.

Read with [25-retention-kpis.md](25-retention-kpis.md) (what we measure) and [brand/fern.md](brand/fern.md) (Fern's voice). Unfurl's target person has quit trackers before ([brand/positioning-and-name.md](brand/positioning-and-name.md)), so every mechanic here is judged by one question: **does it make coming back after a gap easier, or does it punish the gap?**

## 0. Decisions in this document

Taken here so the build can start; each can be overridden cheaply.

| # | Decision | Why | What it excludes |
|---|---|---|---|
| D1 | Engagement nudges (anything the person did not schedule themselves) are sent **by the server** from one budget, not scheduled on the phone. | One place to cap, back off, log opens and run holdouts. The phone can't see the other phones of the same person. | Device-only nudges; the phone keeps only reminders the person set (task, habit, bill, check-in). |
| D2 | The 20:30 "🔥 Your N-day streak is at risk" push is **replaced** by the best-time nudge with factual, non-threatening copy. | Kai's 2026-11-07 amendment: a miss shows the fact plus a way back, no evening nag. The current copy is loss-aversion. | A fixed 20:30 slot; the word "risk"; fire emoji in pushes. |
| D3 | No new currency (XP, gems). Progress is **log days** plus the existing **Life Score** and its levels. | Two numbers already exist and are understood; a third dilutes both and invites a shop. | A store, buying freezes, paying to repair a streak. |
| D4 | No public leagues. A **friends-only, opt-in** weekly board using log days, never ranks below "you did X days". | Comparing health, food and money with strangers harms the people most likely to churn. | Promotion/demotion, strangers, ranking by Life Score on the weekly board. |
| D5 | The lapse ladder goes quiet after day 14, with one last note on day 30 only for people who had 7+ log days. | Repeated pings to someone who left are the top reason people turn notifications off. | Endless win-back pushes, email win-back. |
| D6 | Rules first, models later. Every algorithm ships as a transparent rule or a decayed histogram; a learned model replaces a rule only once there are 200+ weekly active loggers. | Fewer than 50 TestFlight users: nothing learned would be better than a rule, and rules are debuggable. | ML infrastructure in Slices 1–2. |

## 1. Inventory: what exists today

### 1.1 Signals the app already records

| Signal | Where it lives | Granularity | Notes |
|---|---|---|---|
| Habit logs, status and time | `habit_log` (`day`, `status`, `logged_at`, `source`) — [habits/models.py](../backend/app/modules/habits/models.py) | per habit per day, exact time | `logged_at` gives the time of day someone actually does a habit. `source` separates taps from screen-time auto-logs. |
| Routine runs | `routine_run`, `routine_step_result` — same file | per run | Start/finish time. |
| Tasks: created, completed, overdue, reminders | `task` (`completed_at`, `remind_at`, `status`), task events on the phone — [tasks/jobs.py](../backend/app/modules/tasks/jobs.py) | per task | Overdue = open past its date; no "times rescheduled" counter. |
| Finance records, recurring, budgets | finance module; recurring rows written by the job ([ADR-0033](adr/0033-recurring-transactions-generated-by-the-job.md)) | per record | KPI doc already excludes job-written rows from "logs". |
| Meals, workouts, runs, weigh-ins, focus, journal | nutrition, fitness, focus, capture modules | per record | All count as logs ([25-retention-kpis.md](25-retention-kpis.md) "Terms"). |
| **App opens and closes** | `usage_event` kinds `app_open`, `app_close`, `share_card`, Plus moments — [usage/models.py](../backend/app/modules/usage/models.py), queued by [mobile usage.ts](../mobile/src/prototype/usage.ts) | per event, phone timestamp | Live since the 2026-11-08 release only. No open **source** (push vs organic). |
| Fern chats | `companion_message` (`role = 'me'`), `ai_usage` | per message | Fern memory: [companion/memory.py](../backend/app/modules/companion/memory.py). |
| Social activity | `follow`, `post`, `story`, `comment`, likes, `chat_message`, `activity` — [social/models.py](../backend/app/modules/social/models.py) | per event | |
| Profile and onboarding | `user_profile`: `timezone`, `day_start_hour`, `evening_start`, `target_threshold`, `push_permission`, `push_morning`, `push_evening`, `push_review`, `push_checkin`, `occupation`, `referral_source`, `enabled_extras`, `home_layout`, `intro_offered/dismissed`; `module_pref` (enabled + weight per area); `identity` (up to 3 "I am…" statements) — [profile/models.py](../backend/app/modules/profile/models.py) | per person | `module_pref.weight` is a stated priority per area — the best cold-start signal for archetypes. |
| Push devices | `push_device` (`token`, `last_seen_at`, `disabled_at`) | per device | `disabled_at` set when Expo says `DeviceNotRegistered` — the only uninstall proxy. |
| Inbox notifications | `notification` (`kind`, `read`, `dedupe_key`, `pushed_at`) — [dashboard/models.py](../backend/app/modules/dashboard/models.py) | per notification | `read` = read in the inbox, not "tapped the push". |
| Onboarding funnel | `funnel_event` (install id, before the account exists) | per step | |

### 1.2 Retention features that already exist

| Feature | What it does | Files |
|---|---|---|
| Per-habit streaks with **grace days** | A lone missed day is bridged when the next day is a hit; a second grace day must wait 7 days (`GRACE_GAP_DAYS`). This *is* an automatic streak freeze, but invisible until used. | [shared/grace.py](../backend/app/shared/grace.py), `shared/prototype/lib/grace.ts` |
| On-target day streak | A day is "on target" when done ÷ due ≥ `target_threshold` (default 0.8). Same grace walk. | [stats/logic.py](../backend/app/modules/stats/logic.py), [rewards.ts](../mobile/src/prototype/rewards.ts) (`dayStanding`, `yesterdayRecap`) |
| **Way back** (comeback) | After 2+ empty days, Today opens with Fern's catch-up instead of a scorecard, and pauses every habit's streak across the gap, once per 30 days. | [shared/prototype/way-back.ts](../shared/prototype/way-back.ts), [way-back-open.ts](../mobile/src/prototype/way-back-open.ts), [screens/welcome-back.tsx](../mobile/src/prototype/screens/welcome-back.tsx), [companion/review.py](../backend/app/modules/companion/review.py) |
| Streak-at-risk push | Local notification at 20:30 if today is below target and there is an on-target streak. Copy: "🔥 Your N-day streak is at risk". | [streak-at-risk.tsx](../mobile/src/prototype/streak-at-risk.tsx), [local-reminders.ts](../mobile/src/prototype/local-reminders.ts) (`atRiskPlan`) |
| Scheduled reminders | Task, habit (with nag repeats), routine, weigh-in, bill, daily Fern check-in; all respect quiet hours. | [local-reminders.ts](../mobile/src/prototype/local-reminders.ts) |
| Morning task digest | Server push at the digest time, out of quiet hours. | [tasks/jobs.py](../backend/app/modules/tasks/jobs.py) (`send_digest`), cron in [jobs/tasks.py](../backend/app/modules/jobs/tasks.py) |
| Celebrations | Tick toast with Undo; standing moments (target/perfect); streak milestones 7/30/100/365; trophies; big moments (Life Score level, savings goal). | [rewards.ts](../mobile/src/prototype/rewards.ts), [celebration.tsx](../mobile/src/prototype/celebration.tsx), [trophy-overlay.tsx](../mobile/src/prototype/trophy-overlay.tsx), [big-moment.tsx](../mobile/src/prototype/big-moment.tsx) |
| Honest misses | Missed goals in the bad colour; Fern's read of what slipped yesterday. | [missed-goals.tsx](../mobile/src/prototype/missed-goals.tsx), [dashboard/miss_analysis.py](../backend/app/modules/dashboard/miss_analysis.py) |
| Life Score and levels | Weighted area rates → 0–100 score, levels "Getting started" … "Peak". | [stats/logic.py](../backend/app/modules/stats/logic.py) (`LEVELS`, `life_score_of`) |
| Friends leaderboard | You plus people you follow who show scores, ranked by Life Score then streak. | [social/services.py](../backend/app/modules/social/services.py) (`leaderboard`) |
| Hidden-module reintroduction | From day 14, one dimmed preview of a hidden part; "Not for me" is permanent. | [module-intro.ts](../mobile/src/prototype/module-intro.ts), [companion/reintro.py](../backend/app/modules/companion/reintro.py) |
| Cross-area insights | "Days with 7h+ sleep, habit completion is X vs Y". | [insights.ts](../mobile/src/prototype/insights.ts) |
| Share cards | Win and miss cards; `share_card` usage event. | [share-kit.tsx](../mobile/src/prototype/share-kit.tsx) |

### 1.3 Signals missing (need new tracking)

| Missing signal | Needed by | Proposed source |
|---|---|---|
| **Push opened** (and which push) | Fatigue control, best-time bandit, every nudge metric | `nudge.opened_at` (server nudges, §5); `usage_event` kind `push_open` with `detail` = category for other pushes, sent from the notification-response handler in [notifications.ts](../mobile/src/prototype/notifications.ts). |
| App open **source** | Separating "came back by themselves" from "came back from a push" | `push_open` arriving within 5 s before `app_open` marks that open as push-driven (join, no new column). |
| Engagement nudge sent / suppressed and why | Budget, debugging, A/B | New `nudge` table (§5). |
| Local notifications fired | Counting today's reminders against fatigue | Not observable on iOS without opening; count *scheduled* reminders from the phone's plan instead (`reminders_today` in the daily profile upload, §4.2). |
| Home "next up" card shown / tapped | Next-best-action learning (Slice 3) | `usage_event` kinds `nba_shown`, `nba_tap` with `detail` = candidate kind. |
| Daily goal history | Goal sizing | Derived nightly from the day series; stored as `retention_profile.goal_q`. |
| Task reschedules | Planner archetype, overload signal | `task_event` type `rescheduled` on the phone already exists for some flows; ensure it syncs. Verify in build. |
| Notification permission changes | Opt-out rate | `user_profile.push_permission` exists; add `push_permission_changed_at`. |

## 2. Duolingo mechanics, adapted

| Mechanic | Duolingo | Unfurl today | Fit for a personal-life app | Verdict |
|---|---|---|---|---|
| **Streak** | Days in a row with a lesson; the centre of the app. | Per-habit streaks and an on-target day streak, with grace days. | Good as a quiet record of consistency; bad as the goal — a streak punishes the gap Unfurl exists to forgive ([25 §KPIs](25-retention-kpis.md) deliberately excludes it). | **Keep, don't amplify.** Never in a push title; never the biggest number on Today. |
| **Streak freeze** | Item that protects a missed day; bought with gems or earned. | Grace day (automatic, 1 per 7 days) and way-back pause (once per 30 days). Invisible until used. | Strong fit: it removes the all-or-nothing cliff. The gap is **visibility**: people don't know they're protected, so a miss still feels like a loss. | **Adapt.** Slice 1: show "rest day ready" on the streak chip. Slice 2: *earned* rest days (1 per 7 on-target days, bank of 2) replace the fixed 7-day rule. Never purchasable. |
| **Streak repair** | Pay to restore a lost streak within 48 h. | Way back pauses streaks across a gap retroactively. | Paying to undo a miss is a dark pattern. The way-back pause already restores without payment. | **Reject paid repair; keep way back.** |
| **Daily goal** | XP target (casual → intense) chosen at start. | `target_threshold` (share of due items, default 80%). Same for everyone. | Good fit if it adapts: an 80% bar on a heavy day is a set-up for a miss. | **Adapt** — personalised sizing (§3.6). |
| **Leagues / leaderboards** | Weekly leagues of 30 strangers, promotion and demotion. | Friends leaderboard by Life Score. | Strangers + health/money + demotion = shame. Small friend groups that cheer work. | **Adapt narrowly** (D4): opt-in weekly "together" board with friends, by log days, no demotion. Slice 3. |
| **XP / single currency** | XP for every lesson; gems for the shop. | Life Score (0–100) and levels; log days. | A currency invites grinding and a shop. | **Reject** (D3). Use log days and Life Score. |
| **Streak-saver notification** | Evening push: "Your streak is about to end". | 20:30 "🔥 … streak is at risk". | Loss-aversion copy; Kai ruled out evening nags (2026-11-07). | **Replace** (D2) with the best-time nudge: the fact, one easy step, and the rest-day status ("Rest day ready if today's a no."). |
| **"Time you usually practise" reminder** | Sends at the hour you usually do a lesson. | Fixed morning/evening times chosen in onboarding. | Best fit of all: it lands when the person is already reachable and willing. | **Recommend** — §3.2, Slice 1. |
| **Duo character nudges** | Passive-aggressive owl, escalating guilt. | Fern check-in (opt-in time), Fern catch-up on way back. | A companion that notices is the product; a guilt-tripping one breaks Fern's voice rules ("Don't: Guilt"). | **Adapt** — Fern's proactive messages are factual, one idea, one next step (§3.7). No sad/crying Fern art in pushes. |
| **Milestone celebrations** | Streak 7/30/100/365 animations, shareable. | Already present (milestones, trophies, big moments, share cards). | Matches the rewarding-feedback pillar. | **Keep**; add log-day milestones (10/25/50/100 log days) that don't need consecutiveness. Slice 2. |
| **Comeback / re-engagement** | "We miss you" pushes, then email; welcome-back bonuses. | Way back screen on open; nothing reaches someone who doesn't open. | Fit if sparse and helpful; the in-app half already exists. | **Recommend** — lapse ladder (§3.3), Slice 1. |

## 3. Profile-based algorithms

Shared definitions (from [25-retention-kpis.md](25-retention-kpis.md)): **log**, **log day**, **local day** (`user_profile.timezone`, `day_start_hour`), **area**. "Engagement moment" = an `app_open` or a log's `created_at`/`logged_at`.

### 3.1 Archetype and lifecycle stage

**Inputs:** logs per area over 28 days; `module_pref.weight`; plan/calendar usage (tasks with a time block); Fern turns; `user.created_at`; last log day.

**Archetype** (what the person uses Unfurl *for*; drives which nudge content and home card wins):

```
share[a] = logs_28d[a] / Σ logs_28d            # a ∈ habits, tasks, finance, nutrition, fitness, focus, journal
if Σ logs_28d < 10:                             # cold start: stated priorities
    share[a] = module_pref.weight[a] / Σ weights over enabled areas
primary   = argmax(share)
secondary = second argmax if share ≥ 0.25 else none
archetype = MAP[primary]  # habits→"habit-builder", tasks→"planner", finance→"money-tracker",
                          # nutrition|fitness→"body-tracker", focus→"deep-worker", journal→"reflector"
if fern_turns_28d ≥ 0.5 × log_days_28d: add tag "talker"   # logs mostly through Fern
```

**Stage** (where the person is in the lifecycle; drives the ladder and goal sizing):

| Stage | Rule (evaluated in order) |
|---|---|
| `new` | days since signup ≤ 13 |
| `lapsed` | days since last log ≥ 15 |
| `lapsing` | days since last log 3–14 |
| `returning` | a log today or yesterday after a gap ≥ 3 days, for 7 days after the return |
| `steady` | log days in last 14 ≥ 8 |
| `drifting` | otherwise |

**Runs:** backend nightly job (§4). **Output:** `retention_profile.archetype`, `.secondary`, `.tags`, `.stage`. **Cost:** a few grouped COUNT queries per user per night; negligible.

### 3.2 Best time to nudge

**Goal:** send the one daily engagement nudge in the half-hour the person is most often already in the app.

**Inputs:** engagement moments over the last 60 days in local time; quiet hours (`task_settings.quiet_start/end`); scheduled reminders today; onboarding `push_morning`/`push_evening`.

```
slots = 48 half-hour slots × {weekday, weekend}
H[d][s] = Σ over moments m in slot s on day-type d:  0.5 ^ (age_days(m) / 14)   # half-life 14 days
# count at most 1 moment per (day, slot) so one long session doesn't dominate
H_smooth[s] = 0.25·H[s-1] + 0.5·H[s] + 0.25·H[s+1]                              # circular
eligible = slots not in quiet hours, not within 45 min of a scheduled reminder today,
           between 07:00 and 21:30 local
if Σ H[d] < 5:  best = slot of push_evening if set else push_morning else 19:00   # cold start
else:           best = argmax over eligible of H_smooth[d]
send_at = start of best slot − 10 min       # arrive just before the usual window, not during it
```

**Slice 3 upgrade — Thompson sampling** over the top 3 slots: each slot keeps Beta(α, β), reward = nudge opened within 2 h *or* a log within 2 h; sample, pick the max, update. Prior α = 1 + H_smooth·2, β = 1.

**Runs:** histogram rebuilt in the nightly job; the sender job reads `best_slot`. **Data:** `retention_profile.slot_hist` (JSONB, 96 floats), `best_slot_weekday`, `best_slot_weekend`. **Cost:** one query over `usage_event` + record tables per user per night.

### 3.3 Churn risk and the lapse ladder

**Risk score** (0–100, rule-based until 200+ weekly actives, then refit as logistic regression on the same features):

| Feature | Points |
|---|---|
| Days since last log: 0 → 0, 1 → 10, 2 → 25, 3–4 → 40, 5–7 → 55, 8+ → 70 | 0–70 |
| Log days last 7 < half of (log days previous 21 ÷ 3) — slowing down | +10 |
| Ignored the last 3 engagement nudges | +10 |
| Only 1 area used in 28 days | +5 |
| Stage `new` and no log on day 1 after signup | +5 |
| Notifications denied (`push_permission = denied`) | display only, no change: we can't reach them |

**Lapse ladder** (days counted from the last log day; each step is the day's single engagement nudge, at the best time, subject to the budget in §3.5):

| Day | Channel | Content (Fern voice, factual, one step) | Notes |
|---|---|---|---|
| 1 | none | — | The grace day covers it; no push. |
| 2 | in-app only | Way back screen on the next open (exists). | |
| 3 | push | "Yesterday and the day before were quiet. One tap logs today's [top habit]." Deep link to that habit's tick. | Archetype picks the item: planner → today's first task; money-tracker → "add today's spending". |
| 7 | push | "Your [habit] week so far: 0 of 4. Your streak is paused, not lost — pick it up with one." | Mentions the way-back pause only if one is available. |
| 14 | push | "I'll stay quiet from here. Your plan and history are kept. Want a weekly note instead?" Action buttons: "Weekly note" / "No thanks". | "Weekly note" sets `nudge_mode = weekly`. |
| 30 | push, only if lifetime log days ≥ 7 | "A month since we last checked in. Here's where you left off: [streak/Life Score]." | Last one. Then silence until the person returns. |

Any log resets the ladder. A return triggers the existing way back plus stage `returning` (easier goal, §3.6).

**Runs:** score in the nightly job; ladder in the sender job. **Data:** `retention_profile.risk`, `last_log_day`, `ladder_step`. **Measured by:** KPI 5 (return after lapse).

### 3.4 Next-best-action (what to show today)

One candidate list feeds both the Today "Next up" card and the content of the day's nudge.

**Candidates** (generated from data the phone already has): due-not-done habit; overdue task; task with a time block in the next 2 h; bill due ≤ 3 days; meal not logged by the person's usual meal time; weigh-in day; tomorrow's plan empty after `evening_start`; unseen trophy; hidden module (day 14+, existing reintro); day-14 survey (25 §Day-14 survey).

```
score(c) = urgency(c) × value(c) × p_do(c) × fresh(c)
urgency = 1.0 overdue/due now · 0.7 due today · 0.4 due ≤ 3 days · 0.2 no date
value   = 1 + 0.5·[c.area == archetype] + 0.25·[c.area == secondary] + 0.25·[c keeps an on-target day]
p_do    = (done_at_this_hour[c.kind] + 1) / (shown_at_this_hour[c.kind] + 2)   # Laplace; 1/2 until data
fresh   = 0.5 ^ (times shown today without action)                             # don't repeat the ignored card
pick top 1 for Today; top 1 not already pushed today for the nudge
```

**Runs:** on device at render time for Today (data is local, no round trip); the server runs the same function in Python over synced data for the push (port pattern as `grace.py`/`grace.ts`). **Data:** `nba_shown`/`nba_tap` usage events (Slice 3 only; `p_do` = 1/2 until then).

### 3.5 Notification budget and fatigue

Two classes: **reminders the person set** (task `remind_at`, habit/routine/bill, check-in, digest) are never suppressed; **engagement nudges** (best-time, ladder, Fern proactive push, social digest) share a budget.

| Rule | Value |
|---|---|
| Engagement nudges per day | ≤ 1 |
| Engagement nudges per rolling 7 days | ≤ 4 (`steady`), ≤ 3 (`lapsing`), ladder only (`lapsed`) |
| Skip today's nudge if | the person already opened the app or logged today before `send_at`; or reminders scheduled today ≥ 4; or in quiet hours |
| Ignore = | nudge not opened within 6 h and no app open within 2 h |
| Backoff | after `k` consecutive ignores, next nudge waits `2^k − 1` extra days (0, 1, 3, 7) |
| Fatigue stop | 4 consecutive ignores → engagement nudges stop; Today shows one card "Fewer nudges?" with "Weekly only" / "Off" / "Keep". |
| Reset | any opened nudge sets `ignore_streak = 0` |
| Opt-out | Settings → Notifications → "Nudges from Fern": Daily / Weekly / Off (`user_profile.nudge_mode`). Off is one tap and is honoured immediately. |

**Runs:** sender job checks before every engagement send. **Data:** `nudge` rows, `retention_profile.ignore_streak`, `next_nudge_after`.

### 3.6 Personalised daily goal

Today a day is on target when `done / due ≥ target_threshold` (0.8 for everyone). Personalise the threshold `q`, within limits, and say so.

```
q starts at user_profile.target_threshold (0.8)
weekly, per person (nightly job on their week start):
    hit = on-target days last 7 (days with due > 0)
    n   = days with due > 0 last 7
    if n ≥ 5 and hit / n ≤ 3/7: q = max(0.5, q − 0.10)          # applied, Fern says why
    if n ≥ 5 and hit / n ≥ 6/7 and q < user's chosen threshold: q = min(chosen, q + 0.05)
    # q never rises above the person's own chosen threshold without consent;
    # suggest a higher one in Settings only after 3 weeks at 6/7+.
stage == returning: today's goal = max(1, ceil(0.5 × due)) for 7 days ("easy week back")
```

Shown on the Today ring as "Goal today: 3 of 5" with an info tooltip "Eased this week after a few heavy days". **Runs:** nightly job writes `retention_profile.goal_q`; the phone reads it with the profile. **Data:** stats on-target calc must take `goal_q` instead of `target_threshold` when present (server `stats/logic.py` and phone `rewards.ts` together).

### 3.7 Fern's proactive messages

Fern speaks first at most **once a day**, as an opener in the chat (and as that day's engagement push only when it wins the budget). Templated text first; the light model only rewrites the template into Fern's voice with the person's own words, capped by the Fern allowance ([ADR-0038](adr/0038-fern-allowance-and-plus-fair-use.md)).

| Trigger | Condition | Message shape | Archetype bias |
|---|---|---|---|
| Comeback | ladder day 3/7/14/30 | §3.3 table | all |
| Near a personal best | streak or log days 1 short of a milestone | "One more [habit] makes 30 days." | habit-builder |
| Pattern found | `insights.ts` difference passes its floor | "Days you sleep 7h+, you finish 82% of habits vs 60%." | body-tracker, reflector |
| Money heads-up | bill due ≤ 2 days and projected balance below it | "Rent is due Friday; Wallet is ₱2,000 short." | money-tracker |
| Plan tomorrow | after `evening_start`, tomorrow has 0 blocks, person used Plan 3+ days last week | "Tomorrow's empty. Want me to lay it out?" | planner |
| First week | days 1–7, no log on day N | "Day 3: one thing logged is enough." | new |
| Weekly review | `push_review` time (exists) | existing weekly review | all |

Priority when several fire: money heads-up > comeback > plan tomorrow > near a best > pattern > first week. **Runs:** evaluated in the sender job; text from templates in `backend/app/modules/companion/` (new `proactive.py`). **Cost:** templates are free; an LLM rewrite is ~300 tokens on the light model per message, ≤ 1 per person per day — well inside KPI 9's ₱25 per 28 days. **Data:** `companion_message` gains `origin = 'proactive'` so KPI 8 can exclude Fern-initiated turns.

## 4. Where it runs, data model, cost

### 4.1 Placement

| Algorithm | Runs | Schedule |
|---|---|---|
| Archetype, stage, risk, slot histogram, goal_q | backend procrastinate job `retention_nightly` | hourly cron; processes users whose local time is 03:00–03:59 |
| Sender (best-time nudge, ladder, Fern proactive, budget) | backend job `retention_nudges` | every 5 min (same pattern as `task_digests`) |
| Next-best-action for Today | on device, at render | — |
| Next-best-action for the push | backend, inside the sender | — |
| Rest-day status | device and server, from the existing grace walk | at render / nightly |

### 4.2 Data model changes (Alembic, one revision per slice)

| Table / column | Slice | Shape |
|---|---|---|
| `retention_profile` (new, owned, 1 row per user) | 1 | `archetype` str(16) null, `secondary` str(16) null, `tags` JSONB, `stage` str(10), `risk` int, `last_log_day` date null, `slot_hist` JSONB, `best_slot_weekday` int null, `best_slot_weekend` int null, `ignore_streak` int, `next_nudge_after` date null, `ladder_step` int, `goal_q` float null, `arm` str(16), `updated_at` tstz |
| `nudge` (new, owned) | 1 | `kind` str(16) (`best_time`, `ladder_3`, `ladder_7`, `ladder_14`, `ladder_30`, `fern_*`), `scheduled_for` tstz, `sent_at` tstz null, `opened_at` tstz null, `suppressed` str(16) null (`budget`, `quiet`, `active_today`, `holdout`, `opt_out`), `arm` str(16), `notification_id` FK null, `dedupe_key` unique |
| `user_profile.nudge_mode` | 1 | str(8) `daily` / `weekly` / `off`, default `daily` |
| `user_profile.push_permission_changed_at` | 1 | tstz null |
| `usage_event` kinds `push_open` | 1 | `detail` = nudge id or category key |
| `usage_event` kinds `nba_shown`, `nba_tap` | 3 | `detail` = candidate kind |
| `habit_settings` rest-day bank: `rest_days` int | 2 | 0–2 |
| `companion_message.origin` | 2 | str(10) default `user` |

**Cost:** two light periodic jobs on the existing procrastinate worker; no new service. At 1,000 users the nightly job is ~1,000 × ~6 queries spread over 24 hours.

## 5. Measurement

| Algorithm | Primary metric | Guardrail metrics |
|---|---|---|
| Best-time nudge | Nudge open rate; share of days with a log within 2 h of the nudge | Push permission revoked rate; `nudge_mode = off` rate |
| Lapse ladder | KPI 5 return after lapse; return within 48 h of each ladder step | Opt-outs after ladder pushes |
| Rest-day visibility / bank | Share of lapses of 1–2 days that return (vs end in a longer lapse) | — |
| Goal sizing | KPI 3 logging days per week; on-target rate | Complaints that the goal is "too easy" (survey Q8 "Other") |
| Next-best-action | `nba_tap` / `nba_shown` | Time to first log after open |
| Fern proactive | Replies to proactive openers; logs within 2 h | KPI 9 AI cost; "Too many notifications" in survey Q8 |
| Overall | KPI 1 weekly active loggers; D1/D7/D30 (KPI 2); DAU/WAU | Push permission rate over time |

**Experiment design.**

- **Assignment:** `arm = hash(user_id ‖ experiment_salt) mod 100`, stored on `retention_profile.arm` and copied onto every `nudge` row, so every send and its suppression reason is analysable.
- **Global holdout:** 10% of users receive **no engagement nudges** (reminders they set still fire). Suppressed sends are still written with `suppressed = 'holdout'`, giving a counterfactual "would have sent at T".
- **Power, stated honestly:** detecting a D7 lift from 25% to 35% at 95%/80% needs about 330 people per arm. With fewer than 50 TestFlight users, A/B results are directional only. Until 200 weekly active loggers: run everything for everyone *except* the holdout, compare holdout vs treated on KPI 1 and KPI 5, and read per-nudge open rates. Turn on per-feature A/B arms after that.
- **Report:** extend `backend/scripts/retention_report.py` with a "Nudges" section: sends, opens, open rate, logs within 2 h, by kind and arm; holdout vs treated KPI 1 and 5.

## 6. Ethics guardrails

These are acceptance criteria for every slice, not aspirations.

| Rule | Concretely |
|---|---|
| Benefit first | A nudge must point at one thing the person said they wanted (their habit, their bill, their plan). No nudge whose only content is "come back". |
| No loss-aversion copy | Banned in pushes and Fern openers: "at risk", "lose", "about to end", "don't break", "you missed again", fire/skull/crying emoji, sad Fern art. A test asserts this over the template catalogue. |
| Misses are facts with a way back | Every miss message names what happened and one step forward (rewarding-feedback pillar as amended 2026-11-07). |
| Quiet hours are absolute | Engagement nudges never send in quiet hours and never between 21:30 and 07:00 local, even if quiet hours are unset. |
| One-tap opt-out | "Nudges from Fern: Daily / Weekly / Off" in Settings and in the fatigue card; honoured on the next sender run (≤ 5 min). Reminders the person set are separate and untouched. |
| No pay-to-protect | Rest days are earned, never sold; no Plus-only streak protection. |
| Silence after leaving | Ladder ends at day 14 (day 30 for 7+ log-day people). No email win-back. |
| Social is opt-in and kind | Friends board is opt-in per person, shows log days, never shows who is last. |
| No sensitive data in pushes | Push text never includes amounts, weight or food on the lock screen unless the person turned on "Show details in notifications" (default off); finance heads-up says "a bill is due" on the lock screen. |
| Transparent personalisation | Settings shows "Fern nudges you around 7:30 pm, when you usually log" with a "Change" control that pins a time (pinned time overrides the histogram). |

## 7. Build plan

### Slice 1 — best-time nudge, comeback ladder, visible rest days

Smallest set that reaches people who don't open the app, and removes the loss-aversion push.

| Part | Files / areas | Acceptance criteria |
|---|---|---|
| Migration | new `backend/app/modules/retention/` (models `RetentionProfile`, `Nudge`); `user_profile.nudge_mode`, `push_permission_changed_at`; Alembic revision | Upgrades and downgrades cleanly; tables owned and tenant-isolated like other `OwnedRow`s. |
| Nightly profile job | `retention/logic.py` (pure: stage, risk, slot histogram, best slot), `retention/jobs.py`; register `retention_nightly` in [jobs/tasks.py](../backend/app/modules/jobs/tasks.py) | Unit tests on the pure functions: half-life decay, smoothing, cold start falls back to `push_evening`, quiet-hours exclusion, stage table order. Runs for a user only in their local 03:00 hour. |
| Sender job | `retention/sender.py`; register `retention_nudges` (every 5 min); delivery through the existing `notification` + outbox push ([dashboard/outbox.py](../backend/app/modules/dashboard/outbox.py)) | One engagement nudge per day max; skipped when the person logged or opened today; ladder steps on days 3/7/14/(30) from last log day; backoff `2^k − 1`; holdout writes `suppressed='holdout'` and sends nothing; `nudge_mode=off` sends nothing; dedupe key prevents double sends across job overlaps. |
| Templates | `retention/copy.py` (Fern voice, uses companion's current name) | Test: no banned word/emoji from §6 in any template; every template has a deep link. |
| Push-open tracking | [notifications.ts](../mobile/src/prototype/notifications.ts) response handler → `usage_event` `push_open`; backend sets `nudge.opened_at` from it; `usage/schema.py` kind added | Tapping a nudge records `opened_at` within one sync; other pushes record their category. |
| Retire the at-risk push | [streak-at-risk.tsx](../mobile/src/prototype/streak-at-risk.tsx), `atRiskPlan` in [local-reminders.ts](../mobile/src/prototype/local-reminders.ts) | Phone no longer schedules `streak-at-risk` in live mode; existing scheduled one is cancelled on launch. |
| Visible rest day | streak chip via `streakNote` in [rewards.ts](../mobile/src/prototype/rewards.ts); grace walk exposes "grace available" (no grace used in the last 7 days and run > 0) in `grace.ts`/`grace.py` | Chip reads "rest day ready" when a grace day is available, "rest day used" when spent this week; both tested against the walk. No schema change. |
| Settings | Notifications screen: "Nudges from Fern: Daily / Weekly / Off" and "Usually around HH:MM — Change" | Changing it updates `nudge_mode` / pinned slot; the next sender run honours it. |
| Report | `backend/scripts/retention_report.py` "Nudges" section | Prints sends, opens, open rate, logs within 2 h, by kind and arm. |
| Client | `bash scripts/generate-client.sh`; mobile client via `mobile/openapi-ts.config.ts` | Regenerated, not hand-edited. |

**Out of Slice 1:** archetypes beyond what the ladder needs (only the top habit/task pick), goal sizing, Fern proactive beyond ladder copy, NBA card, friends board, earned rest-day bank.

### 7.1 Slice 1 as built

Built 2026-11-12 in `backend/app/modules/retention/` (`logic.py` pure rules, `jobs.py` nightly, `sender.py`, `copy.py`, `signals.py`), migration `5cf0aa4a327d`, and on the phone `rewards.ts` (`streakNote`), `grace.ts` (`graceReady`), `notifications.ts` (`push_open`), `nudge-settings.ts` and Settings. Where the build differs from the text above:

| # | Where | As built | Why |
|---|---|---|---|
| 1 | §4.2 data model | Added `user_profile.nudge_time` (pinned HH:MM, 07:00–21:30, null = usual time), `retention_profile.log_days_total` and `.computed_day`, `nudge.day`. | The pinned time needs a column; the day-30 note needs lifetime log days; one nightly run per day and per-day nudge reads need the day. |
| 2 | §4.2 `nudge.suppressed` | Also `fatigue`, `backoff`, `no_content`, and `no_push` (no active push device: not a send, not an ignore, not a holdout counterfactual). | Every reason the sender holds a nudge back is recorded; an unreachable person must not build an ignore streak. |
| 3 | §1.3 / Slice 1 push opens | A push the server sent records its inbox notification's id as `detail` (that is how a nudge gets `opened_at`); its category is `notification.kind`. A reminder the phone scheduled records its category (`habit`, `task`, `bill`, …). | The phone cannot tell a nudge from another server push; the id resolves both. |
| 4 | §3.3 day-14 step | No action buttons: the push opens Settings, where Daily / Weekly / Off is. | Push action categories need native registration; the setting is one tap away. |
| 5 | §3.5 fatigue card | Not built. Four ignores in a row stop nudges server-side (`fatigue`); the opt-out is the Settings control. | Not in the Slice 1 table; the stop itself is. |
| 6 | §3.5 weekly mode | At most one engagement nudge per rolling 7 days. | The text left "weekly" undefined. |
| 7 | §3.2 reminders | "45 min from a reminder" and "4+ reminders skip the day" count what the server knows: task reminders, the morning digest, the Fern check-in. Habit, routine and bill reminders live on the phone. | The daily `reminders_today` upload is not in Slice 1. |
| 8 | §3.3 ladder vs best time | Day 0 (logged today) and day 1 get the best-time nudge (day 0 is then `active_today`); days 2, 4–6, 8–13, 15–29 and 31+ get nothing; 3, 7, 14, 30 get the ladder step. | The ladder's "day 1: none" is about ladder pushes; the steady daily nudge is the best-time one. |
| 9 | §3.3 day-7 copy | "It's been a week. [habit] is still on your list; one tap picks it up." plus "Your streaks pause across the gap when you come back." only when no way-back pause was used in 30 days. No "0 of 4" count. | Keeps it to one fact and one step without a weekly tally. |
| 10 | Slice 1 retire at-risk | Removed in every mode (not only live); the phone cancels a leftover `streak-at-risk` on launch. | D2 retires the copy itself; demo mode has nothing that should keep it. |
| 11 | Sender timing | A run more than 1 h after the nudge time lets the day go. | After a scheduler outage a late nudge would land at an odd hour. |
| 12 | Settings | `GET /retention/nudge` gives the usual time; until the nightly job has run, the phone shows the same cold start (evening push time − 10 min). | The usual time lives on the server. |
| 14 | §3.5 backoff vs ladder | Backoff holds the best-time nudge only; ladder steps are not backed off (fatigue still stops them). | The ladder is already a widening schedule; otherwise ignored day-3 and day-7 steps pushed the day-14 "I'll stay quiet" note past its day. |
| 15 | §3.5 ignore | A nudge opened at any time counts as opened (not only within 6 h). | "Any opened nudge sets ignore_streak = 0" and the 6-hour rule disagreed; the nightly recount now matches the reset on tap. |
| 16 | §3.2 placement | The sender picks today's slot again from the stored histogram against today's reminders and quiet hours; the nightly best slots are what Settings shows. | The nightly run at 03:xx is still on the previous business day (day start 04:00), so its reminder check looked at the wrong day. |
| 17 | §5 report | Per arm, `eligible` counts days a nudge went out (treated) or would have (holdout), and logs within 2 h are measured from the send or the would-be send. | Otherwise the holdout arm read zero on every figure. |
| 13 | §3.1 returning | A return is a log day 3+ days after the previous one (the same 3 days that make someone `lapsing`). | "Gap ≥ 3 days" read two ways. |

### Slice 2 — goal sizing, earned rest days, archetypes, Fern openers

| Part | Acceptance criteria |
|---|---|
| Archetype + tags in nightly job | Cold start uses `module_pref.weight`; tested per rule. |
| `goal_q` and the easy week back | Server `stats/logic.py` and phone `rewards.ts` agree (shared fixture); q never rises above the person's chosen threshold; Today shows the eased goal with the reason. |
| Earned rest days | 1 per 7 on-target days, bank ≤ 2, used automatically on a miss; replaces `GRACE_GAP_DAYS` in both walks with a migration note; streak history before the change unchanged. |
| Log-day milestones (10/25/50/100) | Celebrate in the overlay layer; never trigger on job-written records. |
| Fern proactive openers (§3.7) | `companion_message.origin='proactive'`; ≤ 1 per day; KPI 8 excludes them. |

### Slice 3 — learning and social

| Part | Acceptance criteria |
|---|---|
| Next-best-action card on Today + `nba_shown`/`nba_tap` | Same scoring function on phone and server (shared fixture); ignored card decays by `fresh`. |
| Thompson sampling over top 3 slots | Falls back to histogram argmax when < 10 nudges sent. |
| Friends "together" board | Opt-in, log days this week, no last place shown, no demotion. |
| Logistic churn model | Only once 200+ weekly active loggers; must beat the rule score on AUC on a time-split holdout before replacing it. |

## 8. Decisions for Kai

Recorded as decided above (§0); listed here because they change product behaviour he has ruled on before.

| # | Question | Default taken |
|---|---|---|
| K1 | Retire the 20:30 "streak at risk" push in favour of the best-time nudge? | Yes (D2). |
| K2 | Ladder end: silence after day 14, one day-30 note for 7+ log-day people? | Yes (D5). |
| K3 | Holdout 10% now, even though results are directional under 200 actives? | Yes: cheap, and it is the only counterfactual we will have. |
| K4 | Goal can ease automatically (shown with the reason), but only rises with consent? | Yes (§3.6). |
| K5 | Earned rest days (Slice 2) replace the fixed one-per-7-days grace rule? | Yes; history before the change is kept as computed. |
| K6 | Friends board by log days, opt-in, no strangers (Slice 3)? | Yes (D4). |
