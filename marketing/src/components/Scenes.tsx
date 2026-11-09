"use client"

import { BellRing, Check, Flame } from "lucide-react"
import { type ReactNode, type RefObject, useEffect, useRef } from "react"
import { STACK } from "@/config/pricing"
import { loadMotion } from "@/lib/motion"

type Gsap = NonNullable<Awaited<ReturnType<typeof loadMotion>>>["gsap"]
type Build = (
  gsap: Gsap,
  q: (s: string) => HTMLElement[],
  tl: gsap.core.Timeline,
) => void

// One pinned scene: the stage sticks while its track scrolls past, and a
// scrubbed timeline plays the scene's beats. Nothing is clicked; scrolling
// is the only control. Without the animation library (reduced motion, or it
// failed to load) the same markup reads as a normal section.
function useScene(root: RefObject<HTMLElement | null>, build: Build) {
  // The build function is defined inline by each scene and never changes
  // meaning, so it is read once.
  const buildRef = useRef(build)
  useEffect(() => {
    const el = root.current
    if (!el) return
    let ctx: { revert: () => void } | null = null
    let dead = false
    loadMotion().then((m) => {
      if (!m || dead) return
      const { gsap, ScrollTrigger } = m
      const q = gsap.utils.selector(el) as (s: string) => HTMLElement[]
      ctx = gsap.context(() => {
        const tl = gsap.timeline({
          defaults: { ease: "power2.out" },
          scrollTrigger: {
            trigger: q(".sc-track")[0],
            start: "top top",
            end: "bottom bottom",
            scrub: 0.6,
            invalidateOnRefresh: true,
          },
        })
        buildRef.current(gsap, q, tl)
        ScrollTrigger.refresh()
      }, el)
    })
    return () => {
      dead = true
      ctx?.revert()
    }
  }, [root])
}

const usd = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
  })

