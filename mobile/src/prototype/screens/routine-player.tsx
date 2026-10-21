import * as A from "@domain/habits/actions"
import * as L from "@domain/habits/logic"
import { habitsStore } from "@domain/habits/store"
import { dayKey, fmtDuration } from "@domain/lib/day"
import { liveStore } from "@domain/lib/live"
import {
  Check,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  X,
} from "lucide-react-native"
import { useEffect, useRef, useState } from "react"
import { Pressable, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Copy, Frame, IconTap, Line, Tap } from "../native-kit"
import { back, go, replace } from "../navigation"
import { useTheme } from "../theme"
import { Button, confirm, useNow } from "../ui"
import { Ring } from "../visual"
export function RoutinePlayer({ id }: { id: string }) {
  const t = useTheme(),
    safe = useSafeAreaInsets(),
    s = habitsStore.use((s) => s),
    r = s.routines.find((r) => r.id === id),
    today = dayKey(),
    run = [...s.runs]
      .reverse()
      .find(
        (r) => r.routineId === id && r.day === today && r.state !== "abandoned",
      ),
    live = liveStore.use((s) => s.live),
    now = useNow(),
    [redo, setRedo] = useState<string | null>(null),
    leaving = useRef(false)
  useEffect(() => {
    if (run?.state === "in_progress" && !live && !leaving.current)
      A.startRoutine(id)
  }, [run?.state, live, id])
  if (!r)
    return (
      <View>
        <Copy>Routine not found</Copy>
      </View>
    )
  const start = () => {
    if (live && live.href !== A.playerHref(id)) {
      confirm(
        "Another activity is running",
        "Return to your current activity before starting this routine.",
        () => go(live.href),
      )
      return
    }
    A.startRoutine(id)
  }
  const step = run?.steps[run.current],
    h = s.habits.find((h) => h.id === step?.habitId),
    next = run?.steps[(run?.current ?? 0) + 1],
    nextHabit = s.habits.find((h) => h.id === next?.habitId),
    log = step
      ? s.logs.find((l) => l.habitId === step.habitId && l.day === today)
      : undefined,
    already =
      log?.status === "done" &&
      log.source !== "routine" &&
      redo !== step?.habitId
  const running = run?.state === "in_progress" && step && h
  const leave = () => {
    leaving.current = true
    A.exitRoutine()
    go("/today")
  }
  const act = (fn: typeof A.stepDone) => {
    if (!run) return
    fn(run)
    if (
      habitsStore.get().runs.find((x) => x.id === run.id)?.state === "completed"
    )
      replace(`/habits/routines/${id}/summary?run=${run.id}`)
  }
  const planned = step ? step.minutes * 60 + (run?.stepBonusSec ?? 0) : 0,
    elapsed = run ? L.stepElapsed(run, now) : 0,
    remaining = planned - elapsed,
    total = run
      ? ((run.pausedAt ? new Date(run.pausedAt).getTime() : now) -
          new Date(run.startedAt).getTime()) /
        1000
      : 0
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: t.bg,
        paddingTop: safe.top,
        paddingBottom: safe.bottom,
      }}
    >
      <Line style={{ height: 56, paddingHorizontal: 8, gap: 8 }}>
        <IconTap
          size={40}
          icon={X}
          label={running ? "Leave routine" : "Close"}
          color={t.text}
          onPress={() =>
            running
              ? confirm(
                  "Leave routine?",
                  `Progress is kept (${run.current}/${run.steps.length} steps). Resume from Today until the day ends; after that, unreached steps count as missed.`,
                  leave,
                )
              : back()
          }
        />
        {running && (
          <>
            <Copy
              size={14}
              weight="medium"
              lines={1}
              style={{ flex: 1, textAlign: "center" }}
            >
              {r.icon} {r.name}
            </Copy>
            <Copy size={14} muted style={{ width: 40, textAlign: "center" }}>
              {run.current + 1}/{run.steps.length}
            </Copy>
          </>
        )}
      </Line>
      {!running ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            paddingHorizontal: 24,
          }}
        >
          <View
            style={{
              width: 80,
              height: 80,
              borderRadius: 24,
              backgroundColor: `${t.hab}1f`,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Copy size={40}>{r.icon}</Copy>
          </View>
          <View>
            <Copy size={24} weight="semibold" style={{ textAlign: "center" }}>
              {r.name}
            </Copy>
            <Copy muted style={{ textAlign: "center" }}>
              {r.steps.length} steps · {L.plannedMin(r)} min
            </Copy>
          </View>
          {run?.state === "completed" && (
            <Tap
              onPress={() => go(`/habits/routines/${id}/summary?run=${run.id}`)}
            >
              <Copy size={14} style={{ color: t.good }}>
                ✓ Done today in {fmtDuration(L.runActualSec(run))} — see summary
              </Copy>
            </Tap>
          )}
          <View style={{ width: "100%", maxWidth: 320, gap: 4 }}>
            {r.steps.map((step, i) => {
              const h = s.habits.find((h) => h.id === step.habitId)
              return (
                <Line key={i} style={{ gap: 8 }}>
                  <Copy size={14} muted style={{ width: 20 }}>
                    {i + 1}
                  </Copy>
                  <Copy size={14}>{h?.icon}</Copy>
                  <Copy size={14} lines={1} style={{ flex: 1 }}>
                    {h?.name}
                  </Copy>
                  <Copy size={14} muted>
                    {step.minutes}m
                  </Copy>
                </Line>
              )
            })}
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={!r.steps.length}
            onPress={start}
            style={{
              height: 56,
              width: "100%",
              maxWidth: 320,
              borderRadius: 14,
              backgroundColor: t.hab,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Line style={{ gap: 8 }}>
              <Play size={20} color={t.bg} fill={t.bg} />
              <Copy weight="semibold" style={{ color: t.bg }}>
                {run?.state === "completed" ? "Run again" : "Start"}
              </Copy>
            </Line>
          </Pressable>
        </View>
      ) : (
        <>
          <Line style={{ paddingHorizontal: 16, gap: 4 }}>
            {run.steps.map((_, i) => (
              <View
                key={i}
                style={{
                  height: 6,
                  borderRadius: 3,
                  flex: 1,
                  backgroundColor:
                    i < run.current
                      ? run.results[i]?.status === "skipped"
                        ? `${t.warn}99`
                        : t.hab
                      : i === run.current
                        ? `${t.hab}80`
                        : t.soft,
                }}
              />
            ))}
          </Line>
          <View
            style={{
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              gap: 20,
              paddingHorizontal: 24,
            }}
          >
            <View style={{ alignItems: "center", gap: 8 }}>
              <View
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 16,
                  backgroundColor: `${t.hab}1f`,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Copy size={28}>{h.icon}</Copy>
              </View>
              <Copy size={24} weight="semibold">
                {h.name}
              </Copy>
              <Copy size={14} muted>
                Planned {step.minutes} min
                {run.stepBonusSec > 0 ? ` +${run.stepBonusSec / 60}` : ""}
              </Copy>
            </View>
            {already ? (
              <Frame
                style={{ padding: 16, width: "100%", maxWidth: 320, gap: 8 }}
              >
                <Copy
                  weight="semibold"
                  style={{ color: t.good, textAlign: "center" }}
                >
                  ✓ Already done today
                </Copy>
                <Copy size={14} muted style={{ textAlign: "center" }}>
                  Logged via {log.source}. Skip ahead or redo it.
                </Copy>
                <Line>
                  <View style={{ flex: 1 }}>
                    <Button tone="quiet" onPress={() => setRedo(step.habitId)}>
                      Redo
                    </Button>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button onPress={() => act(A.stepContinue)}>
                      Continue
                    </Button>
                  </View>
                </Line>
              </Frame>
            ) : (
              <Ring
                value={planned ? elapsed / planned : 0}
                size={240}
                strokeWidth={10}
                color={remaining < 0 ? t.warn : t.hab}
              >
                <Copy
                  size={48}
                  weight="semibold"
                  style={{
                    color: remaining < 0 ? t.warn : t.text,
                    opacity: run.pausedAt ? 0.6 : 1,
                  }}
                >
                  {remaining < 0
                    ? `+${fmtDuration(-remaining)}`
                    : fmtDuration(remaining)}
                </Copy>
                <Copy size={14} muted>
                  {run.pausedAt
                    ? "paused"
                    : remaining < 0
                      ? "over plan"
                      : "left"}
                </Copy>
              </Ring>
            )}
            <View>
              <Copy size={14} muted style={{ textAlign: "center" }}>
                {nextHabit
                  ? `Up next · ${nextHabit.icon} ${nextHabit.name} · ${next?.minutes}m`
                  : "Last step"}
              </Copy>
              <Copy
                size={12}
                muted
                style={{ textAlign: "center", marginTop: 4 }}
              >
                Total {fmtDuration(Math.max(0, total))} /{" "}
                {fmtDuration(run.steps.reduce((a, s) => a + s.minutes * 60, 0))}{" "}
                planned
              </Copy>
            </View>
          </View>
          <View style={{ gap: 12, paddingHorizontal: 16, paddingBottom: 24 }}>
            <Line style={{ gap: 8 }}>
              {[
                {
                  label: "Back",
                  icon: SkipBack,
                  action: () => A.stepBack(run),
                  disabled: run.current === 0,
                },
                {
                  label: "Skip",
                  icon: SkipForward,
                  action: () => act(A.stepSkip),
                },
                {
                  label: run.pausedAt ? "Resume" : "Pause",
                  icon: run.pausedAt ? Play : Pause,
                  action: () => A.toggleRunPause(run),
                },
                {
                  label: "+1 min",
                  icon: null,
                  action: () => A.stepAddMinute(run),
                },
              ].map((b) => (
                <Pressable
                  key={b.label}
                  accessibilityRole="button"
                  accessibilityLabel={b.label}
                  disabled={b.disabled}
                  onPress={b.action}
                  style={{
                    flex: 1,
                    height: 64,
                    borderRadius: 16,
                    backgroundColor: t.soft,
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 4,
                    opacity: b.disabled ? 0.3 : 1,
                  }}
                >
                  {b.icon ? (
                    <b.icon size={20} color={t.text} />
                  ) : (
                    <Copy weight="semibold">+1</Copy>
                  )}
                  <Copy size={12} weight="medium">
                    {b.label}
                  </Copy>
                </Pressable>
              ))}
            </Line>
            {!already && (
              <Tap
                onPress={() => act(A.stepDone)}
                style={{
                  height: 64,
                  borderRadius: 14,
                  backgroundColor: t.hab,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Line style={{ gap: 8 }}>
                  <Check size={24} color={t.bg} />
                  <Copy size={18} weight="semibold" style={{ color: t.bg }}>
                    Done
                  </Copy>
                </Line>
              </Tap>
            )}
          </View>
        </>
      )}
    </View>
  )
}
