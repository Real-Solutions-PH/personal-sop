# 25 — Retention KPIs

2026-11-08. What we measure to know whether people keep using Unfurl, how each number is computed from tables the backend already has, and the bar each one has to clear. The numbers come from `backend/scripts/retention_report.py`, a read-only script run against production (see [runbook.md](runbook.md), "Retention report").

Why now: TestFlight has real users and no retention measurement. Unfurl's target person is someone who has quit trackers before (the positioning in [brand/positioning-and-name.md](brand/positioning-and-name.md)), so **coming back after a gap** matters more than an unbroken streak.

## Terms

| Term | Meaning |
|---|---|
| **Log** | A record the person made: a habit log (not one completed from screen time), a routine run, a task added, a task completed, a workout, a run or walk, a weigh-in, a meal, a finance record (not one the recurring job or a balance adjustment wrote), a focus session, a journal entry. Fern chats and captures are not logs on their own: a capture writes records that are already counted. |
| **Log time** | The record's `created_at` (when the person made it), except a completed task, which uses `completed_at`. A meal logged for yesterday counts today: logging is the act we measure. |
| **Day** | The person's local calendar day, from `user_profile.timezone` (default `Asia/Manila`). |
| **Log day** | A day with at least one log. |
| **Signup** | `user.created_at`, the moment the account was made. The onboarding funnel (`funnel_event`) runs before the account exists and carries only an install id, so it cannot anchor a person's cohort. |
| **Area** | habits, tasks, fitness, nutrition, finance, focus, journal. |
| **Active logger (28 days)** | Someone with a log day in the 28 days before the report day. The denominator for depth and cost figures. |
| **Superusers** | Excluded by default (Kai's own account holds the copied development history); `--include-superusers` adds them. |

## The KPIs

"Target" is the bar for the TestFlight cohort to beat. TestFlight users were invited and are motivated, so the bars sit above public app-store averages; treat any figure from fewer than 20 people as directional.

| # | KPI | Definition | Source tables | Target |
|---|---|---|---|---|
| 1 | **Weekly active loggers (north star)** | People with **3 or more log days** in a Monday–Sunday week. Also reported: people with 1+ log day, and the north star as a share of everyone signed up by that week. | record tables (see Terms) | **≥ 50% of weekly actives** reach 3+ days; the count grows week on week |
| 2 | **D1 / D7 / D30 retention by signup week** | Share of a signup-week cohort with a log day in the window: D1 = day 1 after signup; D7 = days 7–13; D30 = days 30–36. A person counts only once their window has fully passed. | `user`, record tables | **D1 ≥ 40%, D7 ≥ 25%, D30 ≥ 15%** |
| 3 | **Logging days per week** | Mean log days in the week among people with 1+ log day that week. | record tables | **≥ 4.0** |
| 4 | **Entries per active day** | Logs ÷ (person, log day) pairs, last 28 days. Depth, not frequency. | record tables | **≥ 4** |
| 5 | **Return after lapse** | A lapse begins after **3 whole days** with no log. A return is a log within **14 days** of the lapse beginning. Reported per lapse (every lapse whose 14-day window has closed) and per person (each person's first such lapse). This is the metric for people who have quit trackers before. | record tables | **≥ 40%** of lapses end in a return |
| 6 | **Time to first log** | Hours from signup to the first log: median, and share of all signups who logged within 24 hours. | `user`, record tables | **median ≤ 0.25 h (15 min); ≥ 80% within 24 h** |
| 7 | **Areas used per person** | Distinct areas with a log in the last 28 days, per active logger (mean and median), plus how many people use each area. | record tables | **median ≥ 2** (the all-in-one promise) |
| 8 | **Fern turns per active logger** | Messages the person sent Fern (`companion_message.role = 'me'`) in 28 days ÷ active loggers, plus how many people chatted. | `companion_message` | watch, no bar yet: rising with KPI 1 is good; rising alone means chat without logging |
| 9 | **AI cost per active logger** | `ai_usage.cost_minor` (centavos, estimated per call) summed over 28 days ÷ active loggers, in pesos. | `ai_usage` | **≤ ₱25 per 28 days**, about a fifth of the Philippine monthly price (₱1,490 a year, ruled 2026-11-08) |
| 10 | **Share cards** | Times the share sheet was opened with a card, by card, in 28 days. Counted from when the share sheet returns; the phone cannot tell whether the person then posted. | `usage_event` (new) | **≥ 1 per weekly active logger per month** |
| 11 | **Referral source** | Signups by `user_profile.referral_source` (asked in onboarding; `unanswered` when skipped), and how many of each are weekly active loggers in the last complete week. | `user_profile` | none: used to pick channels, compared by KPI 1 share |
| 12 | **App opens and time in app** | Sessions (an open more than 30 minutes after the last close starts a new one) and median session length, 28 days. | `usage_event` (new) | watch, no bar: Unfurl should be fast to log, so short sessions with high KPI 1 are the goal |

Not a KPI on purpose: streak length. A streak punishes the gap that KPI 5 is built to forgive.

## What was added to read them

The record tables, `companion_message`, `ai_usage` and `user_profile` already answer KPIs 1–9 and 11. Two numbers had no source:

- **`usage_event`** (`backend/app/modules/usage/`): one row per `app_open`, `app_close` or `share_card`, owned by the person and tenant-isolated like every record. A share carries the card's fixed key, never typed text. `POST /usage/events` takes batches of up to 50 for the signed-in person.
- **Mobile** (`mobile/src/prototype/usage.ts`): a queue like the onboarding funnel's. The launch and each return to the foreground log an open; leaving for the background logs a close and sends at once. The share sheet logs a `share_card`. Signed-in, live mode only. Each queued event is tagged on the phone with the account it was logged under, and a queue left from another account is dropped, never sent.

No screen names or tap positions are recorded. Screen flows and heatmaps are the analytics SDK question below.

## Product analytics SDK (screen flows, session replay)

**Recommendation: do not add one yet.** Proposed in [adr/0035-product-analytics-sdk-deferred.md](adr/0035-product-analytics-sdk-deferred.md); nothing is installed.

| Question | Answer |
|---|---|
| What would it add? | Screen-to-screen flows, funnels inside the app, and session replay (heatmaps on mobile are replay-derived). |
| Why not now? | With fewer than 50 TestFlight users the KPIs above and interviews answer more per hour than replay. The 12 KPIs need no SDK. |
| Best candidate when it is time | **PostHog**: MIT-licensed core, self-hostable or EU cloud, React Native SDK with session replay. Fits the constitution's rule that a stateful layer must be OSS or have a named exit (self-hosting is the exit). |
| Masking (mandatory) | Unfurl shows health, food and money on nearly every screen, and Apple's rules restrict health data shared with third parties. Replay, if ever on, masks **all** text and **all** images, and captures nothing on finance, nutrition, weigh-in and Fern screens. Events carry ids and fixed names only, never record values. |
| When to revisit | Weekly active loggers ≥ 30, or a specific flow question the KPIs and interviews cannot answer (for example: where do people abandon the first capture). |

## Day-14 survey

The questions are the 10-question TestFlight survey from the 2026-11 customer-interview kit:

| # | Question | Answers |
|---|---|---|
| 1 | How would you feel if you could no longer use Unfurl? | Very / Somewhat / Not disappointed |
| 2 | What do you mainly use Unfurl to track? (pick all) | Money / Food / Workouts / Habits / Tasks |
| 3 | Before Unfurl, how many tracking apps had you stopped using? | None / One / Two or more |
| 4 | What did you use before Unfurl for the thing you track most? | Nothing / Another app (name) / Spreadsheet or notes / A coach or programme |
| 5 | How do you usually tell Fern things? | Typing / Voice note / Photo / A mix |
| 6 | In the last week, how often did Fern file something wrong that you had to fix? | Never / Once or twice / Often / I didn't check |
| 7 | Think of the last day you didn't open Unfurl. When you came back, how did it feel? | Easy to pick up / A bit of a chore / I felt bad about the gap / Haven't missed a day |
| 8 | What nearly made you stop using Unfurl so far? | Nothing / Too slow or buggy / Fern got things wrong / Too many notifications / Seeing misses / Didn't see the point / Other (text) |
| 9 | Would you put down a refundable deposit to keep the founding price for Unfurl Plus? | Yes / Maybe, remind me later / No |
| 10 | What is the main thing Unfurl does for you? If it disappeared, what would you use instead? | Free text |

- **When:** once per person, on the first open on or after their 14th day since signup, or after their 5th log day, whichever comes first. Skippable; a skip is not asked again.
- **Where it lands:** a `survey_response` row per answer set, owned by the person, so answers join to KPIs 1–5 (for example: Q1 "Very disappointed" share among weekly active loggers versus lapsed people).
- **How it is read:** Q1 ≥ 40% "Very disappointed" is the usual product-market-fit bar (directional at this size). Segment every answer by Q1 and by Q3 (quit two or more apps versus not).
- **Status:** specified here, **not built in this change**. The in-app card and the `survey_response` table are their own piece of work (a screen to design and review), proposed as a separate task.

## Caveats

- **Offline logging shifts days.** `created_at` is set when the server writes the row. A record made offline and synced later lands on the sync day.
- **A full re-upload is one burst.** "Re-upload this phone's data" writes every record at once, so that day shows a spike of entries (KPI 4) and possibly a false first log (KPI 6).
- **Imports count once per row.** A bank statement import adds one finance log per row: it can inflate KPI 4 for that day.
- **Cost is an estimate.** `ai_usage.cost_minor` is priced from the model price table at call time.
- **`usage_event` starts empty.** KPIs 10 and 12 read only from the day the backend and an app build with the queue are both released.
