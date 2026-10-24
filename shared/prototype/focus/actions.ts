// What the focus screens do (ADR-0025). Every action reads the running
// session from the store, applies the rule from logic.ts at this instant and
// writes the session and its segments back; the sync engine diffs them into
// rows. Nothing ticks: `tick` only writes down what came due (a set that
// ended while the phone was locked) so it reaches the server too.

import { newId } from "../lib/ids"
import {
  type FocusItem,
  type FocusMode,
  type FocusSession,
  type FocusSettings,
  type FocusState,
  PRESETS,
  type PresetKey,
} from "./data"
import * as L from "./logic"
import { focusStore } from "./store"

export function current(s: FocusState): FocusSession | undefined {
  let best: FocusSession | undefined
  for (const x of s.sessions)
    if (!x.endedAt && (!best || x.startedAt > best.startedAt)) best = x
  return best
}

export function timelineOf(s: FocusState, session: FocusSession) {
  return L.toTimeline(session, s.segments)
}

/** The running session's timeline as of `now` (null when none). */
export function liveTimeline(s: FocusState, now = Date.now()) {
  const cur = current(s)
  return cur ? L.advance(timelineOf(s, cur), now) : null
}

function write(s: FocusState, tl: L.Timeline, now: number): FocusState {
  const prev = s.sessions.find((x) => x.id === tl.sess.id)
  const row = L.fromSess(tl, prev, now)
  const segs = tl.segs.map((g) => L.fromSeg(g, tl.sess.id))
  const byId = new Map(s.segments.map((g) => [g.id, g]))
  let changed = !prev || JSON.stringify(prev) !== JSON.stringify(row)
  for (const g of segs) {
    const old = byId.get(g.id)
    if (!old || JSON.stringify(old) !== JSON.stringify(g)) changed = true
    byId.set(g.id, g)
  }
  if (!changed) return s
  return {
    ...s,
    sessions: prev
      ? s.sessions.map((x) => (x.id === row.id ? row : x))
      : [...s.sessions, row],
    segments: [...byId.values()],
  }
}

function act(fn: (tl: L.Timeline, now: number) => L.Timeline) {
  const now = Date.now()
  focusStore.set((s) => {
    const cur = current(s)
    if (!cur) return s
    return write(s, fn(timelineOf(s, cur), now), now)
  })
}

export interface StartOptions {
  mode?: FocusMode
  preset?: PresetKey | "custom"
  lengths?: [number, number, number, number]
  item?: FocusItem | null
}

/** Start a session now; one already running ends first (kept). Returns the
 * new session's id. */
export function startFocus(o: StartOptions = {}): string {
  const now = Date.now()
  const id = newId()
  focusStore.set((s0) => {
    let s = s0
    const running = current(s)
    if (running) s = write(s, L.stop(timelineOf(s, running), now), now)
    const st = s.settings
    const mode = o.mode ?? st.mode
    const preset = mode === "stopwatch" ? undefined : (o.preset ?? st.preset)
    const lengths: [number, number, number, number] =
      o.lengths ??
      (preset && preset !== "custom"
        ? PRESETS[preset].lengths
        : [st.focusMin, st.shortBreakMin, st.longBreakMin, st.setsBeforeLong])
    const tl = L.start({
      sessionId: id,
      segmentId: newId(),
      mode,
      lengths,
      autoStartBreaks: st.autoStartBreaks,
      autoStartFocus: st.autoStartFocus,
      item: o.item ?? null,
      now,
    })
    const next = write(s, tl, now)
    return {
      ...next,
      sessions: next.sessions.map((x) =>
        x.id === id ? { ...x, ...(preset ? { preset } : {}) } : x,
      ),
    }
  })
  return id
}

export const pauseFocus = () => act((tl, now) => L.pause(tl, now, newId))
export const resumeFocus = () => act((tl, now) => L.resume(tl, now, newId))
export const nextFocus = () => act((tl, now) => L.startNext(tl, now, newId))
export const skipBreak = () => act((tl, now) => L.skipBreak(tl, now, newId))
export const extendFocus = (sec: number) =>
  act((tl, now) => L.extend(tl, now, sec))
export const switchFocusItem = (item: FocusItem | null) =>
  act((tl, now) => L.switchItem(tl, now, item, newId))
export const stopFocus = (abandon = false) =>
  act((tl, now) => L.stop(tl, now, abandon))

/** Write down transitions that came due (no-op when none did). */
export function tickFocus(now = Date.now()) {
  const s = focusStore.get()
  const cur = current(s)
  if (!cur) return
  const next = write(s, L.advance(timelineOf(s, cur), now), now)
  if (next !== s) focusStore.set(next)
}

export function saveFocusSettings(patch: Partial<FocusSettings>) {
  focusStore.set((s) => ({
    ...s,
    settings: { ...s.settings, ...patch },
    settingsSaved: true,
  }))
}

/** Remove an ended session and its segments (from its detail screen). */
export function deleteFocusSession(id: string) {
  focusStore.set((s) => ({
    ...s,
    sessions: s.sessions.filter((x) => x.id !== id),
    segments: s.segments.filter((g) => g.sessionId !== id),
  }))
}
