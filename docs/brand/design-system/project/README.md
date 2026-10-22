Unfurl is the all-in-one life tracker you talk to. People log habits, tasks, training, food and money by telling Fern, the companion, in a sentence, a voice note or a photo. The brand voice is **calm, plain, specific**, and the interface speaks it as clearly as the copy does. Two product rules sit on top. **Insight at a glance**: reading the data is as effortless as logging it, so every number, chart and ring the app shows is styled to be understood at once. **Fern first**: talking to Fern is the main way in, so Fern is the one glowing, moving thing on every screen. This system changes how the app looks, never which sections a screen has or their order: the Screens cards reproduce the app's current layouts. Start with the Principles card: it shows each rule, with what to do and what not to do.

## The voice, as design

| Word | In copy | In the interface |
|---|---|---|
| **Calm** | Short sentences. No hype, no guilt. | One brand colour (`primary`, moss) marks one thing per screen. Muted module colours on small marks only. Warm paper `background`. No gradients, glows or coloured shadows. Slow, quiet motion. |
| **Plain** | Everyday words, sentence case, no emoji. | Flat cards with hairline `border`s. One filled button per screen; the rest outline or text. One icon family at one stroke. Geist, a plain sans. |
| **Insight at a glance** | Numbers with their unit, change and window: "+12% vs last wk", "↓0.3 kg/wk". | The app's analytics (DayHero, the stat strip on every area card, rings, trends, heatmaps, projections) are styled to be read in a glance: mono numbers, values printed on bars, today highlighted, colour in the data. This system restyles them; it does not add or remove any. |
| **Fern first** | Fern invites, never nags: "Message Fern…". | Fern alone has the orb gradient (`moss` → `frond` → `sprout`), a `sprout` glow and idle motion. The Fern button rises out of the tab bar with a breathing halo, as it does in the app. Fern's replies sit in `mist` bubbles; the composer floats, with a large gradient talk button. |
| **Specific** | Real numbers, units and times. Say what happened. | Numbers in Geist Mono with their unit beside them (`96 / 140 g`, `₱250.00`, `12:40`). Every record shows the fields Fern filled and the words it came from. Charts carry their values. |

## Content fundamentals

- Speak to one person as "you". Fern speaks as "I" ("I logged both").
- Sentence case everywhere, including buttons and section headings. No uppercase labels.
- Use the numbers people say and keep their units: "3 × 8 @ 60 kg", "₱250.00". Group thousands. Times as `12:40`, dates as `Wed 22 Oct`.
- Name the result: "Logged ₱250.00 · Food · 12:40". Never "Success!" or "Entry processed".
- Comparisons say against what and since when: "−0.6 kg since 15 Oct", "+₱180 vs last week".
- Notice progress plainly ("12-day streak"). No exclamation marks, no emoji, no guilt.
- Say what Fern is doing and what it is unsure of: "Looking at October's transport…", "No workout is open. Start Push day now with this set?"
- Lead with what the person does ("Tell Fern what happened"); the word "AI" does not appear in interface copy.
- Fern's name always comes from the companion's current name, because people can rename it.

| Do | Don't |
|---|---|
| "Tell Fern what happened" | "What's on your mind? ✨" |
| "3 things left today" | "You're crushing it!!!" |
| "Missed yesterday. Today is a new count." | "You broke your streak." |
| "Couldn't save the workout. Check your connection and try again." | "Oops! Something went wrong." |

## Visual foundations

