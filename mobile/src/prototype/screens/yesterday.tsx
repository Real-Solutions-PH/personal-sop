// Yesterday: the page Home's "Yesterday off target" card opens. Yesterday
// only (the person's day before today). First Fern's short read of what
// slipped and why, asked for on open (on demand, kept by the server for the
// day); then every miss of that day, each saying its kind and its cost,
// opening its record on tap, with a reflection note.
import type { Miss } from "@domain/contract"
import { AREA } from "@domain/dash/data"
import * as D from "@domain/dash/hooks"
import { dashStore, noteMiss } from "@domain/dash/store"
import { dayOffset } from "@domain/lib/day"
import { useQueryClient } from "@tanstack/react-query"
import {
  CloudOff,
  ListX,
  MessageSquarePlus,
  PenLine,
  RotateCcw,
  Sparkles,
  Trophy,
} from "lucide-react-native"
import { useState } from "react"
import { View } from "react-native"
import { liveMode } from "@/live/config"
import {
  useYesterdayAnalysis,
  type YesterdayAnalysis,
  yesterdayAnalysisKey,
} from "@/live/yesterday-analysis"
import { FernCelebrates } from "../companion/fern-celebrates"
import { FernSprite } from "../companion/fern-sprite"
import { border, Copy, Frame, Line, SectionHeading, Tap } from "../native-kit"
import { go } from "../navigation"
import { useTheme } from "../theme"
import { Button, Field, Screen, Sheet } from "../ui"
import { missesOn, missKind, missParts, rulesRead } from "../yesterday"
import { LockedPreview } from "./locked-preview"
import { useEndedRuns } from "./today"

const QUICK = ["Sick", "Rest day", "Travel", "Work ran late", "Chose not to"]

const longDay = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  })

export type ReadState =
  | { state: "loading" }
  | { state: "error"; retrying: boolean }
  | {
      state: "ready"
      celebrate: boolean
      source: YesterdayAnalysis["source"]
      points: string[]
    }

export function Yesterday() {
  const day = dayOffset(-1)
  const all = D.useAllMisses(dayOffset(-7), day)
  const misses = missesOn(all, day)
  const week = all.filter((m) => m.day < day)
  const notes = dashStore.use((s) => s.missNotes)
  const ring = D.useOnTarget(7).series.find((d) => d.day === day)
  const ended = useEndedRuns(misses)
  const q = useYesterdayAnalysis(day, liveMode)
  const client = useQueryClient()
  const read: ReadState = !liveMode
    ? {
        state: "ready",
        celebrate: !misses.length,
        source: misses.length ? "rules" : "none",
        points: rulesRead(misses, week, notes),
      }
    : q.data
      ? {
          state: "ready",
          celebrate: q.data.state === "celebrate",
          source: q.data.source,
          points: q.data.points,
        }
      : q.isError
        ? { state: "error", retrying: q.isFetching }
        : { state: "loading" }
  return (
    <YesterdayView
      day={day}
      misses={misses}
      notes={notes}
      ended={ended}
      done={ring?.done ?? null}
      due={ring?.due ?? null}
      read={read}
      onRetry={() =>
        client.refetchQueries({ queryKey: yesterdayAnalysisKey(day) })
      }
    />
  )
}

