import { useCallback, useRef } from "react"

// One-finger swipe recogniser on touch events. Pointer events can't do this:
// once the browser starts a native scroll it cancels them, and touch-action
// can't be decided per gesture. Here the axis locks on the first real move;
// a claimed gesture preventDefaults every move so the page doesn't scroll.
// ponytail: touch only — mouse and keyboard users have the buttons.

export type Axis = "x" | "y"

export interface SwipeHandlers {
  /** Take this gesture? Called once, when the axis locks. */
  claim: (g: {
    axis: Axis
    dx: number
    dy: number
    x0: number
    target: Element
  }) => boolean
  move?: (dx: number, dy: number) => void
  /** v = release velocity in px/ms along the locked axis. */
  end?: (dx: number, dy: number, v: number) => void
}

const LOCK = 8 // px before the axis is decided

export function axisOf(dx: number, dy: number): Axis | null {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < LOCK) return null
  return Math.abs(dx) > Math.abs(dy) ? "x" : "y"
}

/** Past `dist`, or flicked fast in the same direction. */
export function passed(d: number, v: number, dist: number): boolean {
  return (
    Math.abs(d) >= dist || (Math.abs(v) > 0.5 && Math.sign(v) === Math.sign(d))
  )
}

/**
 * Anything between target and root that should keep this gesture for itself:
 * form fields, drag grips (.touch-none), [data-noswipe], a horizontal scroller
 * (for x), or a vertical scroller not at its top (for a downward y).
 */
export function blocked(target: Element, root: Element, axis: Axis): boolean {
  if (
    target.closest(
      "input, textarea, select, [contenteditable], .touch-none, [data-noswipe]",
    )
  )
    return true
  for (let el: Element | null = target; el; el = el.parentElement) {
    const s = getComputedStyle(el)
    if (
      axis === "x" &&
      /auto|scroll/.test(s.overflowX) &&
      el.scrollWidth > el.clientWidth
    )
      return true
    if (axis === "y" && /auto|scroll/.test(s.overflowY) && el.scrollTop > 0)
      return true
    if (el === root) break
  }
  return false
}

// Nested recognisers (a row inside a swipeable page): the innermost listener
// sees each event first, and whoever claims owns the gesture.
let owner: object | null = null

/** Returns a callback ref; attach it to the element that receives the swipe. */
export function useSwipe(handlers: SwipeHandlers) {
  const h = useRef(handlers)
  h.current = handlers
  return useCallback((el: HTMLElement | null) => {
    if (!el) return
    const me = {}
    let x0 = 0
    let y0 = 0
    let target: Element | null = null
    let axis: Axis | null = null
    let mine = false
    let last = { t: 0, x: 0, y: 0 }
    let v = 0

    const start = (e: TouchEvent) => {
      if (e.touches.length > 1) {
        target = null
        return
      }
      owner = null
      const t = e.touches[0]
      x0 = t.clientX
      y0 = t.clientY
      target = e.target as Element
      axis = null
      mine = false
      last = { t: e.timeStamp, x: x0, y: y0 }
      v = 0
    }
    const move = (e: TouchEvent) => {
      if (!target) return
      const t = e.touches[0]
      const dx = t.clientX - x0
      const dy = t.clientY - y0
      if (!axis) {
        axis = axisOf(dx, dy)
        if (!axis) return
        mine =
          owner === null &&
          e.cancelable &&
          h.current.claim({ axis, dx, dy, x0, target })
        if (!mine) {
          target = null
          return
        }
        owner = me
      }
      e.preventDefault()
      const dt = e.timeStamp - last.t
      if (dt > 0)
        v = axis === "x" ? (t.clientX - last.x) / dt : (t.clientY - last.y) / dt
      last = { t: e.timeStamp, x: t.clientX, y: t.clientY }
      h.current.move?.(dx, dy)
    }
    const stop = (e: TouchEvent) => {
      if (!target || !mine) return
      const t = e.changedTouches[0]
      target = null
      mine = false
      if (owner === me) owner = null
      // A pause before lifting isn't a flick.
      if (e.timeStamp - last.t > 100) v = 0
      h.current.end?.(
        t.clientX - x0,
        t.clientY - y0,
        e.type === "touchcancel" ? 0 : v,
      )
    }

    el.addEventListener("touchstart", start, { passive: true })
    el.addEventListener("touchmove", move, { passive: false })
    el.addEventListener("touchend", stop)
    el.addEventListener("touchcancel", stop)
    return () => {
      el.removeEventListener("touchstart", start)
      el.removeEventListener("touchmove", move)
      el.removeEventListener("touchend", stop)
      el.removeEventListener("touchcancel", stop)
    }
  }, [])
}