**Colour**
- Ground and ink: `background` (paper), `card` (white / green-black), `foreground` (ink), `muted-foreground` (secondary text, units), `border` (hairlines), `input` (control outlines, 3:1), `muted` (tracks, the person's chat bubble).
- Brand: `primary` (moss `#1f5a43`; `#8fcaa6` in dark). The one filled button, selected switches, links, the focus `ring`.
- Fern: `moss`, `frond`, `sprout` and `mist` belong to Fern alone: the orb gradient, the glow and halo, and Fern's reply bubbles. Nothing else uses them, so Fern is always the most colourful thing on screen.
- Data: `tsk`, `fit`, `fin`, `hab`, `life`, `nut` are the area colours and the chart palette, in that fixed order. They are vivid enough to read as data and validated as a set (colour-blind separation ≥ 8.9 ΔE, ≥ 3:1 on `card`, both themes). They fill charts, sparklines, heatmap cells, progress and dots. Never a button, a card background or text: labels and values stay in `foreground` or `muted-foreground`. Calm chrome, colourful data.
- Status: `good`, `warn`, `bad`, always with a word or an icon.
- Every text colour meets 4.5:1 on `background` and `card` in both themes. Area colours are not text colours.
- `hero-*`, `share-*`, `paper`, `acct-*` are artwork and account colours, not interface.

**Type**
- Geist for words: `page-title` 28, `title` 20, `sheet-title` 17, `body` 16, `control` 15, `detail` 14, `caption` 13, `micro` 12. Nothing smaller than 12.
- Geist Mono for numbers: `num-xl` (one hero number per screen), `num-lg` (metrics), `num-md` (values in rows and records), `num-sm` (times, deltas, chart labels). The unit follows in the same face, muted.
- Weights: 400 for reading, 500 for controls and labels, 600 for titles. No bold body text.

**Space and shape**
- 16 pt gutter and card padding (`space-lg`), 16 pt between blocks on a screen, 8–12 pt inside. Whitespace does the grouping; lines are a last resort.
- `radius-control` 12 for buttons and inputs, `radius-card` 16 for cards, `radius-pill` for chips and the composer, `radius-hero` for sheet tops.
- Shadows only on things that float: `shadow-drawer` (sheets, Fern's drawer), `shadow-composer`, `shadow-fern` (the raised Fern button), plus the small knob and segment shadows.
- Touch targets at least 44 pt; primary buttons and inputs 48 pt.

**Motion**: 160 ms for presses, 240 ms for state changes, ease-out in and faster out. Motion only explains a change (a sheet arriving, a check filling). Fern is the exception: its orb breathes, its halo pulses in the tab bar, and its frond sways while it works. Nothing else loops. Everything stops under reduced motion.

**States**: pressed = opacity 0.72 (buttons) or an `accent` circle (icon buttons); disabled = 0.4; selected = a 2 pt ink outline and a check, never colour alone; focus = 2 pt `ring` with 2 pt offset.

**Charts**: one axis, never two; past values in a light tint of the area colour and today at full strength; values printed on bars; gridlines in `border`; a goal as a dashed `good` line; a crosshair readout on touch; a legend whenever there are two or more series; a projection sentence under trends. `Unfurl.render()` draws sparklines (`data-spark`) and trend charts (`data-line`).

**Empty states**: the real components at 32% opacity with zeroes, and one card with an exact example of what to tell Fern (see LockedPreview).

## Logo and iconography

- The mark is the **fiddlehead**: a stem rising into a spiral with two young leaflets, on a 24-unit grid with round caps (see the Logo card). It is also Fern's face, so the logo, the app icon, the Fern button and Fern's avatar are one object.
- Lockup: the fiddlehead in `primary` beside lowercase "unfurl" in Geist Medium, tracking −3%, in `foreground`.
- The logo is always flat: no gradient, glow or shadow on the mark, the lockup or the app icon.
- App icon: the white fiddlehead on a solid moss square. Dark icon: `sprout` mark on `#121513`. Files: `assets/Logos/`.
- Inside the app the mark becomes Fern's orb, which alone carries the gradient and glow.
- Icons are lucide outlines at 1.75 stroke (active tab 2.0), 18 pt in controls, 22 pt in the tab bar. One family, outline only, never emoji.
- Module icons: habits `target`, tasks `square-check-big`, training `dumbbell`, nutrition `utensils`, money `wallet`, journal `book-open`, weigh-ins `scale`.

## Components at a glance

| Group | Components |
|---|---|
| Brand | Logo, Principles |
| Actions | Button, IconButton |
| Inputs | Field, Choices, Segmented, Switch |
| Containers | Card, Sheet |
| Lists | Row, SectionHeading |
| Home | DayHero, ModuleStats, WeatherCard, AppLauncher, NextUp, HabitsCard, TasksCard, FitnessCard, NutritionDay, FinanceCard, CommunityCard, GoalsCard |
| Data | TrendChart, Heatmap, Charts, Progress, Metric, LifeScore |
| Feedback | Toast, LockedPreview |
| Navigation | TabBar, ScreenHeader |
| Fern | FernAvatar, FernHome, ChatMessage, Composer, FernDrawer, RecordCard, StepsBlock |
| Screens | TodayScreen, FernScreen |

Previews use the classes in `components/bundle.css` (prefix `uf-`); set a module with one class on an ancestor (`acc-hab`, `acc-tsk`, `acc-fit`, `acc-nut`, `acc-fin`, `acc-life`). `Unfurl.mark(size, colour)` in `components/bundle.js` draws the fiddlehead.

**Changes from the app as built**: the app currently uses Barlow and Barlow Condensed, a teal primary (`#007567`), saturated module colours, gradient heroes and a gradient mic button. This system replaces them with Geist and Geist Mono, moss as the interface colour, muted module colours and flat surfaces everywhere except Fern, which keeps (and gains) its gradient orb, raised tab button and glow. The code change is a separate step.
