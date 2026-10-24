# ADR-0025 — Focus: a timer that records what the time went to

- **Date:** 2026-10-24
- **Status:** accepted
- **Deciders:** owner (delegated: "decide rather than ask")

## Context

Every other module records finished things: a habit ticked, a task done, a
meal eaten. Nothing records the work in between. The owner asked for a focus
timer in the shape of TickTick's Pomodoro and free stopwatch, kept as a
record of what the person actually did with their time (the counterpart to
Screen Time, which records apps): focus sessions on a task or a habit, with
pauses and switches kept, shown as blocks on a day timeline, measured
against a daily "deep work" goal, and counted in the Life Score.

The app is local-first (ADR-0011): the phone writes its stores, an outbox
pushes them, and the server is the merge point for several devices. A timer
in that world has to survive the app being killed, the phone being locked,
being offline, and two devices touching the same session.

## Decision

### A session is a sequence of segments, and the timer is read from them

- **`focus_session`**: one sitting at the timer. Its mode (`pomodoro` or
  `stopwatch`), the lengths it ran with (focus, short break, long break,
  sets before the long break, copied from the preset or custom), the two
  auto-start switches, `started_at`, `ended_at`, `end_reason`
  (`completed` / `abandoned`), and the item being worked on now.
- **`focus_segment`**: one span of `focus`, `break` or `pause`, with
  `started_at`, `ended_at` (null while it runs), the Pomodoro `set_index`
  it belongs to, `planned_sec` (the set's or break's length, extensions
  included; null for a stopwatch), and the item (`item_kind` task or habit,
  `item_id`, and `item_title` as it was, so a renamed or deleted item still
  labels its time). Segments of one session never overlap: a pause closes
  the running segment and opens a pause segment; resuming closes it and
  opens a segment of the paused kind.
- **`focus_settings`**: one row per person with the daily goal
  (`daily_goal_min`, default 120, 0 turns it off) and the timer defaults.
- `task.estimate_min` (new, nullable): how long a task should take, so its
  page shows time spent against it. A habit's estimate is its existing
  duration target, compared with today's time.

Nothing counts. Where the timer stands at any instant is a pure function of
the segments' timestamps (`logic.py` on the server, `shared/prototype/focus/
logic.ts` on the device, checked against each other by the golden test
`scripts/golden/focus.golden.test.ts`):

- a focus set ends when its focus segments add up to `planned_sec`, pauses
  excluded; a break the same way;
- `advance(now)` writes down transitions that came due unseen: it closes the
  finished segment on the exact instant it finished and, when auto-start is
  on, opens the break or the next set at that instant. The auto-opened
  segment's id is derived (`uuid5("focus-segment:<session>:auto-<kind>-<set>")`),
  so the phone and the server opening "the same" break produce one row.

### Edge cases, decided

| Case | Rule |
|---|---|
| Presets | 25/5 with 15 after 4 ("Classic"), 50/10 with 20 after 3, 90/20 with 30 after 2; or custom lengths |
| Auto-start | Breaks auto-start by default; the next set does not (both switchable). Auto-start never passes a **long break**: after it the timer waits, so a session left running accrues at most one round unattended |
| Skip a break | Closes the break now (or skips one the timer was waiting on) and starts the next set now |
| Extend | Adds minutes to the running or paused set or break (`planned_sec` on that set's segments) |
| End early | Closes everything now and keeps it: the partial set's minutes count, but it is not a finished Pomodoro |
| Abandon (Discard) | The session is kept as `abandoned` for honesty but **counts nowhere**: not in the day, the goal, an item's time, or the Life Score |
| Accidental tap | A session ended with under 60 seconds of focus is recorded as abandoned |
| Left running | A stopwatch, or a pause nobody resumed, is closed 12 hours after it began and the session ends there |
| Midnight / the 04:00 business-day start | A span is split at the person's day boundary (their time zone and `day_start_hour`); midnight itself splits nothing. The session's `day` is the business day it started |
| App killed / phone locked | Nothing runs in the background: on the next launch, foreground or screen tick, `advance` writes down what came due, then it syncs |
| Two devices | Each writes rows; field-level last-writer-wins applies per segment. Two open segments in one session are closed where the next begins. Two sessions covering the same minutes count those minutes **once** (per-day and per-item totals are over the union of the intervals) |
| Starting while one runs | The running session ends first (kept) |
| Offline | Plain rows through the existing outbox; the server re-derives the session's `day`, `focus_sec` and `sets_completed` from its segments on every write |

### Writes and reads

The phone runs the timer and writes sessions and segments as entity upserts
through `/sync` (no actions: every change is a field write, which is what
makes offline and two devices simple). The server checks each write (ranges,
item pairs, the parent session) and re-derives the totals.

`/api/v1/focus` serves the reads (`/today`, `/range`, `/day` timeline,
`/items/{kind}/{id}` time on an item, `/sessions`, `/current`, settings)
and timer actions (`POST /sessions` to start, `/current/pause`, `resume`,
`next`, `skip-break`, `extend`, `switch`, `stop`) for Fern and anything
driving the timer over HTTP. Actions apply the same pure functions and save
the result. Permissions `focus:read` and `focus:write`, granted to the
baseline user role.

### Stats and the Life Score

Focus becomes a module key (`focus`), a Life Score area (label "Focus",
accent `foc`, default weight 2, enabled by default) and a stats contributor:

- a day is **due** from the person's first counted session on, while the
  goal is on, and **done** when its focus reaches the goal;
- the **area rate** is the mean, over due days in the window, of each day's
  share of the goal capped at 1; it is `null` (left out of the Life Score)
  before the first session and while the goal is off, so someone who never
  uses the timer is not marked down;
- metrics `focused`, `daily` (average a due day), `goalDays`, `sessions`,
  `pomodoros`; misses for due days that ended under the goal; achievements
  for the first session and 3/7/30/100-day goal streaks; a "Focus" facet;
- calendar items: one per session per day ("Focus 50m · Write the ADR"),
  linking to the day timeline, so the Plan calendar shows focus time too.

The migration widens the three module-key checks (`module_pref`,
`setup_skip`, `daily_module_stat`).

### Colour

A seventh data colour, `foc`, teal (`#0a7d92` light, `#3cb0c4` dark), fills
the hue gap between Money green and Tasks blue. It has ≥ 3:1 contrast on
card in both themes (4.8:1 light, 6.6:1 dark) but was added after the
six-colour set was validated for colour-blind separation, and it sits
nearest `tsk` and `fin` in hue, so Focus colour is always paired with the
Focus label or the timer icon.

