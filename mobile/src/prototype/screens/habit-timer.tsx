import * as A from "@domain/habits/actions"
import { targetLabel } from "@domain/habits/logic"
import { habitsStore } from "@domain/habits/store"
import { fmtDuration } from "@domain/lib/day"
import { elapsedSec, liveStore } from "@domain/lib/live"
import { ChevronDown, Pause, Play, Square } from "lucide-react-native"
import { useEffect, useState } from "react"
import { View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Copy, IconTap, Line, Tap } from "../native-kit"
import { back, go } from "../navigation"
import { useTheme } from "../theme"
import { Button, confirm, Field, Sheet, useNow } from "../ui"
import { Ring } from "../visual"
export function HabitTimer({ id }: { id: string }) {
  const t = useTheme(),
    safe = useSafeAreaInsets(),
    s = habitsStore.use((s) => s),
    h = s.habits.find((h) => h.id === id),
    live = liveStore.use((s) => s.live),
    now = useNow(),
    [finish, setFinish] = useState(false),
    [minutes, setMinutes] = useState("1")
  const own = live?.href === A.timerHref(id) && s.timer?.habitId === id,
    elapsed = own && live ? elapsedSec(live, now) : 0,
    target = own ? s.timer?.targetSec : undefined,
    over = target ? elapsed - target : 0,
    paused = own && !!live?.pausedAt,
    stale = own && elapsed > Math.min(14400, target ? target * 2 : 14400)
  useEffect(() => {
    if (stale) {
      setMinutes(String(Math.max(1, Math.round(elapsed / 60))))
      setFinish(true)
    }
  }, [stale, elapsed])
  if (!h)
    return (
      <View>
        <Copy>Habit not found</Copy>
      </View>
    )
  const start = () => {
    if (live && !own) {
      confirm(
        "Another activity is running",
        "Return to your current activity before starting this timer.",
        () => go(live.href),
      )
      return
    }
    A.startTimer(id)
  }
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
          label="Minimise — keeps running"
          color={t.text}
          onPress={() => back()}
        />
        <Copy
          size={14}
          weight="medium"
          muted
          style={{ flex: 1, textAlign: "center" }}
        >
          {own ? (paused ? "Paused" : "Focusing") : "Focus timer"}
        </Copy>
        <View style={{ width: 40 }} />
      </Line>
      {!own ? (
        <View
          style={{
            flex: 1,
            paddingHorizontal: 24,
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
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
            <Copy size={40}>{h.icon}</Copy>
          </View>
          <View>
            <Copy size={24} weight="semibold" style={{ textAlign: "center" }}>
              {h.name}
            </Copy>
            <Copy muted style={{ textAlign: "center" }}>
              {h.type === "duration" ? `Target ${targetLabel(h)}` : "Counts up"}
            </Copy>
          </View>
          <Tap
            label="Start timer"
            onPress={start}
            style={{
              width: 96,
              height: 96,
              borderRadius: 48,
              marginTop: 24,
              backgroundColor: t.hab,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Play size={40} fill={t.bg} color={t.bg} />
          </Tap>
          <Tap onPress={() => go(`/habits/${id}`)}>
            <Copy size={14} muted>
              Log time manually instead
            </Copy>
          </Tap>
        </View>
      ) : (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: 24,
            paddingHorizontal: 24,
          }}
        >
          <Line style={{ gap: 8 }}>
            <Copy size={20}>{h.icon}</Copy>
            <Copy weight="medium" muted>
              {h.name}
            </Copy>
          </Line>
          <Ring
            value={target ? elapsed / target : (elapsed % 3600) / 3600}
            size={272}
            strokeWidth={10}
            color={over > 0 ? t.good : t.hab}
          >
            <Copy
              size={60}
              weight="semibold"
              style={{
                lineHeight: 60,
                letterSpacing: -1.5,
                color: paused ? t.muted : over > 0 ? t.good : t.text,
              }}
            >
              {target
                ? over > 0
                  ? `+${fmtDuration(over)}`
                  : fmtDuration(target - elapsed)
                : fmtDuration(elapsed)}
            </Copy>
            <Copy size={14} muted style={{ marginTop: 4 }}>
              {target
                ? over > 0
                  ? `Target ${Math.round(target / 60)}m reached`
                  : `of ${Math.round(target / 60)} min · ${fmtDuration(elapsed)} in`
                : "counting up"}
            </Copy>
          </Ring>
          <Line style={{ gap: 20 }}>
            <Tap
              label="Add 5 minutes"
              onPress={() => A.extendTimer(300)}
              style={{
                width: 56,
                height: 56,
                borderRadius: 28,
                backgroundColor: t.soft,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Copy size={14} weight="semibold">
                +5m
              </Copy>
            </Tap>
            <Tap
              label={paused ? "Resume" : "Pause"}
              onPress={() => (paused ? A.resumeLive() : A.pauseLive())}
              style={{
                width: 80,
                height: 80,
                borderRadius: 40,
                backgroundColor: t.hab,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {paused ? (
                <Play size={32} color={t.bg} fill={t.bg} />
              ) : (
                <Pause size={32} color={t.bg} fill={t.bg} />
              )}
            </Tap>
            <Tap
              label="Stop"
              onPress={() => {
                setMinutes(String(Math.max(1, Math.round(elapsed / 60))))
                setFinish(true)
              }}
              style={{
                width: 56,
                height: 56,
                borderRadius: 28,
                backgroundColor: t.soft,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Square size={20} color={t.text} fill={t.text} />
            </Tap>
          </Line>
          <Copy size={12} muted style={{ textAlign: "center" }}>
            Safe to lock your phone or close the app — time is kept from
            timestamps.
          </Copy>
        </View>
      )}
      <Sheet
        title="Log this session"
        open={finish}
        onClose={() => setFinish(false)}
      >
        <Copy size={14} muted>
          {stale
            ? `Timer ran ${fmtDuration(elapsed)} — did you forget it? Adjust before saving.`
            : `${h.name} · ${fmtDuration(elapsed)} elapsed`}
        </Copy>
        <Field
          label="Minutes to log"
          value={minutes}
          onChangeText={setMinutes}
          keyboardType="numeric"
        />
        <Button
          disabled={!(Number(minutes) > 0)}
          onPress={() => {
            A.finishTimer(Number(minutes))
            setFinish(false)
            go(`/habits/${id}`)
          }}
        >
          Save log
        </Button>
        <Button tone="quiet" onPress={() => setFinish(false)}>
          Keep going
        </Button>
        <Button
          tone="danger"
          onPress={() => {
            A.discardTimer()
            setFinish(false)
            back()
          }}
        >
          Discard session
        </Button>
      </Sheet>
    </View>
  )
}
