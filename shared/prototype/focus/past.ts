// Logging a focus session after the fact, for when the timer was never
// started. It is written as the same session and segment rows a timed one
// leaves, so it counts toward the day's focus, the goal and every stat
// exactly like one; `source: "manual"` lets it be edited as a whole.
//
// A plain focus block runs from its start to its end. A Pomodoro block is
// N sets of the chosen length with the breaks between them (a long break
// after every Nth set, as the timer does), so its end follows from the
// count. A logged session may not reach into the future or overlap another
// session: overlapping time would count twice, so the form names the
// session it collides with and the person moves the times.

import { newId } from "../lib/ids"
import type { FocusSegment, FocusSession, FocusState } from "./data"
import { PRESETS, type PresetKey } from "./data"
import * as L from "./logic"
import { focusStore } from "./store"

export type PastKind = "focus" | "pomodoro"
export interface PastInput {
  kind: PastKind
  /** Epoch ms. */
  start: number
  /** Focus blocks: epoch ms. Pomodoro blocks derive it. */
  end?: number
  /** Pomodoro sets. */
  count?: number
  preset?: PresetKey
  label?: string
}

export const MAX_SETS = 12
const MIN = 60_000

function lengths(i: PastInput): [number, number, number, number] {
  return PRESETS[i.preset ?? "25-5"].lengths
}

/** The span the block covers. */
export function pastWindow(i: PastInput): { start: number; end: number } {
  if (i.kind === "focus") return { start: i.start, end: i.end ?? i.start }
  const [f, sb, lb, n] = lengths(i)
  const c = Math.max(1, i.count ?? 1)
  let end = i.start
  for (let k = 0; k < c; k++) {
    end += f * MIN
    if (k < c - 1) end += ((k + 1) % n === 0 ? lb : sb) * MIN
  }
  return { start: i.start, end }
}

export interface PastErrors {
  start?: string
  end?: string
  count?: string
  /** The session it would overlap, named for the person to move. */
  overlap?: string
}

const hm = (t: number) =>
  new Date(t).toLocaleTimeString("en-PH", {
    hour: "numeric",
    minute: "2-digit",
  })

/** What stops the block being saved; empty when it can be. */
export function pastErrors(
  s: FocusState,
  i: PastInput,
  now = Date.now(),
  editingId?: string,
): PastErrors {
  const out: PastErrors = {}
  const w = pastWindow(i)
  if (i.kind === "pomodoro" && (!i.count || i.count < 1 || i.count > MAX_SETS))
    out.count = `Log 1 to ${MAX_SETS} Pomodoros`
  if (w.start > now) out.start = "That's in the future"
  else if (w.end <= w.start) out.end = "End after it starts"
  else if (w.end > now)
    out.end =
      i.kind === "pomodoro"
        ? `${i.count} Pomodoros from then end after now. Start earlier or log fewer.`
        : "That's in the future"
  if (out.start || out.end || out.count) return out
  for (const x of s.sessions) {
    if (x.id === editingId) continue
    const a = new Date(x.startedAt).getTime()
    const b = x.endedAt ? new Date(x.endedAt).getTime() : now
    if (a < w.end && b > w.start) {
      const what = x.label ?? x.item?.title ?? "focus"
      out.overlap = `Overlaps your ${what} session, ${hm(a)}–${hm(b)}. Move the times so they don't overlap.`
      break
    }
  }
  return out
}

export const pastOk = (e: PastErrors) =>
  !e.start && !e.end && !e.count && !e.overlap

