"use client"

import { ArrowRight } from "lucide-react"
import { useEffect, useState } from "react"
import { CTA } from "@/config/site"

// Appears once the hero's call to action has scrolled away, and steps aside
// while the waitlist form itself is on screen, so there is never a second
// button pointing at a form the person is already looking at.
export function StickyCta() {
  const [heroGone, setHeroGone] = useState(false)
  const [formVisible, setFormVisible] = useState(false)

  useEffect(() => {
    const hero = document.getElementById("hero-cta")
    const form = document.getElementById("waitlist")
    const ios: IntersectionObserver[] = []
    if (hero) {
      const io = new IntersectionObserver(([e]) =>
        setHeroGone(!e.isIntersecting && e.boundingClientRect.top < 0),
      )
      io.observe(hero)
      ios.push(io)
    }
    if (form) {
      const io = new IntersectionObserver(([e]) =>
        setFormVisible(e.isIntersecting),
      )
      io.observe(form)
      ios.push(io)
    }
    return () => {
      for (const io of ios) io.disconnect()
    }
  }, [])

  const show = heroGone && !formVisible
  return (
    <aside className={`sticky-cta ${show ? "show" : ""}`} aria-hidden={!show}>
      <div className="inner">
        <p>
          <b>Say it. It's tracked.</b> {CTA.reassurance}
        </p>
        <a
          className="btn btn-primary"
          href={CTA.appStoreUrl ?? CTA.primaryHref}
          tabIndex={show ? 0 : -1}
        >
          {CTA.appStoreUrl ? "Download on the App Store" : CTA.primaryLabel}
          <ArrowRight aria-hidden />
        </a>
      </div>
    </aside>
  )
}
