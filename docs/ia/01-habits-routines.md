# M1 Habits & Routines — IA

Date: 2026-09-26 · Status: draft for prototype · Source: [00-intake.md](00-intake.md) (cited as `L<n>`).
Anything not traceable to intake is in §9 with a proposed default.

## 1. Jobs to be done

- **See what's due today and right now, and mark it done with one tap.** (L35 "see what's done today/at this time"; L17–21 C1)
- **Keep a list of daily habits:** add, change, pause and retire them. (L35 "Manage habits tracked daily")
- **Set which weekdays and what time each habit happens**, so Today and reminders are correct. (L37)
- **Time a habit while doing it** (focus-timer style) and have the time saved as the log. (L38)
- **Run a routine:** a stacked sequence of habits played back as one guided flow, with each finished step logged automatically. (L39)
- **Log habits by chatting, speaking or sending a photo, without opening the habit screens.** (L17–21, L62)
- **See how habits are going:** completion, streaks, time spent, with goals to improve against. (L36, L22–24 C2)
- **Face misses honestly:** missed days, broken streaks and skips are shown, not hidden. (L23–24)
- **Share habit and routine results** as story-ready cards. (L25–26 C3)
- **Get a nudge at the scheduled time** so he opens the app. (L37 "what time"; reminder pattern from L43; see OQ-HAB-6)

## 2. Entities

| Entity | Key fields | Notes |
|---|---|---|
| **Habit** | id, name, icon/colour, type (`check` \| `duration` \| `count`), target (minutes for duration, number + unit for count), schedule (1..n slots), reminder on/off, status (`active` \| `paused` \| `archived`), pausedUntil, createdAt, sortOrder | `count` type exists only so phrases like "read 20 pages" work (OQ-HAB-2). One occurrence per scheduled day (OQ-HAB-4). |
| **ScheduleSlot** | weekdays (set of Mon–Sun), time (optional HH:MM; empty = "anytime"), window (minutes, default 60) | By default a habit has one slot. Add a second slot only when some days use a different time (OQ-HAB-1). |
| **HabitLog** | habitId, day (logical date), status (`done` \| `partial` \| `skipped`), value (minutes or count), loggedAt, source (`tap` \| `timer` \| `routine` \| `capture`), note | Each habit gets at most one log per logical day. A later log for the same day updates the existing one (count values are added). A missed day has no log row and is derived from the schedule. |
| **TimerSession** | habitId, startedAt, pausedAt?, accumulatedMs, mode (`countup` \| `countdown`), targetMs, state (`running` \| `paused` \| `ended`) | All values are timestamps. Elapsed = accumulated + (now − startedAt) while running. Only one timer can be active at a time. |
| **Routine** | id, name, icon, schedule (same slot shape as Habit), reminder on/off, steps[], status (`active` \| `archived`) | Examples: "Morning", "Pre-sleep". |
| **RoutineStep** | routineId, habitId, order, plannedMinutes | Every step is a habit (OQ-HAB-3). A habit can appear in more than one routine. |
| **RoutineRun** | routineId, day, startedAt, endedAt?, stepResults[] (habitId, status `done` \| `skipped` \| `not_reached`, actualMs), state (`in_progress` \| `completed` \| `abandoned`) | Stored as timestamps, so a run survives the app being closed or the phone locked. |
| **HabitSettings** | dayStartHour (default 04:00), weekStart (Mon), defaultReminder on, streakAtRiskNudge on/off | Owner-level settings. Lives under Me. |

## 3. User journeys

**J1 Check off from Today (primary).** Trigger: opens the app, or a reminder push.
1. Today (TODAY-card HAB-C1): due habits are grouped **Now / Later today / Anytime / Done**.
2. Tap a habit's check circle. It is logged `done` and the streak chip animates. **1 tap.**
- Alt a: long-press the row or tap its "⋯" → HAB-05 Log sheet → pick Skip / Partial / value / note → Save. **2 taps.**
- Alt b: the tap was a mistake → tap Undo in the toast, or tap the circle again. The log is removed.
- Alt c: a count habit → tap "+" (adds the default step, e.g. +1) or tap the value to type one in HAB-05.
- Alt d: offline → the log is saved locally and shows a pending dot until it syncs (HAB-E1).