### Navigation

No new tab: the tab bar stays Today, Plan, Fern, Stats, Me. Focus is
reached by a **Focus card on Today** (today against the goal, what runs, a
Start button), a **Focus tile** in the app launcher on Today and Me (seven
apps now wrap into rows of four), the **Live bar** while a session runs
(from any screen), the time-spent card on every task and habit page
("Focus" starts a session on it), the Plan calendar's focus items, and Fern.
The timer is full screen (`/focus`), like the habit timer; `/focus/day`,
`/focus/stats` and `/focus/settings` are ordinary pages.

### Fern

Read: `focus_status` (today, or the last N days: total against the goal,
by item, the goal streak, what runs now). Write: `start_focus`,
`focus_control` (pause, resume, skip the break, start what is next, switch
item, extend) and `stop_focus` (keep or abandon), offered when the turn's
words are about focus, the timer, studying or time spent. Fern's TODAY
facts carry today's focused time, the goal and the running session.

### Native touches

- The running session is drawn by the existing Live Activity / ongoing
  notification as a `timer` (no native code changed): a Pomodoro counts
  down to the end of its set or break, a stopwatch counts up; pause,
  resume, skip the break and end work from the lock screen.
- A local notification fires when a set or a break ends (switchable), so
  the phone tells the person even when the app is closed.

## Constitution clause deviated from

None.

## Consequences

**Positive:**
- The timer is correct after a kill, a lock, a reboot, a second device or a
  week offline, because nothing but timestamps is stored.
- Every pause and switch is kept, so the day timeline and time-by-item are
  exact rather than estimated.
- Tasks and habits gain "time spent", and tasks an estimate to hold it
  against.

**Negative:**
- Totals derived on the server lag the phone until it syncs; an auto-start
  transition that came due while the phone was off is written when the
  phone next opens (the server reads its own `advance` in memory meanwhile).
- Two devices editing one running session can each close it differently;
  last-writer-wins per field decides, and union counting keeps the totals
  honest.
- `foc` was not validated with the original colour-blind sweep.

**Follow-ups:**
- An iOS home-screen quick action ("Start focus") when the app adds
  `expo-quick-actions`.
- A focus share card on the share-card system.
