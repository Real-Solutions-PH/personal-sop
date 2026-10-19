# Personal SOP mobile prototype

The Expo application renders the prototype as React Native screens. It covers the 95 route patterns in the web prototype, including Today, Plan, Capture, Stats, Me, habits/routines, tasks/lists, workouts, nutrition, body tracking, finance and journal.

## Run

```sh
cd mobile
bun install --frozen-lockfile
bun run start
```

Prototype mode is the default. It needs no backend, Supabase credentials or AI keys. Scan the Expo QR code on a compatible device, or use a configured simulator. `bun run web` is useful for browser checks, but does not verify native gestures, permissions or sharing.

`bun run start:connected` selects the original authenticated API template. That template is separate from the migrated prototype; setting this flag does **not** connect prototype records to the backend. A connected native development build must include the original MMKV dependencies.

## Boundaries

- `shared/prototype/` owns provisional data types, seed data, actions, calculations, module metrics and cross-module capture behavior. Both clients use these functions.
- `frontend/src/proto/` retains the web UI and compatibility re-exports.
- `mobile/src/prototype/screens/` contains native feature screens. Thin Expo routes under `mobile/src/app/(sop)/` supply parameters.
- `mobile/src/prototype/ui.tsx` owns the common touch controls, safe-area layouts, accessible fields, sheets, swipe actions and feedback.
- Native persistence uses a separate SQLite database, `prototype.db`, through a small synchronous storage adapter. Each module keeps its existing JSON shape and key. The browser uses localStorage. Data is local to that installation; web records are not automatically transferred to a phone.
- The native adapter uses parameterized SQL. Failed writes stay in memory and can be retried. Malformed saved collections fall back to sample data without overwriting the saved value during loading.
- The authenticated template and prototype have separate route guards, providers and storage. Connected screen implementations live in `mobile/src/connected/`; their Expo route wrappers load them only in connected mode. Route discovery can therefore run in Expo Go without initializing MMKV or backend services. No production authorization is bypassed by the prototype's screen actions.

## Phone interactions

The bottom navigation exposes Today, Plan, Capture, Stats and Me. Social opens from the Community icon in Today's header (with an unread-messages badge), the Community card on Today, and Me. Tab icons spring when selected and every tab press gives a selection haptic. Native stack navigation supports back gestures. A full right swipe completes a habit/task with undo; a left swipe reveals more actions. Swipe actions are coloured, their icons grow toward the release threshold, and crossing it gives a haptic. Sheets drag down to dismiss and animate in and out; switches and segmented controls animate; screens show a header hairline once content scrolls under it, and Today supports pull-to-refresh (it refreshes the weather). Motion timings live in `src/prototype/motion.tsx`: checking a task or habit pops and fills the check with a success haptic, then commits after ~360 ms so the result is visible before the row glides to its new place; score rings sweep in and life/day scores count up; root tabs crossfade while drilling in still slides. Plan (Tasks/Habits/Calendar), Stats ranges, Habits periods and Finance reports page between segments with a horizontal swipe; the Plan calendar and habit week strip step a month/week with a swipe (they take priority over the page swipe). Task rows open their actions on long-press. Notifications swipe right to mark read and left to dismiss with undo. Under reduced motion, checks commit immediately and nothing slides. Visible controls provide alternatives. Buttons use press feedback, and transitions respect reduced-motion settings. Forms avoid the keyboard, date/time fields open system pickers, and long histories use native virtualized lists. Reordering uses explicit move controls.

Photo capture/library selection, microphone recording, haptic feedback, clipboard, CSV sharing and progress-card image sharing use Expo/native APIs. Permission denial leaves typed/manual entry available. Voice recording pauses when the app leaves the foreground and is limited to five minutes for capture and ten minutes for journal entries. Audio transcription, image interpretation, AI responses, statement parsing and reminder delivery remain simulated, matching the prototype's scope.

Sign-in is simulated in prototype mode (`src/prototype/session.ts`, screens `src/prototype/screens/auth-*.tsx`). Signed-out users land on Welcome, then Sign in, Sign up → six-digit email code → onboarding, or Forgot password → Check your inbox → Reset password. Password `wrong` and email `taken@example.com` demonstrate the error states; code `000000` is rejected. Me → Sign out returns to Welcome. Reset demo data does not sign the user out.

