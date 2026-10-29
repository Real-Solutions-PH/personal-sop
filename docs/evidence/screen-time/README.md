# Screen time screenshots (2026-10-29)

Captured from the Expo web build of the app in demo mode (prototype seed,
390 × 844 viewport at 2×, light theme) on branch `feat/screen-time`, for the
spec [2026-10-29-screen-time-design](../../superpowers/specs/2026-10-29-screen-time-design.md).
The web build has no Screen Time native module, which is exactly the
"unavailable" path the simulator, Expo Go off iOS and builds made without
`UNFURL_SCREEN_TIME=1` take. Shot 2 used two habits with screen-time rules
written into the demo store by a temporary seed route (not committed); the
minutes come from the demo screen-time seed (today: All apps ≥ 45 min,
Social ≥ 15 min, still open). Shots 5 and 6 emptied the screen-time store.

| File | Shows |
|---|---|
| `01-settings-unavailable-locked.png` | Settings → Screen time without the native module: the real screen (status, All apps, groups, budgets) dimmed under one LockedPreview card saying why |
| `02-today-rule-habits-tracking-and-broken.png` | Today: "Social under 30 min" tracking (ring filling with the day, "≥ 15 of 30 min") and "Phone under 30 min" broken ("Over by ≥ 15 min", ring and label in the miss colour); both carry the "auto" mark and have no check, swipe or more-options button |
| `03-areas-screen-time-corner.png` | The Areas chart with eight corners, Screen time last (between Finance and Habits) |
| `04-stats-screen-time-section.png` | Stats' Screen time section: today per group ("≥ 45 min", "≥ 15 min") and seven days of lower bounds on bars |
| `05-areas-screen-time-no-data-dimmed.png` | With no screen-time data the Screen time corner is dimmed, reads "—" and sits at the centre (no score of 0) |
| `06-stats-screen-time-locked-preview.png` | With no screen-time data the section is a LockedPreview over the dimmed real card |

Not shown here: the iOS permission prompt, the FamilyActivityPicker and real
threshold events, which need a device build with the Family Controls
entitlement. The row, settings, editor and foreground-sync behaviour is
covered by `mobile/src/prototype/__tests__/screen-ui.test.tsx`.