**J2 Log by Capture (primary for C1).** Trigger: he taps Capture, or speaks or types in chat.
1. Capture (M5) receives: "did my workout and read 20 pages".
2. The AI matches phrases to active habits and writes the HabitLogs.
3. A result card (HAB-24) appears in the chat: "✓ Workout · ✓ Read 20 pages · streaks 5 / 12", with **Undo** and **Edit** buttons.
- Alt a: no habit matches ("did yoga") → the AI asks "Log once, or create habit 'Yoga'?" → the answer creates HAB-24 or HAB-03 prefilled.
- Alt b: more than one habit matches ("did my reading" when both "Read book" and "Read news" exist) → the AI asks one choice question.
- Alt c: the day is implied ("last night journaled") → the log is backdated. The card shows the date in bold.
- Alt d: a command, not a log ("start morning routine", "start 25-min reading timer") → opens HAB-14 or HAB-06.

**J3 Create a habit.** Trigger: HAB-01 "+", Today empty state, or Capture ("add habit stretch weekdays 7am").
1. HAB-03 Habit form: name (required), type, target, schedule (HAB-04), reminder.
2. Save → returns to HAB-01. The habit appears on Today if it is due today.
- Alt: created from Capture → the AI fills the form → confirm card → Save. **No form screen is needed.**
- Alt: validation error (no name, or no weekdays) → inline error on HAB-03.

**J4 Time a habit.** Trigger: ▶ on a duration-habit row (Today or HAB-01), or Capture.
1. HAB-06 Timer starts right away. It counts down if the habit has a target, otherwise counts up.
2. He can lock the phone or close the app. On return, elapsed time is recomputed from the timestamps.
3. Target reached → local vibration/sound if the app is open. If it is closed, a server-scheduled push fires (installed PWA only).
4. Stop → HAB-07 Finish sheet: shows the duration, which can be adjusted → Save logs `done` if ≥ target, else `partial`.
- Alt: another timer is already running → HAB-E3 dialog: switch (ends the old one → HAB-07) or cancel.
- Alt: he forgets the timer (>4h running) → on the next open, HAB-07 appears with "Timer ran 6h 12m — adjust?"

**J5 Build a routine.** Trigger: HAB-10 "+".
1. HAB-12 Routine form: name, schedule, reminder.
2. HAB-11 steps list → "Add step" → HAB-13 picker (existing habits, or "New habit" inline) → set planned minutes → drag to reorder.
3. Save. The routine appears on Today as a CTA when it is scheduled.

**J6 Run a routine.** Trigger: Today CTA "Start Morning · 6 steps · 35m", a routine push, or Capture.
1. HAB-14 Player (full screen, tab bar hidden). It shows the current step, a countdown of planned minutes, "up next", and total progress.
2. Tap **Done** → the step's habit is logged `done` (source routine, actual time) → auto-advances.
3. Options at each step: **Skip** (logged `skipped`), **+1 min**, **Pause**, **Back**.
4. The last step → HAB-15 Summary: steps done, total time vs planned, streaks, and a Share button.
- Alt: a step's habit is already done today → it shows as ✓ and is auto-skipped (tap to redo).
- Alt: he leaves mid-run → the run stays `in_progress`. Today shows "Resume Morning (3/6)". After the day ends it becomes `abandoned`, completed steps stay logged, and unreached steps are counted as missed.
- Alt: a step overruns its planned time → the timer turns amber and counts up the overrun. Nothing blocks.

**J7 Review performance.** Trigger: Stats tab → Habits, a habit row, or HAB-15.
1. HAB-16 Habits analytics: overall rate, per-habit ranking, reflection panel (misses, broken streaks).
2. Tap a habit → HAB-02 detail: calendar heatmap, streaks, trend, history list.
3. Tap a day → HAB-17 day editor to fix a log.
4. Share → HAB-23 share card preview.

**J8 Pause, archive or delete.** Trigger: HAB-02 or HAB-03 overflow.
1. Pause until a date → the habit leaves Today, and its paused days don't count against the rate or streak.
2. Archive → moves to HAB-08. History and stats are kept. It can be restored.
3. Delete → HAB-09 confirm, which states "removes N logs and all stats". Delete is only offered from HAB-08 (archive first).

## 4. Screen inventory

