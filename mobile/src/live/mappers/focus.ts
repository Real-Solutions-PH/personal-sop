// Focus module mappers (ADR-0025): sessions, their segments and the
// settings row. The phone runs the timer itself, so every change is a plain
// field write: a new segment is a create, closing one writes its
// `ended_at`, a switch or an extension writes the item or `planned_sec`.
// The session's `day`, `focus_sec` and `sets_completed` are derived on the
// server and only read back. Sessions come before segments: a segment's
// session must exist when its create lands.

import {
  DEFAULT_SETTINGS,
  type FocusItem,
  type FocusSegment,
  type FocusSession,
  type FocusSettings,
  type FocusState,
} from "@domain/focus/data"
import { focusStore } from "@domain/focus/store"
import type { Mapper, Payload } from "../mapper"
import { singleton } from "./helpers"

const instant = (v: unknown): string | undefined =>
  v === null || v === undefined ? undefined : new Date(String(v)).toISOString()

function mergeById<T extends { id: string }>(
  rows: T[],
  ups: T[],
  dels: string[],
): T[] {
  const byId = new Map(ups.map((u) => [u.id, u]))
  const gone = new Set(dels)
  const out: T[] = []
  for (const r of rows) {
    const u = byId.get(r.id)
    if (u) {
      out.push(u)
      byId.delete(r.id)
    } else if (!gone.has(r.id)) out.push(r)
  }
  return [...out, ...byId.values()]
}

const itemOut = (i?: FocusItem) => ({
  item_kind: i?.kind ?? null,
  item_id: i?.id ?? null,
  item_title: i?.title?.slice(0, 160) ?? null,
})
function itemIn(row: Payload): FocusItem | undefined {
  const kind = row.item_kind
  if ((kind !== "task" && kind !== "habit") || !row.item_id) return undefined
  return {
    kind,
    id: String(row.item_id),
    ...(row.item_title ? { title: String(row.item_title) } : {}),
  }
}
const presetIn = (v: unknown): FocusSession["preset"] =>
  v === "25-5" || v === "50-10" || v === "90-20" || v === "custom"
    ? v
    : undefined

export function sessionMapper(): Mapper<FocusState, FocusSession> {
  return {
    entity: "focus_session",
    store: focusStore,
    list: (s) => s.sessions,
    id: (x) => x.id,
    toServer: (x) => ({
      mode: x.mode,
      preset: x.preset ?? null,
      focus_min: x.focusMin,
      short_break_min: x.shortBreakMin,
      long_break_min: x.longBreakMin,
      sets_before_long: x.setsBeforeLong,
      auto_start_breaks: x.autoStartBreaks,
      auto_start_focus: x.autoStartFocus,
      started_at: x.startedAt,
      ended_at: x.endedAt ?? null,
      end_reason: x.endReason ?? null,
      // Only a logged session carries these, so timed sessions synced
      // before they existed are not rewritten.
      ...(x.source === "manual"
        ? { source: "manual", label: x.label ?? null }
        : {}),
      ...itemOut(x.item),
    }),
    fromServer: (row) => {
      const out: FocusSession = {
        id: String(row.id),
        mode: row.mode === "stopwatch" ? "stopwatch" : "pomodoro",
        focusMin: Number(row.focus_min ?? 25),
        shortBreakMin: Number(row.short_break_min ?? 5),
        longBreakMin: Number(row.long_break_min ?? 15),
        setsBeforeLong: Number(row.sets_before_long ?? 4),
        autoStartBreaks: Boolean(row.auto_start_breaks),
        autoStartFocus: Boolean(row.auto_start_focus),
        startedAt: instant(row.started_at) ?? new Date().toISOString(),
        focusSec: Number(row.focus_sec ?? 0),
        setsCompleted: Number(row.sets_completed ?? 0),
      }
      const preset = presetIn(row.preset)
      if (preset) out.preset = preset
      const ended = instant(row.ended_at)
      if (ended) out.endedAt = ended
      if (row.end_reason === "completed" || row.end_reason === "abandoned")
        out.endReason = row.end_reason
      const item = itemIn(row)
      if (item) out.item = item
      if (row.source === "manual") out.source = "manual"
      if (row.label != null && row.label !== "") out.label = String(row.label)
      if (row.day) out.day = String(row.day)
      return out
    },
    merge: (s, ups, dels) => ({
      ...s,
      sessions: mergeById(s.sessions, ups, dels),
      // A session deleted elsewhere takes its segments with it.
      segments: dels.length
        ? s.segments.filter((g) => !dels.includes(g.sessionId))
        : s.segments,
    }),
  }
}

