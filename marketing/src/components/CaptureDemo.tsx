"use client"

import {
  BookOpen,
  Check,
  Dumbbell,
  ListChecks,
  Target,
  Timer,
  Undo2,
  Utensils,
  Wallet,
} from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { Fern } from "./Fern"

type Rec = {
  kind: "fin" | "fit" | "tsk" | "nut" | "hab" | "jnl" | "foc"
  icon: ReactNode
  what: string
  detail: string
  value: string
  // The words in the sentence this record came from.
  from: string
}

type Example = { label: string; sentence: string; records: Rec[] }

// Each example is a sentence a person might say, and the records Fern files
// from it. Every record quotes the words it came from, as the app does.
const EXAMPLES: Example[] = [
  {
    label: "After the gym",
    sentence:
      "spent 12 on lunch, bench 3x8 at 60kg, remind me to submit the budget draft at 5",
    records: [
      {
        kind: "fin",
        icon: <Wallet aria-hidden />,
        what: "Expense",
        detail: "Food · today 12:41",
        value: "$12.00",
        from: "spent 12 on lunch",
      },
      {
        kind: "fit",
        icon: <Dumbbell aria-hidden />,
        what: "Bench press",
        detail: "Workout · added to today",
        value: "3 × 8 @ 60 kg",
        from: "bench 3x8 at 60kg",
      },
      {
        kind: "tsk",
        icon: <ListChecks aria-hidden />,
        what: "Submit the budget draft",
        detail: "Task · reminder set",
        value: "17:00",
        from: "submit the budget draft at 5",
      },
    ],
  },
  {
    label: "Morning",
    sentence:
      "drank 2 glasses of water, oats with banana for breakfast, read 20 pages",
    records: [
      {
        kind: "hab",
        icon: <Target aria-hidden />,
        what: "Drink water",
        detail: "Habit · checked off",
        value: "2 / 8",
        from: "2 glasses of water",
      },
      {
        kind: "nut",
        icon: <Utensils aria-hidden />,
        what: "Oats with banana",
        detail: "Breakfast · estimate",
        value: "about 380 kcal",
        from: "oats with banana for breakfast",
      },
      {
        kind: "hab",
        icon: <Target aria-hidden />,
        what: "Read",
        detail: "Habit · checked off",
        value: "20 pages",
        from: "read 20 pages",
      },
    ],
  },
  {
    label: "End of day",
    sentence: "focus 25 on the report, paid rent 950, felt calm after the walk",
    records: [
      {
        kind: "foc",
        icon: <Timer aria-hidden />,
        what: "The report",
        detail: "Focus timer · started now",
        value: "25 min",
        from: "focus 25 on the report",
      },
      {
        kind: "fin",
        icon: <Wallet aria-hidden />,
        what: "Rent",
        detail: "Bill · Housing",
        value: "$950.00",
        from: "paid rent 950",
      },
      {
        kind: "jnl",
        icon: <BookOpen aria-hidden />,
        what: "Journal",
        detail: "Entry · today",
        value: "1 entry",
        from: "felt calm after the walk",
      },
    ],
  },
]

const KIND_VAR: Record<Rec["kind"], string> = {
  fin: "var(--fin)",
  fit: "var(--fit)",
  tsk: "var(--tsk)",
  nut: "var(--nut)",
  hab: "var(--hab)",
  jnl: "var(--jnl)",
  foc: "var(--foc)",
}

type Phase = "typing" | "thinking" | "filed"

// The "say it, it's tracked" moment: a sentence types out, Fern thinks, and
// three structured records land, each quoting its words. Plays when scrolled
// into view, holds once filed, and only moves again when the person picks
// another example. Under reduced motion it shows the filed state at once.
export function CaptureDemo() {
  const [i, setI] = useState(0)
  const [typed, setTyped] = useState(0)
  const [phase, setPhase] = useState<Phase>("typing")
  const [started, setStarted] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const ex = EXAMPLES[i]

  useEffect(() => {
    const el = box.current
    if (!el) return
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setStarted(true)
          io.disconnect()
        }
      },
      { threshold: 0.35 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!started) return
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const full = EXAMPLES[i].sentence.length
    if (reduce) {
      setTyped(full)
      setPhase("filed")
      return
    }
    setTyped(0)
    setPhase("typing")
    let n = 0
    const timers: number[] = []
    const tick = window.setInterval(() => {
      n += 1
      setTyped(n)
      if (n >= full) {
        window.clearInterval(tick)
        setPhase("thinking")
        timers.push(window.setTimeout(() => setPhase("filed"), 650))
      }
    }, 28)
    return () => {
      window.clearInterval(tick)
      for (const t of timers) window.clearTimeout(t)
    }
  }, [i, started])

  const filed = phase === "filed"

  return (
    <div className="demo-grid">
      <div>
        <h2 className="h2" id="demo-title">
          One sentence in. Three records out.
        </h2>
        <p className="lede">Type it, say it or snap a photo.</p>
        <fieldset
          className="examples"
          style={{ border: 0, padding: 0, margin: "24px 0 0" }}
        >
          <legend className="sr-only">Pick a sentence to try</legend>
          {EXAMPLES.map((e, k) => (
            <button
              key={e.label}
              type="button"
              className="example"
              aria-pressed={k === i}
              onClick={() => {
                setStarted(true)
                setI(k)
              }}
            >
              {e.label}
            </button>
          ))}
        </fieldset>
      </div>

      <div ref={box} className="chat">
        <div className="chat-head">
          <Fern mood={phase === "filed" ? "speaking" : "listening"} size={40} />
          <div>
            <b>Fern</b>
            <small>
              {phase === "typing"
                ? "Listening…"
                : phase === "thinking"
                  ? "Logging…"
                  : "Your companion"}
            </small>
          </div>
        </div>
        <p className="bubble-me">
          <span className="sr-only">You: {ex.sentence}</span>
          <span aria-hidden="true">
            {ex.sentence.slice(0, typed)}
            {phase === "typing" && started && <span className="caret" />}
          </span>
        </p>
        <p className="sr-only" aria-live="polite">
          {filed
            ? `Logged ${ex.records.length} things: ${ex.records.map((r) => `${r.what}, ${r.value}`).join("; ")}.`
            : ""}
        </p>
        <p className={`undo-row ${filed ? "in" : ""}`} aria-hidden="true">
          <span className="lbl">
            <Check aria-hidden /> Logged {ex.records.length} things
          </span>
        </p>
        <ol className="records">
          {ex.records.map((r, k) => (
            <li
              key={`${i}-${r.what}`}
              className={`record ${filed ? "in" : ""}`}
              style={{
                transitionDelay: filed ? `${k * 80}ms` : "0ms",
                ["--k" as string]: KIND_VAR[r.kind],
              }}
            >
              <span className="kind">{r.icon}</span>
              <span className="what">
                {r.what}
                <small>{r.detail}</small>
              </span>
              <span className="val num">{r.value}</span>
              <span className="quote">
                from <mark>“{r.from}”</mark> ·{" "}
                <Undo2
                  aria-hidden
                  style={{
                    width: 13,
                    height: 13,
                    display: "inline",
                    verticalAlign: -2,
                  }}
                />{" "}
                Undo
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
