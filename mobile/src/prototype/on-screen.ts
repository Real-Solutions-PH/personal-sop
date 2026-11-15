// Battery: what is actually in front of the person. Clocks, loops and the
// microphone ask here before they run, so nothing ticks for a screen that
// is covered by another tab, or for an app that is in the background (a
// run recording its route keeps JS alive there).

import { useNavigation } from "expo-router"
import { useEffect, useState } from "react"
import { AppState } from "react-native"

const inForeground = () => AppState.currentState !== "background"

/** False while the app is in the background. A glance at Control Center
 * ("inactive") still counts as on screen. */
export function useAppForeground() {
  const [on, setOn] = useState(inForeground)
  useEffect(() => {
    setOn(inForeground())
    const sub = AppState.addEventListener("change", (s) =>
      setOn(s !== "background"),
    )
    return () => sub.remove()
  }, [])
  return on
}

type FocusNav = {
  isFocused(): boolean
  addListener(type: "focus" | "blur", l: () => void): () => void
}

/** The navigation object of the screen this renders in; null outside a
 * navigator (the root layout's own chrome, a test). */
function useScreenNavigation(): FocusNav | null {
  try {
    // Throws outside a navigator, the same way on every render, so the
    // hooks it calls stay in the same order.
    // biome-ignore lint/correctness/useHookAtTopLevel: see above; a component never moves between inside and outside a navigator
    const nav = useNavigation() as unknown as Partial<FocusNav> | undefined
    return nav && typeof nav.isFocused === "function" && nav.addListener
      ? (nav as FocusNav)
      : null
  } catch {
    return null
  }
}

/** Whether the screen this renders in is the one showing (true outside a
 * navigator). A tab left behind stays mounted, but is not focused. */
export function useScreenFocused() {
  const nav = useScreenNavigation()
  const [focused, setFocused] = useState(() => nav?.isFocused() ?? true)
  useEffect(() => {
    if (!nav) {
      setFocused(true)
      return
    }
    const read = () => setFocused(nav.isFocused())
    read()
    const offFocus = nav.addListener("focus", read)
    const offBlur = nav.addListener("blur", read)
    return () => {
      offFocus()
      offBlur()
    }
  }, [nav])
  return focused
}

/** In the foreground and on the focused screen. */
export function useOnScreen() {
  const app = useAppForeground()
  const focused = useScreenFocused()
  return app && focused
}

// The last touch, navigation or return to the foreground. Idle loops
// (Fern's breathing, the halo) rest once nobody has touched the phone for a
// while, and the "Hey Fern" microphone closes after a longer wait.
let lastActivity = Date.now()
const activityListeners = new Set<() => void>()

/** Someone is using the app: a touch, a new screen, back in front. */
export function noteActivity() {
  lastActivity = Date.now()
  for (const l of activityListeners) l()
}

/** True once there has been no activity for ``ms``; any activity (or the
 * app coming back to the foreground) makes it false again. */
export function useIdle(ms: number) {
  const [idle, setIdle] = useState(false)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const check = () => {
      timer = null
      const left = lastActivity + ms - Date.now()
      if (left > 0) timer = setTimeout(check, left)
      else setIdle(true)
    }
    const wake = () => {
      setIdle(false)
      // The pending check re-reads the time, so a touch never restarts it.
      timer ??= setTimeout(check, ms)
    }
    timer = setTimeout(check, Math.max(0, lastActivity + ms - Date.now()))
    activityListeners.add(wake)
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") noteActivity()
    })
    return () => {
      activityListeners.delete(wake)
      sub.remove()
      if (timer) clearTimeout(timer)
    }
  }, [ms])
  return idle
}