export function segmentMapper(): Mapper<FocusState, FocusSegment> {
  return {
    entity: "focus_segment",
    store: focusStore,
    list: (s) => s.segments,
    id: (g) => g.id,
    toServer: (g) => ({
      session_id: g.sessionId,
      kind: g.kind,
      started_at: g.startedAt,
      ended_at: g.endedAt ?? null,
      set_index: g.setIndex,
      planned_sec: g.plannedSec ?? null,
      ...itemOut(g.item),
    }),
    fromServer: (row) => {
      const kind = row.kind
      if (kind !== "focus" && kind !== "break" && kind !== "pause") return null
      const out: FocusSegment = {
        id: String(row.id),
        sessionId: String(row.session_id),
        kind,
        startedAt: instant(row.started_at) ?? new Date().toISOString(),
        setIndex: Number(row.set_index ?? 0),
      }
      const ended = instant(row.ended_at)
      if (ended) out.endedAt = ended
      if (row.planned_sec !== null && row.planned_sec !== undefined)
        out.plannedSec = Number(row.planned_sec)
      const item = itemIn(row)
      if (item) out.item = item
      return out
    },
    merge: (s, ups, dels) => ({
      ...s,
      segments: mergeById(s.segments, ups, dels),
    }),
  }
}

export function settingsMapper(userId: string) {
  return singleton<FocusState, FocusSettings>({
    entity: "focus_settings",
    userId,
    store: focusStore,
    read: (s) => s.settings,
    write: (s, v) => ({ ...s, settings: v, settingsSaved: true }),
    toServer: (v) => ({
      daily_goal_min: v.dailyGoalMin,
      mode: v.mode,
      preset: v.preset,
      focus_min: v.focusMin,
      short_break_min: v.shortBreakMin,
      long_break_min: v.longBreakMin,
      sets_before_long: v.setsBeforeLong,
      auto_start_breaks: v.autoStartBreaks,
      auto_start_focus: v.autoStartFocus,
      notify: v.notify,
    }),
    fromServer: (row, cur) => ({
      ...DEFAULT_SETTINGS,
      ...cur,
      dailyGoalMin: Number(row.daily_goal_min ?? cur.dailyGoalMin),
      mode: row.mode === "stopwatch" ? "stopwatch" : "pomodoro",
      preset:
        row.preset === "25-5" ||
        row.preset === "50-10" ||
        row.preset === "90-20"
          ? row.preset
          : "custom",
      focusMin: Number(row.focus_min ?? cur.focusMin),
      shortBreakMin: Number(row.short_break_min ?? cur.shortBreakMin),
      longBreakMin: Number(row.long_break_min ?? cur.longBreakMin),
      setsBeforeLong: Number(row.sets_before_long ?? cur.setsBeforeLong),
      autoStartBreaks: Boolean(row.auto_start_breaks ?? cur.autoStartBreaks),
      autoStartFocus: Boolean(row.auto_start_focus ?? cur.autoStartFocus),
      notify: Boolean(row.notify ?? cur.notify),
    }),
  })
}

export const focusMappers = (userId: string) => [
  sessionMapper(),
  segmentMapper(),
  settingsMapper(userId),
]
