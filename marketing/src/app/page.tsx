import {
  ArrowRight,
  BookOpen,
  Check,
  CloudOff,
  Download,
  Dumbbell,
  ListChecks,
  MessageCircle,
  RefreshCw,
  Smartphone,
  Target,
  Timer,
  Utensils,
  Wallet,
} from "lucide-react"
import type { ReactNode } from "react"
import { Fern } from "@/components/Fern"
import { HeroVideo } from "@/components/HeroVideo"
import { Logo } from "@/components/Logo"
import { PrimaryCta } from "@/components/PrimaryCta"
import { Reveal } from "@/components/Reveal"
import { FernScene, ProblemSection, ShareScene } from "@/components/Scenes"
import { ScrollFx } from "@/components/ScrollFx"
import { ScrollStory } from "@/components/ScrollStory"
import { SiteFooter } from "@/components/SiteFooter"
import { StreakRing } from "@/components/StreakRing"
import { WaitlistForm } from "@/components/WaitlistForm"
import {
  FAIR_USE,
  PLANS,
  REGIONAL_NOTE,
  SHOW_PRICES,
  STUDENT_NOTE,
} from "@/config/pricing"
import { CTA, FEATURE_STATUS, SITE } from "@/config/site"

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

// Four answers, shown open: nothing on the page waits behind a click. Offline
// use and export are in the privacy section, missed days in the streak
// section, and the not-an-adviser line in the footer.
const FAQ: { q: string; a: ReactNode }[] = [
  {
    q: "Where does my data live?",
    a: "On your phone first. A copy syncs to our servers, so Fern can answer and a new phone gets your history back.",
  },
  {
    q: "Why does Fern have a limit?",
    a: "Every message has a running cost: Free has a daily allowance, Plus a monthly fair-use budget. Logging by hand is never limited.",
  },
  {
    q: "Do I need an account?",
    a:
      FEATURE_STATUS.localOnlyMode === "shipped"
        ? "No. Start without one; sign in later only if you want sync."
        : "For now, an email sign-in. A mode with no account is coming.",
  },
  {
    q: "Is it on Android?",
    a:
      FEATURE_STATUS.android === "shipped"
        ? "Yes, on Google Play."
        : "iPhone comes first. The waitlist gets an email when Android is ready.",
  },
]

export default function Home() {
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
            <a href="#how">How it works</a>
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
            <div className="hero-copy">
              <h1 id="hero-title">
                Say it. <em>It's tracked.</em>
              </h1>
              <p className="lede">
                Tell Fern what happened in one sentence. It lands in the right
                place, in one app instead of five.
              </p>
              <div className="hero-cta">
                <PrimaryCta id="hero-cta" />
              </div>
            </div>
            <div className="hero-visual">
              <div className="hero-tilt" data-tilt="5">
                <HeroVideo />
              </div>
            </div>
          </div>
        </section>

        {/* Act one, the problem. */}
        <ProblemSection />

        {/* Act two, the solution: the pinned, scroll-scrubbed story. */}
        <ScrollStory />

        {/* Features grid. */}
        <section
          id="features"
          aria-labelledby="features-title"
          style={{ paddingTop: 0 }}
        >
          <div className="wrap">
            <div className="section-head reveal">
              <h2 className="h2" id="features-title">
                Seven areas of your day. One way in.
              </h2>
            </div>
            <ul className="features">
              {FEATURES.map((f) => (
                <li
                  key={f.name}
                  className={`feature reveal ${f.fern ? "fern-card" : ""}`}
                  data-tilt="5"
                  style={{ ["--k" as string]: f.k }}
                >
                  <span className="feature-head">
                    <span className="tile">{f.icon}</span>
                    <h3>{f.name}</h3>
                  </span>
                  <span className="say">“{f.say}”</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Act three, the showcase: Fern, streaks, sharing, privacy. */}
        <FernScene />

        {/* Grace day and the way back (PR 331). */}
        <section id="way-back" aria-labelledby="wayback-title">
          <div className="wrap wayback-grid">
            <div className="reveal">
              <div data-speed="0.25">
                <StreakRing />
              </div>
            </div>
            <div className="reveal">
              <h2 className="h2" id="wayback-title">
                Miss a day. Keep the run going.
              </h2>
              <p className="lede">
                One missed day is covered by a grace day. Away longer? Tell Fern
                what happened, and your streaks pause instead of ending.
              </p>
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
              <h2 className="h2" id="privacy-title">
                Your life, on your phone first.
              </h2>
            </div>
            <ul className="privacy-list">
              <li className="reveal">
                <Smartphone aria-hidden />
                <h3>Saved on your phone first</h3>
              </li>
              <li className="reveal">
                <RefreshCw aria-hidden />
                <h3>A copy syncs, so Fern can answer</h3>
              </li>
              <li className="reveal">
                <CloudOff aria-hidden />
                <h3>
                  No-account mode
                  {FEATURE_STATUS.localOnlyMode === "coming-soon" && (
                    <span className="soon">Coming soon</span>
                  )}
                </h3>
              </li>
              <li className="reveal">
                <Download aria-hidden />
                <h3>Export everything, free</h3>
              </li>
            </ul>
          </div>
        </section>

        <ShareScene />

        {/* Research: the customer interview. Secondary on purpose: an
            outline button, so it never competes with the waitlist. */}
        <div className="shape-band">
          <div className="wrap shape-inner reveal">
            <h2>Quit a tracking app before? Help shape Unfurl.</h2>
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
              <h2 className="h2" id="pricing-title">
                {SHOW_PRICES
                  ? "Free to start. About a sixth of the five-app stack."
                  : "Free to start."}
              </h2>
            </div>
            {SHOW_PRICES ? (
              <>
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
                    </article>
                  ))}
                </div>
                {/* Phones show each plan as one row; this line carries what
                    the plan cards list on wider screens. */}
                <p className="plus-adds">
                  Plus adds Fern for everyday logging, questions about your
                  whole history and Life Score breakdowns.
                </p>
                <div className="pricing-foot reveal">
                  <p>{FAIR_USE}</p>
                  <p>{STUDENT_NOTE}</p>
                  <p>{REGIONAL_NOTE}</p>
                </div>
              </>
            ) : (
              <div className="reveal">
                <p className="lede">Paid plans are announced before launch.</p>
              </div>
            )}
          </div>
        </section>

        {/* FAQ. */}
        <section id="faq" aria-labelledby="faq-title">
          <div className="wrap">
            <div className="section-head reveal">
              <h2 className="h2" id="faq-title">
                Straight answers.
              </h2>
            </div>
            <dl className="faq">
              {FAQ.map((f) => (
                <div key={f.q} className="reveal">
                  <dt>{f.q}</dt>
                  <dd>{f.a}</dd>
                </div>
              ))}
            </dl>
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
            <div data-speed="0.3">
              <Fern mood="celebrating" still />
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
      <Reveal />
      <ScrollFx />
    </>
  )
}
