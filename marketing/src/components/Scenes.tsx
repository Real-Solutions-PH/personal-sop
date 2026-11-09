"use client"

import {
  BellRing,
  Check,
  Dumbbell,
  Flame,
  ListChecks,
  Target,
  Utensils,
  Wallet,
} from "lucide-react"
import { type ReactNode, type RefObject, useEffect, useRef } from "react"
import { STACK } from "@/config/pricing"
import { loadMotion } from "@/lib/motion"
import { Fern, type FernMood } from "./Fern"

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
// studies), ordered by how broad the evidence is. A pinned scene: each
// stretch of scroll plays one reason inside a small app screen, first the
// way it goes wrong elsewhere, then Unfurl's way in the same spot. Without
// motion, the four reasons and their answers read as a plain list.
const AREA = {
  fit: { name: "Fitness", icon: <Dumbbell />, k: "var(--fit)" },
  nut: { name: "Nutrition", icon: <Utensils />, k: "var(--nut)" },
  fin: { name: "Money", icon: <Wallet />, k: "var(--fin)" },
  hab: { name: "Habits", icon: <Target />, k: "var(--hab)" },
  tsk: { name: "Tasks", icon: <ListChecks />, k: "var(--tsk)" },
}
type AreaKey = keyof typeof AREA

const Tile = ({ a }: { a: AreaKey }) => (
  <span className="rs-tile" style={{ ["--k" as string]: AREA[a].k }}>
    {AREA[a].icon}
  </span>
)

const Week = ({ last }: { last: ReactNode }) => (
  <span className="rs-week rs-i" aria-hidden="true">
    {[0, 1, 2, 3, 4, 5].map((d) => (
      <i key={d} />
    ))}
    {last}
  </span>
)

