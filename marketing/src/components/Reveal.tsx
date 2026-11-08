"use client"

import { useEffect } from "react"

// One observer for every `.reveal` block: each fades up once, the first time
// it scrolls into view. Content is visible without JavaScript (see the `.js`
// guard in globals.css), and reduced motion shows everything at once.
export function Reveal() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>(".reveal"))
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      for (const el of els) el.classList.add("in")
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("in")
            io.unobserve(e.target)
          }
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.05 },
    )
    for (const el of els) io.observe(el)
    return () => io.disconnect()
  }, [])
  return null
}
