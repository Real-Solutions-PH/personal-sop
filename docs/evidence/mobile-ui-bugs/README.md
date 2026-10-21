# Mobile UI bug sweep — 2026-10-04

The Expo web build (`bunx expo start --web`) was compared with the deployed web prototype (https://personal-sop-seven.vercel.app). Both were run with the same seed data in headless Chromium at 414px and 320px, in light and dark themes. Finance was checked first, then Today, Plan, Stats, Me, habits, tasks, fitness, nutrition, journal and capture. Screenshots were reviewed during the session but are not committed. The table records each route, theme, defect and fix.

| Route | Theme / width | Defect | Fix |
|---|---|---|---|
| `/finance` | both, 414 | The "OK" buttons on AI-draft rows sat mid-row because the record row didn't stretch | Wrapped the row in a `flex: 1` container |
| `/finance` | both | Budget category % was always muted. The web prototype shows `warn` when a budget is ahead of pace and `bad` when it is over | Colour now comes from pace |
| `/finance` | both | The cash-flow legend used grey "●" glyphs, not the good/bad series colours | Added real coloured dots (`good`/`bad`) |
| `/finance` | both | Upcoming rows printed the raw status ("· due", "· upcoming") and signed transfers with "−" | `due`/`overdue` now show as pills, other statuses are hidden, transfers are unsigned and income uses `good` |
| `/finance` | dark, 320 | "₱50,000" broke mid-number ("₱50,00 / 0") | One line, with a smaller display size below 380px |
| finance pills (all) | both | `FinPill` used radius 6 and 10px text. The home pills were hand-rolled with radius 14 and regular weight, so they didn't match each other | `FinPill` = `radius.pill`, 11px medium, the web `Pill`. It's reused for review, to-check, due, overdue and import status |
| `/finance/records` | both | Positive nets (header and day groups) were muted | Positive nets use `good` |
| `/finance/planned` | both | Long names wrapped to 3–4 lines and pushed the `auto` pill to a new line | Name and schedule truncate to one line and the pill stays inline |
| `/finance/planned` | dark, 320 | Header totals broke mid-digit | One line, smaller on narrow screens |
| `/finance/review` | both | The "+38% vs 3-period avg" hint was muted. The web prototype uses `bad`/`good` | Semantic tone |
| `/finance/review` | both | The "🏆 Wins" heading used an emoji and "Misses" had no icon | Trophy/ThumbsDown icon headings |
| `/finance/review` | both | Yearly leak estimates showed full pesos. The web prototype uses compact values (≈₱26k/yr) | `compact()` |
| `/finance/review` | dark, 320 | Four stat tiles (48.9% width plus gap) collapsed into one column | `flexBasis` 45% with `flexGrow` |
| `/finance/reports`, `/finance/reports/cashflow` | both | The delta wrapped below the label, and at 320 "₱4,386" broke mid-digit | Delta is inline with the label. The value stays on one line and is smaller on narrow screens |
| `/finance/settings` | both | Field captions weren't uppercase (the web prototype uses uppercase captions), the disclaimer shield was muted, and the minimum balance showed "30000" | Uppercase captions, `fin` shield, grouped "30,000" |
| `/finance/import` | both | Captions weren't uppercase and account chips had no account icons | Uppercase captions; `FinChip` takes an optional `leading` slot, and `AccountIcon` takes a `size` |
| `FinChip` (import, settings, projection) | both | Hard-coded radius 20, and active text used `t.bg` | `radius.pill` and `onPrimary` |
| `/finance/accounts/[id]` | both | Import status was plain text | Status pill (good/bad/warn/muted) |
| `/finance/advisor` | both | The terms gate showed the generic archive icon | Lock icon, as on the web prototype |
| `/today` | dark | Habit and task rows inside the Habits/Tasks cards had a page-coloured (`t.bg`) band | `SwipeRow` takes an optional `background`. Today passes `t.card`, and `TaskRow` takes `surface` |
| `/today`, `/tasks`, `/plan` | both | Due-now times were muted, and "3 due now" was plain text | `tsk` accent with medium weight, and the count is a pill |
| `/tasks` | dark | The completed tick was white on the light-blue `tsk` fill | Uses `t.bg` in dark mode, the same as `IconButton` |
| `/habits` | both | The ranking streak badge was pushed to the right edge, which truncated names early | Badge sits next to the name and uses `radius.pill` |
| `/stats` | both | The legend swatch for the current period was grey, not the hexagon colour | `life` accent swatch |
| `/fitness` | both | Recent-workout PR count was plain text and showed "0" | Warn pill, hidden when the count is zero |

## Checked and left as is

- Alpha-suffix concatenation (`${t.x}26`): every call site appends to a 6-digit module/semantic accent. Nothing appends to `border`/`input`, the only tokens that are 8-digit in dark mode. `native-kit.tsx` `border()` already handles 8-digit hex, so no new helper was needed.
- Hard-coded hex colours that remain are on always-dark hero/share surfaces, weather gradients and the error fallback. They don't depend on the theme.
- Several web-prototype quirks were kept in native for parity: the GCash balance chart's negative axis labels, "₱-4,386" net formatting and the truncated "Salary — Lumen Studio (part-time" row.

## Not fixed (out of scope or in kit files others are editing)

- The "What-if drafts" option in the `Segmented` control (native-kit) wraps to two lines at 320px.
- `Field` labels (ui.tsx) are title case, while the web prototype uses uppercase captions for form fields.
- On web, the advisor disclaimer sheet's backdrop shows a blue focus outline. This is a react-native-web focus ring.
- Capture question chips are filled, while the web prototype's are outlined. Journal area chips have no icons.
- On `/finance`, pending-draft names still truncate hard at 320px. The web prototype does the same.
