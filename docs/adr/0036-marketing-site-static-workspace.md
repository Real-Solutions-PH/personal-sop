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

## Addendum 2026-11-09: scroll-driven motion

Kai asked for a page that makes visitors stop and keep scrolling. The site therefore goes beyond the studio's default motion rule, which allows motion only to show what changed and rules out parallax and decorative effects. The exception covers only this marketing site; the app keeps the default.

- **Library:** GSAP 3.13 with ScrollTrigger, under GSAP's free standard licence. That licence allows commercial use and excludes only tools that compete with Webflow. It is imported dynamically after the `load` event (`marketing/src/lib/motion.ts`), so it never competes with first paint. About 44 KB gzipped, in two chunks the HTML does not reference.
- **No WebGL:** the depth is CSS 3D transforms, not three.js, which would add roughly 150 KB for one phone model.
- **What moves:**
  - a pinned, scroll-scrubbed "How it works" story (`ScrollStory.tsx`): the sentence types in, splits into three records, the day fills in, and the seven area tiles fold into the phone, with the waitlist ask at the end;
  - section headings that brighten word by word;
  - the tracker-stack prices striking out while the yearly total counts up (removed in the second pass);
  - parallax depth (`data-speed`) and pointer tilt (`data-tilt`, mouse and trackpad only).
- **Guards:**
  - Every animated property is a transform or opacity.
  - Under reduced motion GSAP is never fetched, and the story renders as a plain list beside the phone in its filed state.
  - The pinned layout is decided before first paint, by the same inline script that sets `js`, so nothing shifts when GSAP arrives. If GSAP fails to load, the pinned layout is removed.
  - Headings start at half opacity, never lower, so a heading read mid-reveal still meets 3:1 contrast.
- **Measured:** Lighthouse mobile against a compressing local server scored performance 93–98 over four runs, accessibility 100, best practices 100, and CLS 0.012.

**Addendum 2026-11-09 (second pass): one screen, scroll only.** The owner set two rules for the site: everything a section says fits in one screen, and nothing waits behind a click (assume the visitor never clicks). So:
- The page is three acts of pinned scenes (`marketing/src/components/Scenes.tsx`, `ScrollStory.tsx`): the problem (a still section: five apps struck out and their yearly total), the solution (the existing story), and a showcase (Fern's five moods, then the app's real share cards fanning out).
- The click-driven sentence demo and Fern's mood tabs are removed; the FAQ shows four answers open instead of eight behind toggles.
- The share cards are images captured from the app itself (`mobile/src/prototype`, Fern ground) and saved to `marketing/public/share/`; recapture them when the card design changes.
- A headless check measures every section against one screen at 375, 768 and 1280 px wide.
- No sticky waitlist bar and no reading-progress bar (owner, 2026-11-09): the ask lives in the header, the hero and the closing form.
- Act one names the four reasons people give for quitting a tracker (chores, a wiped streak, logging you can't trust, scolding reminders) as a pinned scene, problem only (owner, 2026-11-09): each beat builds the frustration in a small app screen (a tap tally over a pile of five apps, a 47-day streak dropping to 0, a calorie number with doubts, reminders piling up) and offers no answer; the scroll story after it is where Unfurl comes in. The reasons come from the marketing research pass of 2026-11-07 (app-store reviews, forum threads, published studies), ranked by breadth of evidence. No quotes and no percentages: that pass's quotes are internal only and its sample supports no share. The tap tally counts only the taps drawn.
- Privacy is a diagram (records on the phone, one copy to the cloud for Fern, export) beside the four statements; every pricing plan ends in the waitlist button, since payment is not live.
- The Fern sprite files use a wider frame (`scripts/gen-fern.mjs`) because an `<img>` crops the ripple and halo drawn outside it.

- The app is React Native and the site says iPhone and Android throughout (owner, 2026-11-09).

- The problem beats recall the kinds of app people quit (a food log and a budget app's long forms, a streak app's paid restore, a photo calorie scanner, guilt-tripping reminders) without naming any: no competitor name, logo, mascot or brand colour, and wording paraphrased (owner, 2026-11-09). Naming a rival stays a separate decision (claims ledger R-007).
- The how-it-works story has a fifth beat, Ask Fern: a question about the week answered from the very records the sentence filed (the run against past 5k times, the groceries against the food budget).
- The companion scene (Fern's five moods) is removed: it told the visitor nothing they could use (owner, 2026-11-09); Fern's answers live in the story's fifth beat and the grace day in its own section.
- The features section is one row of real app screens, one per area, running edge to edge and slid sideways by scroll at every width, captured from the demo build (`mobile/src/prototype`) with the currency set to US dollars and the Philippine demo names swapped for neutral ones before capture. Recapture when those screens change.
- The share cards are the app's real cards on its Photo ground, over three photos generated with Figma AI for the site (2026-11-09); no real person is shown.

- The hero film starts muted with captions off (owner, 2026-11-09); a sound button turns its music on, and it mutes itself again once the film leaves the screen. Fern sits beside the hero's waitlist button, leaning toward it (decorative).

**Follow-ups:**
- Pick the production domain and add the Cloudflare Pages project (Kai).
- Connect the waitlist form to a real endpoint, or remove it.
- Replace the placeholder legal pages with reviewed text before launch.
