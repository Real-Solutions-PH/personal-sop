# ADR-0032 — The brand's hand-drawn line in the app

- **Date:** 2026-11-03
- **Status:** accepted
- **Deciders:** owner (asked on 2026-11-03 to start the redesign of the app on the new branding)
- **Amends:** [ADR-0019](0019-unfurl-brand-and-design-system.md), where "flat" also covered every chart part in the interface

## Context

The share and brand kit (`docs/brand/share-and-brand-kit.pdf`) drew Unfurl's data in a hand-drawn line: strokes with a slight wobble and a thinner echo just off them, dotted tracks, leaves and fronds. The card library (`docs/brand/unfurl-card-library.pdf`) then applied that line to every Today, Stats and area-screen card, and the owner asked for the app to be redesigned on it.

Inside the app, ADR-0019 had kept every chart part flat: a solid track and a solid fill for progress, solid rounded bars, a straight polyline for trends. The redesign touches most screens, but nearly all of them draw their data through a handful of shared parts. Those parts can change once.

## Decision

- **The shared chart parts draw in the hand-drawn line.** The share kit's path helpers live in `mobile/src/prototype/brand/scribble.ts`, typed and seeded so a drawing is identical on every render. The drawn parts live in `mobile/src/prototype/brand/line.tsx`.
  - `Bar` (`native-kit.tsx`), the progress track: a dotted track, a scribbled fill and a thinner echo. The target tick is unchanged.
  - `Ring` (`visual.tsx`): a dotted track, the arc, and an echo arc just inside it at half strength.
  - Small bar charts (`DailyBars` in `chart.tsx`, the Today stat strips in `screens/today-stats.tsx`): each bar is a hand-drawn stem, with no leaves.
  - `Sparkline` (`chart.tsx`): a smooth curve with an echo stroke in place of the straight polyline.
- **Motion is kept.** The stems grow inside the existing `GrowBar`, and the arcs sweep with the existing `ArcCircle`. Reduced Motion still shows the final state.
- **Props, sizes and accessibility labels do not change.** No screen needed an edit for this step.
- **Chrome stays calm.** Cards, buttons, inputs and the tab bar are unchanged. Only data marks take the line.

## Consequences

- Every screen that uses these parts changes at once. Screens with their own chart code (`finance-charts.tsx`, the Stats areas radar, the share-card `Dots` and `Meter`) move in later steps, each in its own pull request.
- Later steps on the same footing, as drawn in the card library:
  - the Stats areas chart as the leaf flower, with the Unfurl mark at its centre and score tiers at 90% and 100%;
  - Fern as the C1 wreath sprite;
  - leaf mood marks in Journal;
  - weather backgrounds per sky;
  - account cards on the Fern ground;
  - figures in Geist with tabular digits (another amendment to ADR-0019, which sets Geist Mono for numbers).
- A new chart part draws through `brand/line.tsx` rather than a solid `View` or polyline.
