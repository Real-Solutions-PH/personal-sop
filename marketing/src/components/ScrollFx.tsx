"use client"

import { useEffect } from "react"
import { finePointer, loadMotion } from "@/lib/motion"

// Wraps every word of a heading in a span so it can light up as the heading
// scrolls into place. Walks text nodes only, so inline elements such as <em>
// keep their styling, and the words stay real text for screen readers.
function splitWords(el: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = []
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)
  for (const node of nodes) {
    const parts = (node.textContent ?? "").split(/(\s+)/)
    const frag = document.createDocumentFragment()
    for (const part of parts) {
      if (!part) continue
      if (/^\s+$/.test(part)) {
        frag.append(part)
        continue
      }
      const span = document.createElement("span")
      span.className = "fx-word"
      span.textContent = part
      frag.append(span)
      out.push(span)
    }
    node.replaceWith(frag)
  }
  return out
}

// Page-wide scroll effects, all driven by GSAP ScrollTrigger once it loads:
// a reading-progress bar, section headings that light up word by word,
// parallax depth on elements marked `data-speed`, and a pointer tilt on
// elements marked `data-tilt`. Nothing here hides content before it runs, so the
// page reads the same without it.
export function ScrollFx() {
  useEffect(() => {
    let ctx: { revert: () => void } | null = null
    const offs: (() => void)[] = []
    let dead = false

    loadMotion().then((m) => {
      if (!m || dead) return
      const { gsap } = m
      ctx = gsap.context(() => {
        gsap.to(".fx-progress", {
          scaleX: 1,
          ease: "none",
          scrollTrigger: { start: 0, end: "max", scrub: 0.3 },
        })

        for (const h of gsap.utils.toArray<HTMLElement>(
          "main .h2:not([data-no-split])",
        )) {
          const words = splitWords(h)
          gsap.fromTo(
            words,
            // Starts at half strength, not near zero: a heading read
            // mid-reveal still clears 3:1 contrast for large text.
            { opacity: 0.5, y: "0.25em" },
            {
              opacity: 1,
              y: 0,
              stagger: 0.08,
              ease: "none",
              scrollTrigger: {
                trigger: h,
                start: "top 88%",
                end: "top 52%",
                scrub: 0.4,
              },
            },
          )
        }

        for (const el of gsap.utils.toArray<HTMLElement>("[data-speed]")) {
          const speed = Number(el.dataset.speed) || 0
          gsap.fromTo(
            el,
            { y: () => speed * 120 },
            {
              y: () => -speed * 120,
              ease: "none",
              scrollTrigger: {
                trigger: el,
                start: "top bottom",
                end: "bottom top",
                scrub: true,
                invalidateOnRefresh: true,
              },
            },
          )
        }

        // The hero film leans back and drifts slower than the page as you
        // scroll past it.
        gsap.to(".hero-visual .phone", {
          rotateX: 14,
          yPercent: 8,
          scale: 0.94,
          ease: "none",
          scrollTrigger: {
            trigger: ".hero",
            start: "top top",
            end: "bottom top",
            scrub: true,
          },
        })

        if (finePointer()) {
          for (const el of gsap.utils.toArray<HTMLElement>("[data-tilt]")) {
            const max = Number(el.dataset.tilt) || 6
            gsap.set(el, { transformPerspective: 900 })
            const rx = gsap.quickTo(el, "rotateX", {
              duration: 0.5,
              ease: "power3",
            })
            const ry = gsap.quickTo(el, "rotateY", {
              duration: 0.5,
              ease: "power3",
            })
            const move = (e: PointerEvent) => {
              // Wait for a card's fade-up to finish, then drop its CSS
              // transition so the tilt follows the pointer directly.
              if (el.classList.contains("reveal")) {
                if (!el.classList.contains("in")) return
                el.style.transition = "none"
              }
              const r = el.getBoundingClientRect()
              ry(((e.clientX - r.left) / r.width - 0.5) * max * 2)
              rx(-((e.clientY - r.top) / r.height - 0.5) * max * 2)
            }
            const leave = () => {
              rx(0)
              ry(0)
            }
            el.addEventListener("pointermove", move)
            el.addEventListener("pointerleave", leave)
            offs.push(() => {
              el.removeEventListener("pointermove", move)
              el.removeEventListener("pointerleave", leave)
            })
          }
        }
      })
    })

    return () => {
      dead = true
      for (const off of offs) off()
      ctx?.revert()
    }
  }, [])

  return <div className="fx-progress" aria-hidden="true" />
}
