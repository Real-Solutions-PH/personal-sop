# Focus module screenshots (2026-10-24)

Captured from the Expo web build of the app in demo mode (prototype seed,
375 × 812 viewport, light theme) on branch `feat/focus-module`, for
[ADR-0025](../../adr/0025-focus-module.md). The running sessions in shots 1–4
and 10 were written into the demo store with timestamps in the past, which
is exactly what a phone reopened after a lock or an app kill reads: the
screens derive the timer from those timestamps.

| File | Shows |
|---|---|
| `01-pomodoro-running.jpg` | A 25/5 Pomodoro in set 2 of 4, after a break, a pause (hatched in the session strip) and a switch to a habit |
| `02-switch-picker.jpg` | Switching what the running session is on: open tasks and active habits |
| `03-after-switch.jpg` | The same session after switching to a task mid-set |
| `04-day-timeline-with-pause.jpg` | Today's timeline: focus blocks labelled with the item, the break lighter, the pause hatched, an empty afternoon folded into one line |
| `05-focus-stats.jpg` | Focus stats over 7 days: hours per day against the goal line, goal streak, time by item |
| `06-life-score-with-focus.jpg` | The Life Score with Focus as an area |
| `07-areas-with-focus.jpg` | The Areas chart with seven facets, Focus included |
| `08-today-launcher-and-live-bar.jpg` | The Focus tile in the app launcher and the Live bar while a session runs |
| `09-today-focus-card.jpg` | The Focus card on Today: today against the goal, what runs, time left |
| `10-stopwatch-running.jpg` | The free stopwatch counting up, with one pause |
| `11-task-time-spent-vs-estimate.jpg` | A task's time spent against its 4-hour estimate, with recent sessions |

Not shown here: the lock-screen Live Activity, which needs a device build
(its mapping is covered by `mobile/src/prototype/__tests__/focus-module.test.tsx`).