// Act one, the problem: five apps, five prices, each struck out, and what
// they cost together. A still section; nothing animates.
export function ProblemSection() {
  return (
    <section id="why" aria-labelledby="why-title">
      <div className="wrap sc-center why">
        <h2 className="h2" id="why-title" data-no-split>
          You didn't fail at tracking. Five apps did.
        </h2>
        <div className="why-stack">
          <ul className="stack-list" aria-label="A typical tracker stack">
            {STACK.apps.map((s) => (
              <li key={s.app}>
                <span>
                  {s.app} <span className="area">{s.area}</span>
                </span>
                <span className="price num">
                  <span className="strike" aria-hidden="true" />
                  {usd(s.perYear)}
                  <span className="per"> / yr</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="stack-total">
            <b>Five apps, five places to log one day</b>
            <span className="num">
              about {usd(STACK.total)}
              <span className="per"> / yr</span>
            </span>
          </div>
          <p className="fine">
            Approximate US prices, checked {STACK.checked}. Prices vary by
            region and change.
          </p>
        </div>
      </div>
    </section>
  )
}

// Act one, part two: the reasons people give for quitting a tracker, from
// the 2026-11-07 research pass (app-store reviews, forum threads, published
// studies), ordered by how broad the evidence is. Problem only: this scene
// builds the frustration up and offers no answer; the next section (the
// scroll story) is where Unfurl comes in. Each stretch of scroll plays one
// reason inside a small app screen: the pieces arrive (`rs-i`), a tally
// counts (`data-count`), then it turns for the worse (`rs-late` arrives,
// `rs-gone` leaves). Without motion it reads as a list of the four reasons.
// Each beat recalls the kind of app people quit, without naming one: the
// food log and budget app's long forms, the streak app's paywall, the photo
// scanner's confident number, the reminder that guilt-trips. Shapes and
// wording are generic; no logo, mascot or brand colour is copied.

// One lunch, logged by hand: a food entry, then the same lunch as an
// expense. Every row is a field to fill or a tap; the tally counts rows.
const LUNCH: { head?: string; label?: string; value?: string; tap?: string }[] =
  [
    { head: "Add food" },
    { label: "Search", value: "chicken rice" },
    { label: "Pick a match", value: "Chicken rice (generic) · 1 cup" },
    { label: "Serving size", value: "1 cup ▾" },
    { label: "Servings", value: "1.5" },
    { label: "Meal", value: "Lunch ▾" },
    { label: "Time", value: "12:40" },
    { tap: "Add" },
    { head: "Add transaction" },
    { label: "Payee", value: "Food stall" },
    { label: "Category", value: "Eating out ▾" },
    { label: "Account", value: "Debit card ▾" },
    { label: "Outflow", value: "12.00" },
    { label: "Memo", value: "lunch" },
    { tap: "Save" },
  ]
const FIELDS = LUNCH.filter((r) => !r.head).length

const NAGS = [
  "You're about to lose your 412-day streak!",
  "These reminders don't seem to work. We'll stop for now.",
  "You haven't logged lunch. Again.",
  "Unlock your insights with Premium.",
]

const REASONS: { problem: string; feel: string; scene: ReactNode }[] = [
  {
    problem: "Logging turns into a chore.",
    feel: "One lunch: a food log, then the same lunch again as an expense.",
    scene: (
      <>
        <span className="rs-tally rs-i">
          <span className="tnum" data-count={FIELDS}>
            0
          </span>
          <small>fields to log one lunch</small>
        </span>
        <span className="rs-window">
          <span className="rs-scroll">
            {LUNCH.map((r, i) =>
              r.head ? (
                <b key={r.head} className="rs-head">
                  {r.head}
                </b>
              ) : r.tap ? (
                <span key={r.tap} className="rs-btn">
                  {r.tap}
                </span>
              ) : (
                <span key={`${r.label}${i}`} className="rs-row">
                  <small>{r.label}</small>
                  <span>{r.value}</span>
                </span>
              ),
            )}
          </span>
        </span>
        <small className="rs-sub bad rs-late">…and that's one lunch.</small>
      </>
    ),
  },
  {
    problem: "One missed day wipes the streak.",
    feel: "Hundreds of days of showing up, gone overnight. Unless you pay.",
    scene: (
      <>
        <span className="rs-swap">
          <span className="rs-count good rs-i rs-gone">
            <Flame aria-hidden="true" />
            <span className="tnum" data-count={412}>
              0
            </span>
          </span>
          <span className="rs-count bad rs-late">
            <Flame aria-hidden="true" />
            <span className="tnum">0</span>
          </span>
        </span>
        <small className="rs-cap rs-i">day streak</small>
        <span className="rs-week" aria-hidden="true">
          {[0, 1, 2, 3, 4, 5].map((d) => (
            <i key={d} className="rs-i" />
          ))}
          <i className="rs-miss rs-late" />
        </span>
        <span className="rs-paywall rs-late">
          <b>Your streak is gone</b>
          <small>Restore all 412 days?</small>
          <span className="rs-btn">Restore with Premium</span>
        </span>
      </>
    ),
  },
  {
    problem: "Quick logging you can't trust.",
    feel: "A confident number from a photo, and no way to check it.",
    scene: (
      <>
        <span className="rs-viewfinder rs-i">
          <span className="rs-plate" />
          <small>Analyzing…</small>
        </span>
        <span className="rs-result rs-i">
          <b>Chicken rice</b>
          <span className="rs-kcal">
            <span className="tnum" data-count={1240}>
              0
            </span>{" "}
            kcal
          </span>
          <small>Protein 38 g · Carbs 160 g · Fat 42 g</small>
        </span>
        <span className="rs-doubts">
          <span className="rs-doubt rs-late">Was that the whole plate?</span>
          <span className="rs-doubt rs-late">What did it count?</span>
          <span className="rs-doubt rs-late">How do I fix it?</span>
        </span>
      </>
    ),
  },
  {
    problem: "Reminders start to scold.",
    feel: "The app that was meant to help starts guilt-tripping you.",
    scene: (
      <>
        <span className="rs-tally rs-i">
          <BellRing aria-hidden="true" />
          <span className="tnum" data-count={12}>
            0
          </span>
          <small>unread reminders</small>
        </span>
        {NAGS.map((n, i) => (
          <span key={n} className={`rs-note ${i < 2 ? "rs-i" : "rs-late"}`}>
            <BellRing aria-hidden="true" />
            {n}
          </span>
        ))}
      </>
    ),
  },
]

export function ReasonsSection() {
  const root = useRef<HTMLElement>(null)
  useScene(root, (gsap, q, tl) => {
    const panels = q(".rs-panel")
    const lines = q(".rs-line")
    const dots = q(".rs-dots i")
    gsap.set(panels.slice(1), { autoAlpha: 0, y: 24 })
    gsap.set(lines.slice(1), { autoAlpha: 0, y: 16 })
    gsap.set(dots.slice(1), { opacity: 0.25 })
    panels.forEach((p, i) => {
      const at = i
      const start = at + (i > 0 ? 0.2 : 0)
      const pieces = Array.from(p.querySelectorAll<HTMLElement>(".rs-i"))
      const late = Array.from(p.querySelectorAll<HTMLElement>(".rs-late"))
      const gone = Array.from(p.querySelectorAll<HTMLElement>(".rs-gone"))
      gsap.set(late, { autoAlpha: 0, scale: 1.08 })
      if (i > 0) {
        tl.to(panels[i - 1], { autoAlpha: 0, y: -24, duration: 0.2 }, at)
        tl.to(lines[i - 1], { autoAlpha: 0, y: -16, duration: 0.2 }, at)
        tl.to(panels[i], { autoAlpha: 1, y: 0, duration: 0.25 }, at + 0.1)
        tl.to(lines[i], { autoAlpha: 1, y: 0, duration: 0.25 }, at + 0.1)
        tl.to(dots[i], { opacity: 1, duration: 0.15 }, at + 0.1)
      }
      // The pieces arrive one by one, and the tally climbs with them.
      tl.from(
        pieces,
        { autoAlpha: 0, y: 14, stagger: 0.04, duration: 0.14 },
        start,
      )
      for (const el of p.querySelectorAll<HTMLElement>("[data-count]")) {
        const n = { v: 0 }
        const to = Number(el.dataset.count)
        tl.to(
          n,
          {
            v: to,
            duration: 0.35,
            ease: "none",
            onUpdate: () => {
              el.textContent = Math.round(n.v).toLocaleString("en-US")
            },
          },
          start,
        )
      }
      // A form longer than the screen scrolls past while its tally climbs.
      for (const sc of p.querySelectorAll<HTMLElement>(".rs-scroll")) {
        const win = sc.parentElement as HTMLElement
        tl.to(
          sc,
          {
            y: () => -Math.max(0, sc.scrollHeight - win.clientHeight),
            duration: 0.45,
            ease: "none",
          },
          start + 0.05,
        )
      }
      // Then it turns for the worse.
      tl.to(gone, { autoAlpha: 0, scale: 0.9, duration: 0.1 }, at + 0.6)
      tl.to(
        late,
        { autoAlpha: 1, scale: 1, stagger: 0.07, duration: 0.14 },
        at + 0.6,
      )
      tl.fromTo(
        p,
        { x: 0 },
        { keyframes: { x: [0, -6, 6, -4, 0] }, duration: 0.12 },
        at + 0.62,
      )
    })
    tl.to({}, { duration: 0.5 })
  })

  return (
    <section
      ref={root}
      id="reasons"
      className="scene"
      aria-labelledby="reasons-title"
      style={{ ["--beats" as string]: REASONS.length }}
    >
      <div className="sc-track">
        <div className="sc-stage sc-split wrap">
          <div className="rs-copy">
            <h2 className="h2" id="reasons-title" data-no-split>
              Why people quit trackers.
            </h2>
            <ol className="rs-lines">
              {REASONS.map((r) => (
                <li key={r.problem} className="rs-line">
                  <b>{r.problem}</b>
                  <span className="rs-feel">{r.feel}</span>
                </li>
              ))}
            </ol>
            <span className="rs-dots" aria-hidden="true">
              {REASONS.map((r) => (
                <i key={r.problem} />
              ))}
            </span>
            <p className="fine rs-src">
              From app-store reviews, forum threads and published studies on why
              people stop tracking.
            </p>
          </div>
          <div className="rs-stage" aria-hidden="true">
            <div className="rs-screen">
              {REASONS.map((r) => (
                <div key={r.problem} className="rs-panel">
                  {r.scene}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

// The real share cards, rendered by the app itself (mobile/src/prototype,
// the share composer's Photo ground) over a picture, the way a person
// shares one: their own photo with the card's numbers on top. The photos
// were generated for the site (Figma AI, 2026-11-09); no real person is shown.
const CARDS = [
  {
    src: "/share/tasks.webp",
    alt: "Share card on a desk photo: 22 tasks done this week",
  },
  {
    src: "/share/habits.webp",
    alt: "Share card on a sunrise run photo: Morning workout, a 16-day streak, its longest yet",
  },
  {
    src: "/share/finance.webp",
    alt: "Share card on a café photo: savings rate 32%, down 6 points on September",
  },
]

// Showcase: sharing. The three cards start as one stack and fan out as you
// scroll; the middle one rises toward you.
export function ShareScene() {
  const root = useRef<HTMLElement>(null)
  useScene(root, (gsap, q, tl) => {
    const [left, mid, right] = q(".sh-card")
    gsap.set([left, right], { xPercent: 0, rotate: 0, z: -80 })
    gsap.set(mid, { z: 0, rotateX: 18, y: 40 })
    tl.to(mid, { rotateX: 0, y: 0, z: 40, duration: 1 }, 0)
    tl.to(
      left,
      {
        xPercent: () => (innerWidth < 900 ? -40 : -52),
        rotate: -8,
        z: -40,
        duration: 1,
      },
      0.3,
    )
    tl.to(
      right,
      {
        xPercent: () => (innerWidth < 900 ? 40 : 52),
        rotate: 8,
        z: -40,
        duration: 1,
      },
      0.3,
    )
    tl.to(q(".sh-win"), { autoAlpha: 1, y: 0, duration: 0.4 }, 0.9)
    tl.to({}, { duration: 0.6 })
  })

  return (
    <section
      ref={root}
      id="community"
      className="scene"
      aria-labelledby="share-title"
      style={{ ["--beats" as string]: 2 }}
    >
      <div className="sc-track">
        <div className="sc-stage sc-split wrap">
          <div>
            <h2 className="h2" id="share-title" data-no-split>
              Share the win, not the spreadsheet.
            </h2>
            <p className="lede">
              Every area makes a card for your story, on your own photo.
            </p>
            <p className="sh-win">
              <Check aria-hidden /> Money cards show shares and ratios, never
              amounts.
            </p>
          </div>
          <div className="sh-fan">
            {CARDS.map((c) => (
              // biome-ignore lint/performance/noImgElement: static export, no image optimiser
              <img
                key={c.src}
                className="sh-card"
                src={c.src}
                alt={c.alt}
                width={732}
                height={1304}
                loading="lazy"
                decoding="async"
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

// Every area as a real app screen: tiles of screenshots. Laptops and tablets
// see them as a grid in one screen; phones, where ten screens cannot fit, see
// two rows that slide sideways as you scroll down.
export function FeatureGallery({
  features,
}: {
  features: {
    k: string
    icon: ReactNode
    name: string
    shot: string
    text: string
  }[]
}) {
  const root = useRef<HTMLElement>(null)
  useScene(root, (_gsap, q, tl) => {
    const strip = q(".gl-strip")[0]
    tl.to(strip, {
      x: () => -Math.max(0, strip.scrollWidth - strip.clientWidth),
      ease: "none",
      duration: 1,
    })
  })
  return (
    <section
      ref={root}
      id="features"
      className="scene gallery"
      aria-labelledby="features-title"
      style={{ ["--beats" as string]: 2 }}
    >
      <div className="sc-track">
        <div className="sc-stage wrap gl-stage">
          <h2 className="h2" id="features-title" data-no-split>
            Every part of your day, in one app.
          </h2>
          <ul className="gl-strip">
            {features.map((f) => (
              <li
                key={f.name}
                className="gl-tile"
                style={{ ["--k" as string]: f.k }}
              >
                {/* biome-ignore lint/performance/noImgElement: static export, no image optimiser */}
                <img
                  src={`/screens/${f.shot}.webp`}
                  alt={`The ${f.name} screen in Unfurl`}
                  width={480}
                  height={1039}
                  loading="lazy"
                  decoding="async"
                />
                <span className="gl-name">
                  {f.icon}
                  {f.name}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
