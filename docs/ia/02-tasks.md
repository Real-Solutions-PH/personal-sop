# M2 Tasks — IA

Date: 2026-09-26 · Source: [00-intake.md](00-intake.md) · Status: draft for review.
Trace keys: **C1–C7** = hard constraints; **M2** = intake §M2 lines 42–43; **M5** = Capture & AI; **M6** = dashboard/stats; **ENV** = PWA realities (lines 74–76); **FRAME** = tentative global frame (lines 80–88).

Design stance (C1, C5): a task is *a line of text with an optional when*. Everything else is optional and never asked for at creation. The AI (M5) fills fields; the UI is for reviewing, ticking off and fixing.

## 1. Jobs to be done

- Dump anything I need to do — work, life, groceries — in one breath, without choosing fields. *(M2 l.42, C1 l.17–21)*
- Keep separate buckets (work / daily life / groceries) without having to maintain a system. *(M2 l.42 "work, daily life, groceries"; "unopinionated")*
- Get pinged at a specific time so I pick up the phone and open the app. *(M2 l.43)*
- See what's due today alongside habits/macros/spend without opening a separate screen. *(M6 l.65, FRAME l.81–82)*
- Tick things off fast while shopping (one-handed, in-store, possibly offline). *(M2 l.42 groceries, ENV l.76)*
- Deal honestly with what slipped: see overdue and how often I pushed things. *(C2 l.22–24)*
- Get rewarded / brag about getting things done (completion stats, share card). *(C2, C3 l.22–26)*
- Add a task on the go by voice or photo (e.g., photo of a handwritten list or whiteboard). *(C1 l.20, M5 l.62)*

## 2. Entities

| Entity | Key fields | Notes |
|---|---|---|
| **Task** | id, title, list_id (nullable → Inbox), due_date (nullable), due_time (nullable), remind_at (nullable), recurrence (nullable), notes (nullable), priority flag (bool "starred"), status (open / done / deleted), completed_at, created_at, source (manual / capture-text / capture-voice / capture-photo), parse_state (parsed / pending — for offline captures), original_due (first due set), reschedule_count | Only `title` is required. `original_due` + `reschedule_count` power honest-reflection metrics (§7). One flag, not a 4-level priority (C5). |
| **List** | id, name, kind (standard / shopping), icon/colour, sort_order, archived_at, is_default | Seeded: **Work**, **Life**, **Groceries** (kind=shopping). `Inbox` is virtual (list_id = null). *Shopping* kind = no dates by default, check-off sorts to bottom, "clear checked". |
| **Recurrence** (value on Task) | rule (daily / weekdays / weekly on [days] / monthly on day N / every N days), mode (fixed schedule / after completion) | Completing a recurring task spawns the next instance; the done one stays for stats. |
| **TaskEvent** | task_id, type (created / completed / uncompleted / rescheduled / deleted / restored), from_due, to_due, at | Append-only; feeds Stats. Not user-visible except via Stats. |
| **PushSubscription** | device id, endpoint, platform, installed (bool), created_at | Per device. Needed because iOS push only when installed (ENV l.74). |
| **TaskSettings** (on user) | default reminder time for date-only tasks, morning digest on/off + time, quiet hours, count groceries in stats (bool), week start | Lives under Me → Tasks. |

Deliberately **no**: tags, projects/sections, subtasks, Kanban, time estimates, Eisenhower matrix, pomodoro (Pomodoro-style timing lives in M1 habits). See §10.

## 3. User journeys

**J1 — Brain-dump via Capture (primary path).** Trigger: thought on the go.
1. Any screen → tap **(+) Capture** (1 tap) → M5 chat opens with mic/keyboard ready.
2. Type/speak: "buy eggs and rice, call Mark tomorrow 3pm, finish deck for work by Fri".
3. AI returns **TSK-14 Capture result card** listing 4 tasks with inferred list/date/time/reminder.
4. Owner does nothing → auto-saved after send (card shows "Saved · Undo"). Or taps a row → **TSK-03** to fix.
- Alt 4a: ambiguous item ("call Mark" with no time) → saved without date; AI asks **one** follow-up only if the phrase implied time but it's unparsable ("tomorrow after lunch" → "1pm OK?" with chips 1pm / 2pm / No time). Unanswered → task stays saved as-is.
- Alt 4b: offline → text stored locally as a single raw task (parse_state=pending), badge "will sort when online"; on reconnect AI splits it and shows the result card next time Capture/Today opens.
- Alt 4c: photo of a handwritten list → same result card, all items into the list AI infers (Groceries if items look like groceries), editable.

