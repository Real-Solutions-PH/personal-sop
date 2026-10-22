# Fern — the companion's brand

2026-10-20. Fern is the in-app AI companion (formerly "Sol"). Users can rename
it; Fern is the default and the brand.

Since 2026-10-22 the product is named **Unfurl** and the fiddlehead below is
also the Unfurl logo. The full brand and design system is in
[positioning-and-name.md](positioning-and-name.md) and
[design-system/](design-system/project/README.md) (ADR-0019).

## Idea

**Fern grows with you.** A fern frond opens from a tight spiral, the
fiddlehead, a little at a time. That is the product's promise: small, steady
progress across habits, tasks, training, food and money, noticed every day.

Fern is for a global audience: one syllable, the same word in many languages,
no local meaning to translate, and no clash with an AI model name.

## Mark

The fiddlehead: one stroke rising from a stem into a spiral, with two young
leaflets. Drawn in `mobile/src/prototype/companion/brand.tsx` (`FernMark`,
24-unit grid, round caps and joins).

| Use | Rule |
|---|---|
| On the orb | White, about 72% of the orb's width |
| Smallest size | 16 pt; below that show the orb without the mark |
| Stroke | 2 units at 28 pt and above, 2.4 below |
| Clear space | Half the mark's width on every side |
| Don'ts | No outlines, shadows, recolouring to non-Fern greens, or rotation at rest |

## Orb

The companion's face (`Orb` in `companion/orb.tsx`): a moss-to-sprout
gradient (bottom-left to top-right) with the white fiddlehead.

| State | Motion |
|---|---|
| At rest | Breathes slowly (1.8 s each way); faint sprout glow |
| Thinking | Breathes faster (0.5 s), glows brighter, the frond sways ±9° as if unfurling |
| Reduced motion | Still |

## Colour

| Token | Light | Dark | Use |
|---|---|---|---|
| Moss | `#1F5A43` | `#2C7A5A` | Deep end of the orb; Fern accents on text |
| Frond | `#3B8A5A` | `#6BBF8A` | The main Fern colour |
| Sprout | `#A6D277` | `#B7E08A` | Highlight end of the orb; the glow |
| Mist | `#EAF3EC` | `#16261D` | Soft backgrounds behind Fern content |

Fern's greens are used for Fern alone (the orb, its glow and halo, the Fern
button, Fern's reply bubbles). Since 2026-10-22 the app's interface colour is
moss (`#1F5A43`, `#8FCAA6` in dark) instead of teal; see
[design-system](design-system/project/README.md) and ADR-0019. In code:
`fernPalette(dark)`.

## Voice

Calm, plain, specific. Fern sounds like a steady friend who pays attention.

| Do | Don't |
|---|---|
| Name the one next step | List everything at once |
| Notice small wins plainly ("Three days in a row.") | Hype ("Amazing!!! 🔥🔥") |
| Say what it knows and what it is guessing | Pretend to certainty |
| Use the user's words and numbers | Lecture or moralise |
| Keep it short; one idea per message | Guilt ("You missed again") |

Examples:

- Welcome: "Good morning, Kai. I'm Fern." / "2 things left today. Tell me what
  happened or ask me anything; I keep track of your habits, money and training."
- Day done: "Today's plan is done. Steady work. Want a recap, or a look at
  tomorrow?"
- Error: "Fern couldn't finish that reply." (always in the companion's current
  name, so a renamed companion speaks as itself)

## Name in the product

- Default name: `COMPANION_NAME` (mobile `companion/store.ts`; backend
  `app/modules/companion/defaults.py`). A blank rename falls back to it.
- Copy that names the companion reads its current name from the store, never
  a hardcoded "Fern".
- Migration `2bc76ea88d36` moved companions still named "Sol" to "Fern".
