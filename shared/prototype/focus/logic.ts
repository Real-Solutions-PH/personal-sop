// The focus timer's rules (ADR-0025): the device's copy of
// backend/app/modules/focus/logic.py, function for function, so the phone,
// Fern and the stats read one timer the same way.
//
// The timer is never a counter. Where it stands at `now` follows from the
// stored timestamps: a focus set ends `plannedSec` of focus after it began
// (pauses excluded), and so does a break. `advance` writes down what came
// due while the app was killed or the phone locked: it closes a finished set
// on the instant it finished and, when the session auto-starts, opens the
// break or the next set at that same instant, with an id the server mints
// too. Auto-start stops at a long break; a segment open past MAX_OPEN is
// closed at the cap and the session ends; under MIN_FOCUS_SEC of focus an
// ended session is abandoned; an abandoned session counts nowhere; and
// focus time is counted once however many sessions cover it.

import { DAY_START_HOUR } from "../lib/day"
import { derivedId } from "../lib/ids"
import type {
  FocusItem,
  FocusMode,
  FocusSegment,
  FocusSession,
  SegmentKind,
} from "./data"

export const MAX_OPEN_MS = 12 * 3600_000
export const MIN_FOCUS_SEC = 60

export interface Seg {
  id: string
  kind: SegmentKind
  start: number
  end: number | null
  setIndex: number
  plannedSec: number | null
  item: FocusItem | null
}
export interface Sess {
  id: string
  mode: FocusMode
  start: number
  focusMin: number
  shortBreakMin: number
  longBreakMin: number
  setsBeforeLong: number
  autoStartBreaks: boolean
  autoStartFocus: boolean
  end: number | null
  endReason: "completed" | "abandoned" | null
  item: FocusItem | null
}
export interface Timeline {
  sess: Sess
  segs: Seg[]
}

const ms = (iso: string) => new Date(iso).getTime()
const iso = (t: number) => new Date(t).toISOString()

// ---------------------------------------------------------------- mapping

export function toTimeline(
  s: FocusSession,
  segments: FocusSegment[],
): Timeline {
  return {
    sess: {
      id: s.id,
      mode: s.mode,
      start: ms(s.startedAt),
      focusMin: s.focusMin,
      shortBreakMin: s.shortBreakMin,
      longBreakMin: s.longBreakMin,
      setsBeforeLong: s.setsBeforeLong,
      autoStartBreaks: s.autoStartBreaks,
      autoStartFocus: s.autoStartFocus,
      end: s.endedAt ? ms(s.endedAt) : null,
      endReason: s.endReason ?? null,
      item: s.item ?? null,
    },
    segs: ordered(
      segments
        .filter((g) => g.sessionId === s.id)
        .map((g) => ({
          id: g.id,
          kind: g.kind,
          start: ms(g.startedAt),
          end: g.endedAt ? ms(g.endedAt) : null,
          setIndex: g.setIndex,
          plannedSec: g.plannedSec ?? null,
          item: g.item ?? null,
        })),
    ),
  }
}

export function fromSeg(g: Seg, sessionId: string): FocusSegment {
  const out: FocusSegment = {
    id: g.id,
    sessionId,
    kind: g.kind,
    startedAt: iso(g.start),
    setIndex: g.setIndex,
  }
  if (g.end !== null) out.endedAt = iso(g.end)
  if (g.plannedSec !== null) out.plannedSec = g.plannedSec
  if (g.item) out.item = g.item
  return out
}

/** The session row as the timeline leaves it, totals derived. */
export function fromSess(
  tl: Timeline,
  prev: FocusSession | undefined,
  now: number,
): FocusSession {
  const s = tl.sess
  const out: FocusSession = {
    ...(prev ?? {}),
    id: s.id,
    mode: s.mode,
    focusMin: s.focusMin,
    shortBreakMin: s.shortBreakMin,
    longBreakMin: s.longBreakMin,
    setsBeforeLong: s.setsBeforeLong,
    autoStartBreaks: s.autoStartBreaks,
    autoStartFocus: s.autoStartFocus,
    startedAt: iso(s.start),
    focusSec: focusSec(tl, now),
    setsCompleted: setsCompleted(tl, now),
  }
  if (s.end !== null) out.endedAt = iso(s.end)
  else delete out.endedAt
  if (s.endReason) out.endReason = s.endReason
  else delete out.endReason
  if (s.item) out.item = s.item
  else delete out.item
  return out
}

