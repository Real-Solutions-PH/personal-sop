# ADR-0036 — Marketing site as a static Next.js workspace in `marketing/`

- **Date:** 2026-11-08
- **Status:** proposed
- **Deciders:** Kai (approves anything public)

## Context

Unfurl has no public website. The site has to be static so it can be served by Cloudflare Pages without a server (the domain is not chosen yet; realsolutionsph.com is on Cloudflare).

The existing web app in `frontend/` cannot be exported as static pages. It uses:

- Supabase sessions;
- Sentry instrumentation;
- CopilotKit;
- the generated API client.

A route group inside `frontend/` would also tie the public site's build, dependencies and release timing to the app.

## Decision

The marketing site is a separate bun workspace member, `marketing/`:

- **Stack:** Next.js 16 App Router with `output: "export"` (`next build` writes plain files to `marketing/out/`), React 19 and Biome, following the `frontend/` conventions.
- **Dependencies:** only `next`, `react`, `react-dom` and `lucide-react`. No Tailwind, no auth, no API client, no analytics.
- **Brand:** the tokens, Geist fonts and Fern's C1 wreath sprite come from `docs/brand` (ADR-0019) and the Unfurl card library. Fern's renderer is vendored unchanged in `marketing/vendor/fern/` and runs at build time and writes one SVG file per mood to `marketing/public/fern/`, so the browser receives drawings, not the renderer.
- **Content switches:** every launch-dependent value lives in `marketing/src/config/`:
  - placeholders for counts, the domain, the App Store link and the waitlist endpoint;
  - the pricing preset and price visibility;
  - the shipped-or-not status of local-only mode and Android.
- **Not deployed by this change.** Going live, and the domain, are Kai's call.

## Constitution clause deviated from

None. This adds a second web package next to `frontend/`; both follow the frontend defaults (Next.js, bun, Biome, TypeScript strict).

## Consequences

**Positive:**
- The app stays as it is: no static-export constraints on `frontend/`.
- The home page loads about 141 KB of JavaScript (gzipped), and the hero film only after the page has loaded. Lighthouse mobile performance was 95 on three runs against a compressing local server.
- Copy, placeholders and prices change in two config files (`site.ts`, `pricing.ts`), with no code edits.

**Negative:**
- A second Next.js package, with its own lint and typecheck in CI.
- The brand tokens are copied into `marketing/src/app/globals.css`, not imported from one shared package, so a token change has to be made in both places.

**Follow-ups:**
- Pick the production domain and add the Cloudflare Pages project (Kai).
- Connect the waitlist form to a real endpoint, or remove it.
- Replace the placeholder legal pages with reviewed text before launch.
