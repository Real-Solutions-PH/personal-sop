// The focus timer (ADR-0025): a Pomodoro or a free stopwatch, on a task, a
// habit or nothing. What it shows is read from the session's timestamps
// every second, so it is right after the app was killed or the phone
// locked; nothing here counts.

import * as A from "@domain/focus/actions"
import * as C from "@domain/focus/calc"
import {
  type FocusItem,
  type FocusMode,
  PRESETS,
  type PresetKey,
} from "@domain/focus/data"
import * as L from "@domain/focus/logic"
import { useFocusState } from "@domain/focus/store"
import { dayKey } from "@domain/lib/day"
import { liveStore } from "@domain/lib/live"
import {
  CalendarClock,
  ChartColumn,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Coffee,
  History,
  Pause,
  Play,
  Settings2,
  SkipForward,
  Square,
  Target,
} from "lucide-react-native"
import { useEffect, useMemo, useState } from "react"
import { ScrollView, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import {
  FocusTimeline,
  ItemPicker,
  SessionStrip,
  TimerRing,
} from "../focus-kit"
import { Copy, Frame, IconTap, Line, Segmented, Tap } from "../native-kit"
import { back, go } from "../navigation"
import { fonts, useTheme } from "../theme"
import { Button, confirm, Sheet, useNow } from "../ui"
import { PastSessionSheet } from "./focus-past"

type PresetChoice = PresetKey | "custom"

export function FocusTimer() {
  const t = useTheme(),
    safe = useSafeAreaInsets(),
    s = useFocusState(),
    now = useNow(),
    live = liveStore.use((x) => x.live),
    [mode, setMode] = useState<FocusMode>(s.settings.mode),
    [preset, setPreset] = useState<PresetChoice>(s.settings.preset),
    [pick, setPick] = useState(false),
    [next, setNext] = useState<FocusItem | null>(null),
    [ending, setEnding] = useState(false),
    [logging, setLogging] = useState(false)
  // Write down a set that ended on screen, so it syncs as it happens.
  // biome-ignore lint/correctness/useExhaustiveDependencies: now is the clock tick
  useEffect(() => A.tickFocus(), [now])
  const session = A.current(s),
    tl = useMemo(
      () => (session ? L.advance(A.timelineOf(s, session), now) : null),
      [s, session, now],
    ),
    p = tl ? L.phase(tl, now) : null,
    today = dayKey(new Date(now)),
    todaySec = useMemo(
      () => C.rangeStats(s, today, today, now).byDay[today] ?? 0,
      [s, today, now],
    ),
    goal = C.goalSec(s),
    blocks = useMemo(
      () =>
        session
          ? C.dayBlocks(s, today, now).filter((b) => b.sessionId === session.id)
          : [],
      [s, session, today, now],
    )
  const lengths: [number, number, number, number] =
    preset === "custom"
      ? [
          s.settings.focusMin,
          s.settings.shortBreakMin,
          s.settings.longBreakMin,
          s.settings.setsBeforeLong,
        ]
      : PRESETS[preset].lengths
  const start = () => {
    if (live && live.kind !== "focus") {
      confirm(
        "Another activity is running",
        `Finish or pause ${live.label} before starting a focus session.`,
        () => go(live.href),
      )
      return
    }
    A.startFocus({
      mode,
      preset: mode === "pomodoro" ? preset : undefined,
      lengths,
      item: next,
    })
  }
  const item = p?.item ?? session?.item ?? null
  const accent = p?.kind === "break" ? t.good : t.foc
  const progress = p?.plannedSec
    ? p.elapsed / p.plannedSec
    : p
      ? (p.elapsed % 3600) / 3600
      : 0
  const clock = !p
    ? L.fmtClock(mode === "pomodoro" ? lengths[0] * 60 : 0)
    : p.remaining !== null
      ? L.fmtClock(p.remaining)
      : L.fmtClock(p.elapsed)
  const sets = tl?.sess.setsBeforeLong ?? lengths[3]
  const status = !p
    ? mode === "pomodoro"
      ? `${lengths[0]} min focus · ${lengths[1]} min break`
      : "Counts up until you stop"
    : p.status === "paused"
      ? `Paused · ${p.kind === "break" ? "break" : `set ${p.setIndex + 1}`}`
      : p.status === "waiting"
        ? p.kind === "break"
          ? `Set ${p.setIndex + 1} done · ${p.longBreak ? "long " : ""}break next`
          : `Break over · set ${p.setIndex + 1} next`
        : p.kind === "break"
          ? p.longBreak
            ? "Long break"
            : "Short break"
          : tl?.sess.mode === "stopwatch"
            ? "Stopwatch"
            : `Focus · set ${p.setIndex + 1} of ${sets}`
  const round = (size: number, color: string) => ({
    width: size,
    height: size,
    borderRadius: size / 2,
    backgroundColor: color,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  })
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: t.bg,
        paddingTop: safe.top,
        paddingBottom: safe.bottom,
      }}
    >
      <Line style={{ height: 56, paddingHorizontal: 8 }}>
        <IconTap
          size={40}
          icon={ChevronDown}
          label={session ? "Minimise, keeps running" : "Close"}
          color={t.text}
          onPress={() => back("/today")}
        />
        <Copy
          size={14}
          weight="medium"
          muted
          style={{ flex: 1, textAlign: "center" }}
        >
          Focus
        </Copy>
        <IconTap
          size={40}
          icon={Settings2}
          label="Focus settings"
          color={t.text}
          onPress={() => go("/focus/settings")}
        />
      </Line>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: 32,
          gap: 20,
          alignItems: "center",
        }}
      >
        {!session && (
          <View style={{ width: "100%", gap: 12 }}>
            <Segmented
              value={mode}
              onChange={setMode}
              options={[
                { value: "pomodoro", label: "Pomodoro" },
                { value: "stopwatch", label: "Stopwatch" },
              ]}
            />
            {mode === "pomodoro" && (
              <Segmented
                value={preset}
                onChange={setPreset}
                options={[
                  ...(Object.keys(PRESETS) as PresetKey[]).map((k) => ({
                    value: k as PresetChoice,
                    label: `${PRESETS[k].lengths[0]}/${PRESETS[k].lengths[1]}`,
                  })),
                  { value: "custom" as PresetChoice, label: "Custom" },
                ]}
              />
            )}
          </View>
        )}
        <ItemChip
          item={session ? item : next}
          onPress={() => setPick(true)}
          switching={!!session}
        />
        <TimerRing value={progress} size={264} stroke={10} color={accent}>
          <Copy
            size={56}
            lines={1}
            style={{
              fontFamily: fonts.mono,
              lineHeight: 64,
              letterSpacing: -1,
              paddingHorizontal: 16,
              color: p?.status === "paused" ? t.muted : t.text,
            }}
          >
            {clock}
          </Copy>
          <Copy size={14} muted lines={1} style={{ maxWidth: 200 }}>
            {status}
          </Copy>
          {tl?.sess.mode === "pomodoro" && (
            <Line style={{ gap: 6, marginTop: 10 }}>
              {Array.from({ length: sets }, (_, i) => {
                const k = (p?.setIndex ?? 0) - ((p?.setIndex ?? 0) % sets) + i
                const done =
                  L.setsCompleted(
                    {
                      sess: tl.sess,
                      segs: tl.segs.filter((g) => g.setIndex === k),
                    },
                    now,
                  ) > 0
                return (
                  <View
                    key={i}
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: done ? t.foc : t.soft,
                    }}
                  />
                )
              })}
            </Line>
          )}
        </TimerRing>
        {!session ? (
          <Tap label="Start focus" onPress={start} style={round(88, t.foc)}>
            <Play size={36} color={t.bg} fill={t.bg} />
          </Tap>
        ) : p?.status === "waiting" ? (
          <Line style={{ gap: 16 }}>
            {p.kind === "break" && (
              <Tap
                label="Skip the break"
                onPress={A.skipBreak}
                style={round(56, t.soft)}
              >
                <SkipForward size={22} color={t.text} />
              </Tap>
            )}
            <Tap
              label={
                p.kind === "break"
                  ? "Start the break"
                  : `Start set ${p.setIndex + 1}`
              }
              onPress={A.nextFocus}
              style={round(80, accent)}
            >
              {p.kind === "break" ? (
                <Coffee size={30} color={t.bg} />
              ) : (
                <Play size={32} color={t.bg} fill={t.bg} />
              )}
            </Tap>
            <Tap
              label="End session"
              onPress={() => setEnding(true)}
              style={round(56, t.soft)}
            >
              <Square size={20} color={t.text} fill={t.text} />
            </Tap>
          </Line>
        ) : (
          <Line style={{ gap: 16 }}>
            {p?.kind === "break" ? (
              <Tap
                label="Skip the break"
                onPress={A.skipBreak}
                style={round(56, t.soft)}
              >
                <SkipForward size={22} color={t.text} />
              </Tap>
            ) : p?.plannedSec ? (
              <Tap
                label="Add 5 minutes"
                onPress={() => {
                  A.extendFocus(300)
                }}
                style={round(56, t.soft)}
              >
                <Copy
                  size={14}
                  weight="semibold"
                  style={{ fontFamily: fonts.mono }}
                >
                  +5m
                </Copy>
              </Tap>
            ) : (
              // A stopwatch has no length to extend.
              <View style={{ width: 56 }} />
            )}
            <Tap
              label={p?.status === "paused" ? "Resume" : "Pause"}
              onPress={() =>
                p?.status === "paused" ? A.resumeFocus() : A.pauseFocus()
              }
              style={round(80, accent)}
            >
              {p?.status === "paused" ? (
                <Play size={32} color={t.bg} fill={t.bg} />
              ) : (
                <Pause size={32} color={t.bg} fill={t.bg} />
              )}
            </Tap>
            <Tap
              label="End session"
              onPress={() => setEnding(true)}
              style={round(56, t.soft)}
            >
              <Square size={20} color={t.text} fill={t.text} />
            </Tap>
          </Line>
        )}
        {session && blocks.length > 0 && (
          <View style={{ width: "100%", gap: 6 }}>
            <SessionStrip blocks={blocks} />
            <Line>
              <Copy size={12} muted style={{ flex: 1 }}>
                This session · {L.fmtHm(tl ? L.focusSec(tl, now) : 0)} focused
              </Copy>
              <Copy size={12} muted>
                {pauseLabel(blocks.filter((b) => b.kind === "pause").length)}
              </Copy>
            </Line>
          </View>
        )}
        <TodayGoal sec={todaySec} goal={goal} />
        <View style={{ width: "100%", gap: 8 }}>
          <NavRow
            icon={CalendarClock}
            label="Today's timeline"
            detail="Every block, pause and switch"
            onPress={() => go(`/focus/day?day=${today}`)}
          />
          <NavRow
            icon={History}
            label="Log a past session"
            detail="Forgot the timer? Add the block afterwards"
            onPress={() => setLogging(true)}
          />
          <NavRow
            icon={ChartColumn}
            label="Focus stats"
            detail="Hours, goal streak, time by item"
            onPress={() => go("/focus/stats")}
          />
        </View>
        {!session && (
          <View style={{ width: "100%" }}>
            <FocusTimeline
              blocks={C.dayBlocks(s, today, now)}
              day={today}
              dimmed={!C.dayBlocks(s, today, now).length}
            />
          </View>
        )}
        <Copy size={12} muted style={{ textAlign: "center" }}>
          Safe to lock your phone or close the app: the timer keeps time from
          when each block started.
        </Copy>
      </ScrollView>
      <ItemPicker
        open={pick}
        onClose={() => setPick(false)}
        current={session ? item : next}
        onPick={(i) => {
          if (session) {
            A.switchFocusItem(i)
          } else setNext(i)
        }}
      />
      <Sheet
        title="End this session?"
        open={ending}
        onClose={() => setEnding(false)}
      >
        <Copy size={14} muted>
          {tl
            ? `${L.fmtHm(L.focusSec(tl, now))} focused${
                tl.sess.mode === "pomodoro"
                  ? `, ${L.setsCompleted(tl, now)} of ${tl.sess.setsBeforeLong} sets`
                  : ""
              }.`
            : ""}
        </Copy>
        <Button
          onPress={() => {
            A.stopFocus()
            setEnding(false)
          }}
        >
          End and keep it
        </Button>
        <Button tone="quiet" onPress={() => setEnding(false)}>
          Keep going
        </Button>
        <Button
          tone="danger"
          onPress={() => {
            A.stopFocus(true)
            setEnding(false)
          }}
        >
          Discard session
        </Button>
      </Sheet>
      <PastSessionSheet open={logging} onClose={() => setLogging(false)} />
    </View>
  )
}

