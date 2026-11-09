"use client"

import {
  BookOpen,
  Check,
  Dumbbell,
  ListChecks,
  Target,
  Timer,
  Utensils,
  Wallet,
} from "lucide-react"
import { Fragment, type ReactNode, useEffect, useRef } from "react"
import { finePointer, loadMotion } from "@/lib/motion"
import { Fern } from "./Fern"

// The sentence, split into the parts Fern files. `k` is the record it becomes;
// words with no `k` are connective and stay in the sentence.
const PARTS: { text: string; k?: number }[] = [
  { text: "ran 5k in 28 min", k: 0 },
  { text: "," },
  { text: "groceries 46.20", k: 1 },
  { text: "," },
  { text: "call mum on sunday", k: 2 },
]

const RECORDS: {
  color: string
  icon: ReactNode
  what: string
  detail: string
  value: string
}[] = [
  {
    color: "var(--fit)",
    icon: <Dumbbell aria-hidden />,
    what: "Run",
    detail: "Workout",
    value: "5 km · 28:00",
  },
  {
    color: "var(--fin)",
    icon: <Wallet aria-hidden />,
    what: "Groceries",
    detail: "Expense · Food",
    value: "$46.20",
  },
  {
    color: "var(--tsk)",
    icon: <ListChecks aria-hidden />,
    what: "Call mum",
    detail: "Task · Sunday",
    value: "Sun",
  },
]

// What the day looks like once the records are filed: one bar per area the
// sentence touched, each filling to its share.
const TODAY: { color: string; label: string; value: string; fill: number }[] = [
  {
    color: "var(--fit)",
    label: "Training",
    value: "1 of 1 today",
    fill: 1,
  },
  {
    color: "var(--fin)",
    label: "Food budget",
    value: "$46 of $80",
    fill: 0.58,
  },
  { color: "var(--tsk)", label: "Tasks", value: "1 for Sunday", fill: 0.34 },
]

// The seven areas, floating around the phone at different depths. In the last
// beat they fold into the phone: five apps' worth of tracking in one place.
const TILES: { color: string; icon: ReactNode; label: string }[] = [
  { color: "var(--hab)", icon: <Target aria-hidden />, label: "Habits" },
  { color: "var(--fin)", icon: <Wallet aria-hidden />, label: "Money" },
  { color: "var(--fit)", icon: <Dumbbell aria-hidden />, label: "Training" },
  { color: "var(--nut)", icon: <Utensils aria-hidden />, label: "Food" },
  { color: "var(--tsk)", icon: <ListChecks aria-hidden />, label: "Tasks" },
  { color: "var(--jnl)", icon: <BookOpen aria-hidden />, label: "Journal" },
  { color: "var(--foc)", icon: <Timer aria-hidden />, label: "Focus" },
]

const STEPS: { title: string; body: string }[] = [
  {
    title: "Say it",
    body: "Type it, say it or snap a photo.",
  },
  {
    title: "Fern files it",
    body: "Each part lands in its place, with Undo.",
  },
  {
    title: "Your day fills in",
    body: "Training, budget and tasks update on their own.",
  },
  {
    title: "Five apps, folded into one",
    body: "One sentence. Nothing to fill in.",
  },
  {
    title: "Ask Fern anything",
    body: "It reads your records and answers with a chart, like asking an assistant about your own data.",
  },
]

// Beat 5: a question, answered from the very records step 2 filed: the
// run joins the 5k history (bar height is the time, shorter is faster; each
// bar is scaled from 26:00 up to the slowest run), and the groceries come off
// this week's food budget ($80 - $46.20 leaves about $34, as step 3 shows).
const RUNS: { d: string; t: string; v: number }[] = [
  { d: "1", t: "29:40", v: 0.9 },
  { d: "2", t: "29:10", v: 0.78 },
  { d: "3", t: "30:05", v: 1 },
  { d: "4", t: "28:50", v: 0.69 },
  { d: "Today", t: "28:00", v: 0.49 },
]