// ---------------------------------------------------------------- basics

export const ordered = (segs: Seg[]) =>
  [...segs].sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1))

export const isLongBreak = (s: Sess, k: number) =>
  (k + 1) % s.setsBeforeLong === 0
export const breakSec = (s: Sess, k: number) =>
  (isLongBreak(s, k) ? s.longBreakMin : s.shortBreakMin) * 60
export const focusPlanned = (s: Sess) =>
  s.mode === "pomodoro" ? s.focusMin * 60 : null

function openOf(segs: Seg[]): Seg | null {
  for (let i = segs.length - 1; i >= 0; i--)
    if (segs[i].end === null) return segs[i]
  return null
}

function done(segs: Seg[], kind: SegmentKind, k: number, skip: string) {
  let sec = 0
  for (const s of segs)
    if (s.kind === kind && s.setIndex === k && s.end !== null && s.id !== skip)
      sec += (s.end - s.start) / 1000
  return sec
}

/** At most one open segment: an open one followed by a later segment (two
 * devices each opened one) ends where the next begins. */
export function normalise(segs: Seg[]): Seg[] {
  const out = ordered(segs)
  for (let i = 0; i < out.length - 1; i++)
    if (out[i].end === null)
      out[i] = { ...out[i], end: Math.max(out[i].start, out[i + 1].start) }
  return out
}

/** The id of a segment the timer opened by itself; the server mints the
 * same one, so one auto-started break is one row. */
export const autoId = (sessionId: string, kind: SegmentKind, k: number) =>
  derivedId("focus-segment", sessionId, `auto-${kind}-${k}`)

export function advance(tl: Timeline, now: number): Timeline {
  let sess = tl.sess
  const segs = normalise(tl.segs)
  for (let n = 0; n < 4 * sess.setsBeforeLong + 8; n++) {
    const cur = openOf(segs)
    if (!cur) break
    const i = segs.indexOf(cur)
    if (sess.end !== null) {
      segs[i] = { ...cur, end: Math.max(cur.start, sess.end) }
      continue
    }
    const cap = cur.start + MAX_OPEN_MS
    if (cur.kind === "pause" || cur.plannedSec === null) {
      if (now > cap) {
        segs[i] = { ...cur, end: cap }
        sess = { ...sess, end: cap, endReason: "completed" }
      }
      break
    }
    const left = cur.plannedSec - done(segs, cur.kind, cur.setIndex, cur.id)
    const end = cur.start + Math.max(0, left) * 1000
    if (end > now) break
    segs[i] = { ...cur, end }
    const k = cur.setIndex
    if (cur.kind === "focus" && sess.autoStartBreaks)
      segs.push({
        id: autoId(sess.id, "break", k),
        kind: "break",
        start: end,
        end: null,
        setIndex: k,
        plannedSec: breakSec(sess, k),
        item: null,
      })
    else if (
      cur.kind === "break" &&
      sess.autoStartFocus &&
      !isLongBreak(sess, k)
    )
      segs.push({
        id: autoId(sess.id, "focus", k + 1),
        kind: "focus",
        start: end,
        end: null,
        setIndex: k + 1,
        plannedSec: focusPlanned(sess),
        item: sess.item,
      })
  }
  return { sess, segs: ordered(segs) }
}

// ---------------------------------------------------------------- reading

export type Status = "running" | "paused" | "waiting" | "ended"
export interface Phase {
  status: Status
  /** What runs, or (waiting) what comes next. */
  kind: "focus" | "break"
  setIndex: number
  plannedSec: number | null
  elapsed: number
  remaining: number | null
  longBreak: boolean
  /** Epoch ms the phase ends if nothing changes (running only). */
  endsAt: number | null
  item: FocusItem | null
}

function resumeKind(segs: Seg[], pause: Seg): "focus" | "break" {
  const before = segs.filter(
    (s) => s.start <= pause.start && s.kind !== "pause",
  )
  return before.length && before[before.length - 1].kind === "break"
    ? "break"
    : "focus"
}

