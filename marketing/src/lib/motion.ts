import type { gsap as Gsap } from "gsap"
import type { ScrollTrigger as ST } from "gsap/ScrollTrigger"

export type Motion = { gsap: typeof Gsap; ScrollTrigger: typeof ST }

let pending: Promise<Motion | null> | null = null

// Loads GSAP and ScrollTrigger once, after the page has finished loading, so
// the animation library never competes with the first paint or the hero
// poster. Resolves to null under reduced motion (nothing animates then), and
// drops the pinned layout if the library fails to arrive, so the story falls
// back to plain stacked content instead of a long empty scroll.
export function loadMotion(): Promise<Motion | null> {
  if (pending) return pending
  pending = new Promise((resolve) => {
    const root = document.documentElement
    if (!root.classList.contains("motion-ok")) {
      resolve(null)
      return
    }
    const go = () => {
      Promise.all([import("gsap"), import("gsap/ScrollTrigger")])
        .then(([{ gsap }, { ScrollTrigger }]) => {
          gsap.registerPlugin(ScrollTrigger)
          root.classList.add("motion-live")
          resolve({ gsap, ScrollTrigger })
        })
        .catch(() => {
          root.classList.remove("motion-ok")
          resolve(null)
        })
    }
    if (document.readyState === "complete") go()
    else window.addEventListener("load", go, { once: true })
  })
  return pending
}

// True on devices with a mouse or trackpad. Pointer tilt is skipped on touch,
// where there is no hover and a finger would fight the scroll.
export const finePointer = () =>
  window.matchMedia("(hover: hover) and (pointer: fine)").matches