| ID | Screen | Reached from | Purpose | Key content | Actions available |
|---|---|---|---|---|---|
| HAB-C1 | Today · Habits card (component) | Today tab | Check off due habits right now | Groups Now / Later / Anytime / Done; each row shows check circle, name, time, streak chip, ▶ on duration rows, +/value on count rows; progress "4/7" | Check, undo, long-press → HAB-05, ▶ → HAB-06, "Manage" → HAB-01 |
| HAB-C2 | Today · Routine CTA (component) | Today tab | Start or resume today's routine | Name, steps count, planned minutes, state (start / resume 3/6 / done ✓) | Start/Resume → HAB-14, view → HAB-11 |
| HAB-01 | Habits list | Plan › Habits, HAB-C1 "Manage", Stats | Manage all active habits | Rows: name, schedule summary, 7-day dots, streak; segmented **Today / All**; filter chip for paused | +New → HAB-03, tap → HAB-02, reorder (drag), filter/sort → HAB-21, Archived → HAB-08, Routines → HAB-10 |
| HAB-01a | Habits list · empty | HAB-01 with no habits | First-run prompt | "Track your first habit" + 3 starter suggestions + "or just tell Capture" | +New, tap suggestion → HAB-03 prefilled, open Capture |
| HAB-02 | Habit detail | HAB-01, HAB-C1 row tap, HAB-16 | See one habit's performance and history | Header (name, schedule, target); current / best streak; 30-day rate; calendar heatmap (done / partial / skipped / missed / paused / not scheduled); trend; recent logs | Edit → HAB-03, log today → HAB-05, start timer, tap day → HAB-17, Share → HAB-23, overflow: Pause / Archive |
| HAB-03 | Habit form (create/edit) | HAB-01 +, HAB-02 Edit, Capture prefill, HAB-13 "New habit" | Define a habit | Name, icon/colour, type, target, schedule summary → HAB-04, reminder toggle, (edit only) Pause / Archive | Save, cancel, open HAB-04, Pause, Archive |
| HAB-04 | Schedule sheet | HAB-03, HAB-12 | Set weekdays and time | Weekday chips (Every day / Weekdays / custom); time picker or "Anytime"; "Different time on some days" → adds a slot | Toggle days, set time, add/remove slot, done |
| HAB-05 | Log sheet | Long-press on HAB-C1 / HAB-01 row, HAB-02 | Log anything other than a plain done | Status (Done / Partial / Skip), value field (min or count), note, day (defaults to today; "Yesterday" chip) | Save, clear log, cancel |
| HAB-06 | Timer (full screen) | ▶ on row, HAB-02, Capture | Time a habit | Big elapsed/remaining time, habit name, target ring, state | Pause/resume, stop → HAB-07, +5 min, minimise (keeps running; Today row shows a live chip) |
| HAB-07 | Timer finish sheet | HAB-06 Stop, target reached, stale-timer recovery | Confirm the time to log | Measured duration (editable), resulting status (done/partial) | Save log, discard, resume |
| HAB-08 | Archived habits | HAB-01 overflow | Restore or permanently remove | Archived habits with their date ranges and final stats | Restore, Delete → HAB-09 |
| HAB-09 | Confirm dialog (archive / delete / leave routine) | HAB-02, HAB-03, HAB-08, HAB-11, HAB-14 | Prevent accidental loss | Plain consequence text, e.g. "Deletes 142 logs. Stats and streaks are lost." | Confirm, cancel |
| HAB-10 | Routines list | Plan › Habits › Routines, HAB-01 | Manage routines | Rows: name, schedule, steps, planned minutes, last-run status, 7-day dots | +New → HAB-12, tap → HAB-11, Start → HAB-14, archived filter |
| HAB-10a | Routines list · empty | HAB-10 with none | Explain routines | "Stack habits into one guided flow" + "Build Morning routine" | +New → HAB-12 |
| HAB-11 | Routine detail / steps | HAB-10, HAB-C2 | See and edit the step stack; view stats | Ordered steps with planned minutes and total; last 7 runs; routine completion rate, avg actual vs planned | Start, add step → HAB-13, reorder, remove step, edit planned minutes, Edit → HAB-12, Share, Archive/Delete → HAB-09 |
| HAB-12 | Routine form (create/edit) | HAB-10 +, HAB-11 Edit | Name, schedule and reminder for a routine | Name, icon, schedule → HAB-04, reminder toggle | Save, cancel |
| HAB-13 | Add-step picker (sheet) | HAB-11 | Pick a habit to add as a step | Searchable active-habit list; "New habit" row | Select (multi), search, New habit → HAB-03 → returns |
| HAB-14 | Routine player (full screen) | HAB-C2, HAB-10, HAB-11, push, Capture | Guided continuous flow | Current step, countdown/overrun, up next, progress bar, total elapsed | Done, Skip, +1 min, Pause, Back, Exit → HAB-09 ("Leave? Progress is kept") |
| HAB-15 | Routine summary | HAB-14 end | Reward and reflect after a run | Steps ✓/skipped, actual vs planned total, streaks extended, "fastest this month" badge if applicable | Share → HAB-23, Done → Today |
| HAB-16 | Habits analytics | Stats › Habits | Module-level performance | Period switch (7d / 30d / 90d / year); overall completion rate; perfect days; per-habit ranking; time spent; **Reflection** panel (misses, broken streaks, most-skipped); routine stats | Change period, tap habit → HAB-02, sort ranking, Share → HAB-23 |
| HAB-17 | Day editor | Tap a day on the HAB-02 heatmap, "Yesterday" review on HAB-C1 | Fix or backfill past logs | That day's scheduled habits with their current status | Set status/value per habit, save |
| HAB-18 | Habits settings | Me › Modules › Habits | Configure module behaviour | Day starts at (hour), week start, default reminder, streak-at-risk nudge, notification status + "Enable" | Edit each; Enable → HAB-19 |
| HAB-19 | Notifications setup | HAB-18, first reminder toggle, HAB-E2 | Get push working | Status (installed? permission?); iOS: "Add to Home Screen" steps; Android/desktop: permission request | Request permission, show install steps, dismiss |
| HAB-21 | Filter / sort sheet | HAB-01, HAB-10, HAB-16 | Find and order habits | Search field; filter: status (active/paused), type, time of day; sort: manual / time / streak / rate / name | Apply, reset |
| HAB-22 | Plan · Habit schedule view | Plan tab | See the week's habit and routine schedule next to tasks | Week strip; per-day list of scheduled habits/routines by time; past days show status | Tap day → day list; tap item → HAB-02/HAB-11; tap past day → HAB-17 |
| HAB-23 | Share card preview | HAB-02, HAB-11, HAB-15, HAB-16 | Make a story-ready image | Template picker (Streak / Month heatmap / Routine run / Habits scoreboard), metric toggles, hide-names toggle | Switch template, toggle fields, Save image, native Share |
| HAB-24 | Capture result card (in Capture chat) | Capture after a habit intent | Confirm what the AI logged | One line per affected habit: status, value, date if not today, updated streak | Undo (all/each), Edit → HAB-05, Create habit (unmatched) → HAB-03 |
| HAB-E1 | Offline / sync pending state | Any habit screen | Show unsynced logs | Pending dot on rows; banner "3 logs waiting to sync" | Retry now |
| HAB-E2 | Reminder not delivered state | HAB-03 / HAB-12 reminder toggle, HAB-18 | Warn that push won't work | Inline "Reminders need the app installed + notifications allowed" | Fix → HAB-19 |
| HAB-E3 | Timer conflict dialog | ▶ while another timer runs, routine start while a timer runs | Enforce one active timer | "Reading timer is running (12:04)" | Stop it & start new, cancel |
| HAB-E4 | Load / save error state | Any list, detail or form | Recover from server failure | Inline error with last-known data (cached), unsaved form preserved | Retry |