export function phase(tl: Timeline, now: number): Phase {
  const { sess, segs } = tl
  const cur = openOf(segs)
  if (sess.end !== null || (!cur && !segs.length))
    return {
      status: sess.end !== null ? "ended" : "waiting",
      kind: "focus",
      setIndex: 0,
      plannedSec: focusPlanned(sess),
      elapsed: 0,
      remaining: null,
      longBreak: false,
      endsAt: null,
      item: sess.item,
    }
  if (cur) {
    const kind = cur.kind === "pause" ? resumeKind(segs, cur) : cur.kind
    const k = cur.setIndex
    const before = done(segs, kind, k, cur.id)
    const running = cur.kind !== "pause"
    const elapsed = before + (running ? (now - cur.start) / 1000 : 0)
    const planned = cur.plannedSec
    const remaining = planned === null ? null : Math.max(0, planned - elapsed)
    return {
      status: running ? "running" : "paused",
      kind,
      setIndex: k,
      plannedSec: planned,
      elapsed,
      remaining,
      longBreak: kind === "break" && isLongBreak(sess, k),
      endsAt: running && remaining !== null ? now + remaining * 1000 : null,
      item: cur.item ?? sess.item,
    }
  }
  const last = segs[segs.length - 1]
  const k = last.setIndex
  if (
    last.kind === "focus" ||
    (last.kind === "pause" && resumeKind(segs, last) === "focus")
  ) {
    const planned = breakSec(sess, k)
    return {
      status: "waiting",
      kind: "break",
      setIndex: k,
      plannedSec: planned,
      elapsed: 0,
      remaining: planned,
      longBreak: isLongBreak(sess, k),
      endsAt: null,
      item: sess.item,
    }
  }
  const planned = focusPlanned(sess)
  return {
    status: "waiting",
    kind: "focus",
    setIndex: k + 1,
    plannedSec: planned,
    elapsed: 0,
    remaining: planned,
    longBreak: false,
    endsAt: null,
    item: sess.item,
  }
}

export function endOf(s: Seg, now: number): number {
  if (s.end !== null) return s.end
  return Math.max(s.start, Math.min(now, s.start + MAX_OPEN_MS))
}

export function focusSec(tl: Timeline, now: number): number {
  const spans = tl.segs
    .filter((s) => s.kind === "focus")
    .map((s) => [s.start, endOf(s, now)] as Span)
  return Math.floor(union(spans).reduce((n, [a, b]) => n + (b - a), 0) / 1000)
}

export function setsCompleted(tl: Timeline, now: number): number {
  if (tl.sess.mode !== "pomodoro") return 0
  const doneBy = new Map<number, number>()
  const planned = new Map<number, number>()
  for (const s of tl.segs) {
    if (s.kind !== "focus") continue
    doneBy.set(
      s.setIndex,
      (doneBy.get(s.setIndex) ?? 0) + (endOf(s, now) - s.start) / 1000,
    )
    if (s.plannedSec !== null) planned.set(s.setIndex, s.plannedSec)
  }
  let n = 0
  for (const [k, v] of doneBy) {
    const p = planned.get(k)
    if (p !== undefined && v + 1 >= p) n++
  }
  return n
}

// ---------------------------------------------------------------- actions

export type NewId = () => string

export function start(o: {
  sessionId: string
  segmentId: string
  mode: FocusMode
  lengths: [number, number, number, number]
  autoStartBreaks: boolean
  autoStartFocus: boolean
  item: FocusItem | null
  now: number
}): Timeline {
  const [f, sb, lb, n] = o.lengths
  const sess: Sess = {
    id: o.sessionId,
    mode: o.mode,
    start: o.now,
    focusMin: f,
    shortBreakMin: sb,
    longBreakMin: lb,
    setsBeforeLong: n,
    autoStartBreaks: o.autoStartBreaks,
    autoStartFocus: o.autoStartFocus,
    end: null,
    endReason: null,
    item: o.item,
  }
  return {
    sess,
    segs: [
      {
        id: o.segmentId,
        kind: "focus",
        start: o.now,
        end: null,
        setIndex: 0,
        plannedSec: focusPlanned(sess),
        item: o.item,
      },
    ],
  }
}

function closeOpen(segs: Seg[], now: number) {
  const cur = openOf(segs)
  if (cur) segs[segs.indexOf(cur)] = { ...cur, end: Math.max(cur.start, now) }
  return cur
}

