// One business day of focus as time blocks (ADR-0025): when each focus,
// break and pause ran and what it was on. Swipe or tap to step days.

import * as C from "@domain/focus/calc"
import * as L from "@domain/focus/logic"
import * as P from "@domain/focus/past"
import { useFocusState } from "@domain/focus/store"
import { dayKey } from "@domain/lib/day"
import {
  ChevronLeft,
  ChevronRight,
  History,
  Pencil,
  Play,
} from "lucide-react-native"
import { useMemo, useState } from "react"
import { View } from "react-native"
import { clockOf, FocusTimeline } from "../focus-kit"
import { SwipeStep } from "../motion"
import { Copy, Frame, IconTap, Line, Tap } from "../native-kit"
import { fonts, useTheme } from "../theme"
import { Screen, useNow } from "../ui"
import { PastSessionSheet } from "./focus-past"
import { LockedPreview } from "./locked-preview"

const longDay = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  })

export function FocusDay({ day: initial }: { day?: string }) {
  const t = useTheme(),
    s = useFocusState(),
    now = useNow(),
    today = dayKey(new Date(now)),
    [day, setDay] = useState(initial ?? today),
    // null: closed; "": a new block; an id: that logged session.
    [logging, setLogging] = useState<string | null>(null),
    manual = useMemo(
      () =>
        new Map(
          s.sessions
            .filter((x) => x.source === "manual")
            .map((x) => [x.id, x.label]),
        ),
      [s.sessions],
    ),
    blocks = useMemo(() => C.dayBlocks(s, day, now), [s, day, now]),
    sec = useMemo(
      () => C.rangeStats(s, day, day, now).byDay[day] ?? 0,
      [s, day, now],
    ),
    items = useMemo(
      () => C.itemTotals(P.withLabels(s, C.rangeStats(s, day, day, now).spans)),
      [s, day, now],
    ),
    goal = C.goalSec(s),
    pauses = blocks.filter((b) => b.kind === "pause"),
    pausedSec = pauses.reduce((n, b) => n + (b.end - b.start) / 1000, 0)
  const step = (n: 1 | -1) => {
    const next = C.addDays(day, n)
    if (next <= today) setDay(next)
  }
  return (
    <Screen
      title="Focus timeline"
      actions={
        <IconTap
          size={40}
          icon={History}
          label="Log a past session"
          onPress={() => setLogging("")}
        />
      }
    >
      <Line style={{ marginBottom: 12 }}>
        <IconTap
          size={40}
          icon={ChevronLeft}
          label="Previous day"
          color={t.text}
          onPress={() => step(-1)}
        />
        <Copy weight="semibold" style={{ flex: 1, textAlign: "center" }}>
          {day === today ? "Today" : longDay(day)}
        </Copy>
        <IconTap
          size={40}
          icon={ChevronRight}
          label="Next day"
          color={day < today ? t.text : t.muted}
          onPress={() => step(1)}
        />
      </Line>
      <SwipeStep stepKey={day} onStep={(d) => step(d)}>
        <View style={{ gap: 12 }}>
          <Frame style={{ padding: 16 }}>
            <Line style={{ gap: 20 }}>
              <Stat
                value={L.fmtHm(sec)}
                label={goal ? `of ${L.fmtHm(goal)} goal` : "focused"}
              />
              <Stat
                value={String(pauses.length)}
                label={`pauses · ${L.fmtHm(pausedSec)}`}
              />
              <Stat
                value={String(new Set(blocks.map((b) => b.sessionId)).size)}
                label="sessions"
              />
            </Line>
          </Frame>
          <LockedPreview
            locked={!blocks.length}
            title={day === today ? "No focus yet today" : "No focus this day"}
            detail="Each session shows here as blocks: focus in colour, breaks lighter, pauses hatched."
            action={{
              label: "Log a session you forgot to time",
              onPress: () => setLogging(""),
            }}
            color={t.foc}
            icon={Play}
          >
            <Frame style={{ padding: 16 }}>
              <FocusTimeline
                blocks={blocks.length ? blocks : SAMPLE(day)}
                day={day}
              />
            </Frame>
          </LockedPreview>
          {blocks.length > 0 && (
            <Frame style={{ padding: 16, gap: 8 }}>
              <Copy weight="semibold">Blocks</Copy>
              {blocks.map((b) => (
                <BlockRow
                  key={`${b.segmentId}-${b.start}`}
                  logged={manual.has(b.sessionId)}
                  onEdit={() => setLogging(b.sessionId)}
                >
                  <View
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 3,
                      backgroundColor:
                        b.kind === "focus"
                          ? t.foc
                          : b.kind === "break"
                            ? `${t.foc}40`
                            : t.soft,
                      borderWidth: b.kind === "pause" ? 1 : 0,
                      borderColor: t.muted,
                    }}
                  />
                  <Copy size={14} style={{ fontFamily: fonts.mono, width: 96 }}>
                    {clockOf(b.start)}–{b.running ? "now" : clockOf(b.end)}
                  </Copy>
                  <Copy
                    size={14}
                    lines={1}
                    muted={b.kind !== "focus"}
                    style={{ flex: 1 }}
                  >
                    {b.kind === "focus"
                      ? (b.item?.title ?? manual.get(b.sessionId) ?? "Focus")
                      : b.kind === "pause"
                        ? `Paused ${L.fmtHm((b.end - b.start) / 1000)}`
                        : "Break"}
                    {b.abandoned ? " · discarded" : ""}
                  </Copy>
                </BlockRow>
              ))}
            </Frame>
          )}
          {items.length > 0 && (
            <Frame style={{ padding: 16, gap: 10 }}>
              <Copy weight="semibold">By item</Copy>
              {items.map((x) => (
                <Line key={x.item ? L.itemKey(x.item) : "none"}>
                  <Copy lines={1} style={{ flex: 1 }}>
                    {x.item?.title ?? "Nothing in particular"}
                  </Copy>
                  <Copy style={{ fontFamily: fonts.mono }}>
                    {L.fmtHm(x.sec)}
                  </Copy>
                </Line>
              ))}
            </Frame>
          )}
        </View>
      </SwipeStep>
      <PastSessionSheet
        open={logging !== null}
        onClose={() => setLogging(null)}
        day={day}
        {...(logging ? { editId: logging } : {})}
      />
    </Screen>
  )
}

