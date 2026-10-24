// The focus timer's records on the device (ADR-0025): the same rows the
// server keeps (focus_session, focus_segment, focus_settings), camelCased.
import { at } from "../lib/day"
import { derivedId } from "../lib/ids"

export type FocusMode = "pomodoro" | "stopwatch"
export type SegmentKind = "focus" | "break" | "pause"
export type EndReason = "completed" | "abandoned"
export type PresetKey = "25-5" | "50-10" | "90-20"

export interface FocusItem {
  kind: "task" | "habit"
  id: string
  /** The title when it was picked, so a renamed or deleted item still
   * labels its time. */
  title?: string
}
export interface FocusSession {
  id: string
  mode: FocusMode
  preset?: PresetKey | "custom"
  focusMin: number
  shortBreakMin: number
  longBreakMin: number
  setsBeforeLong: number
  autoStartBreaks: boolean
  autoStartFocus: boolean
  startedAt: string
  endedAt?: string
  endReason?: EndReason
  /** What is being worked on now; each new segment copies it. */
  item?: FocusItem
  /** Derived (the server recomputes them): business day, focus seconds,
   * finished Pomodoros. */
  day?: string
  focusSec: number
  setsCompleted: number
}
export interface FocusSegment {
  id: string
  sessionId: string
  kind: SegmentKind
  startedAt: string
  endedAt?: string
  setIndex: number
  /** The set's or break's length including extensions; none for a
   * stopwatch. */
  plannedSec?: number
  item?: FocusItem
}
export interface FocusSettings {
  /** "Deep work" minutes a day; 0 turns the goal off. */
  dailyGoalMin: number
  mode: FocusMode
  preset: PresetKey | "custom"
  focusMin: number
  shortBreakMin: number
  longBreakMin: number
  setsBeforeLong: number
  autoStartBreaks: boolean
  autoStartFocus: boolean
  notify: boolean
}
export interface FocusState {
  sessions: FocusSession[]
  segments: FocusSegment[]
  settings: FocusSettings
  /** The settings were saved once (here or pulled from the server): setup
   * counts the Focus step as done. */
  settingsSaved: boolean
}

/** [focus, short break, long break, sets before the long break] */
export const PRESETS: Record<
  PresetKey,
  { label: string; lengths: [number, number, number, number] }
> = {
  "25-5": { label: "Classic", lengths: [25, 5, 15, 4] },
  "50-10": { label: "Long", lengths: [50, 10, 20, 3] },
  "90-20": { label: "Deep", lengths: [90, 20, 30, 2] },
}
export const DEFAULT_SETTINGS: FocusSettings = {
  dailyGoalMin: 120,
  mode: "pomodoro",
  preset: "25-5",
  focusMin: 25,
  shortBreakMin: 5,
  longBreakMin: 15,
  setsBeforeLong: 4,
  autoStartBreaks: true,
  autoStartFocus: false,
  notify: true,
}

// ------------------------------------------------------------ demo seed

const DEMO_TASK: FocusItem = {
  kind: "task",
  id: "t2",
  title: "Review PR #214 (payments refactor)",
}
const DEMO_HABIT: FocusItem = {
  kind: "habit",
  id: "h-deepwork",
  title: "Deep work 90m",
}
const DEMO_OTHER: FocusItem = {
  kind: "task",
  id: "t1",
  title: "Sprint planning notes",
}
const NS = "6f1d7c2a-4b8e-5a3c-9d10-2e7f40b1c9a5"

/** A week of mornings at the timer, for the prototype: Pomodoros on the PR
 * review and deep work, an afternoon stopwatch, and this morning's session
 * with a pause and a switch. */
export function seedFocus(): FocusState {
  const sessions: FocusSession[] = []
  const segments: FocusSegment[] = []
  const add = (
    d: number,
    startH: number,
    startM: number,
    mode: FocusMode,
    spans: [SegmentKind, number, number, number, FocusItem | undefined][],
  ) => {
    const id = derivedId("demo-focus", NS, `${d}-${startH}`)
    const t0 = new Date(at(d, startH, startM)).getTime()
    const iso = (min: number) => new Date(t0 + min * 60_000).toISOString()
    let focus = 0
    for (const [kind, a, b, k, item] of spans) {
      if (kind === "focus") focus += b - a
      segments.push({
        id: derivedId("demo-focus-seg", id, `${a}`),
        sessionId: id,
        kind,
        startedAt: iso(a),
        endedAt: iso(b),
        setIndex: k,
        plannedSec:
          mode === "stopwatch" ? undefined : kind === "break" ? 300 : 1500,
        item: kind === "break" ? undefined : item,
      })
    }
    const last = spans[spans.length - 1]
    sessions.push({
      id,
      mode,
      preset: mode === "pomodoro" ? "25-5" : undefined,
      focusMin: 25,
      shortBreakMin: 5,
      longBreakMin: 15,
      setsBeforeLong: 4,
      autoStartBreaks: true,
      autoStartFocus: false,
      startedAt: iso(0),
      endedAt: iso(last[2]),
      endReason: "completed",
      item: last[4],
      focusSec: focus * 60,
      setsCompleted:
        mode === "pomodoro"
          ? new Set(
              spans
                .filter(([k]) => k === "focus")
                .map(([, , , s]) => s)
                .filter(
                  (s) =>
                    spans
                      .filter(([k, , , x]) => k === "focus" && x === s)
                      .reduce((n, [, a, b]) => n + b - a, 0) >= 25,
                ),
            ).size
          : 0,
    })
  }
  for (const d of [-6, -5, -3, -2, -1]) {
    add(d, 9, 0, "pomodoro", [
      ["focus", 0, 25, 0, DEMO_TASK],
      ["break", 25, 30, 0, undefined],
      ["focus", 30, 55, 1, d % 2 ? DEMO_HABIT : DEMO_TASK],
      ["break", 55, 60, 1, undefined],
      ["focus", 60, 85, 2, DEMO_HABIT],
    ])
    if (d !== -5)
      add(d, 14, 0, "stopwatch", [
        ["focus", 0, 30 + (d + 7) * 5, 0, DEMO_OTHER],
      ])
  }
  add(0, 7, 0, "pomodoro", [
    ["focus", 0, 25, 0, DEMO_TASK],
    ["break", 25, 30, 0, undefined],
    ["focus", 30, 40, 1, DEMO_TASK],
    ["pause", 40, 47, 1, DEMO_TASK],
    ["focus", 47, 62, 1, DEMO_HABIT],
  ])
  return {
    sessions,
    segments,
    settings: { ...DEFAULT_SETTINGS },
    settingsSaved: true,
  }
}
