import {
  ArrowRight,
  BookOpen,
  Camera,
  Check,
  CloudOff,
  Download,
  Dumbbell,
  FlaskConical,
  HardDrive,
  Heart,
  Layers,
  ListChecks,
  MessageCircle,
  MessagesSquare,
  Mic,
  Plus,
  RefreshCw,
  Route,
  Share2,
  ShieldCheck,
  Smartphone,
  Sprout,
  Target,
  Timer,
  Type,
  Users,
  Utensils,
  Wallet,
} from "lucide-react"
import type { ReactNode } from "react"
import { CaptureDemo } from "@/components/CaptureDemo"
import { Fern } from "@/components/Fern"
import { FernMoods } from "@/components/FernMoods"
import { HeroVideo } from "@/components/HeroVideo"
import { Logo, Mark } from "@/components/Logo"
import { PrimaryCta } from "@/components/PrimaryCta"
import { Reveal } from "@/components/Reveal"
import { SiteFooter } from "@/components/SiteFooter"
import { StickyCta } from "@/components/StickyCta"
import { StreakRing } from "@/components/StreakRing"
import { WaitlistForm } from "@/components/WaitlistForm"
import {
  FAIR_USE,
  PLANS,
  REGIONAL_NOTE,
  SHOW_PRICES,
  STACK,
  STUDENT_NOTE,
} from "@/config/pricing"
import { CTA, FEATURE_STATUS, PROOF, SITE } from "@/config/site"

const usd = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
  })

const FEATURES: {
  k: string
  icon: ReactNode
  name: string
  say: string
  text: string
  fern?: boolean
}[] = [
  {
    k: "var(--hab)",
    icon: <Target aria-hidden />,
    name: "Habits",
    say: "meditated 10 min",
    text: "Routines, streaks and perfect days, with a check-off you can feel.",
  },
  {
    k: "var(--tsk)",
    icon: <ListChecks aria-hidden />,
    name: "Tasks",
    say: "call the dentist tomorrow at 9",
    text: "Due times and one-tap Done, Today or Tomorrow.",
  },
  {
    k: "var(--fit)",
    icon: <Dumbbell aria-hidden />,
    name: "Training",
    say: "squat 5x5 at 80kg",
    text: "Routines, sets with the gain since last time, PRs and a rest timer.",
  },
  {
    k: "var(--nut)",
    icon: <Utensils aria-hidden />,
    name: "Food",
    say: "📷 photo of lunch",
    text: "Meals with macros. A photo gives an estimate you can adjust.",
  },
  {
    k: "var(--fin)",
    icon: <Wallet aria-hidden />,
    name: "Money",
    say: "coffee 4.50",
    text: "Expenses, accounts, budgets, bills and where the month is heading.",
  },
  {
    k: "var(--jnl)",
    icon: <BookOpen aria-hidden />,
    name: "Journal",
    say: "good talk with mum tonight",
    text: "A line about your day, kept next to everything else you did.",
  },
  {
    k: "var(--foc)",
    icon: <Timer aria-hidden />,
    name: "Focus",
    say: "focus 25 on the essay",
    text: "Pomodoro and stopwatch sessions that record where the time went.",
  },
  {
    k: "var(--primary)",
    icon: <MessageCircle aria-hidden />,
    name: "Ask Fern",
    say: "when did I last train legs?",
    text: "Answers from your own records, with the chart to show it.",
    fern: true,
  },
]

const FAQ: { q: string; a: ReactNode }[] = [
  {
    q: "Where does my data live?",
    a: "Every record is saved on your phone first. Your account keeps a copy on our servers, which is how Fern reads your records to answer questions and how a new phone gets your history back. A local-only mode, with no account and nothing leaving your phone, is being built now.",
  },
  {
    q: "Why does Fern have a daily limit?",
    a: `Every message to Fern has a real running cost, so the free plan comes with a daily allowance and Plus with a monthly fair-use budget we state up front; past it, Fern switches to a lighter model. Logging by hand, charts and streaks are never limited.`,
  },
  {
    q: "Does it work offline?",
    a: "Logging by hand works with no signal and syncs when you are back online. Fern needs a connection to read what you said.",
  },
  {
    q: "Can I export my data?",
    a: "Yes. You can download every record as a file at any time, on the free plan.",
  },
  {
    q: "Do I need an account?",
    a:
      FEATURE_STATUS.localOnlyMode === "shipped"
        ? "No. Start without one; sign in later only if you want sync or Fern in the cloud."
        : "For now, yes: an email sign-in. Local-only mode, with no account at all, is coming.",
  },
  {
    q: "What happens when I miss a day?",
    a: "One lone missed day is covered by a grace day, so your streak keeps going. If you are away longer, tell Fern what happened in one sentence; it fills in the gap and pauses your streaks instead of ending them.",
  },
  {
    q: "Is it on Android?",
    a:
      FEATURE_STATUS.android === "shipped"
        ? "Yes, on Google Play."
        : "iPhone comes first. Join the waitlist and we will email you when Android is ready.",
  },
  {
    q: "Is Fern a coach or a doctor?",
    a: "No. Fern keeps your records and answers questions about them. It is not a medical, nutrition or financial adviser, and food estimates from photos are estimates.",
  },
]

