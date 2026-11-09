"use client"

import { ShieldCheck } from "lucide-react"
import { useEffect, useRef, useState } from "react"

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
// Thursday is the missed day the grace day covered.
const GRACE = 3
const R = 92
const C = 110

// One arc per day of the week. Arcs light up in order when the ring scrolls
// into view (opacity only), so the ring "fills" without animating stroke
// geometry. The grace day is drawn dashed in the warning colour: it counted,
// and it shows.
function arc(i: number) {
  const gap = 11
  const a0 = ((i * 360) / 7 + gap / 2 - 90) * (Math.PI / 180)
  const a1 = (((i + 1) * 360) / 7 - gap / 2 - 90) * (Math.PI / 180)
  const x0 = C + R * Math.cos(a0)
  const y0 = C + R * Math.sin(a0)
  const x1 = C + R * Math.cos(a1)
  const y1 = C + R * Math.sin(a1)
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${R} ${R} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
}

export function StreakRing() {
  const ref = useRef<HTMLDivElement>(null)
  const [lit, setLit] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const timers: number[] = []
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return
        io.disconnect()
        if (reduce) {
          setLit(7)
          return
        }
        for (let k = 1; k <= 7; k++) {
          timers.push(window.setTimeout(() => setLit(k), 120 * k))
        }
      },
      { threshold: 0.5 },
    )
    io.observe(el)
    return () => {
      io.disconnect()
      for (const t of timers) window.clearTimeout(t)
    }
  }, [])

  return (
    <div className="ring-card" ref={ref}>
      <div className="ring">
        <svg viewBox="0 0 220 220" aria-hidden="true">
          {DAYS.map((d, i) => (
            <path
              key={d}
              d={arc(i)}
              className={`seg ${i < lit ? "on" : ""}`}
              fill="none"
              stroke={i === GRACE ? "var(--warn)" : "var(--hab)"}
              strokeWidth="16"
              strokeLinecap="round"
              strokeDasharray={i === GRACE ? "4 7" : undefined}
            />
          ))}
        </svg>
        <div className="center">
          <span className="num">12</span>
          <small className="ring-sub">day run, still going</small>
        </div>
      </div>
      <div
        className="days"
        role="img"
        aria-label="This week: six days done, Thursday missed and covered by a grace day."
      >
        {DAYS.map((d, i) => (
          <span key={d} className={`day ${i === GRACE ? "grace" : ""}`}>
            <i />
            {d}
          </span>
        ))}
      </div>
      <p className="ring-note">
        <ShieldCheck aria-hidden /> Thursday missed · grace day used
      </p>
      <p className="sample">Sample data</p>
    </div>
  )
}