**J2 — Manual quick-add (≤2 taps).** Trigger: prefers typing a single task.
1. Long-press **(+)** anywhere (or tap "+" on any task list) → **TSK-04 Quick-add sheet**, keyboard up (1 tap/press).
2. Type "dentist fri 10am" — inline natural-language date parse highlights "fri 10am" (local parser, works offline).
3. Tap **Add** or Return (2nd tap). Sheet stays open for the next line; swipe down to close.
- Alt: list chip defaults to the list you're in (or Inbox); tap chip to change — optional.

**J3 — Reminder fires → open app.** Trigger: remind_at reached.
1. Web Push: "Call Mark · 3:00 PM" with actions **Done** / **Snooze 1h** (where the platform supports actions).
2. Tap body → app opens to **TSK-03** for that task.
3. Done → completed; Snooze → remind_at +1h (not a reschedule).
- Alt: push not available (iOS not installed / permission denied) → task surfaces in **TSK-16 Today card** with a "due now" badge and app-icon badge count where supported; banner on next open.

**J4 — Enable reminders (first time).** Trigger: first task saved with a time/reminder.
1. Inline prompt in TSK-14 / TSK-04: "Want a ping at 3pm?" → **TSK-12 Reminders setup sheet**.
2. If iOS Safari and not installed → step-by-step "Add to Home Screen" illustration; "Remind me later".
3. If installed / Android / desktop → explain → system permission prompt.
4. Granted → test notification "You're set". Denied → explain fallback (Today card), link to how to re-enable.

**J5 — Grocery run.** Trigger: at the store.
1. Today card "Groceries · 6" or Plan → Tasks → **Groceries** → **TSK-02 List detail (shopping mode)**.
2. Tap each item's circle to check; checked items drop to "In cart" section.
3. **Clear checked** → marks all done (kept for stats if enabled), list empties.
- Alt: offline in store → checks are queued, sync later.

**J6 — Daily review / overdue triage.** Trigger: overdue tasks exist when opening Today.
1. Today card shows "3 overdue" in warning colour → tap → **TSK-11 Overdue triage sheet**.
2. Per task: **Today** / **Tomorrow** / **Pick date** / **Done** / **Drop (delete)**; or **Move all to today**.
3. Each date change increments reschedule_count (visible later in Stats).

**J7 — Review week / brag.** Trigger: curiosity, end of week.
1. Stats → Tasks → **TSK-17 Task stats**.
2. Tap **Share** → **TSK-18 Share card preview** → pick template → system share sheet.

**J8 — Find something.** Plan → Tasks → search icon → **TSK-09 Search & filter** → type → results across lists incl. completed.

## 4. Screen inventory

