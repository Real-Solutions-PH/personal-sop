# Information Architecture — Personal SOP

Date: 2026-09-26 · Status: **Ratified 2026-09-26** (decisions below). Prototype built on it: `frontend/src/app/(sop)`, see ADR-0009.

| Doc | Module | Screens | Functions | Open Qs |
|---|---|---|---|---|
| [00-intake.md](00-intake.md) | Requirements source of truth | — | — | — |
| [01-habits-routines.md](01-habits-routines.md) | M1 Habits & Routines | 34 | 43 | 13 |
| [02-tasks.md](02-tasks.md) | M2 Tasks | 18 | 48 | 11 |
| [03-fitness.md](03-fitness.md) | M3 Fitness (gym, weigh-ins, macros) | 26 | 31 | 15 |
| [04-finance.md](04-finance.md) | M4 Finance | 37 | 47 | 17 |
| [05-capture-ai.md](05-capture-ai.md) | M5 Capture & AI (+ journal) | 21 | 26 | 13 |
| [06-dashboard-stats-sharing.md](06-dashboard-stats-sharing.md) | M6 Today, Stats, Rewards, Sharing, Me | 35 | 35 | 14 |
| **Total** | | **171** | **230** | **83** |

Screen counts include sheets, modals, Today cards, and empty/error states.

## Open-question rule

Every open question carries a proposed default. **A default binds unless the owner overrides it
at the IA gate.** Overrides are recorded in the Decisions table below.

## Global frame (ratification target)

```
┌────────────────────────────────────────────┐
│  [Live bar: ▶ Timer / Routine / Workout]   │  ← global, shown only while something is running
├────────────────────────────────────────────┤
│  Offline / sync banner (global)            │
├────────────────────────────────────────────┤
│  Today  ·  Plan  ·  (+)  ·  Stats  ·  Me   │
└────────────────────────────────────────────┘
```

| Tab | Holds | Owner docs |
|---|---|---|
| **Today** | Life dashboard for today: Next up, Routine CTA, Habits due, Tasks due, Macros left, Weigh-in, Spend today, Goals, one contextual card. Morning vs evening (wrap-up) modes. Bell → notifications inbox. | M6 §6, cards from M1–M4 |
| **Plan** | Segments **Tasks · Habits · Calendar**. Calendar overlays tasks, habit schedule, routines, bills and paydays. | M2, M1, M4 |
| **(+) Capture** | Center button → sheet over the current screen (keeps context). Text, 🎤 voice (long-press = voice), 📷 photo, 📎 file (statements). Opens the full chat thread. Quick-add manual forms are a fallback inside the sheet. | M5 |
| **Stats** | Player profile (on-target rate, streaks, PRs, savings rate…), per-module analytics, Misses & Leaks, Goals, Trophy case, Reviews. | M6 + module §7s |
| **Me** | Profile + identity statements, share cards, journal, settings, module config (habits, routines, lists, exercises, accounts, categories, budgets, AI & connector). | M6, M5 |

Module detail screens (Habit detail, Routine player, Workout logger, Account, Budget, Projection, Statement import…) are pushed stacks reached from Today cards, Plan, Stats and Me. No module owns a tab.

## Cross-module rulings (resolving conflicts between the six drafts)

| # | Conflict | Ruling |
|---|---|---|
| X-1 | Day boundary: M1 said 04:00, M3 said midnight | **One app-wide `day_start_hour`, default 04:00 Asia/Manila**, in Settings. Applies to streaks, macros, spend-today, on-target rate. |
| X-2 | Running timer (M1) and live workout (M3) each wanted a persistent indicator | **One global Live bar** above the tabs for whichever is running: habit timer, routine player, or workout. Only one runs at a time; starting another asks to finish/pause the current one. |
| X-3 | Journal owned by M5 (entries) vs M6 (wrap-up reflection + list) | **One `JournalEntry` entity (M5).** The evening wrap-up reflection line creates a journal entry. There's one journal list (Me → Journal). DSH-26 and CAP-15 are the same screen. |
| X-4 | "Identity" | **≤3 identity statements on the profile, each linked to a goal** (M6). Journal entries can carry an area tag. |
| X-5 | Finance share cards: M4 allowed a per-card ₱ opt-in, M6 said never | **Never show ₱ on share cards.** Percentages, ratios and streaks only. **Owner decision** (Q2 at the gate). |
| X-6 | Auto-save policy defined in three places | **M5 OQ-CAP-1 is the single policy**, and the other modules defer to it. Statement import never auto-commits (M4 OQ-FIN-12). |
| X-7 | A workout doesn't tick the "Gym" habit (M1 put this under Later) | **In v1:** a habit can be linked to "any workout logged". Finishing a workout in M3 auto-checks it. It is one field and saves a tap every gym day (C1). |
| X-8 | Privacy mode (hide ₱) | **App-wide toggle** in the Today header long-press and Settings. Blurs all amounts. |
| X-9 | Plan calendar contents | Tasks + habit schedule + routines + M4 planned items (bills, paydays). Read-only for M4 items; tapping one opens the M4 detail. |
| X-10 | AI provider | **Built-in AI via the existing module (OpenRouter) in v1.** The Claude connector (MCP) is a fast follow over the same tool layer, and its screen is designed but ships disabled. |
| X-11 | Notifications | Permission + iOS "Add to Home Screen" guide are owned by M6 onboarding (DSH) and reused by M1/M2/M3. One inbox (bell on Today). |

## Decisions (owner overrides at the gate)

| Date | Question | Decision |
|---|---|---|
| 2026-09-26 | OQ-DSH-1 Social scope | Share-card export only. Friends/follow/kudos feed → Later. |
| 2026-09-26 | OQ-DSH-2 Headline stat | **Composite Life Score (0–100)** is the profile headline: weighted mean of area rates (Habits, Tasks, Fitness, Finance), weights shown on tap and editable in Settings. On-target rate + on-target streak stay as secondary stats (they drive streaks). Overrides the M6 default. |
| 2026-09-26 | X-5 / OQ-DSH-7 ₱ on share cards | Never. Percentages, ratios, streaks only. |
| 2026-09-26 | Prototype stack | Next.js `frontend/` as an installable PWA, mobile-first layout. `mobile/` (Expo) unused for now. |
| 2026-09-26 | All other open questions | Proposed defaults bind. |
