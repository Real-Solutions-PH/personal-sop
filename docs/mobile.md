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
- The authenticated template and prototype have separate route guards, providers and storage. No production authorization is bypassed by the prototype's screen actions.

## Phone interactions

The bottom navigation exposes Today, Plan, Capture, Stats and Me. Native stack navigation supports back gestures. A full right swipe completes a habit/task with undo; a left swipe reveals more actions. Visible controls provide alternatives. Buttons use press feedback, and transitions respect reduced-motion settings. Forms avoid the keyboard, date/time fields open system pickers, and long histories use native virtualized lists. Reordering uses explicit move controls.

Photo capture/library selection, microphone recording, haptic feedback, clipboard, CSV sharing and progress-card image sharing use Expo/native APIs. Permission denial leaves typed/manual entry available. Voice recording pauses when the app leaves the foreground and is limited to five minutes for capture and ten minutes for journal entries. Audio transcription, image interpretation, AI responses, statement parsing and reminder delivery remain simulated, matching the prototype's scope.

## Visual system

The native prototype uses the web prototype's semantic palette, including separate light/dark module accents. Their sRGB equivalents, spacing, radii and font names live in `shared/prototype/design/tokens.ts`. Barlow supplies body text and Barlow Condensed supplies display headings and statistics; font assets are bundled with the application.

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