Social (`/social`, mobile-only, `src/prototype/social/`) is an Instagram-style community built on one local store (`social/store.ts`); every action is simulated, including friends' replies and likes. It covers a feed (Following / For you) with a stories tray, photo/video/progress carousels, double-tap to like, comments with replies, saves and share-to-DM; a story viewer (tap left/right, hold to pause, swipe sideways between people, swipe down to close, reply/like) and a story composer (text, photo/video, progress; everyone or close friends); notes in the inbox; 1:1 and group chats with swipe-to-reply, long-press reactions, shared posts and story replies, typing indicators and group details; profiles with follow/unfollow, follower lists, close friends and a followers-only scorecard (life score, area rates, streaks, stats, achievements, comparison with your own score); explore with a friends' leaderboard, people and #tag search; and activity. Swiping in from the right edge of the feed opens messages. Share cards gain **Post** and **Story** actions that render the selected card to an image and hand it to the post composer or straight to your story; the composer can also attach live progress (life score, latest workout, best habit streak, today's nutrition, tasks, net worth) from the user's data. Today shows a Community card. Seed photos and the sample video load from Unsplash and Mixkit, so the feed needs a connection to show them; posts and stories created on device store their media under the app's document directory.

The centre + button opens **Sol**, the personal companion (`src/prototype/companion/`), in a drawer that springs up while the + turns into ×. Dragging the drawer down closes it; dragging it up grows it to full screen and lands in the full chat at `/capture` (the tab bar hides there). Sol replaces the capture-only sheet: logging and specific questions still go through the existing capture engine and appear inline, while `companion/brain.ts` routes other requests — insights from the last 30 days, charts of any metric (life score, habits, tasks, spending, categories, net worth, workouts, weight, calories), life-coach feedback with a next step, a short day plan, trackers with goals ("track spending under 1500"), memories ("remember that …") and small talk. Answers are blocks rendered by `companion/blocks.tsx` from live data, so they stay current. The router is deterministic and on-device; a real model would replace it behind `ask()`.

Charts animate in on open (lines sweep, bars grow with a stagger, donut slices fan out). Swiping sideways on Today, Plan, Stats or Me moves between tabs; in-page swipes (rows, segment pagers, calendars) win, and past a pager's first or last segment the swipe carries on to the next tab.

Weather (`/weather`, mobile-only, summarised by a card on Today) uses the free, keyless Open-Meteo forecast and geocoding APIs (`src/prototype/weather.ts`). Location permission is requested only on the first visit to `/weather` or from "Use current location". If permission is denied or unavailable, the screen uses the saved city (Manila by default), which can be changed with the city search. The last forecast is persisted locally and shown offline with its age. It refreshes after 15 minutes when the screen mounts or the app returns to the foreground, and it can also be refreshed manually. On web, the device location is labelled with coordinates because reverse geocoding is native-only.

## Live mode (2026-10-19)

`bun run start:live` (`EXPO_PUBLIC_APP_MODE=live`) runs the same product UI against the API server, with Supabase sign-in and local-first sync (ADR-0011). It needs `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`. Like connected mode, it needs a native development build, because the Supabase session is kept in encrypted MMKV.

| Piece | Where | What it does |
|---|---|---|
| Account | `src/live/auth.ts`, delegated from `src/prototype/session.ts` | Sign-in, sign-up with the 6-digit email code, password reset and sign-out through GoTrue. The auth screens are unchanged. Apple and Google sign-in show "not available yet". |
| HTTP | `src/live/http.ts` | Bearer token on every call. A 401 refreshes the session once and retries. |
| Sync engine | `src/live/engine.ts`, `mapper.ts`, `outbox.ts` | Diffs each mapped store against the last state both sides agreed on, and writes ops to a persisted outbox: creates, field-level edits, deletes, and domain actions for transitions such as completing a task. Pushes in order, then pulls past a stored cursor. Pulled rows are merged without being echoed back. |
| Mappers | `src/live/mappers/` | One per server entity: local store shape to and from server rows. `reference.ts` holds weather preferences and module switches; each module adds its own via `registerMappers`. |
| Events | `src/live/events.ts`, `runtime.ts` | One SSE stream (`/events/stream`) opened with `expo/fetch`. It resumes from `Last-Event-ID`, and `sync.changed` triggers a pull. Other events reach `onServerEvent` listeners. |
| First run | `src/live/blank.ts` | An account's first run on a device starts from empty stores (no demo records), then pulls. Sign-out pushes what is queued, then clears the device. |

Ids: rows created on the device are UUID v4 (`shared/prototype/lib/ids.ts`). Rows a domain action derives use `derivedId`, which matches the backend's UUID v5 byte for byte, so an offline action and its server replay never duplicate.