/** The rows a logged block is written as. */
export function pastRows(
  i: PastInput,
  id: string,
  now = Date.now(),
): { session: FocusSession; segments: FocusSegment[] } {
  const w = pastWindow(i)
  const [f, sb, lb, n] =
    i.kind === "pomodoro" ? lengths(i) : ([0, 0, 0, 4] as const)
  const segments: FocusSegment[] = []
  if (i.kind === "focus")
    segments.push({
      id: newId(),
      sessionId: id,
      kind: "focus",
      startedAt: new Date(w.start).toISOString(),
      endedAt: new Date(w.end).toISOString(),
      setIndex: 0,
    })
  else {
    let t = w.start
    const c = Math.max(1, i.count ?? 1)
    for (let k = 0; k < c; k++) {
      segments.push({
        id: newId(),
        sessionId: id,
        kind: "focus",
        startedAt: new Date(t).toISOString(),
        endedAt: new Date(t + f * MIN).toISOString(),
        setIndex: k,
        plannedSec: f * 60,
      })
      t += f * MIN
      if (k === c - 1) break
      const br = ((k + 1) % n === 0 ? lb : sb) * 60
      segments.push({
        id: newId(),
        sessionId: id,
        kind: "break",
        startedAt: new Date(t).toISOString(),
        endedAt: new Date(t + br * 1000).toISOString(),
        setIndex: k,
        plannedSec: br,
      })
      t += br * 1000
    }
  }
  const base: FocusSession = {
    id,
    mode: i.kind === "pomodoro" ? "pomodoro" : "stopwatch",
    ...(i.kind === "pomodoro" ? { preset: i.preset ?? "25-5" } : {}),
    focusMin: i.kind === "pomodoro" ? f : 25,
    shortBreakMin: i.kind === "pomodoro" ? sb : 5,
    longBreakMin: i.kind === "pomodoro" ? lb : 15,
    setsBeforeLong: n,
    autoStartBreaks: true,
    autoStartFocus: true,
    startedAt: new Date(w.start).toISOString(),
    endedAt: new Date(w.end).toISOString(),
    endReason: "completed",
    focusSec: 0,
    setsCompleted: 0,
  }
  const derived = L.fromSess(L.toTimeline(base, segments), base, now)
  const label = i.label?.trim()
  return {
    session: { ...derived, source: "manual", ...(label ? { label } : {}) },
    segments,
  }
}

/** The form's values for a logged session (to edit it). */
export function pastInputOf(s: FocusState, id: string): PastInput | null {
  const x = s.sessions.find((y) => y.id === id)
  if (x?.source !== "manual" || !x.endedAt) return null
  const start = new Date(x.startedAt).getTime()
  if (x.mode === "pomodoro")
    return {
      kind: "pomodoro",
      start,
      count: s.segments.filter((g) => g.sessionId === id && g.kind === "focus")
        .length,
      preset: x.preset && x.preset !== "custom" ? x.preset : "25-5",
      ...(x.label ? { label: x.label } : {}),
    }
  return {
    kind: "focus",
    start,
    end: new Date(x.endedAt).getTime(),
    ...(x.label ? { label: x.label } : {}),
  }
}

/** Saves a new logged block, or replaces one (`id`); returns its id, or
 * null when it may not be saved (pastErrors says why). */
export function savePastSession(i: PastInput, id?: string): string | null {
  const s = focusStore.get()
  if (!pastOk(pastErrors(s, i, Date.now(), id))) return null
  const sid = id ?? newId()
  const rows = pastRows(i, sid)
  focusStore.set((st) => ({
    ...st,
    sessions: id
      ? st.sessions.map((x) => (x.id === id ? rows.session : x))
      : [...st.sessions, rows.session],
    segments: [
      ...st.segments.filter((g) => g.sessionId !== sid),
      ...rows.segments,
    ],
  }))
  return sid
}

/** Removes a session (logged or timed) and returns it, for Undo. */
export function takeSession(id: string) {
  const s = focusStore.get()
  const session = s.sessions.find((x) => x.id === id)
  if (!session) return null
  const segments = s.segments.filter((g) => g.sessionId === id)
  focusStore.set((st) => ({
    ...st,
    sessions: st.sessions.filter((x) => x.id !== id),
    segments: st.segments.filter((g) => g.sessionId !== id),
  }))
  return { session, segments }
}

export function putBackSession(r: {
  session: FocusSession
  segments: FocusSegment[]
}) {
  focusStore.set((st) => ({
    ...st,
    sessions: [...st.sessions, r.session],
    segments: [...st.segments, ...r.segments],
  }))
}

/** Focus spans with a logged session's label standing in for an item, so
 * "time by item" lists "Reading" rather than "Nothing in particular". */
export function withLabels(s: FocusState, spans: L.Focused[]): L.Focused[] {
  const labels = new Map(
    s.sessions
      .filter((x) => x.source === "manual" && x.label)
      .map((x) => [x.id, x.label as string]),
  )
  return spans.map((f) => {
    const label = f.item ? undefined : labels.get(f.sessionId)
    return label
      ? { ...f, item: { kind: "task", id: `label:${label}`, title: label } }
      : f
  })
}