| ID | Screen | Reached from | Purpose | Key content | Actions available |
|---|---|---|---|---|---|
| TSK-01 | Tasks home (Plan → Tasks segment) | Plan tab; Today card "See all"; Stats drill-down | Overview of all open tasks | Smart views: **Today** (incl. overdue at top), **Upcoming** (next 7 days grouped by day), **Inbox**, **Starred**; list of Lists with open counts; offline/sync banner | Tick task, open task, quick-add, open list, search, open overdue triage, manage lists |
| TSK-02 | List detail | TSK-01 list row; Today groceries chip | Tasks in one list (or smart view) | Open tasks (sorted by due, then manual order); collapsed "Completed (n)"; shopping mode: "In cart" section + Clear checked | Tick/untick, swipe (right=done, left=reschedule/delete), drag reorder, quick-add into this list, edit list, sort toggle |
| TSK-03 | Task detail / edit (sheet) | Tap any task; push tap; Capture result row | View + edit all fields in one place | Title, list chip, date, time, reminder, repeat, star, notes, created/source line, "Rescheduled n×" (honest), completed_at if done | Edit any field inline (autosave), complete/uncomplete, duplicate, move list, delete (undo toast) |
| TSK-04 | Quick-add sheet | Long-press (+); "+" in TSK-01/02; Today card "+" | Manual add in ≤2 taps | Single text field w/ inline date highlight; list chip; optional date/remind chips | Add (Return), change list, set date/reminder via chips, keep adding, close |
| TSK-05 | Date · time · reminder picker (sheet) | TSK-03/04/11 date chip | Pick when | Presets: Today, Tomorrow, This weekend, Next week, No date; calendar; time; reminder: at time / 10m / 1h / 1 day before / custom | Set, clear |
| TSK-06 | Repeat picker (sheet) | TSK-03 repeat row | Set recurrence | Presets: daily, weekdays, weekly on…, monthly on…, every N days; "repeat after completion" toggle | Set, clear |
| TSK-07 | List create / edit (sheet) | TSK-08 "+"; TSK-02 overflow | Name a bucket | Name, icon/colour, shopping-mode toggle | Save, archive, delete (confirm if has open tasks: move to Inbox or delete them) |
| TSK-08 | Manage lists | TSK-01 "Edit lists"; Me → Tasks | Housekeeping | All lists incl. archived section | Reorder, create, edit, archive/unarchive, delete |
| TSK-09 | Search & filter | TSK-01/02 search icon | Find tasks | Search field; filters: list, status (open/done), has date, starred, overdue; sort: due / created / manual | Search, filter, sort, open result, clear |
| TSK-10 | Completed & deleted | TSK-01 overflow "Completed"; TSK-09 status filter | Log + recovery | Completed grouped by day; "Recently deleted" (30 days) | Uncomplete, restore deleted, open task |
| TSK-11 | Overdue triage (sheet) | Today card overdue badge; TSK-01 overdue header | Honest cleanup | Overdue tasks with days-late | Today / Tomorrow / Pick date / Done / Delete per row; Move all to today |
| TSK-12 | Reminders setup (sheet) | First reminder set; Me → Tasks → Notifications; banner "Reminders off" | Get push working | Platform-specific: iOS install steps (Share → Add to Home Screen); permission explainer; status (on/off/blocked) | Enable, send test, remind me later, how to unblock |
| TSK-13 | Tasks settings | Me → Module settings → Tasks | Defaults | Default reminder time for date-only tasks; morning digest toggle + time; quiet hours; count groceries in stats; week start; per-device notification status | Toggle/edit each; open TSK-08, TSK-12 |
| TSK-14 | Capture result card (in M5 chat) | Capture send | Confirm what AI recorded | One row per created task: title, list, when, reminder bell; follow-up chips if any | Undo all, tap row → TSK-03, answer follow-up chip, remove single row |
| TSK-15 | Notification (OS surface) | remind_at; morning digest | Pull owner into app | Title + time; digest: "5 tasks today · 2 overdue" | Tap → TSK-03 / TSK-01 Today; Done; Snooze 1h |
| TSK-16 | Today card (component on Today tab) | Today tab | Tasks at a glance | Overdue count (warning), up to 5 due today (tick inline), next reminder time, groceries count chip, "All clear" state | Tick, open task, quick-add, open triage, see all → TSK-01 |
| TSK-17 | Task stats | Stats → Tasks; Today card long-press (Later) | Analytics + reflection | Metrics from §7: completed, on-time rate, streak, overdue now, reschedules; week/month/all toggle; trend chart; list breakdown | Change range, share, drill into overdue list (→ TSK-11) |
| TSK-18 | Share card preview | TSK-17 Share | IG-story card | Template: week summary ("32 done · 88% on time · 9-day streak") | Switch template, toggle which metrics show, share / save image |

**States (apply across screens)**

