# ADR-0028 — Gradients on share artwork only

- **Date:** 2026-10-30
- **Status:** accepted
- **Deciders:** owner (approved 2026-10-30)
- **Amends:** [ADR-0019](0019-unfurl-brand-and-design-system.md), the rule that Fern is the only element with a gradient

## Context

ADR-0019 made the interface flat: Fern's orb is the only thing in the app with a gradient, and share cards followed the same rule on flat Dark, Light, Colour, Photo and Sticker grounds. The share-card tests failed the build if a gradient appeared in any share file.

On 2026-10-30 the owner asked for share cards with a more designed look: gradients and stronger branding. A share card is not interface. It is artwork that leaves the app and sits in someone else's feed or story, next to other people's photos, where a flat paper or ink square reads as a screenshot rather than a designed card.

## Decision

- **Gradients are allowed on exported share artwork only**: the ground of a share card, drawn in `CardGround` in `mobile/src/prototype/share-kit.tsx`. Everything the person taps inside the app stays flat, including the composer chrome around the card.
- **Two gradient grounds**, built from existing tokens, with no new colours:
  - **Fern**: `background` (dark) to `moss` (light), top-left to bottom-right. `sprout` appears only on the lockup mark and the accent bar. No lighter stop (`frond`) and no `sprout` glow: against the dark ink `#ecebe6`, `frond` gives 3.8:1, and a glow drops muted text below 4.5:1. Moss alone keeps ink at about 7:1 and muted text at about 5:1.
  - **Dusk**: `hero-from` → `hero-via` → `hero-to`, the same tokens the old hero gradient used. Ink reaches 14:1 or better on every stop.
- **Fern is the default ground** when the share composer opens.
- **Every text token meets WCAG contrast against every stop** of its ground (4.5:1 for words, 3:1 for numbers 24 px and up). The share-card tests check this.
- **The logo stays flat.** The lockup and the fiddlehead watermark are single solid colours, as ADR-0019 requires.
- The gradient is an SVG `LinearGradient` (react-native-svg), not `expo-linear-gradient`: it draws the same on iOS, Android and web, and react-native-view-shot captures it at full resolution.

## Consequences

- Fern's orb is no longer the only gradient the person can see in Unfurl: a share card can have one too. It is still the only gradient in the interface.
- The share-card test now allows `LinearGradient` in `share-kit.tsx` only, never `RadialGradient`, and still bans raw hex in every share file.
- A new gradient ground needs its stops added to the contrast test before it ships.