// A pinned, scroll-scrubbed walk through the core loop. The stage stays on
// screen while scrolling plays five beats: the sentence appears word by word,
// splits into three records, the day fills in, and the seven area tiles fold
// into the phone. Scrolling back plays it in reverse.
//
// Without the animation library (reduced motion, or it failed to load) the
// same markup reads as a normal section: the steps as a list and the phone in
// its filed state.
export function ScrollStory() {
  const root = useRef<HTMLElement>(null)

  // Scales the phone and its tiles (drawn on a fixed 460 × 600 box) to fit
  // whatever room the scene has, from a wide laptop to a short phone.
  useEffect(() => {
    const scene = root.current?.querySelector<HTMLElement>(".st-scene")
    const fit = root.current?.querySelector<HTMLElement>(".st-fit")
    if (!scene || !fit) return
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect
      const f = Math.min(1, width / 460, height / 600)
      fit.style.setProperty("--st-scale", f.toFixed(3))
    })
    ro.observe(scene)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const el = root.current
    if (!el) return
    let ctx: { revert: () => void } | null = null
    let off = () => {}
    let dead = false

    loadMotion().then((m) => {
      if (!m || dead) return
      const { gsap, ScrollTrigger } = m
      const q = gsap.utils.selector(el)
      ctx = gsap.context(() => {
        const steps = q(".st-step")
        const words = q(".st-word")
        const records = q(".st-record")
        const tiles = q(".st-tile")
        const bars = q(".st-bar i")

        gsap.set(steps, { autoAlpha: 0, y: 24 })
        gsap.set(steps[0], { autoAlpha: 1, y: 0 })
        gsap.set(words, { autoAlpha: 0, y: 6 })
        gsap.set(records, { autoAlpha: 0, y: -36, scale: 0.86, z: 60 })
        gsap.set(q(".st-hl"), { opacity: 0 })
        gsap.set(q(".st-filed"), { autoAlpha: 0 })
        gsap.set(q(".st-today"), { autoAlpha: 0, y: 40 })
        gsap.set(bars, { scaleX: 0 })
        gsap.set(q(".st-fern"), { autoAlpha: 0, scale: 0.6, y: 20 })
        gsap.set(q(".st-phone"), { rotateY: -26, rotateX: 16, rotateZ: -4 })
        tiles.forEach((t, i) => {
          gsap.set(t, { autoAlpha: 0, scale: 0.7, z: -120 - (i % 3) * 80 })
        })

        const showStep = (tl: gsap.core.Timeline, n: number, at: number) => {
          tl.to(steps, { autoAlpha: 0, y: -24, duration: 0.3 }, at)
          tl.fromTo(
            steps[n],
            { autoAlpha: 0, y: 24 },
            { autoAlpha: 1, y: 0, duration: 0.4 },
            at + 0.15,
          )
          tl.to(
            q(".st-rail i"),
            { scaleY: (n + 1) / STEPS.length, duration: 0.4 },
            at,
          )
        }

        const tl = gsap.timeline({
          defaults: { ease: "power2.out" },
          scrollTrigger: {
            trigger: q(".st-track")[0],
            start: "top top",
            end: "bottom bottom",
            scrub: 0.6,
            invalidateOnRefresh: true,
          },
        })

        // Beat 1: the phone turns toward you, the tiles drift in, the
        // sentence appears word by word.
        tl.to(
          q(".st-phone"),
          { rotateY: -12, rotateX: 8, rotateZ: 0, duration: 1.2 },
          0,
        )
        tl.to(
          tiles,
          { autoAlpha: 1, scale: 1, z: 0, stagger: 0.06, duration: 0.8 },
          0.1,
        )
        tl.to(words, { autoAlpha: 1, y: 0, stagger: 0.08, duration: 0.3 }, 0.4)

        // Beat 2: each part of the sentence lights in its area's colour and
        // drops into its record; the matching tiles pulse.
        showStep(tl, 1, 2)
        tl.to(q(".st-hl"), { opacity: 1, stagger: 0.06, duration: 0.3 }, 2.1)
        tl.to(
          records,
          { autoAlpha: 1, y: 0, scale: 1, z: 0, stagger: 0.25, duration: 0.6 },
          2.2,
        )
        tl.to(q(".st-filed"), { autoAlpha: 1, duration: 0.3 }, 3)
        tl.to(q(".st-phone"), { rotateY: 10, rotateX: 6, duration: 1.6 }, 2)
        tl.to(tiles, { y: (i) => (i % 2 ? -18 : 18), duration: 1.6 }, 2)

        // Beat 3: the records slide up and the day fills in.
        showStep(tl, 2, 4)
        tl.to(q(".st-chat"), { autoAlpha: 0, y: -60, duration: 0.6 }, 4.1)
        tl.to(q(".st-today"), { autoAlpha: 1, y: 0, duration: 0.6 }, 4.3)
        tl.to(
          bars,
          { scaleX: (i) => TODAY[i]?.fill ?? 1, stagger: 0.2, duration: 0.7 },
          4.6,
        )
        tl.to(q(".st-phone"), { rotateY: -6, rotateX: 4, duration: 1.6 }, 4)

        // Beat 4: the tiles fold into the phone, which squares up to face
        // you; Fern celebrates and the ask appears.
        showStep(tl, 3, 6)
        tl.to(
          tiles,
          {
            // Distance from each tile's resting spot to the phone's centre,
            // from layout offsets so earlier transforms don't skew it.
            x: (_i: number, t: HTMLElement) =>
              (t.offsetParent as HTMLElement).offsetWidth / 2 -
              (t.offsetLeft + t.offsetWidth / 2),
            y: (_i: number, t: HTMLElement) =>
              (t.offsetParent as HTMLElement).offsetHeight / 2 -
              (t.offsetTop + t.offsetHeight / 2),
            scale: 0.3,
            autoAlpha: 0,
            stagger: 0.05,
            duration: 0.9,
            ease: "power2.in",
          },
          6,
        )
        tl.to(
          q(".st-phone"),
          { rotateY: 0, rotateX: 0, scale: 1.04, duration: 1 },
          6.2,
        )
        tl.to(
          q(".st-fern"),
          { autoAlpha: 1, scale: 1, y: 0, duration: 0.5, ease: "back.out(2)" },
          6.8,
        )

        // Beat 5: a question, and Fern answers from the records with a chart
        // and what it notices.
        showStep(tl, 4, 8)
        tl.to(
          [q(".st-today"), q(".st-fern")],
          { autoAlpha: 0, y: -40, duration: 0.5 },
          8,
        )
        tl.to(q(".st-phone"), { scale: 1, duration: 0.6 }, 8)
        tl.fromTo(
          q(".st-ask-q"),
          { autoAlpha: 0, y: 20 },
          { autoAlpha: 1, y: 0, duration: 0.4 },
          8.3,
        )
        tl.fromTo(
          q(".st-answer"),
          { autoAlpha: 0, y: 24 },
          { autoAlpha: 1, y: 0, duration: 0.5 },
          8.7,
        )
        tl.fromTo(
          q(".st-week i"),
          { scaleY: 0 },
          { scaleY: 1, stagger: 0.05, duration: 0.4 },
          8.9,
        )
        tl.fromTo(
          q(".st-insight"),
          { autoAlpha: 0, x: -12 },
          { autoAlpha: 1, x: 0, stagger: 0.2, duration: 0.35 },
          9.3,
        )
        tl.to({}, { duration: 0.6 }, 9.9)

        // Pointer tilt on top of the scroll pose, on a separate wrapper so the
        // two never fight over one transform.
        if (finePointer()) {
          const tilt = q(".st-tilt")[0]
          const rx = gsap.quickTo(tilt, "rotateX", {
            duration: 0.6,
            ease: "power3",
          })
          const ry = gsap.quickTo(tilt, "rotateY", {
            duration: 0.6,
            ease: "power3",
          })
          const stage = q(".st-stage")[0] as HTMLElement
          const move = (e: PointerEvent) => {
            const r = stage.getBoundingClientRect()
            ry(((e.clientX - r.left) / r.width - 0.5) * 12)
            rx(-((e.clientY - r.top) / r.height - 0.5) * 10)
          }
          const leave = () => {
            rx(0)
            ry(0)
          }
          stage.addEventListener("pointermove", move)
          stage.addEventListener("pointerleave", leave)
          off = () => {
            stage.removeEventListener("pointermove", move)
            stage.removeEventListener("pointerleave", leave)
          }
        }
        ScrollTrigger.refresh()
      }, el)
    })

    return () => {
      dead = true
      off()
      ctx?.revert()
    }
  }, [])

  return (
    <section
      ref={root}
      id="how"
      className="story"
      aria-labelledby="story-title"
    >
      <div className="st-track">
        <div className="st-stage wrap">
          <div className="st-copy">
            <h2 className="h2" id="story-title">
              One sentence. Watch where it goes.
            </h2>
            <div className="st-steps-wrap">
              <span className="st-rail" aria-hidden="true">
                <i />
              </span>
              <ol className="st-steps">
                {STEPS.map((s, n) => (
                  <li key={s.title} className="st-step">
                    <span className="st-n num">{n + 1}</span>
                    <h3>{s.title}</h3>
                    <p>{s.body}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>

          <div className="st-scene" aria-hidden="true">
            <div className="st-tilt">
              <div className="st-fit">
                {TILES.map((t, i) => (
                  <span
                    key={t.label}
                    className={`st-tile st-tile-${i}`}
                    style={{ ["--k" as string]: t.color }}
                  >
                    {t.icon}
                    {t.label}
                  </span>
                ))}
                <div className="st-phone">
                  <div className="st-screen">
                    <div className="st-bar-top">
                      <b>Today</b>
                      <Fern mood="listening" size={38} />
                    </div>
                    <div className="st-chat">
                      <p className="st-bubble">
                        {PARTS.map((p, i) => {
                          // Words are inline-blocks so they can move; spaces sit
                          // between them, never inside, or they would collapse.
                          const words = p.text.split(" ").map((w, j) => (
                            <Fragment key={`${p.text}-${w}-${j}`}>
                              {j > 0 && " "}
                              <span className="st-word">
                                {p.k !== undefined && <i className="st-hl" />}
                                {w}
                              </span>
                            </Fragment>
                          ))
                          return (
                            <Fragment key={`${p.text}-${i}`}>
                              {i > 0 && p.text !== "," && " "}
                              {p.k === undefined ? (
                                words
                              ) : (
                                <span
                                  className="st-part"
                                  style={{
                                    ["--k" as string]: RECORDS[p.k].color,
                                  }}
                                >
                                  {words}
                                </span>
                              )}
                            </Fragment>
                          )
                        })}
                      </p>
                      <p className="st-filed">
                        <Check aria-hidden /> Logged 3 things
                      </p>
                      <ol className="st-records">
                        {RECORDS.map((r) => (
                          <li
                            key={r.what}
                            className="st-record"
                            style={{ ["--k" as string]: r.color }}
                          >
                            <span className="st-kind">{r.icon}</span>
                            <span className="st-what">
                              {r.what}
                              <small>{r.detail}</small>
                            </span>
                            <span className="st-val num">{r.value}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                    <div className="st-today">
                      {TODAY.map((t) => (
                        <div
                          key={t.label}
                          className="st-bar"
                          style={{ ["--k" as string]: t.color }}
                        >
                          <span className="st-bar-label">
                            {t.label}
                            <small className="num">{t.value}</small>
                          </span>
                          <span className="st-bar-track">
                            <i style={{ transform: `scaleX(${t.fill})` }} />
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="st-fern">
                      <Fern mood="celebrating" size={132} />
                      <span>Nice day. All three are in.</span>
                    </div>
                    <div className="st-ask">
                      <p className="st-bubble st-ask-q">
                        How am I doing this week?
                      </p>
                      <div className="st-answer">
                        <span className="st-answer-head">
                          <Fern mood="speaking" size={36} />
                          <b>Your 5k times</b>
                        </span>
                        <span className="st-week">
                          {RUNS.map((r) => (
                            <span key={r.d} className="st-day">
                              <i
                                className={r.d === "Today" ? "hi" : ""}
                                style={{ height: `${r.v * 100}%` }}
                              >
                                {r.d === "Today" && (
                                  <small className="num">{r.t}</small>
                                )}
                              </i>
                              <small>{r.d}</small>
                            </span>
                          ))}
                        </span>
                        <p className="st-insight">
                          Today's <b className="num">28:00</b> is your fastest
                          5k yet, 1:40 under your first.
                        </p>
                        <p className="st-insight">
                          The groceries leave <b className="num">$34</b> of this
                          week's food budget.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* Screen readers get the story as plain sentences. */}
      <p className="sr-only">
        Example: you type “ran 5k in 28 min, groceries 46.20, call mum on
        sunday”. Fern logs a 5 km run in 28 minutes, a $46.20 grocery expense
        and a task to call mum on Sunday, and your day&apos;s training, food
        budget and tasks update. Ask “How&apos;s my week going?” and Fern
        answers from your records with a chart of food spend per day: $34 under
        budget, and tasks slip on Tuesdays.
      </p>
    </section>
  )
}