/** A block's row; a logged session's opens its editor, with a pencil to
 * say so (no tag: the label needs the width). */
function BlockRow({
  logged,
  onEdit,
  children,
}: {
  logged: boolean
  onEdit: () => void
  children: React.ReactNode
}) {
  const t = useTheme()
  if (!logged) return <Line style={{ gap: 10 }}>{children}</Line>
  return (
    <Tap
      onPress={onEdit}
      label="Edit logged session"
      style={{ minHeight: 32, justifyContent: "center" }}
    >
      <Line style={{ gap: 10 }}>
        {children}
        <Pencil size={14} color={t.muted} />
      </Line>
    </Tap>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Copy size={20} style={{ fontFamily: fonts.mono, lineHeight: 26 }}>
        {value}
      </Copy>
      <Copy size={12} muted lines={1}>
        {label}
      </Copy>
    </View>
  )
}

/** The shape of a morning, drawn dimmed under the empty-day card. */
function SAMPLE(day: string): C.Block[] {
  const at = (h: number, m: number) =>
    L.dayStart(day) + ((h - 4) * 60 + m) * 60_000
  const b = (kind: C.Block["kind"], a: number, z: number): C.Block => ({
    sessionId: "sample",
    segmentId: `sample-${a}`,
    kind,
    start: a,
    end: z,
    running: false,
    abandoned: false,
    item:
      kind === "focus"
        ? { kind: "task", id: "sample", title: "Deep work" }
        : null,
  })
  return [
    b("focus", at(9, 0), at(9, 25)),
    b("break", at(9, 25), at(9, 30)),
    b("focus", at(9, 30), at(9, 45)),
    b("pause", at(9, 45), at(9, 50)),
    b("focus", at(9, 50), at(10, 0)),
  ]
}