export default function Home() {
  const testers = PROOF.testers
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE.name,
    applicationCategory: "LifestyleApplication",
    operatingSystem: "iOS",
    description: SITE.description,
    publisher: { "@type": "Organization", name: SITE.company },
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <header className="site-header">
        <div className="wrap">
          <Logo />
          <nav className="nav" aria-label="Sections">
            <a href="#demo">How it works</a>
            <a href="#way-back">Streaks</a>
            <a href="#privacy">Privacy</a>
            <a href="#pricing">Pricing</a>
            <a href="#faq">FAQ</a>
          </nav>
          <a className="btn btn-primary btn-sm" href={CTA.primaryHref}>
            {CTA.primaryLabel}
          </a>
        </div>
      </header>

      <main id="main">
        {/* Hero: the one filmable moment, and the one ask. */}
        <section className="hero" aria-labelledby="hero-title">
          <div className="wrap hero-grid">
            <div>
              <span className="eyebrow">
                <Sprout aria-hidden /> For everyone who gave up on a tracking
                app
              </span>
              <h1 id="hero-title">
                Say it. <em>It's tracked.</em>
              </h1>
              <p className="lede">
                Tell Fern what happened in one sentence, a voice note or a
                photo. It lands as habits, tasks, workouts, meals, money,
                journal and focus.{" "}
                <span>One app instead of five, and nothing to fill in.</span>
              </p>
              <div style={{ marginTop: 28 }}>
                <PrimaryCta
                  id="hero-cta"
                  secondary={{ label: "See it work", href: "#demo" }}
                />
              </div>
              <p className="hero-stack">
                Replaces:
                {[
                  "Habit app",
                  "Budget app",
                  "Gym log",
                  "Calorie app",
                  "To-do app",
                ].map((a) => (
                  <span key={a} className="app-chip">
                    {a}
                  </span>
                ))}
              </p>
            </div>
            <HeroVideo />
          </div>
        </section>

        {/* Proof strip: only true statements; counts appear when measured. */}
        <div className="proof">
          <div className="wrap">
            <ul>
              <li>
                <FlaskConical aria-hidden />
                {testers
                  ? `${testers.toLocaleString("en-US")} people testing on TestFlight`
                  : "In private beta on TestFlight"}
              </li>
              <li>
                <Layers aria-hidden /> 7 areas of life, one app
              </li>
              <li>
                <HardDrive aria-hidden /> Saved on your phone first
              </li>
              <li>
                <Heart aria-hidden /> Kind about missed days
              </li>
            </ul>
          </div>
        </div>

        {/* The moment: a sentence becomes records. CTA at peak desire. */}
        <section id="demo" className="demo" aria-labelledby="demo-title">
          <div className="wrap">
            <CaptureDemo />
            <div className="demo-cta reveal">
              <p>That's the whole idea. Want it on your phone?</p>
              <PrimaryCta />
            </div>
          </div>
        </section>

        {/* The real competitor is giving up. Anchor against the stack. */}
        <section id="why" aria-labelledby="why-title">
          <div className="wrap">
            <div className="section-head reveal">
              <span className="eyebrow">
                <Route aria-hidden /> Why trackers don't stick
              </span>
              <h2 className="h2" id="why-title">
                You didn't fail at tracking. Five apps did.
              </h2>
              <p className="lede">
                Most people don't pick the wrong tracker. They try two or three,
                stop logging, and end up tracking nothing, because logging in
                five places takes longer than the thing they did.
              </p>
            </div>
            <div className="compare-grid">
              <div className="reveal">
                <ul className="stack-list" aria-label="A typical tracker stack">
                  {STACK.apps.map((s) => (
                    <li key={s.app}>
                      <span>
                        <span className="area">{s.area}</span>
                        {s.app}
                      </span>
                      <span className="price num">
                        {usd(s.perYear)}
                        <span style={{ color: "var(--muted-foreground)" }}>
                          {" "}
                          / yr
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="stack-total">
                  <b>Five apps, five places to log one day</b>
                  <span className="num">
                    {usd(STACK.total)}
                    <span style={{ fontSize: 16 }}> / yr</span>
                  </span>
                </div>
                <p className="fine">
                  US list prices, checked {STACK.checked}. Prices vary by region
                  and change; check each app's own page.
                </p>
              </div>
              <div className="vs-card reveal">
                <h3>Nobody else does both.</h3>
                <p className="lede" style={{ fontSize: 16 }}>
                  Apps that cover your whole life make you fill in forms. Apps
                  that take one sentence only cover one thing.
                </p>
                <table className="quad">
                  <caption className="sr-only">Where Unfurl sits</caption>
                  <thead>
                    <tr>
                      <td />
                      <th scope="col">One sentence per entry</th>
                      <th scope="col">Forms per entry</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th scope="row">Whole life</th>
                      <td className="us">
                        <Check aria-hidden /> Unfurl
                      </td>
                      <td>Notion templates, life-OS apps</td>
                    </tr>
                    <tr>
                      <th scope="row">One area</th>
                      <td>Photo-calorie and voice-expense apps</td>
                      <td>Budget, macro, gym, to-do and habit apps</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div className="reveal" style={{ marginTop: 40 }}>
              <PrimaryCta />
            </div>
          </div>
        </section>

        {/* How it works in three steps. */}
        <section id="how" aria-labelledby="how-title" style={{ paddingTop: 0 }}>
          <div className="wrap">
            <div className="section-head reveal">
              <span className="eyebrow">
                <Sprout aria-hidden /> How it works
              </span>
              <h2 className="h2" id="how-title">
                Three steps, and you already know the first one.
              </h2>
            </div>
            <ol className="steps">
              <li className="step reveal">
                <span className="step-n">
                  <i>1</i> Say it
                </span>
                <h3>Tell Fern what happened</h3>
                <p>
                  Type a sentence, hold the mic, or snap a receipt or a meal.
                </p>
                <span className="inputs">
                  <span className="pill">
                    <Type aria-hidden /> Text
                  </span>
                  <span className="pill">
                    <Mic aria-hidden /> Voice
                  </span>
                  <span className="pill">
                    <Camera aria-hidden /> Photo
                  </span>
                </span>
              </li>
              <li className="step reveal">
                <span className="step-n">
                  <i>2</i> Fern files it
                </span>
                <h3>Each part lands in its place</h3>
                <p>
                  Every record shows the words it came from, with Undo. Not sure
                  if that was lunch or dinner? Fern asks instead of guessing.
                </p>
              </li>
              <li className="step reveal">
                <span className="step-n">
                  <i>3</i> Watch it unfurl
                </span>
                <h3>See yourself improve</h3>
                <p>
                  Streaks, charts and a Life Score fill in as you go. Ask Fern
                  anything about your records.
                </p>
              </li>
            </ol>
          </div>
        </section>

        {/* Features grid. */}
        <section
          id="features"
          aria-labelledby="features-title"
          style={{ paddingTop: 0 }}
        >
          <div className="wrap">
            <div className="section-head reveal">
              <span className="eyebrow">
                <Layers aria-hidden /> Everything in one place
              </span>
              <h2 className="h2" id="features-title">
                Seven areas of your day. One way in.
              </h2>
            </div>
            <ul className="features">
              {FEATURES.map((f) => (
                <li
                  key={f.name}
                  className={`feature reveal ${f.fern ? "fern-card" : ""}`}
                  style={{ ["--k" as string]: f.k }}
                >
                  <span className="feature-head">
                    <span className="tile">{f.icon}</span>
                    <h3>{f.name}</h3>
                  </span>
                  <span className="say">“{f.say}”</span>
                  <p>{f.text}</p>
                </li>
              ))}
            </ul>
            <div className="reveal" style={{ marginTop: 40 }}>
              <PrimaryCta />
            </div>
          </div>
        </section>

        {/* Fern's moods. */}
        <section id="fern" className="privacy" aria-label="Meet Fern">
          <div className="wrap">
            <FernMoods />
          </div>
        </section>

        {/* Never lose your progress: grace day and the way back (PR 331). */}
        <section id="way-back" aria-labelledby="wayback-title">
          <div className="wrap wayback-grid">
            <div className="reveal">
              <StreakRing />
            </div>
            <div className="reveal">
              <span className="eyebrow">
                <ShieldCheck aria-hidden /> Never lose your progress
              </span>
              <h2 className="h2" id="wayback-title">
                Miss a day. Keep the run going.
              </h2>
              <p className="lede">
                Life gets in the way. Unfurl is honest about a missed day and
                generous with your streak.
              </p>
              <ul className="points">
                <li>
                  <span className="ic">
                    <ShieldCheck aria-hidden />
                  </span>
                  <span>
                    <b>A grace day, built in</b>
                    <span className="txt">
                      One lone missed day doesn't end a streak. Two in a row, or
                      two in a week, does, and Unfurl says so plainly.
                    </span>
                  </span>
                </li>
                <li>
                  <span className="ic">
                    <RefreshCw aria-hidden />
                  </span>
                  <span>
                    <b>A way back after a few days off</b>
                    <span className="txt">
                      Tell Fern what happened while you were away, in one
                      sentence. It fills in the gap and pauses your streaks
                      instead of ending them.
                    </span>
                  </span>
                </li>
                <li>
                  <span className="ic">
                    <Sprout aria-hidden />
                  </span>
                  <span>
                    <b>Every miss shows what it cost</b>
                    <span className="txt">
                      “2 days missed · run of 12 ended.” Clear, muted, and never
                      a lecture, so you know where you stand and start again.
                    </span>
                  </span>
                </li>
              </ul>
              <div style={{ marginTop: 32 }}>
                <PrimaryCta />
              </div>
            </div>
          </div>
        </section>

        {/* Privacy and local-first. */}
        <section
          id="privacy"
          className="privacy"
          aria-labelledby="privacy-title"
        >
          <div className="wrap">
            <div className="section-head reveal">
              <span className="eyebrow">
                <Smartphone aria-hidden /> Privacy
              </span>
              <h2 className="h2" id="privacy-title">
                Your life, on your phone first.
              </h2>
              <p className="lede">
                What you tell Fern is personal. Here is exactly where it goes.
              </p>
            </div>
            <ul className="privacy-list">
              <li className="reveal">
                <h3>
                  <Smartphone aria-hidden /> Saved on your phone
                </h3>
                <p>
                  Every record is written to your phone first, so logging by
                  hand works with no signal.
                </p>
              </li>
              <li className="reveal">
                <h3>
                  <RefreshCw aria-hidden /> Synced so Fern can answer
                </h3>
                <p>
                  Your account keeps a copy on our servers. That is how Fern
                  reads your records to answer, and how a new phone gets your
                  history back.
                </p>
              </li>
              <li className="reveal">
                <h3>
                  <CloudOff aria-hidden /> Local-only mode
                  {FEATURE_STATUS.localOnlyMode === "coming-soon" && (
                    <span className="soon">Coming soon</span>
                  )}
                </h3>
                <p>
                  Use Unfurl with no account at all. Nothing leaves your phone,
                  and you back up to a file or your iCloud Drive.
                </p>
              </li>
              <li className="reveal">
                <h3>
                  <Download aria-hidden /> Export any time
                </h3>
                <p>
                  Download every record as a file whenever you want, on the free
                  plan.
                </p>
              </li>
            </ul>
          </div>
        </section>

        {/* Community preview. No invented users or quotes. */}
        <section id="community" aria-labelledby="community-title">
          <div className="wrap community-grid">
            <div className="reveal">
              <span className="eyebrow">
                <Users aria-hidden /> Community
              </span>
              <h2 className="h2" id="community-title">
                Share the win, not the spreadsheet.
              </h2>
              <p className="lede">
                Turn a streak, a PR or a week of training into a clean card for
                your story. Follow friends' progress in the feed when you want
                company, and keep it private when you don't.
              </p>
              <ul className="points">
                <li>
                  <span className="ic">
                    <Share2 aria-hidden />
                  </span>
                  <span>
                    <b>Share cards for every area</b>
                    <span className="txt">
                      Workouts with every set, a day of meals, a habit's run, a
                      week of focus. Win and miss versions.
                    </span>
                  </span>
                </li>
                <li>
                  <span className="ic">
                    <Users aria-hidden />
                  </span>
                  <span>
                    <b>Friends and stories</b>
                    <span className="txt">
                      Progress stories and a friends feed, with a frame editor
                      for your photos.
                    </span>
                  </span>
                </li>
              </ul>
            </div>
            <figure className="share-card reveal" style={{ margin: "0 auto" }}>
              <div className="top">
                <span>Training · this week</span>
                <span>Sample card</span>
              </div>
              <p className="big num">
                4 <small>sessions</small>
              </p>
              <div className="bars" aria-hidden="true">
                {[40, 0, 72, 55, 0, 88, 64].map((h, i) => (
                  <i
                    key={i}
                    className={i === 6 ? "today" : ""}
                    style={{ height: `${Math.max(h, 4)}%` }}
                  />
                ))}
              </div>
              <figcaption className="foot">
                <span>Squat PR · 100 kg × 5</span>
                <span className="logo" aria-hidden="true">
                  <Mark /> unfurl
                </span>
              </figcaption>
            </figure>
          </div>
        </section>

        {/* Research: the customer interview. Secondary on purpose: an
            outline button, so it never competes with the waitlist. */}
        <div className="shape-band">
          <div className="wrap shape-inner reveal">
            <span className="ic">
              <MessagesSquare aria-hidden />
            </span>
            <div>
              <h2>Quit a tracking app before? Help shape Unfurl.</h2>
              <p>
                Ten minutes about what you used, why you stopped and what you do
                now. Your stories decide what we build next.
              </p>
            </div>
            <a className="btn btn-outline" href="/research/">
              Answer the questions
              <ArrowRight aria-hidden />
            </a>
          </div>
        </div>

        {/* Pricing, anchored against the stack. Config-driven. */}
        <section
          id="pricing"
          className="privacy"
          aria-labelledby="pricing-title"
        >
          <div className="wrap">
            <div className="section-head reveal">
              <span className="eyebrow">
                <Wallet aria-hidden /> Pricing
              </span>
              <h2 className="h2" id="pricing-title">
                Free to start. Less than one of the apps it replaces.
              </h2>
            </div>
            {SHOW_PRICES ? (
              <>
                <p className="anchor reveal">
                  <span>
                    Five separate apps:{" "}
                    <s className="num">{usd(STACK.total)} a year</s>
                  </span>
                  <span>
                    Unfurl:{" "}
                    <b className="num" style={{ color: "var(--foreground)" }}>
                      {PLANS.find((p) => p.highlighted)?.price}{" "}
                      {PLANS.find((p) => p.highlighted)?.cadence}
                    </b>
                  </span>
                </p>
                <div className="plans">
                  {PLANS.map((p) => (
                    <article
                      key={p.id}
                      className={`plan reveal ${p.highlighted ? "hl" : ""}`}
                      aria-label={p.name}
                    >
                      {p.highlighted && (
                        <span className="badge">Best value</span>
                      )}
                      <h3>{p.name}</h3>
                      <div>
                        <p className="price">
                          <span
                            className="num"
                            style={{ color: "var(--foreground)" }}
                          >
                            {p.price ?? "$0"}
                          </span>
                          {p.cadence && <span>{p.cadence}</span>}
                        </p>
                        {p.note && <p className="note">{p.note}</p>}
                      </div>
                      <ul>
                        {p.features.map((f) => (
                          <li key={f}>
                            <Check aria-hidden />
                            {f}
                          </li>
                        ))}
                      </ul>
                      <a
                        className={`btn ${p.highlighted ? "btn-primary" : "btn-outline"}`}
                        href={CTA.appStoreUrl ?? CTA.primaryHref}
                      >
                        {CTA.appStoreUrl
                          ? "Download on the App Store"
                          : CTA.primaryLabel}
                      </a>
                    </article>
                  ))}
                </div>
                <div className="pricing-foot reveal">
                  <p>{FAIR_USE}</p>
                  <p>{STUDENT_NOTE}</p>
                  <p>{REGIONAL_NOTE}</p>
                </div>
              </>
            ) : (
              <div className="reveal">
                <p className="lede">
                  Free to start. Paid plans are announced before launch.
                </p>
                <div style={{ marginTop: 24 }}>
                  <PrimaryCta />
                </div>
              </div>
            )}
          </div>
        </section>

        {/* FAQ. */}
        <section id="faq" aria-labelledby="faq-title">
          <div className="wrap">
            <div className="section-head reveal">
              <span className="eyebrow">
                <MessageCircle aria-hidden /> Questions
              </span>
              <h2 className="h2" id="faq-title">
                Straight answers.
              </h2>
            </div>
            <div className="faq">
              {FAQ.map((f) => (
                <details key={f.q}>
                  <summary>
                    {f.q}
                    <Plus aria-hidden />
                  </summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Final ask: the waitlist. */}
        <section id="waitlist" className="final" aria-labelledby="final-title">
          <div className="wrap final-grid">
            <div>
              <h2 className="h2" id="final-title">
                Just tell Fern.
              </h2>
              <p className="lede">
                Get an invite when Unfurl opens. Your first record takes one
                sentence.
              </p>
              <WaitlistForm />
            </div>
            <Fern mood="celebrating" still />
          </div>
        </section>
      </main>

      <SiteFooter />
      <StickyCta />
      <Reveal />
    </>
  )
}