| State | Where | Behaviour |
|---|---|---|
| Empty — no tasks ever | TSK-01, TSK-16 | One-line prompt + example phrase button "Try: buy eggs, call Mark tomorrow 3pm" (opens Capture prefilled) |
| Empty — all done today | TSK-16, TSK-02 Today | "All clear" + today's completed count (positive reward) |
| Empty — list | TSK-02 | "Nothing here" + quick-add field focused on tap |
| Empty — search | TSK-09 | "No matches" + "Include completed?" toggle |
| Error — offline | global banner | "Offline · changes will sync"; all task actions work locally |
| Error — sync conflict / failed | TSK-03 toast; TSK-01 banner | Last-write-wins; failed ops listed with Retry |
| Error — AI parse failed | TSK-14 | Text saved as single raw task in Inbox; "Couldn't split — edit?" |
| Error — push blocked | TSK-12, TSK-13 | Shows "Blocked in browser settings" + how-to |

**Coverage check (entity × op)**

| Op | Task | List | Reminder/Push | Recurrence |
|---|---|---|---|---|
| Create | TSK-04, TSK-14 | TSK-07 | TSK-05, TSK-12 | TSK-06 |
| View list | TSK-01, TSK-02, TSK-16 | TSK-01, TSK-08 | TSK-13 (status) | — (shown on row) |
| View detail | TSK-03 | TSK-02 | TSK-15 | TSK-03 |
| Edit | TSK-03 | TSK-07 | TSK-05, TSK-13 | TSK-06 |
| Delete/archive | TSK-03, TSK-02 swipe, TSK-10 restore | TSK-07, TSK-08 | TSK-05 clear, TSK-12 off | TSK-06 clear |
| Empty/error | States table | States table | TSK-12 blocked | — |
| Search/filter/sort | TSK-09, TSK-02 sort | TSK-08 reorder | — | — |
| Settings | TSK-13 | TSK-13 | TSK-13 | — |

## 5. Function inventory

