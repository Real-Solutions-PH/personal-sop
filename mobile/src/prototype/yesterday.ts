// What the Yesterday page needs apart from drawing: which misses are
// yesterday's, what kind each one is (said with an icon and a word), and
// the rules read of the day that stands in for Fern's analysis when the
// server cannot be asked (prototype mode). The misses themselves come from
// the one misses feed (useAllMisses), so this page, the Home card and the
// Misses page always agree on what a miss is.
import type { Miss } from "@domain/contract"
import { AREA } from "@domain/dash/data"
import {
  AlarmClockOff,
  CalendarX,
  CircleDollarSign,
  Clock,
  Drumstick,
  Dumbbell,
  Flame,
  Gauge,
  type LucideIcon,
  Receipt,
  Redo2,
  Repeat,
  Timer,
  TrendingDown,
  Wallet,
  Wheat,
} from "lucide-react-native"
import { missCost } from "./goal-vine"

export interface MissKind {
  word: string
  icon: LucideIcon
}

/** The kind of a miss from its id, which the feed builds the same way on the
 * server and on the phone. An unknown id still says it was missed. */
export function missKind(id: string): MissKind {
  if (id.startsWith("miss-")) return { word: "Missed habit", icon: CalendarX }
  if (id.startsWith("abandon-"))
    return { word: "Routine stopped", icon: Repeat }
  if (id.startsWith("task-overdue:"))
    return { word: "Overdue task", icon: Clock }
  if (id.startsWith("task-late:"))
    return { word: "Late task", icon: AlarmClockOff }
  if (id.startsWith("task-pushed:")) return { word: "Pushed task", icon: Redo2 }
  if (id.startsWith("fin-budget-")) return { word: "Over budget", icon: Wallet }
  if (id.startsWith("fin-due-")) return { word: "Unpaid bill", icon: Receipt }
  if (id.startsWith("fin-big-"))
    return { word: "Unplanned spend", icon: CircleDollarSign }
  if (id.startsWith("fit-miss-"))
    return { word: "Gym sessions", icon: Dumbbell }
  if (id.startsWith("fit-stall-"))
    return { word: "Stalled lift", icon: TrendingDown }
  if (id.startsWith("nut-over-")) return { word: "Over calories", icon: Flame }
  if (id.startsWith("nut-protein-"))
    return { word: "Protein short", icon: Drumstick }
  if (id.startsWith("nut-fiber-")) return { word: "Fiber short", icon: Wheat }
  if (id.startsWith("nut-limit-")) return { word: "Over limit", icon: Gauge }
  if (id.startsWith("focus-under-")) return { word: "Focus short", icon: Timer }
  return { word: "Missed", icon: CalendarX }
}

/** The misses of one day only: the feed may date a miss after its window (a
 * task pushed three times shows on its future due day). */
export function missesOn(misses: Miss[], day: string): Miss[] {
  return misses.filter((m) => m.day === day)
}

/** What slipped and what it cost, for every kind the feed emits: the habit
 * and task wording Home already uses (missCost), plus the ones whose title
 * carries a measure (a budget, calories, focus, gym sessions, a routine). */
export function missParts(
  m: Pick<Miss, "title" | "module">,
  endedRun = 0,
): { name: string; cost: string } {
  const title = m.title
  let r = /^Over (.+) budget by (\d+%) \((.+)\)$/.exec(title)
  if (r) return { name: `${r[1]} budget`, cost: `over by ${r[2]} in ${r[3]}` }
  r = /^Over calories by (\d+%)$/.exec(title)
  if (r) return { name: "Calories", cost: `over the target by ${r[1]}` }
  r = /^(Protein|Fiber) short by (.+) \((.+) of (.+)\)$/.exec(title)
  if (r) return { name: r[1], cost: `${r[3]} of ${r[4]} · ${r[2]} short` }
  r = /^Over (.+) limit by (.+) \((.+) of (.+)\)$/.exec(title)
  if (r)
    return {
      name: r[1].charAt(0).toUpperCase() + r[1].slice(1),
      cost: `${r[3]} of ${r[4]} · ${r[2]} over`,
    }
  r = /^Focused (.+) of (.+)$/.exec(title)
  if (r) return { name: "Focus goal", cost: `${r[1]} of ${r[2]} focused` }
  r = /^Missed (\d+) gym sessions? \((.+)\)$/.exec(title)
  if (r)
    return {
      name: "Gym sessions",
      cost: `${r[2]} this week · ${r[1]} short`,
    }
  r = /^Unplanned big purchase: (.+)$/.exec(title)
  if (r) return { name: r[1], cost: "a big purchase outside the plan" }
  r = /^(.+) abandoned at (\d+\/\d+)$/.exec(title)
  if (r) return { name: r[1], cost: `stopped at step ${r[2]}` }
  return missCost(m, endedRun)
}

const plural = (n: number, word: string) =>
  `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`

/** The rules read: what slipped, a likely cause, one thing for today. The
 * server writes the same three beats when no model may run. */
export function rulesRead(
  misses: Miss[],
  week: Miss[],
  notes: Record<string, string>,
): string[] {
  if (!misses.length) return []
  const by = new Map<string, number>()
  for (const m of misses) by.set(m.module, (by.get(m.module) ?? 0) + 1)
  const [top, k] = [...by.entries()].sort((a, b) => b[1] - a[1])[0]
  const area = AREA[top as Miss["module"]]?.label.toLowerCase() ?? top
  const first =
    by.size > 1
      ? `${plural(misses.length, "thing")} slipped yesterday, ${k.toLocaleString("en-US")} of them in ${area}.`
      : `${plural(misses.length, "thing")} slipped yesterday, all in ${area}.`
  const name = (m: Miss) => missParts(m).name
  const seen = new Map<string, number>()
  for (const m of week) seen.set(name(m), (seen.get(name(m)) ?? 0) + 1)
  const repeat = misses.find((m) => (seen.get(name(m)) ?? 0) >= 2)
  const noted = misses.find((m) => notes[m.id])
  const cause = noted
    ? `You noted “${notes[noted.id]}” on ${name(noted)}.`
    : repeat
      ? `${name(repeat)} slipped ${((seen.get(name(repeat)) ?? 0) + 1).toLocaleString("en-US")} of the last 7 days, so it is a pattern, not a one-off.`
      : "The day likely ran out before the list did."
  const lead = repeat ?? misses[0]
  return [first, cause, `Today, do ${name(lead)} first, before anything else.`]
}