export function pause(t: Timeline, now: number, newId: NewId): Timeline {
  const tl = advance(t, now)
  const segs = [...tl.segs]
  const cur = openOf(segs)
  if (tl.sess.end !== null || !cur || cur.kind === "pause") return tl
  closeOpen(segs, now)
  segs.push({ ...cur, id: newId(), kind: "pause", start: now, end: null })
  return { sess: tl.sess, segs: ordered(segs) }
}

export function resume(t: Timeline, now: number, newId: NewId): Timeline {
  const tl = advance(t, now)
  const segs = [...tl.segs]
  const cur = openOf(segs)
  if (tl.sess.end !== null || !cur || cur.kind !== "pause") return tl
  const kind = resumeKind(segs, cur)
  closeOpen(segs, now)
  segs.push({
    id: newId(),
    kind,
    start: now,
    end: null,
    setIndex: cur.setIndex,
    plannedSec: cur.plannedSec,
    item: kind === "focus" ? tl.sess.item : null,
  })
  return { sess: tl.sess, segs: ordered(segs) }
}

/** Begin what comes next when the timer is waiting between phases. */
export function startNext(t: Timeline, now: number, newId: NewId): Timeline {
  const tl = advance(t, now)
  const p = phase(tl, now)
  if (p.status !== "waiting") return tl
  return {
    sess: tl.sess,
    segs: ordered([
      ...tl.segs,
      {
        id: newId(),
        kind: p.kind,
        start: now,
        end: null,
        setIndex: p.setIndex,
        plannedSec: p.plannedSec,
        item: p.kind === "focus" ? tl.sess.item : null,
      },
    ]),
  }
}

/** End (or skip) the break and start the next focus set now. */
export function skipBreak(t: Timeline, now: number, newId: NewId): Timeline {
  const tl = advance(t, now)
  const p = phase(tl, now)
  if (tl.sess.end !== null || p.kind !== "break") return tl
  const segs = [...tl.segs]
  closeOpen(segs, now)
  segs.push({
    id: newId(),
    kind: "focus",
    start: now,
    end: null,
    setIndex: p.setIndex + 1,
    plannedSec: focusPlanned(tl.sess),
    item: tl.sess.item,
  })
  return { sess: tl.sess, segs: ordered(segs) }
}

/** Add `bySec` to the running (or paused) set or break. */
export function extend(t: Timeline, now: number, bySec: number): Timeline {
  const tl = advance(t, now)
  const cur = openOf(tl.segs)
  if (tl.sess.end !== null || !cur || cur.plannedSec === null) return tl
  const planned = Math.min(86400, cur.plannedSec + bySec)
  const k = cur.setIndex
  const kind = cur.kind === "pause" ? resumeKind(tl.segs, cur) : cur.kind
  return {
    sess: tl.sess,
    segs: tl.segs.map((s) =>
      s.setIndex === k && (s.kind === kind || s.kind === "pause")
        ? { ...s, plannedSec: planned }
        : s,
    ),
  }
}

/** Work on `item` from now on; a running focus segment is split here, so
 * the time before and after the switch lands on the right item. */
export function switchItem(
  t: Timeline,
  now: number,
  item: FocusItem | null,
  newId: NewId,
): Timeline {
  const tl = advance(t, now)
  const sess = { ...tl.sess, item }
  const segs = [...tl.segs]
  const cur = openOf(segs)
  if (tl.sess.end !== null || !cur) return { sess, segs: tl.segs }
  const i = segs.indexOf(cur)
  if (cur.kind === "pause") segs[i] = { ...cur, item }
  else if (cur.kind === "focus") {
    if (now - cur.start < 1000) segs[i] = { ...cur, item }
    else {
      closeOpen(segs, now)
      segs.push({ ...cur, id: newId(), start: now, end: null, item })
    }
  }
  return { sess, segs: ordered(segs) }
}

/** End the session: keep what was done, or abandon it. Under a minute of
 * focus is recorded as abandoned (an accidental tap). */