**Coverage check (closed list).** Rows show which screen covers each operation; "—" means it isn't needed.

| Operation | Habit | HabitLog | TimerSession | Routine / Step | RoutineRun |
|---|---|---|---|---|---|
| Create | HAB-03 | HAB-C1, HAB-05, HAB-24 | HAB-06 | HAB-12 / HAB-13 | HAB-14 |
| List | HAB-01, HAB-C1 | HAB-02 recent logs | — (single active) | HAB-10 / HAB-11 | HAB-11 last runs |
| Detail | HAB-02 | HAB-05 | HAB-06 | HAB-11 | HAB-15 |
| Edit | HAB-03, HAB-04 | HAB-05, HAB-17 | HAB-07 | HAB-12, HAB-11 | — (edit the resulting logs) |
| Delete / archive | HAB-03 → HAB-08 → HAB-09 | HAB-05 "clear", undo | HAB-07 discard | HAB-11 → HAB-09 | — (runs go when their routine is deleted) |
| Empty | HAB-01a, HAB-C1 "all done / nothing due" | HAB-02 "no logs yet" | — | HAB-10a, HAB-11 "no steps" | HAB-11 "never run" |
| Error | HAB-E1, HAB-E4 | HAB-E1 | HAB-E3 | HAB-E4 | HAB-E1 (run saved locally) |
| Search / filter / sort | HAB-21 | HAB-02 heatmap by period | — | HAB-21, HAB-13 search | — |
| Settings | HAB-18, HAB-19 | HAB-18 day start | HAB-18 | HAB-12 reminder | — |