export function YesterdayView({
  day,
  misses,
  notes,
  ended,
  done,
  due,
  read,
  onRetry,
}: {
  day: string
  misses: Miss[]
  notes: Record<string, string>
  ended: Map<string, number>
  done: number | null
  due: number | null
  read: ReadState
  onRetry: () => void
}) {
  const t = useTheme()
  const [noting, setNoting] = useState<Miss | null>(null)
  const [text, setText] = useState("")
  const offTarget = due !== null && done !== null && due > 0 && done < due
  return (
    <Screen title="Yesterday" eyebrow={longDay(day)}>
      {due !== null && done !== null && due > 0 && (
        <Copy
          size={14}
          weight="medium"
          style={{ color: offTarget ? t.bad : t.good }}
        >
          {done.toLocaleString("en-US")} of {due.toLocaleString("en-US")} done
          {misses.length
            ? ` · ${misses.length.toLocaleString("en-US")} ${misses.length === 1 ? "miss" : "misses"}`
            : ""}
        </Copy>
      )}
      <SectionHeading icon={Sparkles}>Fern’s read</SectionHeading>
      <FernRead read={read} onRetry={onRetry} />
      <SectionHeading
        icon={ListX}
        action={
          misses.length ? (
            <Copy size={12} muted>
              {misses.length.toLocaleString("en-US")}
            </Copy>
          ) : undefined
        }
      >
        What slipped
      </SectionHeading>
      <LockedPreview
        locked={!misses.length}
        title="Nothing slipped yesterday"
        detail="Every habit, task and target held. Misses show here the day after, each with what it cost."
        action={{ label: "See all misses", href: "/stats/misses" }}
        color={t.good}
        icon={Trophy}
      >
        <Frame style={{ paddingHorizontal: 12, paddingVertical: 4 }}>
          {(misses.length ? misses : SAMPLE).map((m, i) => (
            <MissRow
              key={m.id}
              miss={m}
              note={notes[m.id]}
              endedRun={ended.get(m.id)}
              first={i === 0}
              onNote={() => {
                setText(notes[m.id] ?? "")
                setNoting(m)
              }}
            />
          ))}
        </Frame>
      </LockedPreview>
      <Sheet
        title="Reflect on this miss"
        open={!!noting}
        onClose={() => setNoting(null)}
      >
        <Copy muted>{noting ? missParts(noting).name : ""}</Copy>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {QUICK.map((r) => (
            <Tap
              key={r}
              label={r}
              onPress={() => setText(r)}
              style={{
                height: 44,
                justifyContent: "center",
                borderRadius: 22,
                paddingHorizontal: 12,
                backgroundColor: text === r ? t.primary : t.soft,
              }}
            >
              <Copy
                size={12}
                style={{ color: text === r ? t.onPrimary : t.text }}
              >
                {r}
              </Copy>
            </Tap>
          ))}
        </View>
        <Field
          label="Note"
          placeholder="What got in the way, in a few words"
          maxLength={80}
          value={text}
          onChangeText={setText}
        />
        <Line>
          {noting && notes[noting.id] && (
            <Button
              tone="quiet"
              onPress={() => {
                noteMiss(noting.id, "")
                setNoting(null)
              }}
            >
              Clear
            </Button>
          )}
          <View style={{ flex: 1 }}>
            <Button
              icon={PenLine}
              disabled={!text.trim()}
              onPress={() => {
                if (noting) noteMiss(noting.id, text)
                setNoting(null)
              }}
            >
              Save note
            </Button>
          </View>
        </Line>
      </Sheet>
    </Screen>
  )
}

