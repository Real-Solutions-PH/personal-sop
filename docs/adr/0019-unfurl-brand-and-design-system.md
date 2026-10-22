# ADR-0019 — Unfurl brand and design system for the whole app

- **Date:** 2026-10-22
- **Status:** accepted
- **Deciders:** owner

## Context

The app was built as "Personal SOP" with a working look: Barlow and Barlow
Condensed, a teal primary (`#007567`), saturated module colours and gradient
hero cards. Before the App Store launch it needs a name, a brand and one design
system that every screen follows.

The owner reviewed the positioning and several design-system rounds on
2026-10-22 and approved the result for the whole application.

## Decision

1. **Name.** The product is **Unfurl**. The companion stays **Fern** (default
   name, renamable). Reasoning and the name shortlist:
   [positioning-and-name.md](../brand/positioning-and-name.md).
2. **Design system.** [docs/brand/design-system/](../brand/design-system/project/README.md)
   is the source of truth for colour, type, spacing, radius, shadows, motion,
   iconography and every component's look, in light and dark. Its rules:
   - **Calm chrome, colourful data.** Paper background, ink text, hairline
     cards, moss (`#1f5a43`; `#8fcaa6` dark) as the single interface colour.
     Area colours are a validated chart palette used for data marks only.
   - **Plain.** Flat surfaces, sentence case, one filled button per screen.
   - **Specific.** Geist for words, Geist Mono for numbers with their units
     and changes.
   - **Insight at a glance.** The app's analytics are styled to be read at
     once (values on bars, today highlighted, deltas with their baseline).
   - **Fern first.** Fern alone has the orb gradient, glow and motion; the
     Fern button rises out of the tab bar as it does today.
3. **Logo.** The fiddlehead plus the lowercase wordmark "unfurl". The logo and
   app icon are always flat: white fiddlehead on solid moss. Inside the app the
   mark becomes Fern's glowing orb.
4. **Restyle only.** The design system changes how screens look, never which
   sections a screen has or their order. Layout changes are separate
   decisions.

## Consequences

- The mobile app is restyled to the system: fonts to Geist and Geist Mono
  (via `@expo-google-fonts/geist` or bundled files), the palette in
  `shared/prototype/design/tokens.ts` to the system's tokens, gradient heroes
  to flat cards, the app icon and splash to the flat mark, and the display
  name to Unfurl. Each is a code change in its own pull request.
- Copy follows the voice rules (calm, plain, specific; no hype, no guilt; the
  companion's current name, never a hardcoded "Fern").
- New screens and components start from the design system's components and
  tokens; anything the system does not cover is added there first.
- Trademark clearance for UNFURL (USPTO, EUIPO, IPOPHL) is still open and
  should finish before money is spent on the name.