export function stop(t: Timeline, now: number, abandon = false): Timeline {
  const tl = advance(t, now)
  if (tl.sess.end !== null) return tl
  const segs = [...tl.segs]
  closeOpen(segs, now)
  const out = { sess: tl.sess, segs: ordered(segs) }
  const reason =
    abandon || focusSec(out, now) < MIN_FOCUS_SEC ? "abandoned" : "completed"
  return { sess: { ...tl.sess, end: now, endReason: reason }, segs: out.segs }
}

// ---------------------------------------------------------------- counting

export type Span = [number, number]

export function union(spans: Span[]): Span[] {
  const out: Span[] = []
  for (const [a, b] of spans
    .filter(([x, y]) => y > x)
    .sort((p, q) => p[0] - q[0] || p[1] - q[1])) {
    const last = out[out.length - 1]
    if (last && a <= last[1]) last[1] = Math.max(last[1], b)
    else out.push([a, b])
  }
  return out
}

export const clip = (spans: Span[], lo: number, hi: number): Span[] =>
  spans
    .filter(([a, b]) => b > lo && a < hi)
    .map(([a, b]) => [Math.max(a, lo), Math.min(b, hi)])

export interface Focused {
  start: number
  end: number
  item: FocusItem | null
  sessionId: string
}

export function counted(tls: Timeline[], now: number): Focused[] {
  const out: Focused[] = []
  for (const tl of tls) {
    if (tl.sess.endReason === "abandoned") continue
    for (const s of tl.segs)
      if (s.kind === "focus") {
        const end = endOf(s, now)
        if (end > s.start)
          out.push({ start: s.start, end, item: s.item, sessionId: tl.sess.id })
      }
  }
  return out
}

/** The instant a business day (YYYY-MM-DD) starts on this device. */
export function dayStart(day: string): number {
  const [y, m, d] = day.split("-").map(Number)
  return new Date(y, m - 1, d, DAY_START_HOUR, 0, 0, 0).getTime()
}
export function nextDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number)
  const n = new Date(y, m - 1, d + 1, 12)
  const pad = (x: number) => String(x).padStart(2, "0")
  return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`
}
export function daysBetween(first: string, last: string): string[] {
  const out: string[] = []
  for (let d = first; d <= last; d = nextDay(d)) out.push(d)
  return out
}

/** Whole seconds of focus per business day, split at the day boundary,
 * overlaps counted once. */
export function perDay(
  spans: Focused[],
  first: string,
  last: string,
): Record<string, number> {
  const merged = union(spans.map((f) => [f.start, f.end]))
  const out: Record<string, number> = {}
  for (const d of daysBetween(first, last)) {
    const lo = dayStart(d)
    const hi = dayStart(nextDay(d))
    out[d] = Math.floor(
      clip(merged, lo, hi).reduce((n, [a, b]) => n + (b - a), 0) / 1000,
    )
  }
  return out
}

export const itemKey = (i: FocusItem | null) => (i ? `${i.kind}:${i.id}` : "")

/** Whole seconds per item ("" = nothing picked), each item's overlaps
 * counted once. */
export function perItem(spans: Focused[]): Record<string, number> {
  const groups: Record<string, Span[]> = {}
  for (const f of spans) {
    const key = itemKey(f.item)
    groups[key] ??= []
    groups[key].push([f.start, f.end])
  }
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(groups))
    out[k] = Math.floor(union(v).reduce((n, [a, b]) => n + (b - a), 0) / 1000)
  return out
}

/** Consecutive days on goal ending today (an open today does not break it). */
export function goalStreak(
  byDay: Record<string, number>,
  goalSec: number,
  today: string,
  prevDay: (d: string) => string,
): number {
  if (goalSec <= 0) return 0
  let d = today
  if ((byDay[d] ?? 0) < goalSec) d = prevDay(d)
  let n = 0
  while ((byDay[d] ?? 0) >= goalSec) {
    n++
    d = prevDay(d)
  }
  return n
}

/** `1h 05m`, `45m`, `0m`: whole minutes, rounded down. */
export function fmtHm(sec: number): string {
  const m = Math.floor(sec / 60)
  const h = Math.floor(m / 60)
  const mm = m % 60
  return h ? `${h}h ${String(mm).padStart(2, "0")}m` : `${mm}m`
}
/** The clock face: `24:59`, `1:05:00`. */
export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.ceil(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const pad = (x: number) => String(x).padStart(2, "0")
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`
}