| ID | Function | Screen(s) | Notes |
|---|---|---|---|
| F-TSK-01 | Add task via Capture (text) | TSK-14 | M5 parses; multi-task split; auto-save, undo |
| F-TSK-02 | Add task via voice | TSK-14 | Transcribe → F-TSK-01 |
| F-TSK-03 | Add tasks via photo | TSK-14 | Handwritten list / whiteboard / screenshot → items |
| F-TSK-04 | Answer AI follow-up | TSK-14 | Chips; max 1 question per ambiguous task; ignoring is fine |
| F-TSK-05 | Undo capture (all / single row) | TSK-14 | Hard-removes created tasks (no stats impact) |
| F-TSK-06 | Quick-add manual | TSK-04 | ≤2 taps; local NL date parse, offline |
| F-TSK-07 | Keep-adding mode | TSK-04 | Sheet stays open after Add |
| F-TSK-08 | Complete / uncomplete | TSK-01/02/03/16 | Tap circle; haptic + subtle count-up; logs TaskEvent |
| F-TSK-09 | Swipe to complete / reschedule / delete | TSK-01/02 | Right=done; left reveals Tomorrow / Pick / Delete |
| F-TSK-10 | Edit title / notes | TSK-03 | Autosave |
| F-TSK-11 | Set/clear due date & time | TSK-05 | Moving later = reschedule (see OQ-TSK-3) |
| F-TSK-12 | Set/clear reminder | TSK-05 | Date-only task → default reminder time from settings |
| F-TSK-13 | Set/clear recurrence | TSK-06 | Fixed or after-completion |
| F-TSK-14 | Generate next recurring instance | system | On completion; skipped instances not back-filled |
| F-TSK-15 | Star / unstar | TSK-03, swipe | Only priority mechanism |
| F-TSK-16 | Move to list | TSK-03, TSK-04 chip | |
| F-TSK-17 | Duplicate task | TSK-03 | Useful for groceries re-buy |
| F-TSK-18 | Delete task (soft) + undo | TSK-03, swipe, TSK-11 | 30-day recently deleted |
| F-TSK-19 | Restore deleted | TSK-10 | |
| F-TSK-20 | Reorder tasks manually | TSK-02 | Drag; only when sort=manual |
| F-TSK-21 | Sort toggle | TSK-02, TSK-09 | due / created / manual |
| F-TSK-22 | Search | TSK-09 | Title + notes |
| F-TSK-23 | Filter | TSK-09 | list, status, starred, overdue, has date |
| F-TSK-24 | View smart views | TSK-01 | Today, Upcoming, Inbox, Starred |
| F-TSK-25 | View completed log | TSK-10 | |
| F-TSK-26 | Create list | TSK-07 | |
| F-TSK-27 | Edit list (name/icon/shopping mode) | TSK-07 | |
| F-TSK-28 | Archive / unarchive list | TSK-07, TSK-08 | Hides from TSK-01; tasks kept |
| F-TSK-29 | Delete list | TSK-07 | Confirm: move open tasks to Inbox or delete |
| F-TSK-30 | Reorder lists | TSK-08 | |
| F-TSK-31 | Check item in shopping list | TSK-02 | Moves to "In cart" |
| F-TSK-32 | Clear checked | TSK-02 | Bulk complete; undo |
| F-TSK-33 | Overdue triage (per task) | TSK-11 | Today/Tomorrow/Pick/Done/Delete |
| F-TSK-34 | Move all overdue to today | TSK-11 | Counts as 1 reschedule per task |
| F-TSK-35 | Reminder push | TSK-15 | Server-scheduled Web Push |
| F-TSK-36 | Notification action: Done | TSK-15 | Where supported (not iOS action buttons — see OQ-TSK-6) |
| F-TSK-37 | Notification action: Snooze 1h | TSK-15 | Moves remind_at only; not a reschedule |
| F-TSK-38 | Notification tap → deep link | TSK-15 → TSK-03 | |
| F-TSK-39 | Morning digest push | TSK-15 | Opt-in; "n today · m overdue" |
| F-TSK-40 | Install-to-home-screen guide (iOS) | TSK-12 | Detect standalone mode |
| F-TSK-41 | Request push permission + test ping | TSK-12 | Ask only after first reminder is set, never on first launch |
| F-TSK-42 | In-app fallback for missed reminders | TSK-16, banner | Due-now badge; app badge where supported |
| F-TSK-43 | Offline queue + sync | global | Adds/ticks/edits offline; retry on reconnect |
| F-TSK-44 | Deferred AI parse of offline captures | TSK-14 | Pending raw task split on reconnect |
| F-TSK-45 | Edit task settings | TSK-13 | Defaults, digest, quiet hours, groceries-in-stats |
| F-TSK-46 | View task stats + range toggle | TSK-17 | |
| F-TSK-47 | Share stats card | TSK-18 | Image via Web Share API; fallback save image |
| F-TSK-48 | Tick task from Today card | TSK-16 | |

## 6. Today-card & Capture hooks

**Today card (TSK-16)** — order: overdue badge (if any, warning colour, tap → TSK-11) → up to 5 tasks due today (starred first, then time) with inline tick → "+n more" → groceries chip "Groceries · 6" (only if shopping list non-empty) → next reminder "Next ping 3:00 PM" → "All clear · 7 done today" when empty. Hidden entirely if owner has zero tasks ever (shows empty-state prompt once instead).

**Capture examples** (today = Sat 2026-09-26; default lists Work/Life/Groceries):