## 5. Function inventory

| ID | Function | Screen(s) | Notes |
|---|---|---|---|
| F-HAB-01 | Check habit done (1 tap) | HAB-C1, HAB-01, HAB-22 | Optimistic. Offline-queued. Toast with Undo. |
| F-HAB-02 | Undo / uncheck | HAB-C1, HAB-24, toast | Removes the log and recomputes the streak. |
| F-HAB-03 | Increment count (+step) | HAB-C1, HAB-01 | Count type only. The default step is set on the habit. |
| F-HAB-04 | Log with status / value / note / day | HAB-05 | Covers partial, skip and backdate. |
| F-HAB-05 | Skip with optional reason | HAB-05, HAB-14, Capture | Skips are shown in Reflection (see §7 for their streak effect). |
| F-HAB-06 | Backfill / edit a past day | HAB-17, HAB-05 day chip | Any past day. Streaks recompute. |
| F-HAB-07 | Create habit | HAB-03, Capture | Name is required. The default schedule is every day, anytime. |
| F-HAB-08 | Edit habit | HAB-03 | A schedule change applies from today on. Past days keep the schedule they had (§8). |
| F-HAB-09 | Set schedule (weekdays, time, extra slot) | HAB-04 | |
| F-HAB-10 | Reorder habits | HAB-01 | Sets the manual order used on Today within each time group. |
| F-HAB-11 | Pause habit until a date | HAB-02, HAB-03 | Paused days are excluded from rate and streak. Auto-resumes on that date. |
| F-HAB-12 | Archive / restore habit | HAB-03, HAB-08 | |
| F-HAB-13 | Delete habit permanently | HAB-08 → HAB-09 | Archived habits only. The dialog states the log count. |
| F-HAB-14 | Search / filter / sort habits | HAB-21 | |
| F-HAB-15 | Start timer | HAB-C1 ▶, HAB-02, HAB-06, Capture | Countdown if a target exists. HAB-E3 if another timer is running. |
| F-HAB-16 | Pause / resume timer | HAB-06, Today live chip | Timestamp-based. |
| F-HAB-17 | Stop timer → confirm duration → log | HAB-06, HAB-07 | Done if ≥ target, else partial. Duration editable. |
| F-HAB-18 | Discard timer | HAB-07 | |
| F-HAB-19 | Recover stale timer | HAB-07 on app open | Triggered when running >4h (OQ-HAB-7). |
| F-HAB-20 | Timer-end alert | HAB-06 (in-app), push | Push is scheduled server-side at the expected end time. Recomputed on pause/resume. |
| F-HAB-21 | Create routine | HAB-12 | |
| F-HAB-22 | Add / remove / reorder steps; set planned minutes | HAB-11, HAB-13 | |
| F-HAB-23 | Edit / archive / delete routine | HAB-12, HAB-11, HAB-09 | Deleting a routine never deletes its habits or their logs. |
| F-HAB-24 | Start / resume routine | HAB-C2, HAB-10, HAB-11, Capture, push | |
| F-HAB-25 | Step Done (auto-advance, logs habit) | HAB-14 | The log records actual time spent on the step. |
| F-HAB-26 | Step Skip / Back / +1 min / Pause | HAB-14 | |
| F-HAB-27 | Exit routine mid-run | HAB-14 → HAB-09 | The run stays resumable until the day ends. |
| F-HAB-28 | Finish routine → summary | HAB-15 | |
| F-HAB-29 | View habit detail + heatmap | HAB-02 | |
| F-HAB-30 | View habits analytics + period switch | HAB-16 | |
| F-HAB-31 | View reflection (misses, broken streaks) | HAB-16, HAB-02 | Always visible. It cannot be collapsed away by default (C2). |
| F-HAB-32 | Generate / share card | HAB-23 | Saves the image or uses the native share sheet. A hide-names option is available. |
| F-HAB-33 | Habit reminder push at scheduled time | Push → HAB-C1 | Tapping opens Today with the habit highlighted. The push has a "Done" action where the platform supports it (OQ-HAB-8). |
| F-HAB-34 | Routine reminder push | Push → HAB-14 | Tapping opens the player ready to start. |
| F-HAB-35 | Streak-at-risk nudge | Push (evening) | Sent only when a streak ≥3 would break today. Toggle in HAB-18 (OQ-HAB-6). |
| F-HAB-36 | Enable notifications / install guide | HAB-19 | iOS: install to Home Screen first. |
| F-HAB-37 | Capture: log habit(s) from text/voice | Capture → HAB-24 | Multi-habit in one message. The AI asks only when the match is ambiguous or missing. |
| F-HAB-38 | Capture: create habit / routine | Capture → confirm → HAB-03 | Shows a confirmation card and does not open the form. |
| F-HAB-39 | Capture: start timer / routine | Capture → HAB-06 / HAB-14 | |
| F-HAB-40 | Capture: undo / edit a captured log | HAB-24 | |
| F-HAB-41 | Offline queue + sync | HAB-E1 | Logs, timer actions and routine runs are written locally first. |
| F-HAB-42 | Edit module settings | HAB-18 | Day start, week start, default reminder, nudge. |
| F-HAB-43 | View week schedule in Plan | HAB-22 | |