const REASONS: {
  problem: string
  answer: string
  old: ReactNode
  next: ReactNode
}[] = [
  {
    problem: "Logging turns into a chore.",
    answer: "Say one sentence. Fern files every part.",
    old: (
      <>
        <small className="rs-cap rs-i">5 apps, 5 forms</small>
        {(
          [
            ["fit", "Sets, reps, distance"],
            ["nut", "Search a food"],
            ["fin", "Amount, category"],
            ["hab", "Mark done"],
            ["tsk", "Add a task"],
          ] as [AreaKey, string][]
        ).map(([a, hint]) => (
          <span key={a} className="rs-form rs-i">
            <Tile a={a} />
            <b>{AREA[a].name}</b>
            <span className="rs-field">{hint}</span>
          </span>
        ))}
      </>
    ),
    next: (
      <>
        <small className="rs-cap rs-i">One sentence</small>
        <span className="rs-say rs-i">
          <Fern mood="listening" size={44} />
          <span className="rs-bubble">“Ran 5k, spent $12 on lunch.”</span>
        </span>
        <span className="rs-landed">
          {(["fit", "nut", "fin"] as AreaKey[]).map((a) => (
            <span key={a} className="rs-chip rs-i">
              <Tile a={a} />
              {AREA[a].name}
              <Check className="rs-ok" aria-hidden="true" />
            </span>
          ))}
        </span>
      </>
    ),
  },
  {
    problem: "One missed day wipes the streak.",
    answer: "A grace day covers it.",
    old: (
      <>
        <small className="rs-cap rs-i">Morning workout</small>
        <Week last={<i className="rs-miss" />} />
        <span className="rs-count bad rs-i">
          <Flame aria-hidden="true" />
          <span className="tnum">0</span>
        </span>
        <small className="rs-sub rs-i">Streak reset · was 47</small>
      </>
    ),
    next: (
      <>
        <small className="rs-cap rs-i">Morning workout</small>
        <Week last={<i className="rs-grace" />} />
        <span className="rs-count good rs-i">
          <Flame aria-hidden="true" />
          <span className="tnum">47</span>
        </span>
        <span className="rs-chip rs-i">Grace day used</span>
      </>
    ),
  },
  {
    problem: "Quick logging you can't trust.",
    answer: "See where each part landed, and undo it.",
    old: (
      <>
        <small className="rs-cap rs-i">Meal photo</small>
        <span className="rs-meal rs-i">
          <Tile a="nut" />
          <b>Lunch</b>
          <span className="tnum">1,240 kcal</span>
          <span className="rs-q">?</span>
        </span>
        <small className="rs-sub rs-i">No way to check it, or fix it</small>
      </>
    ),
    next: (
      <>
        <small className="rs-cap rs-i">Meal photo</small>
        <span className="rs-meal good rs-i">
          <Tile a="nut" />
          <b>Lunch</b>
          <span>
            about <span className="tnum">640 kcal</span>
          </span>
        </span>
        <span className="rs-landed">
          <span className="rs-chip rs-i">
            <Check className="rs-ok" aria-hidden="true" />
            Landed in Nutrition
          </span>
          <span className="rs-chip rs-undo rs-i">Undo</span>
        </span>
      </>
    ),
  },
  {
    problem: "Reminders start to scold.",
    answer: "Fern notices what you did. It doesn't nag.",
    old: (
      <>
        <span className="rs-note rs-i">
          <BellRing aria-hidden="true" />
          You missed your goal. Again.
        </span>
        <span className="rs-note rs-i">
          <BellRing aria-hidden="true" />
          Don't break your streak!
        </span>
        <span className="rs-note rs-i">
          <BellRing aria-hidden="true" />3 reminders ignored
        </span>
      </>
    ),
    next: (
      <>
        <span className="rs-fern rs-i">
          <Fern mood="celebrating" size={128} />
        </span>
        <span className="rs-bubble rs-i">“Twelve days in a row.”</span>
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
      const olds = Array.from(p.querySelectorAll<HTMLElement>(".rs-o .rs-i"))
      const news = Array.from(p.querySelectorAll<HTMLElement>(".rs-n .rs-i"))
      const fix = lines[i].querySelector(".rs-fix")
      gsap.set(news, { autoAlpha: 0, y: 14, scale: 0.96 })
      gsap.set(fix, { autoAlpha: 0, y: 8 })
      if (i > 0) {
        tl.to(panels[i - 1], { autoAlpha: 0, y: -24, duration: 0.2 }, at)
        tl.to(lines[i - 1], { autoAlpha: 0, y: -16, duration: 0.2 }, at)
        tl.to(panels[i], { autoAlpha: 1, y: 0, duration: 0.25 }, at + 0.1)
        tl.to(lines[i], { autoAlpha: 1, y: 0, duration: 0.25 }, at + 0.1)
        tl.to(dots[i], { opacity: 1, duration: 0.15 }, at + 0.1)
      }
      // The problem builds up, piece by piece.
      tl.from(
        olds,
        { autoAlpha: 0, y: 14, stagger: 0.05, duration: 0.15 },
        at + (i > 0 ? 0.2 : 0),
      )
      // Then it clears, and Unfurl's way takes its place.
      tl.to(
        olds,
        { autoAlpha: 0, scale: 0.94, stagger: 0.02, duration: 0.12 },
        at + 0.55,
      )
      tl.to(
        news,
        { autoAlpha: 1, y: 0, scale: 1, stagger: 0.06, duration: 0.18 },
        at + 0.65,
      )
      tl.to(fix, { autoAlpha: 1, y: 0, duration: 0.15 }, at + 0.65)
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
                  <span className="rs-fix">
                    <Check aria-hidden="true" />
                    {r.answer}
                  </span>
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
                  <div className="rs-o">{r.old}</div>
                  <div className="rs-n">{r.next}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

const MOODS: { id: FernMood; when: string; line: string }[] = [
  {
    id: "listening",
    when: "While you talk",
    line: "Go on. I'm getting all of it.",
  },
  {
    id: "thinking",
    when: "While it files",
    line: "Lunch to money, bench to today's workout.",
  },
  {
    id: "speaking",
    when: "When you ask",
    line: "$86 on food since Monday, $14 more than last week.",
  },
  {
    id: "celebrating",
    when: "When you finish",
    line: "Today's plan is done. Twelve days in a row.",
  },
  {
    id: "consoling",
    when: "When a day slips",
    line: "Missed yesterday. Your grace day covered it.",
  },
]

// Showcase: Fern. Each stretch of scroll moves Fern to its next mood, with
// the line it says at that moment.
export function FernScene() {
  const root = useRef<HTMLElement>(null)
  useScene(root, (gsap, q, tl) => {
    const ferns = q(".fs-fern")
    const lines = q(".fs-line")
    const dots = q(".fs-dots i")
    gsap.set(ferns.slice(1), { autoAlpha: 0, scale: 0.85 })
    gsap.set(lines.slice(1), { autoAlpha: 0, y: 16 })
    gsap.set(dots.slice(1), { opacity: 0.25 })
    for (let i = 1; i < ferns.length; i++) {
      const at = i
      tl.to(ferns[i - 1], { autoAlpha: 0, scale: 0.85, duration: 0.3 }, at)
      tl.to(lines[i - 1], { autoAlpha: 0, y: -16, duration: 0.3 }, at)
      tl.to(ferns[i], { autoAlpha: 1, scale: 1, duration: 0.4 }, at + 0.15)
      tl.to(lines[i], { autoAlpha: 1, y: 0, duration: 0.4 }, at + 0.15)
      tl.to(dots[i], { opacity: 1, duration: 0.2 }, at + 0.15)
    }
    tl.to({}, { duration: 0.6 })
  })

  return (
    <section
      ref={root}
      id="fern"
      className="scene"
      aria-labelledby="fern-title"
      style={{ ["--beats" as string]: MOODS.length }}
    >
      <div className="sc-track">
        <div className="sc-stage sc-split wrap">
          <div className="fs-copy">
            <h2 className="h2" id="fern-title" data-no-split>
              A companion that notices, and never nags.
            </h2>
            <ol className="fs-lines">
              {MOODS.map((m) => (
                <li key={m.id} className="fs-line">
                  <small>{m.when}</small>
                  {m.line}
                </li>
              ))}
            </ol>
            <span className="fs-dots" aria-hidden="true">
              {MOODS.map((m) => (
                <i key={m.id} />
              ))}
            </span>
          </div>
          <div className="fs-stage" aria-hidden="true">
            {MOODS.map((m) => (
              <span key={m.id} className="fs-fern">
                <Fern mood={m.id} size={380} />
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

// The real share cards, rendered from the app itself (mobile/src/prototype,
// the share composer's Fern ground) and saved as images.
const CARDS = [
  { src: "/share/tasks.webp", alt: "Share card: 22 tasks done this week" },
  {
    src: "/share/habits.webp",
    alt: "Share card: Morning workout, a 15-day streak, its longest yet",
  },
  {
    src: "/share/finance.webp",
    alt: "Share card: savings rate 32%, down 6 points on September",
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
              Every area makes a card for your story, for the win and the miss.
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
                width={520}
                height={924}
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
