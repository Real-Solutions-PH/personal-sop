// The one-time, gentle reintroduction of a part someone hid: a scored
// module switched off, or the Journal or Community. From day 14 after
// sign-up, Today shows one dimmed preview of what a hidden part would add,
// with "Turn on" and "Not for me"; "Not for me" turns that part's
// reintroduction down for good (on the account, so it outlives a
// reinstall). After a "Not for me", the next hidden part waits a day.
import type { ModuleKey } from "@domain/contract"
import { AREA } from "@domain/dash/data"
import { dismissIntro } from "@domain/dash/store"
import { addDays } from "@domain/finance/calc"
import { dayKey } from "@domain/lib/day"
import { createStore } from "@domain/lib/store"
import { type Extra, setShown } from "./extras"

export type IntroKey = ModuleKey | Extract<Extra, "journal" | "social">

/** Days after sign-up before Today reintroduces a hidden part. */
export const INTRO_DAY = 14

export const INTRO_LABEL: Record<IntroKey, string> = {
  ...Object.fromEntries(
    (Object.keys(AREA) as ModuleKey[]).map((k) => [k, AREA[k].label]),
  ),
  journal: "Journal",
  social: "Community",
} as Record<IntroKey, string>

/** What the part would add, in one line. */
export const INTRO_ADDS: Record<IntroKey, string> = {
  habits: "Your daily routines on Today, with a streak for each one.",
  tasks: "What's due today on Today, with reminders at the time you pick.",
  fitness: "Workouts, steps and sleep on Today, and your weigh-in trend.",
  nutrition: "Meals against your calorie and protein target, as you go.",
  focus: "A focus timer that counts deep work against a daily goal.",
  finance: "Spending, bills coming up and budgets on Today.",
  screen: "Your phone time against a daily limit.",
  journal: "A daily mood check-in and notes, so Fern sees how you feel.",
  social: "Friends' wins and yours, and a nudge when someone cheers you on.",
}

export interface IntroInput {
  /** The sign-up day, YYYY-MM-DD. */
  since: string
  today: string
  /** Modules in the person's order, with their switches. */
  order: readonly ModuleKey[]
  enabled: Partial<Record<ModuleKey, boolean>>
  shown: { journal: boolean; social: boolean }
  dismissed: readonly string[]
  /** The day a "Not for me" was last tapped on this phone. */
  pausedOn?: string
}

/** The hidden part Today reintroduces now, or null. Pure. */
export function introCandidate(i: IntroInput): IntroKey | null {
  if (!i.since || addDays(i.since, INTRO_DAY) > i.today) return null
  if (i.pausedOn === i.today) return null
  const hidden: IntroKey[] = [
    // Screen time has no Today card to preview, and turns on only through
    // iOS's own permission sheet: Settings is the place for it.
    ...i.order.filter((k) => i.enabled[k] === false && k !== "screen"),
    ...(["journal", "social"] as const).filter((k) => !i.shown[k]),
  ]
  return hidden.find((k) => !i.dismissed.includes(k)) ?? null
}

/** This phone's pause after a "Not for me", so the next part waits a day. */
export const introPause = createStore<{ day: string }>(
  "native-intro-pause",
  () => ({ day: "" }),
)

export function turnPartOn(k: IntroKey) {
  if (k === "journal" || k === "social") setShown(k, true)
  else {
    // Loaded here: Screen time's switch pulls in the native iOS bridge.
    const { turnModuleOn } =
      require("./module-switch") as typeof import("./module-switch")
    turnModuleOn(k)
  }
}

export function notForMe(k: IntroKey) {
  dismissIntro(k)
  introPause.set({ day: dayKey() })
}

/** Whether ``k`` is shown now (module on, or the extra visible). */
export const partOn = (
  k: IntroKey,
  enabled: Partial<Record<ModuleKey, boolean>>,
  shown: { journal: boolean; social: boolean },
) => (k === "journal" || k === "social" ? shown[k] : enabled[k] !== false)