## 6. Today-card & Capture hooks

**On Today (in order):**
1. **Routine CTA** (HAB-C2) appears when a routine is scheduled today. It shows Start or Resume (n/m), or ✓ with the actual time once done.
2. **Habits card** (HAB-C1). "Now" is the habits whose time window contains the current time, plus overdue ones. After those come Later today, then Anytime, then a collapsed Done group. The header shows "4/7 today" and today's perfect-day status.
3. **Live timer chip** shows when a timer is running. Tapping it opens HAB-06.
4. **Yesterday's loose ends** appear only when yesterday has unlogged scheduled habits and only until noon: "2 habits not logged yesterday: Done / Missed". This saves a trip to the history screen.

Tap budget: check off = 1 tap · skip/partial/note = 2 taps · start timer = 1 tap · start routine = 1 tap · resolve yesterday = 1 tap per habit.

**Capture phrases → records**

| Phrase (text or voice) | Result |
|---|---|
| "did my workout and read 20 pages" | HabitLog Workout `done`; HabitLog Read `done` value 20 (count type), or `done` + note "20 pages" (check type) |
| "meditated 15 min this morning" | Meditate `done` value 15 min, source capture |
| "skipped gym, knee is sore" | Gym `skipped`, note "knee is sore" |
| "journaled last night" (sent at 01:00, before day start) | Journal `done` on the previous logical day. The card shows the date. |
| "did everything in my morning routine except cold shower" | A RoutineRun `completed` is created. Every step is `done` except Cold shower, which is `skipped`. |
| "start my morning routine" | Opens HAB-14 |
| "25 min reading timer" | Starts a countdown timer on Read → HAB-06 |
| "new habit: stretch weekdays 7am" | Confirm card → Habit Stretch, Mon–Fri 07:00, check type |
| "did yoga" (no such habit) | AI asks: "Log once as a note, or create habit 'Yoga'?" |
| Photo (e.g. a gym selfie) with no text | AI asks what to log. Photo attachment as proof is Later. |

Rule: after a capture the AI states what it logged and offers Undo. It asks follow-up questions only for missing required context: which habit, or which day if the phrase is ambiguous.

## 7. Metrics for Stats & share cards

Definitions: a **scheduled occurrence** is a (habit, logical day) pair where the day is in the habit's schedule and the habit is active and not paused. **Done** includes `partial` only where noted.

