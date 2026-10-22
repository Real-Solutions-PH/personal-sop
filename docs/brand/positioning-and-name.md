# Positioning, name and brand

2026-10-22. The launch positioning, the product name and the brand system for
the mobile app that has been called "Personal SOP" while it was being built.
Every section states a decision and the reasoning behind it, so each one can be
reviewed and overridden on its own.

## Decisions at a glance

| Question | Decision |
|---|---|
| Product name | **Unfurl** |
| Companion name | **Fern** stays: the companion inside Unfurl, default and renamable |
| Category | All-in-one life tracker you talk to |
| Lead segment | Busy working adults (22 to 35) who train, eat to a goal and juggle work tasks |
| Second segment | Students, as the growth and word-of-mouth segment |
| Primary tagline | **Say it. It's tracked.** |
| Call to action | **Just tell Fern.** |
| App Store title | `Unfurl: Life Tracker by Voice` |
| Pricing | Free tier with a daily Fern allowance; Unfurl Plus at US$49.99 a year or US$6.99 a month, regional pricing elsewhere |
| Brand colour | Moss (`#1f5a43`) as the single brand colour on a warm paper ground; muted module colours on small marks only (updated 2026-10-22, see [design-system](design-system/project/README.md)) |
| Type | Geist for words, Geist Mono for numbers (replaces Barlow, updated 2026-10-22) |
| Logo | The fiddlehead (Fern's mark) with the wordmark "unfurl"; Fern is the most prominent element of the interface |

## 1. Market and competitors

### The problem, in the user's terms

People who feel productive only when they can see what they did keep a stack
of single-purpose apps: one for habits, one for money, one for food, one for
the gym, one for tasks. Each app wants its own setup, its own screens and its
own subscription. Logging in five places takes long enough that most people
stop within weeks, and then nothing is measured at all.

### What the stack costs today

Prices are US list prices, checked 2026-10-22 from the sources listed under
[Sources](#sources). Several come from review sites, and the App Store varies
them by region and by test, so treat them as approximate.

| Area | Leader | Price a year | What it does well | Gap Unfurl targets |
|---|---|---|---|---|
| Budget | YNAB | $109 (or $14.99 a month) | Strict budgeting method, strong community | Steep learning curve; manual entry is slow |
| Budget | Monarch Money | $99.99 | Bank sync, couples | US-centric bank sync; no life context |
| Budget | Copilot Money | $95 | Polished, Apple-only | Apple-only, US-only bank sync |
| Nutrition | MyFitnessPal Premium | about $79.99 | Largest food database | Heavy interface, ads on the free tier |
| Nutrition | MacroFactor | $71.99 | Adaptive calorie targets | No free tier; nutrition only |
| Nutrition | Cal AI | about $29.99 (often shown higher) | Photo calorie logging | Food only; free tier is manual |
| Training | Strong PRO | $29.99 | Fast set logging | Training only |
| Training | Hevy Pro | $23.99 | Social lifting feed | Free tier caps routines at 4 |
| Tasks | Todoist Pro | $60 | Natural-language task entry | Tasks only |
| Tasks | TickTick Premium | about $35.99 | Tasks plus habits and Pomodoro | Still form-based entry |
| Habits | Habitify Premium | about $39.99 | Clean habit tracking | Habits only |
| Habits | Streaks | $5.99 once | Simple, Apple-native | Habits only, Apple only |

**A typical stack** (YNAB, MacroFactor, Strong, Todoist, Habitify) costs about
**$311 a year**, before counting the time spent switching between five apps.

### All-in-one and chat-first competitors

| Product | What it covers | Why it does not close the gap |
|---|---|---|
| Notion "life OS" templates | Anything, if the user builds it | The user must design the system; no fast capture; Notion AI costs extra |
| Life OS (Android) | Habits, workouts, sleep, water, mood, expenses | Form-based logging; the AI is a coach, not the way you log |
| Lifehub | Habits, finance, goals, tasks, notes, sport | Connects to outside chatbots rather than being one itself |
| Logly | Activity log, with AI questions on Pro | Logging only; no money, food or training records |
| Voice expense apps (Finny, WalletGPT, Vocash) | Expenses by voice | Money only |
| GhostFit | Workouts and meals by voice | Fitness only |
| ChatGPT or another general assistant | Anything you type | Keeps no structured records: no charts, no streaks, no totals you can trust |

### Where Unfurl sits

Two questions place every competitor:

- **How much of daily life does it cover?** One area, or all of it.
- **How much effort does one entry take?** One sentence, or forms and screens.

| | One sentence per entry | Forms and screens per entry |
|---|---|---|
| **Whole life** | **Unfurl** (open) | Notion templates, Life OS, Lifehub |
| **One area** | Cal AI, voice expense apps, GhostFit | YNAB, MacroFactor, Strong, Todoist, Habitify |

The top-left box is empty. Chat-first apps exist, and all-in-one apps exist,
but no app found in this scan does both with structured records the user can
chart and query.

### The real competitor: stopping

Most people in the target market are not choosing between apps. They tried
two or three, stopped logging, and now track nothing. Every message below is
aimed at that, not at YNAB.

## 2. Positioning

### Positioning statement

> For busy people who want to see their progress, **Unfurl** is the
> all-in-one life tracker you talk to. Tell Fern what happened, in a sentence,
> a voice note or a photo, and it lands in the right place: habits, tasks,
> workouts, meals and money. Ask Fern anything and get the answer from your
> own records. Unlike a stack of single-purpose apps, there is nothing to
> learn and nothing to switch between.

### Who it is for (ideal customer profile)

| Field | Profile |
|---|---|
| Who | Working adults, 22 to 35, with a full-time job or side business |
| Trigger | Starting at the gym or a diet, a new budget, a new job, or the third abandoned tracker |
| Behaviour | Already tracks, or has tried tracking, at least two areas of life; pays for at least one app |
| Belief | "If I cannot measure it, I cannot improve it." Feels productive only when the day is recorded |
| Mindset | Scattered attention, many open loops, little patience for setup screens. Many describe themselves as "a bit ADHD" |
| Devices | iPhone or Android; already uses voice notes |
| Budget | Already spends $30 to $300 a year on trackers |

### Segment priority

**Lead with the busy worker; grow through students.**

| | Busy worker (lead) | Student (second) |
|---|---|---|
| Areas tracked | Tasks, training, food, habits, money: all five | Mainly tasks and deadlines, then habits |
| Willingness to pay | High: already pays for trackers | Low: price-sensitive, prefers free |
| Value of the all-in-one promise | Highest: replaces the most apps | Partial: uses one or two areas |
| Reach | Short-form video, gym and productivity creators, Reddit | Campus organisations, class group chats, TikTok |
| Role | Revenue and retention | Volume, word of mouth, future paying users |

The worker is the only segment that uses the whole product and already pays to
track, so the product promise ("one app instead of five") is truest for them.
Students get the sharpest single demo ("I said my assignments out loud and they
became tasks"), which makes them the right growth channel but not the
positioning anchor. Marketing copy speaks to the worker; campus programmes and
student pricing carry the second segment.

### Value proposition

**Track everything you care about, in the time it takes to say it.**

| Job the user hires Unfurl for | How Unfurl does it |
|---|---|
| Record what happened, fast | One sentence, a voice note or a photo; Fern files it, with Undo |
| Stop paying for and switching between five apps | Habits, tasks, training, nutrition, body, money and journal in one place |
| Get answers without digging through screens | Ask Fern: "How much did I spend on food this week?" "When did I last train legs?" |
| See progress | Charts, streaks, and a Life Score that rolls every area into one number |

### Messaging pillars

| Pillar | Message | Proof in the product |
|---|---|---|
| 1. Say it, it's tracked | Logging takes a sentence, not a form | Text, voice dictation and photo capture; Fern creates the record and offers Undo |
| 2. One app, not five | Every area of daily life, one subscription | Habits, tasks, fitness (training, nutrition, body), finance, journal |
| 3. Ask, don't dig | Your records answer back | Fern answers questions from the user's own data |
| 4. See yourself improve | What gets measured gets better | Stats, streaks, Life Score, shareable progress cards |

Lead with pillar 1. No competitor in the scan offers it across every area,
and it is the reason the other three pillars work: an all-in-one app only
replaces five apps if logging in it is faster than in each of them.

**"AI" is not a headline word.** It describes how the product works, not what
the user gets, and in 2026 nearly every app claims it. Say what happens ("tell
Fern", "say it", "snap the receipt"). Mention AI only where a reader expects
it, such as the privacy page and the feature list in the App Store
description.

### Taglines

| Option | Use |
|---|---|
| **Say it. It's tracked.** | **Primary.** Names the low-friction difference in four words |
| Just tell Fern. | Call to action: buttons, end cards of videos, onboarding |
| Your whole day, in a sentence. | Video hooks and ads aimed at the busy worker |
| One app. Every habit, rep, task and peso. | Consolidation message; swap the currency per market |
| Measure it. Watch it unfurl. | The guiding idea, tied to the name; brand and about pages |

### Claims to avoid

The target audience includes many people with diagnosed or self-described
ADHD. Unfurl is not a medical product.

- Say "for scattered days", "for busy minds", "if you forget to log"; never
  "treats", "manages" or "helps with ADHD".
- The word ADHD may appear in App Store keywords and in community posts where
  members use it about themselves, never as a health claim.

### App Store listing

| Field | Text | Length (limit) |
|---|---|---|
| Name | `Unfurl: Life Tracker by Voice` | 29 (30) |
| Subtitle | `Habits, money, gym and tasks` | 28 (30) |
| Keywords | `habit,budget,expense,calorie,macro,workout,gym,todo,planner,journal,routine,diary,log,adhd,streak` | 97 (100) |
| Promotional text | Say what you did, by text, voice or photo. Fern logs it to the right place and answers questions about your week. | |

The keyword field leaves out words already in the name and subtitle (Apple
indexes those) and avoids competitor names, which Apple rejects.

First three screenshots, in order: (1) one spoken sentence becoming a logged
expense, workout and task; (2) "Ask Fern" answering a question with a chart;
(3) the Today screen with every area on one page.

## 3. Name

### What the name had to do

- Work for a global audience: short, easy to say in many accents, no awkward
  meaning in common languages.
- Stand apart in the App Store, where the habit and tracker categories are
  crowded with similar names.
- Fit the existing fiddlehead mark and the companion, Fern, so the brand tells
  one story.
- Be ownable: no same-category app with the same name, and a usable domain.

### Shortlist

Scores are 1 to 5, where 5 is best. **Conflict risk** is scored so that 5
means no conflict was found. The checks were a web search, App Store search
results and a DNS lookup on 2026-10-22; they are not a trademark clearance.

| Name | Meaning | Memorable | Easy to say globally | Conflict risk | Domain | Total /25 | Main finding |
|---|---|---|---|---|---|---|---|
| **Unfurl** | 5 | 4 | 4 | 4 | 3 | **20** | No App Store app found; no software trademark found (one for food goods, one for clothing). An early-access Chrome text expander uses getunfurl.app; unfurl.app and unfurlapp.com are registered |
| Fiddlehead | 5 | 4 | 2 | 5 | 2 | 18 | No app conflict; long and unfamiliar outside North America; fiddlehead.app registered |
| Koru | 5 | 4 | 5 | 2 | 1 | 17 | The Māori word for the unfolding fern frond; a 2026 habit tracker and a mindfulness app already use it; cultural-ownership concerns for a global brand |
| Fern (as the product name) | 4 | 5 | 5 | 1 | 1 | 16 | Taken in this category: "Fern: Goal & Habit Tracker" and "Fern: ADHD Journal & Diary", plus Fern Health (health apps) and several AI assistants named Fern |
| Hey Fern | 3 | 4 | 5 | 1 | 3 | 16 | Carries every Fern conflict; a help-desk AI already uses "Hey Fern" in its product |
| Fernlog | 4 | 3 | 4 | 1 | 4 | 16 | The distinctive part is still "Fern", so it inherits the Fern conflicts |
| Kept | 5 | 4 | 4 | 1 | 2 | 16 | "Kept: Task & Habit Tracker" is live on the App Store |
| Tally | 4 | 5 | 5 | 1 | 1 | 16 | At least five apps named Tally, several of them habit trackers |
| Mylo ("my log") | 4 | 4 | 4 | 2 | 1 | 15 | Several App Store apps named Mylo (dating, pensions, digital legacy, music) |
| Frond | 4 | 3 | 3 | 3 | 2 | 15 | A Product Hunt "Frond" project planner; frond.app registered |
| Onelog | 4 | 3 | 4 | 2 | 2 | 15 | A clinical logbook app, a Swiss single sign-on service and ship logbook software are all named OneLog |

### Recommendation: Unfurl

**Unfurl** is the product name.

- **It tells the brand story in one word.** A fern frond unfurls from the
  tight spiral of the fiddlehead, a little each day. The mark already draws
  that spiral; the name says what it does. "Measure it. Watch it unfurl."
- **It promises progress, not tracking.** Tracking is the method; seeing your
  life open up is the reason. The App Store title adds the plain description
  ("Life Tracker by Voice"), so the name does not have to.
- **It is clear in this category.** No App Store app and no software trademark
  turned up under the name, against heavy crowding for Fern, Kept, Tally and
  Mylo.
- **It is short and spelled as it sounds.** Two syllables: un-FURL.

Accepted costs:

- "Unfurl" is not an everyday word for every English learner. The descriptor
  in the store title and the fern imagery carry the meaning until the name is
  known.
- In software, "unfurl" also names link previews in Slack and Discord, so a
  web search for "unfurl" alone is noisy. A search for "Unfurl app" is not.
- The obvious domains are taken. Use **unfurl.day** or **unfurlapp.co**
  (neither had DNS records on 2026-10-22, so both are probably unregistered;
  confirm at a registrar), and make an offer for unfurlapp.com later if the
  name succeeds.

**Before spending money on the name:** search UNFURL in the USPTO and EUIPO
registers for classes 9 and 42, and in the IPOPHL register in the Philippines,
then file in the launch markets. This scan does not replace that.

### The companion keeps the name Fern

Fern stays as the companion: the voice inside Unfurl, set as the default and
renamable by the user.

- **Products and companions are named differently on purpose.** Duolingo and
  its owl Duo work the same way: people recommend the product by its name, so
  the product name carries the App Store and trademark load, and the companion
  name only needs to be friendly.
- **Fern fits Unfurl.** Fern is the fern; unfurling is what a fern does. "Just
  tell Fern" reads naturally as the call to action of an app called Unfurl.
- **The Fern conflicts sit at the product-name level.** Other apps titled
  "Fern" matter for a store listing and a trademark; they matter much less for
  a character inside another product. Do not file "Fern" as a trademark, and
  do not put "Fern" first in the App Store title.

## 4. Brand system

### Personality

| Unfurl is | Unfurl is not |
|---|---|
| Steady: a friend who pays attention | A drill sergeant or a cheerleader |
| Plain: short words, real numbers | Clever for its own sake |
| Quick: gets out of the way | Chatty when the user is busy |
| Honest: says what it knows and what it is guessing | Falsely certain |
| Kind about misses | Guilt-driven |

### Voice

The voice rules in [fern.md](fern.md) apply to the whole brand, not only to
the companion. Five more rules for product and marketing copy:

1. Lead with the user's action ("Say it"), not the technology ("AI-powered").
2. Use numbers the way the user says them: "3 sets of 8", "₱250 on lunch".
3. One idea per sentence. If a sentence needs "and", consider two.
4. Speak to one person: "you", never "users".
5. Mark progress plainly ("Day 12."), never with stacked emoji or exclamation
   marks.

| Do | Don't |
|---|---|
| "Say it. It's tracked." | "Revolutionary AI-powered life management platform" |
| "Spent ₱250 on lunch? Just say so." | "Effortlessly capture your financial transactions" |
| "You trained legs 6 days ago." | "Great job!!! 🔥🔥 Keep crushing it!" |
| "Missed a day. Pick it up tomorrow." | "You broke your streak. Don't give up!" |
| "Fern logged 3 things. Undo?" | "Your entries have been successfully processed." |
| "Not sure if that was lunch or dinner. Which?" | Guessing silently and filing it in the wrong place |

### Colour, type and logo (updated 2026-10-22)

The full system, with live previews of every component in light and dark, is in
[design-system/](design-system/project/README.md). In short, each word of the
voice is a visual rule:

| Word | Visual rule |
|---|---|
| Calm | One brand colour, moss (`#1f5a43`; `#8fcaa6` in dark), marking one thing per screen. Warm paper background (`#f6f5f1`), green-black ink (`#1b1f1c`). Module colours are muted and appear only as small marks. No gradients, glows or coloured shadows. |
| Plain | Flat cards with hairline borders. One filled button per screen. Sentence case. Geist, a plain sans, for all words. |
| Specific | Numbers in Geist Mono with their units (`96 / 140 g`, `₱250.00`, `12:40`). Fern's record cards list every field it filled and quote the words they came from. |

**Logo.** The fiddlehead, the same mark as Fern's, followed by the wordmark
"unfurl" in Geist Medium. The app icon is the white fiddlehead on a solid moss
square. The logo is always flat (no gradient, glow or shadow) so it reads as
modern and calm; inside the app the same mark becomes Fern's glowing orb.

**Fern first.** Talking to Fern is the main way to use the app, so Fern is the
one element allowed colour depth and motion: the gradient orb, a glow, a raised
tab button with a breathing halo, and reply bubbles in mist. Everything around it stays calm, which makes Fern
stand out more.

**Insight at a glance.** People who track this much are motivated by seeing
their numbers, so reading the data must take as little effort as logging it.
The app's existing analytics (the day ring, the stat strip on every area card,
macro rings, trends, projections) are styled for a glance: numbers in mono with
units and changes, values printed on bars, today highlighted, colour in the
data. The design system restyles the screens; it does not change their layout
or which sections they show.

**What changes in the app** (a separate code step after approval): Barlow and
Barlow Condensed become Geist and Geist Mono; the teal primary (`#007567`)
becomes moss; area colours are re-tuned into a validated chart palette used for data only; the gradient heroes become flat cards;
the Fern button, orb and talk button keep their gradient, now in Fern's greens.

## 5. Go-to-market

### Pricing

Price against the stack, not against each single app. Unfurl should cost
clearly less than the apps it replaces; costing more than any one of them is
not a problem.

| Plan | Price (US) | What is included |
|---|---|---|
| Free | $0 | Every area, unlimited manual logging, charts and streaks; a daily Fern allowance covering text, voice and photo logging (start at 15 messages a day and tune it with cost data) |
| Unfurl Plus | **$49.99 a year** or $6.99 a month; 7-day free trial | Fern without the daily allowance (fair-use limits apply), questions over the full history, Life Score breakdowns, export |
| Student | 50% off Plus, yearly only | Same as Plus, with student verification |

- **Why this price:** $49.99 a year is about a sixth of the $311 five-app
  stack, under MacroFactor ($71.99) or YNAB ($109) on their own, and inside
  the $40 to $60 band where habit and task apps already sell.
- **Why voice and photo stay in the free tier:** they are the difference. A
  free user who never feels "say it, it's tracked" has no reason to upgrade.
  The allowance limits cost; it does not hide the product.
- **No lifetime plan.** Every Fern message has a running model cost, so a
  one-time price would lose money on the most active users.
- **Regional pricing:** set prices per country in App Store Connect and Google
  Play rather than relying on automatic conversion. Philippines target: about
  ₱1,290 a year and ₱199 a month.

### Channels

| Channel | Why it fits | First move |
|---|---|---|
| Short-form video (TikTok, Reels, Shorts) | The difference is visual and takes 10 seconds to show | Daily "logged in 5 seconds" clips: say one sentence, show three records appear |
| Productivity and fitness creators | Their audiences already pay for trackers | 10 small creators (10,000 to 100,000 followers) with a free year and a referral code |
| Reddit and online communities | Where people complain about tracker fatigue | Founder posts in productivity, self-improvement and quantified-self communities, following each community's rules on self-promotion |
| Campus programmes (students) | Dense networks; one class group chat reaches 50 people | Ambassador programme at 3 universities: free Plus for ambassadors, student pricing for members |
| Product Hunt | Early adopters and press | Launch after the first 200 users, with a demo video |
| In-app sharing | Progress cards and the community feed already exist | Every shared progress card carries the Unfurl mark and an install link |

### The first 1,000 users

| Step | Source | Target |
|---|---|---|
| 1. Private beta | Founder's network and local tech and fitness communities | 100 |
| 2. Campus pilot | 3 university organisations, through ambassadors | 300 |
| 3. Short-form video | 30 days of daily clips plus 10 creators | 300 |
| 4. Public launch | Product Hunt, Reddit, Indie Hackers | 300 |

Each step starts only when the one before it shows the product keeps people:

| Measure | Bar to move on |
|---|---|
| Time from install to first logged record | Under 60 seconds for most users |
| Records logged per active user per day | 3 or more |
| Day-7 retention | 30% or more |
| Areas used per user in week one | 2 or more (evidence for the all-in-one promise) |
| Free to Plus conversion after the trial | 4% or more |

### Launch sequence

1. Approve the name and run the trademark searches (section 3).
2. Secure the domain and social handles for Unfurl.
3. Rename the app: display name, store listing, icon, splash screen. The code
   rename is a separate step after approval.
4. Private beta (step 1 above) with in-app feedback.
5. Campus pilot and the video channel in parallel.
6. Public launch on the App Store and Google Play.

## Sources

Checked 2026-10-22. Prices from review sites are approximate; confirm them
against each vendor's own pricing page before quoting them publicly.

- YNAB, Monarch, Copilot: [Asian Efficiency comparison](https://www.asianefficiency.com/technology/copilot-money-vs-monarch-vs-ynab/), [Costbench YNAB](https://costbench.com/software/personal-finance/ynab), [Mezzi on Copilot's 2026 pricing](https://www.mezzi.com/blog/copilot-money-2026-pricing-change-what-annual-subscribers-should-do)
- MyFitnessPal: [Subger listing](https://subger.com/en/gb/service/myfitnesspal)
- MacroFactor: [The Yearly Bill](https://theyearlybill.com/prices/macrofactor/)
- Cal AI: [Cal AI pricing page](https://www.trackcalai.com/pricing), [eesel review](https://www.eesel.ai/blog/cal-ai-pricing)
- Hevy and Strong: [Hevy review 2026](https://www.sensai.fit/blog/hevy-review-2026), [Strong review 2026](https://www.sensai.fit/blog/strong-app-review-2026)
- Todoist and TickTick: [Todoist vs TickTick 2026](https://www.asianefficiency.com/task-management/todoist-vs-ticktick/), [TickTick pricing](https://lifestack.ai/blog/ticktick-pricing)
- Habitify and Streaks: [Toolradar Habitify pricing](https://toolradar.com/tools/habitify/pricing), [Habitify on the App Store](https://apps.apple.com/us/app/habitify-habit-tracker/id1111447047)
- All-in-one apps: [Life OS on Google Play](https://play.google.com/store/apps/details?id=app.lifeos.track&hl=en_US), [habit tracker roundup covering Lifehub](https://applifehub.com/blog/best-habit-tracker-apps), [Logly](https://getlogly.app/blog/best-personal-activity-log-apps/)
- Voice loggers: [Finny on voice expense trackers](https://getfinny.app/blog/best-voice-expense-tracker-apps-2026), [GhostFit](https://play.google.com/store/apps/details?id=com.fytlog.app&hl=en)
- Notion AI and Rosebud: [Life Note comparison](https://blog.mylifenote.ai/the-8-best-ai-journaling-apps-in-2026/)
- Name checks: [Fern: Goal & Habit Tracker](https://apps.apple.com/us/app/fern-goal-habit-tracker/id6757623670), [Fern: ADHD Journal & Diary](https://apps.apple.com/us/app/fern-adhd-journal-diary/id6753620811), [FERN HEALTH trademark](https://trademarks.justia.com/997/78/fern-99778685.html), [Ferndesk](https://ferndesk.com), [Kept: Task & Habit Tracker](https://apps.apple.com/gb/app/id6760225477), [Tally - Habit Tracker](https://apps.apple.com/us/app/tally-habit-tracker/id6758336788), [Koru habit tracker](https://mwm.ai/apps/koru-mobile/6753133508), [Mylo AI](https://apps.apple.com/app/id6469645973), [Frond on Product Hunt](https://www.producthunt.com/products/frond/alternatives), [One Log clinical app](https://apps.apple.com/py/app/one-log/id1550102878?l=en-GB), [UNFURL trademark (food goods)](https://www.trademarkelite.com/trademark/trademark-detail/97093937/UNFURL), [Unfurl text expander](https://getunfurl.app)