| Phrase | Resulting records | Follow-up? |
|---|---|---|
| "buy eggs and rice, call Mark tomorrow 3pm, finish deck for work by Fri" | Task "Eggs" → Groceries · Task "Rice" → Groceries · Task "Call Mark" → Life, due Sun 27 15:00, remind 15:00 · Task "Finish deck" → Work, due Fri Oct 2, no time, remind at default time | None |
| "remind me to pay meralco on the 5th every month" | "Pay Meralco" → Life, due Oct 5, monthly on day 5, remind default time | None (bill amount belongs to M4 — see OQ-TSK-8) |
| "call Mark" | "Call Mark" → Inbox, no date | None — no date implied, don't ask |
| "email client after lunch" | "Email client" → Work, due today | "Remind you at 1pm?" [1pm] [2pm] [No reminder] |
| "gym bag, protein, laundry detergent" | 3 tasks → Groceries? AI unsure (gym bag isn't a grocery) → "Protein", "Laundry detergent" → Groceries; "Pack gym bag" → Life | None; owner fixes via tap if wrong |
| 🎤 "move the deck to Monday" | Updates existing "Finish deck" due → Mon Oct 5; reschedule_count +1 | Only if >1 match: "Which one?" chips |
| 📷 photo of handwritten list | One task per line into inferred list | None |
| "done with call Mark" | Completes matching task | Only if ambiguous |

Rules: never ask about list or priority; ask only when a time was *implied* but unresolvable, or an edit/complete target is ambiguous. One question max per task.

## 7. Metrics for Stats & share cards

| Metric | Formula | Shown where | Good/bad framing |
|---|---|---|---|
| **Tasks done** | count(status=done, completed_at in range) | TSK-17, TSK-18, profile | Positive: big number, count-up |
| **On-time rate** | done with completed_at ≤ end of due date ÷ done-with-due-date, in range | TSK-17, TSK-18, profile | Positive headline; <60% shown neutral-amber, not red-shamed |
| **Done streak** | consecutive days (ending today/yesterday) with ≥1 completion | TSK-16 (small), TSK-17, TSK-18 | Positive; resets honestly, best streak kept |
| **Clear days** | days in range where every task due that day was done by end of day ÷ days with ≥1 due task | TSK-17, TSK-18 | Positive "perfect days" |
| **Overdue now** | count(open, due_date < today) | TSK-16, TSK-17 | Negative, always visible, warning colour, never hidden |
| **Reschedules** | count(TaskEvent rescheduled, in range); + avg reschedule_count per completed task | TSK-17, TSK-03 per task | Negative reflection: "Pushed 14× this week"; top 3 most-pushed tasks listed |
| **Avg lateness** | mean(completed_at date − original_due) in days over late completions | TSK-17 | Negative reflection, uses *original* due so rescheduling can't hide it |
| **Follow-through ratio** | tasks finished per task that slipped: (on-time done + 0.5 × late done) ÷ max(1, overdue-now + reschedules in range) | TSK-17, profile, TSK-18 (optional) | Shareable metric; ↑ good. Formula is a proposal — OQ-TSK-4 |
| **Capture share** | tasks with source≠manual ÷ tasks created | TSK-17 (small) | Neutral — validates C1 (is AI capture actually used?) |

Groceries/shopping-list items excluded from on-time/follow-through by default (they rarely have due dates) but counted in Tasks done if setting on (OQ-TSK-5). Contributes to the player profile's **Productivity** area (M6 l.66).

## 8. Edge cases

| Case | Expected behaviour |
|---|---|
| Capture creates wrong list/date | Visible in TSK-14 immediately; tap row → fix; no penalty event |
| Task completed by accident | Undo toast 5s; uncomplete from TSK-10; completion event reverted from stats |
| Recurring task completed late | Next instance from rule: fixed → next scheduled date after today (no pile-up); after-completion → completion + interval |
| Recurring task never done for weeks | Only one overdue instance exists; no back-fill of missed instances |
| Delete recurring task | Ask: "This one" / "All future" |
| Reminder time in the past when set | Save; no push; show "reminder time passed" hint |
| Reminder during quiet hours | Delivered at end of quiet hours, unless owner set it explicitly (explicit time wins) |
| iOS Safari, not installed | No push; TSK-12 shows install guide; Today card fallback; banner once per week max |
| Permission denied / revoked | Settings shows "Blocked"; reminders still stored; in-app fallback |
| Multiple devices | Push to all subscribed devices; completing on one dismisses on others where supported |
| Offline add then AI parse differs from what owner typed | Raw task shown until parse; parse result replaces it with undo |
| Offline edits on two devices | Last-write-wins per field; no merge UI (C5) |
| Date-only task | Due all day; overdue from next day 00:00; reminder at default time (settings) |
| Timezone change (travel) | Times stored with zone; displayed in device zone; date-only tasks stay on the calendar date |
| Very long capture (20+ items) | All created; result card collapses after 5 with "+15 more" |
| Delete list with open tasks | Confirm → move to Inbox (default) or delete |
| Duplicate capture (same text twice within minutes) | AI flags "Already added 'Buy eggs' — add again?" |
| Moving due date earlier | Not a reschedule |
| Bulk "move all to today" | One reschedule event per task (honest) |

## 9. Open questions

| OQ-TSK-n | Question | Proposed default | Why it matters |
|---|---|---|---|
| OQ-TSK-1 | Does "unopinionated" mean (a) no enforced method (no GTD/Eisenhower), or (b) no built-in lists/defaults at all? | (a): seed Work / Life / Groceries, owner can rename/delete | Seeding shapes first-run and how AI routes capture |
| OQ-TSK-2 | Capture: auto-save then undo, or confirm before saving? | Auto-save + undo (C1) | Confirm step adds a tap to every capture — the TickTick trap |
| OQ-TSK-3 | What counts as a reschedule: (a) any due-date move later, or (b) only moves made after the task is already overdue? | (a) any later move, incl. triage & AI edits | Drives the honest-reflection metric; (b) hides planning churn |
| OQ-TSK-4 | Is a "follow-through ratio" composite wanted, or only plain metrics? | Include, formula as in §7, tunable | Composites are brag-friendly (C2/C3) but can feel arbitrary |
| OQ-TSK-5 | Do grocery items count toward productivity stats? | Count in "Tasks done", excluded from on-time/follow-through; toggle in settings | Otherwise shopping inflates productivity numbers |
| OQ-TSK-6 | iOS PWA notifications have limited action buttons — is tap-to-open enough? | Yes: tap opens TSK-03; Done/Snooze buttons where supported | Sets expectation for "done from lock screen" |
| OQ-TSK-7 | Fallback channel when push unavailable (email / calendar .ics)? | None in v1; in-app Today card only | Adds integration effort; intake doesn't mention one |
| OQ-TSK-8 | Should a bill task ("pay Meralco") link to M4 scheduled expense? | No link in v1; M5 may create both records separately | Cross-module coupling; avoid double entry vs over-engineering |
| OQ-TSK-9 | Are habits and tasks shown in one "Plan" list or separate segments? | Separate segment (Tasks / Habits) in Plan; both on Today | Frame says Plan = tasks + habit schedule; mixing muddles metrics |
| OQ-TSK-10 | Morning digest push: on by default? | Off; offered after 7 days of use | Unasked pushes erode trust in reminders |
| OQ-TSK-11 | "Work" — one list, or one per job (owner has two jobs; M6 names "career, work, company")? | One Work list seeded; owner can add "Job 2"; AI routes by name if lists exist | Affects capture routing and per-area stats |

## 10. Later / out of scope

- **Deliberately not adding (TickTick lessons, C1/C5):** tags, projects/folders/sections, subtasks/checklists-within-tasks, 4-level priority, Kanban/Eisenhower/timeline views, time estimates, pomodoro in tasks (M1 owns timing), mandatory fields, per-task reminder configuration beyond one reminder, onboarding "set up your system" flow.
- Later: location-based reminders (PWA can't do reliably), shared lists with partner/family (social wish, C3), calendar sync/.ics export, email fallback reminders, task templates, attachments on tasks, natural-language bulk edit ("push all work tasks to Monday"), weekly review ritual screen, Today-card long-press to stats, multiple reminders per task, habit↔task conversion.

## 11. Frame feedback

- **Long-press (+) = manual quick-add** (tap = Capture chat). Hidden gestures are discoverable-poor; alternative: Capture screen opens with a "Quick add" text line at top that saves without AI. Either keeps ≤2 taps. Needs a global decision since all modules share (+).
- **Plan tab** should have a top segment **Tasks · Habits · Calendar**; Tasks home (TSK-01) lives there rather than a separate module stack.
- **Notification permission is global**, not per-module — TSK-12 should be a shared screen owned by Me/settings, triggered contextually by whichever module first needs it.
- Offline banner and sync queue should be app-wide, not per-module.