| Metric | Formula | Shown where | Good / bad framing |
|---|---|---|---|
| Completion rate (per habit, overall) | done occurrences ÷ (scheduled occurrences − skipped), over the period | HAB-02, HAB-16, player profile, share cards | Up vs previous period = green delta. Below 50% = flagged in Reflection. |
| Skip rate | skipped ÷ scheduled occurrences | HAB-16 Reflection, HAB-02 | Always shown next to completion so a skip-heavy rate isn't inflated. |
| Current streak | consecutive scheduled occurrences, back from today, that are `done`/`partial`. Skipped and paused days neither extend nor break the streak. Today counts only once logged. | HAB-C1 chip, HAB-02, share | Milestones at 7 / 30 / 100 / 365 get a celebration on check-off. |
| Best streak | max current-streak value ever | HAB-02, share | "New best" badge when current exceeds best. |
| Broken streaks | count of streaks ≥3 that ended with a miss in the period, plus the length lost | HAB-16 Reflection, HAB-02 | Honest: "Lost a 21-day Read streak on Sep 14". |
| Missed | scheduled occurrences with no log after the day ended | HAB-02 heatmap (red), HAB-16 Reflection | Shown plainly. Most-missed weekday is called out. |
| Perfect days | days where every scheduled occurrence is `done` | HAB-16, Today header, player profile | Count and streak of perfect days. |
| On-time rate | done occurrences logged within the slot window ÷ done occurrences with a set time | HAB-02, HAB-16 | Shows whether a habit happens at its planned time or drifts. |
| Time invested | Σ value (minutes) of duration-habit logs | HAB-02, HAB-16, player profile, share | Total and per week. More = good. |
| Count total | Σ value of count-habit logs (e.g. pages) | HAB-02, share | "1,240 pages this year". |
| Routine completion rate | completed runs ÷ scheduled routine days | HAB-11, HAB-16, player profile | Abandoned runs are shown with the step reached. |
| Routine pace | avg (actual total ÷ planned total) for completed runs | HAB-11, HAB-15 | <100% = faster than plan (good). Consistent overrun = suggest updating planned minutes. |
| Habit completion (profile stat) | overall completion rate, last 30 days | Stats player profile, share | Headline habits number (L12–13). |

## 8. Edge cases

| Case | Expected behaviour |
|---|---|
| Logging after midnight but before day start (e.g. 01:30) | The log goes to the previous logical day. HAB-05 shows the date. |
| Habit created mid-day | Today counts as scheduled if it's a scheduled weekday. Days before creation are never "missed". |
| Schedule changed | Only today and future days change. Past heatmap and rate keep the schedule in effect at the time. |
| Logged on an unscheduled day | Stored as `done` and shown as a bonus (hollow dot). It doesn't count in the rate, and neither extends nor breaks the streak. |
| Two check-offs for the same habit on the same day (tap + capture) | Merged into one log. Count values are added. The capture card says "already done — updated". |
| Timer running when app closed or phone locked | Elapsed is recomputed from timestamps on return. No loss. |
| Timer spans midnight / day start | The log goes to the day the timer started. |
| Timer forgotten for hours | Past 4h, the next open shows HAB-07 with the measured time highlighted for correction. |
| Start routine while a habit timer runs | HAB-E3: stop the timer (log it) or cancel. |
| Routine step habit already done today | Shown ✓ and auto-skipped in the player. Redo allowed and updates the value. |
| Same habit in two routines | Allowed. Whichever runs first logs it. The second shows it as done. |
| Routine edited while a run is in progress | The run keeps its step list snapshot. Edits apply to the next run. |
| Routine left unfinished past day end | Becomes `abandoned`. Completed steps stay logged. Shown in Reflection as "Morning abandoned at 3/6". |
| Habit archived that is a routine step | The step is hidden from the player. HAB-11 shows "1 archived step". |
| Habit deleted | Removed from routines. All logs are removed (the confirm dialog says so). |
| Pause spans a week | Paused days show grey. They are excluded from rate, missed and streak. |
| Offline check-off, then sync fails repeatedly | Log stays local with a pending dot. HAB-E1 banner with Retry. Never silently dropped. |
| Two devices log the same day differently | Last write wins per (habit, day). Count values are added. |
| Timezone change while travelling | The logical day follows the device's current timezone. Scheduled times are local wall-clock. |
| Push not available (iOS not installed / permission denied) | The reminder toggle shows HAB-E2. Everything else works, and Today remains the source of truth. |
| No habits scheduled today | HAB-C1 shows "Nothing scheduled — rest day", plus Anytime habits if any exist. |
| All done today | HAB-C1 collapses to "7/7 ✓ Perfect day" with a share shortcut. |
| Capture matches the wrong habit | The Undo/Edit card is visible right away. The correction is made in one tap. |

## 9. Open questions

