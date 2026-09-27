# Intake — Personal SOP

Date: 2026-09-26 · Owner/client: Kai (single user) · Status: source of truth for the IA pass.

Distilled from the owner's brief. Every IA document traces back to a line here or to an
Open Question with a proposed default. Anything not here is an invention and must be logged.

## Product in one line

A mobile-first **PWA** that is the owner's "life dashboard": habits, routines, tasks, fitness,
and finance in one app, where logging is near-zero effort (chat / voice / photo, AI does the
recording) and the payoff is rich, shareable stats — like a Mobile Legends account profile
(win rate, KDA, GPM) or Strava share cards, but for life.

## Hard constraints (from the owner, non-negotiable)

- **C1 Low effort to record.** The owner works two jobs. He quit TickTick and Wallet (BudgetBaker)
  because manual logging cost too much. The one interface he uses consistently is chatting with
  Claude: type/speak loose context → AI records it → AI asks follow-ups only when context is
  missing. Photo and voice capture on the go. No "clicking and swiping to record for the sake of
  recording."
- **C2 Stats-centric, not game-centric.** Analytics and dashboards that show *valuable* info,
  metrics he can set goals on and improve, and brag about. Rewards for positive behaviour; clear,
  non-hidden reflection on negative behaviour.
- **C3 Shareable.** Instagram-story-worthy share cards/templates (Strava-style). Social
  interaction with others is mentioned as a wish.
- **C4 Modern UX.** Mobile-first, modern.
- **C5 No over-engineering.** Cover the goals and their real use/edge cases, nothing speculative.
- **C6 No third-party finance integrations** (no bank/e-wallet API links).
- **C7 UI first.** Validate IA → clickable prototype before business logic.

## Modules requested

### M1 Habits & Routines
- Manage habits tracked daily; see what's done today/at this time.
- Analytics on habit performance.
- Configure schedule: which days of the week, what time.
- Time a habit's duration (TickTick focus/timer style).
- Routine mode (Routinery / "routine flow" style): stack habits into a continuous guided sequence.

### M2 Tasks
- Comprehensive but unopinionated task manager: work, daily life, groceries.
- Reminders/notifications at a time so he picks up the phone and opens the app.

### M3 Fitness (gym / body / nutrition)
- Weigh-ins, macros, weights per exercise → progressive overload.
- Macro logging from meal description/photo via AI (home-cooked meals with no labels) — he
  currently does this with Claude. Either a **connector to Claude** or built-in AI (e.g. OpenRouter).

### M4 Finance
- Everything Wallet by BudgetBaker does (accounts, records, categories, budgets, reports…),
  minus bank sync.
- Import/parse bank & e-wallet statements with AI → reconcile: correct, fill missing details,
  add unrecorded transactions.
- Budgets; **projection of estimated savings** from scheduled monthly income and expenses, so he
  can plan future spending (what he values most in Wallet).
- Look-back evaluation of spending/income: where he went wrong, what to improve.
- AI as personal accountant / financial advisor: lessons, feedback, suggestions on purchases,
  financing, investing.

### M5 Capture & AI (cross-cutting)
- Chat-first capture that can write into every module; voice and photo input; follow-up questions.

### M6 Life dashboard, stats, rewards, sharing (cross-cutting)
- The app's home should feel like the main dashboard of his life.
- Areas he named: productivity, physical, career, work, company, finances, habits, routines,
  **journal**, **identity**.

## Environment facts

- Location/currency: Philippines, PHP (₱). E-wallets in use (to confirm): GCash, Maya; banks TBD.
- Repo: Next.js 16 frontend (shadcn-style UI, Tailwind 4), FastAPI + SQLModel backend, Supabase
  auth, existing AI chat module (AG-UI over SSE, OpenRouter supported — see `docs/22-ai-module.md`).
- PWA realities to design around: Web Push works on iOS only when installed to Home Screen;
  no reliable background execution (timers must be timestamp-based); mic/camera via browser APIs;
  should tolerate offline/flaky network for capture.

## Tentative global frame (IA agents: propose changes, don't silently diverge)

- Bottom tab bar, 5 slots: **Today** · **Plan** · **(+) Capture** (center, primary) · **Stats** · **Me**.
  - Today = the life dashboard for today (due habits, routine CTA, tasks due, macros left,
    spend today, weigh-in prompt).
  - Plan = tasks + habit schedule/calendar.
  - Capture = chat/voice/photo AI entry; also a quick-add sheet.
  - Stats = per-module analytics + the overall "player profile".
  - Me = profile, share cards, settings, module config (accounts, categories, exercises…).
- Each module (Habits, Tasks, Fitness, Finance) owns a screen stack reachable from Today cards,
  Plan, and Stats.