function FernRead({ read, onRetry }: { read: ReadState; onRetry: () => void }) {
  const t = useTheme()
  if (read.state === "loading")
    return (
      <Frame
        style={{ padding: 16, flexDirection: "row", gap: 12 }}
        testID="fern-read-loading"
      >
        <FernSprite size={40} state="thinking" decorative />
        <View
          style={{ flex: 1, gap: 10, paddingTop: 4 }}
          accessible
          accessibilityLabel="Fern is reading yesterday"
        >
          {["92%", "78%", "86%"].map((w) => (
            <View
              key={w}
              style={{
                height: 12,
                width: w as `${number}%`,
                borderRadius: 4,
                backgroundColor: t.soft,
              }}
            />
          ))}
        </View>
      </Frame>
    )
  if (read.state === "error")
    return (
      <Frame style={{ padding: 16, gap: 8 }} testID="fern-read-error">
        <Line style={{ gap: 10 }}>
          <CloudOff size={18} color={t.bad} />
          <Copy weight="medium" style={{ flex: 1 }}>
            Fern couldn’t read yesterday
          </Copy>
        </Line>
        <Copy size={14} muted>
          The server didn’t answer. Your misses below are all there; notes save
          as usual.
        </Copy>
        <Button
          small
          tone="quiet"
          icon={RotateCcw}
          disabled={read.retrying}
          onPress={onRetry}
        >
          {read.retrying ? "Trying again…" : "Try again"}
        </Button>
      </Frame>
    )
  if (read.celebrate)
    return (
      <Frame
        style={{ padding: 16, flexDirection: "row", gap: 12 }}
        testID="fern-read-celebrate"
      >
        <FernCelebrates size={56} />
        <View style={{ flex: 1, gap: 4 }}>
          <Copy weight="semibold" style={{ color: t.good }}>
            Nothing slipped yesterday
          </Copy>
          <Copy size={14} muted>
            A clean day. Keep the same start today and let it carry.
          </Copy>
        </View>
      </Frame>
    )
  return (
    <Frame style={{ padding: 16, gap: 10 }} testID="fern-read">
      <Line style={{ gap: 12, alignItems: "flex-start" }}>
        <FernSprite size={40} state="consoling" decorative />
        <View style={{ flex: 1, gap: 8 }}>
          {read.points.map((p, i) => (
            <Line key={p} style={{ gap: 8, alignItems: "flex-start" }}>
              <View
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  marginTop: 7,
                  backgroundColor:
                    i === read.points.length - 1 ? t.primary : t.muted,
                }}
              />
              <Copy
                size={14}
                weight={i === read.points.length - 1 ? "medium" : undefined}
                style={{ flex: 1 }}
              >
                {p}
              </Copy>
            </Line>
          ))}
        </View>
      </Line>
      {read.source === "rules" && (
        <Copy size={12} muted>
          {liveMode
            ? "AI is off, so this is a quick read of your data."
            : "A quick read of your data. Sign in for Fern’s full read."}
        </Copy>
      )}
    </Frame>
  )
}

function MissRow({
  miss: m,
  note,
  endedRun,
  first,
  onNote,
}: {
  miss: Miss
  note?: string
  endedRun?: number
  first: boolean
  onNote: () => void
}) {
  const t = useTheme()
  const kind = missKind(m.id)
  const { name, cost } = missParts(m, endedRun)
  const accent = t[AREA[m.module].accent]
  const Icon = kind.icon
  return (
    <Line
      testID="yesterday-miss"
      style={{
        gap: 8,
        alignItems: "flex-start",
        paddingVertical: 10,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: border(t.line, 0.5),
      }}
    >
      <Tap
        label={`${kind.word}: ${name}, ${cost}. Open`}
        onPress={() => go(m.href)}
        style={{ flex: 1, flexDirection: "row", gap: 10 }}
      >
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: t.soft,
          }}
        >
          <Icon size={16} color={accent} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Copy size={12} muted>
            {kind.word}
          </Copy>
          <Copy size={14} weight="medium">
            {name}
          </Copy>
          <Copy size={12} style={{ color: t.bad }}>
            {cost}
          </Copy>
          {note ? (
            <Copy size={12} muted>
              “{note}”
            </Copy>
          ) : null}
        </View>
      </Tap>
      <Tap
        label={note ? `Edit note on ${name}` : `Add a note on ${name}`}
        onPress={onNote}
        style={{
          width: 44,
          height: 44,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {note ? (
          <PenLine size={18} color={t.muted} />
        ) : (
          <MessageSquarePlus size={18} color={t.primary} />
        )}
      </Tap>
    </Line>
  )
}

/** What the list looks like with misses in it, dimmed behind the empty
 * state's message. */
const SAMPLE: Miss[] = [
  {
    id: "miss-sample-read",
    day: "",
    title: "Missed: Read 20 pages",
    module: "habits",
    href: "/habits",
  },
  {
    id: "task-overdue:sample",
    day: "",
    title: "Overdue 1d: Send the invoice",
    module: "tasks",
    href: "/tasks",
  },
  {
    id: "nut-over-sample",
    day: "",
    title: "Over calories by 12%",
    module: "nutrition",
    href: "/nutrition",
  },
]