What happens offline and in each failure case:
- Offline, the app keeps working on its stores. Ops wait in the outbox, which holds at most 5,000 and drops the oldest first, and are sent on reconnect, on returning to the foreground, on another device's change nudge, or once a minute.
- A rejected op is logged and dropped from the outbox, and the device keeps its local value until the server row changes. A conflict means the server row wins.

**Verified:**
- `src/live/__tests__/sync.test.ts` covers diff rules, the offline outbox, action ordering, no echo, pulled deletes, restart persistence, the UUID v5 parity value and the SSE parser.
- A throwaway end-to-end run of the engine against a running API server with a real GoTrue account confirmed that the offline edit was queued, then pushed on reconnect, then pulled on a second device. The second device's edit came back to the first, with no echo, and matched the server state.

## Visual system

The native prototype uses the web prototype's semantic palette, including separate light/dark module accents. Their sRGB equivalents, spacing, radii and font names live in `shared/prototype/design/tokens.ts`. Barlow supplies body text and Barlow Condensed supplies display headings and statistics; font assets are bundled with the application.

Prototype press controls with callback-based styles opt out of NativeWind class-name conversion using `cssInterop={false}`. This preserves native dimensions, padding, colors and pressed feedback; the native styling tests exercise the actual adapter because browser rendering does not reproduce this failure. Decorative percentage-sized SVG layers sit in an absolute-fill wrapper so card padding does not shrink their drawing bounds.

`visual.tsx` contains native progress rings, score heroes, metric tiles and module shortcuts. Charts use native SVG. Screen compositions retain the prototype's dashboard hierarchy, compact management rows and fixed capture composer; camera, date pickers, sheets and gestures remain native adaptations. Share artwork supports story, portrait and square layouts, themed backgrounds and native PNG export.

The deployed prototype at https://personal-sop-seven.vercel.app/today is the visual reference. All 95 route patterns have source-based native compositions, including secondary editors, detail views, onboarding and share pages. Shared statistics include the six dashboard facets; screens reuse domain calculations rather than deriving competing scores. Nine Barlow/Barlow Condensed font weights are bundled.

The October 2 comparison pass captured all 95 routes on both clients at 414px in dark mode, with identical local time and fresh data. Contact sheets were visually reviewed. An additional 190 browser checks covered every route at 320px dark and 414px light, with no runtime errors or document-level horizontal overflow. Targeted follow-ups covered capture, dialogs, sharing, advisor and nutrition controls. This is composition and interaction evidence, not pixel-perfect acceptance of every state or native-device verification. See [the evidence record](evidence/mobile-parity/README.md).

Browser interaction checks covered routine duration/add/remove/play/completion; workout set completion/undo/history; journal and goal persistence; review completion; transaction date/time and categories; manual and media capture sheets; onboarding; import apply/undo; offline capture replay and interrupted processing recovery.

Visual review should compare equivalent routes, theme, date range and seed state at the same viewport size. Route coverage and a successful bundle are not visual acceptance criteria. Check key screens in both themes and exercise large text, keyboard placement and sharing on physical devices.

## Verification

```sh
cd mobile
bun run typecheck
bun run test --runInBand
bunx biome ci ./ ../shared/prototype
bunx expo install --check
bunx expo-doctor
bunx expo export --platform all --max-workers 2
```

The CI mobile job checks types, formatting, tests and all-platform export. The web client still has its own type checks and tests. Docker copies `shared/`, and Compose watches it alongside the frontend.

Before calling a build device-verified, exercise it on iOS and Android: launch without backend credentials; create/edit/restart; complete and undo with a swipe; interrupt/resume timers; deny and grant camera/microphone access; dismiss sheets/back navigation; change text size and reduced-motion; share a file/image; and test offline capture replay. An exported JavaScript/Hermes bundle is not evidence that these native interactions ran.

## Scaling after prototype sign-off

Keep the native screens and shared calculations. Replace local mutations behind the action boundary with the generated API client and tenant-scoped persistence after the data/API contracts are finalized. Add server IDs, conflict handling and synchronization at that boundary rather than duplicating domain logic in screens. The prototype's whole-module JSON writes are suitable for its bounded demo dataset, not an unbounded production event history. Large attachments should move out of store JSON into managed files/object storage at that stage.

The dominant current resource cost is local history/attachment size. No AI API or hosting charges are introduced by this migration. Production synchronization, notification delivery and AI services remain a separate implementation step.