const pauseLabel = (n: number) =>
  n === 0
    ? "No pauses"
    : n === 1
      ? "1 pause"
      : `${n.toLocaleString("en-US")} pauses`

function ItemChip({
  item,
  onPress,
  switching,
}: {
  item: FocusItem | null
  onPress: () => void
  switching: boolean
}) {
  const t = useTheme()
  const Icon = item?.kind === "habit" ? Target : CheckSquare
  return (
    <Tap
      label={
        item
          ? `Working on ${item.title}. Change`
          : "Pick what you're working on"
      }
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 14,
        height: 40,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: t.line,
        maxWidth: "100%",
      }}
    >
      {item ? (
        <Icon size={16} color={item.kind === "habit" ? t.hab : t.tsk} />
      ) : null}
      <Copy size={14} weight="medium" lines={1} style={{ flexShrink: 1 }}>
        {item?.title ??
          (switching ? "Nothing in particular" : "What are you working on?")}
      </Copy>
      <Copy size={12} muted>
        {switching ? "Switch" : "Pick"}
      </Copy>
    </Tap>
  )
}

function TodayGoal({ sec, goal }: { sec: number; goal: number }) {
  const t = useTheme()
  return (
    <Frame style={{ width: "100%", padding: 16, gap: 8 }}>
      <Line>
        <Copy weight="semibold" style={{ flex: 1 }}>
          Today
        </Copy>
        <Copy style={{ fontFamily: fonts.mono }}>
          {L.fmtHm(sec)}
          {goal ? ` / ${L.fmtHm(goal)}` : ""}
        </Copy>
      </Line>
      {goal > 0 && (
        <View style={{ height: 8, borderRadius: 4, backgroundColor: t.soft }}>
          <View
            style={{
              height: 8,
              borderRadius: 4,
              width: `${Math.min(100, (sec / goal) * 100)}%`,
              backgroundColor: sec >= goal ? t.good : t.foc,
            }}
          />
        </View>
      )}
      <Copy size={12} muted>
        {!goal
          ? "No daily goal set"
          : sec >= goal
            ? "Daily goal reached"
            : `${L.fmtHm(goal - sec)} to your daily goal`}
      </Copy>
    </Frame>
  )
}

function NavRow({
  icon: Icon,
  label,
  detail,
  onPress,
}: {
  icon: typeof ChartColumn
  label: string
  detail: string
  onPress: () => void
}) {
  const t = useTheme()
  return (
    <Tap label={label} onPress={onPress}>
      <Frame style={{ padding: 14 }}>
        <Line>
          <Icon size={18} color={t.foc} />
          <View style={{ flex: 1 }}>
            <Copy weight="medium">{label}</Copy>
            <Copy size={12} muted>
              {detail}
            </Copy>
          </View>
          <ChevronRight size={16} color={t.muted} />
        </Line>
      </Frame>
    </Tap>
  )
}