| ID | Question | Proposed default | Why it matters |
|---|---|---|---|
| OQ-HAB-1 | "Which days, what time" (L37): one time for all chosen days, or a time per weekday? | One time for all days, with an optional "different time on some days" extra slot. | Sets the complexity of HAB-04 and of the reminder logic. |
| OQ-HAB-2 | Habit types: check only, or also duration and count (e.g. pages, glasses)? | check + duration (L38 implies it) + count. | "Read 20 pages" is the owner's natural phrasing. Without count, capture loses the number. |
| OQ-HAB-3 | Can a routine step be a one-off action that isn't a tracked habit (e.g. "make bed")? | No. Every step is a habit. Inline "New habit" makes adding one cheap. | Keeps stats consistent. The alternative doubles the entities. |
| OQ-HAB-4 | Multiple times per day (e.g. "water ×8"), or "3× per week, any days"? | Neither. Use count type for ×8. Flexible weekly frequency is Later. | Changes the streak and rate formulas substantially. |
| OQ-HAB-5 | Does a skip preserve the streak? Is there a skip allowance? | Skip neither breaks nor extends the streak, has no limit, and is always visible as skip rate. | Too lenient hides bad behaviour (C2). Too strict makes him quit. |
| OQ-HAB-6 | Which reminders? Scheduled-time pushes, routine pushes, and/or the evening streak-at-risk nudge? | Scheduled + routine reminders on by default. Streak-at-risk nudge is on, one per evening at 21:00, max. | Nudges get him to open the app (L43). Too many get muted. |
| OQ-HAB-7 | When is a running timer considered "forgotten"? | 4 h, or 2× the target, whichever is shorter. | Otherwise one forgotten timer inflates time-invested stats. |
| OQ-HAB-8 | Actionable "Done" button on the push notification? | Yes where Web Push actions are supported. Otherwise the tap opens Today. | Would allow a 0-tap in-app log. Platform support is uneven. |
| OQ-HAB-9 | Day-start hour for someone working two jobs? | 04:00, configurable in HAB-18. | Late-night logs landing on the wrong day corrupt streaks. |
| OQ-HAB-10 | "At this time" (L35): does it mean the habits due now, or seeing when each was done? | Both. Today has a "Now" group (due now), and HAB-02/HAB-17 show loggedAt. | Decides the structure of the Today card. |
| OQ-HAB-11 | Routine player: auto-advance when planned time ends, or wait for Done? | Wait for Done, and count up the overrun. Auto-advance is a per-routine toggle, Later. | Auto-advance logs steps he didn't actually do. |
| OQ-HAB-12 | Should share cards show habit names? | Names shown, with a hide-names toggle on HAB-23. | Some habits are private (health, etc.). |
| OQ-HAB-13 | How does habits completion combine with other modules in the player profile? | This module exposes the metrics in §7. M6 decides the composition. | Avoids two modules defining the headline differently. |

## 10. Later / out of scope

- Flexible frequency ("3× a week, any days"), multiple occurrences per day (OQ-HAB-4).
- Photo proof attached to a log.
- Pomodoro cycles / breaks in the timer. Ambient sounds.
- Routine auto-advance, voice-guided steps (TTS), step-level notes/instructions.
- Habit templates library beyond the 3 starter suggestions.
- Social: friends, comparing streaks, challenges (C3 wish; owned by M6).
- Habit goals beyond the target (e.g. "hit 90% in October") belong to M6 goal-setting if it exists.
- Home-screen widgets / lock-screen live activity (not available to a PWA).
- Linking habits to other modules automatically (e.g. a gym workout logged in M3 checks the "Workout" habit). This is a strong C1 win but needs M3's IA first, so it's flagged for cross-module review.

## 11. Frame feedback

- **Habits and Routines need a home in Plan.** Plan = tasks + habit schedule (L83). Proposal: Plan gets a top segmented control **Tasks · Habits** (Habits = HAB-22 week view, with Manage → HAB-01/HAB-10). Management should not live only in Me › module config, because creating and editing habits is frequent in the first weeks.
- **Full-screen modes hide the tab bar:** Routine player (HAB-14) and Timer (HAB-06). A running timer or routine surfaces as a persistent mini-bar above the tab bar on every tab, like a music player.
- **Me › Modules › Habits** holds only HAB-18 settings, consistent with L86.
- **Cross-module:** Stats needs a shared "Reflection" pattern (misses, broken streaks) so every module presents negatives the same way. Propose that M6 own the component and M1 supply the data.
