import { addJournalEntry } from "@domain/capture/actions"
import type { CalendarItem } from "@domain/contract"
import { AREA } from "@domain/dash/data"
import {
  useAllCalendar,
  useAllMisses,
  useOnTarget,
  useTodayRing,
} from "@domain/dash/hooks"
import {
  dashStore,
  markAllRead,
  markNotifRead,
  sealDay,
  unsealDay,
} from "@domain/dash/store"
import { checkHabit, skipHabit } from "@domain/habits/actions"
import { openCapture } from "@domain/lib/capture"
import { dayKey, dayOffset } from "@domain/lib/day"
import { completeTask, rescheduleBy } from "@domain/tasks/actions"
import {
  ArrowRight,
  Bell,
  Check,
  MailOpen,
  Mic,
  Sparkles,
  Target,
  Trophy,
  X,
} from "lucide-react-native"
import { useState } from "react"
import { TextInput, View } from "react-native"
import { toast } from "sonner-native"
import {
  border,
  Copy,
  Frame,
  IconTap,
  Line,
  SectionHeading,
  Tap,
} from "../native-kit"
import { go } from "../navigation"
import { fonts, useTheme } from "../theme"
import { Button, Screen, SwipeRow, undo } from "../ui"
import { Ring } from "../visual"

const colors = {
  habits: "hab",
  tasks: "tsk",
  fitness: "fit",
  finance: "fin",
} as const
const icons = {
  reminder: Bell,
  achievement: Trophy,
  review: Sparkles,
  system: Target,
}
export function Inbox() {
  const t = useTheme(),
    notifs = dashStore.use((s) => s.notifs),
    today = dayKey(),
    yesterday = dayOffset(-1)
  return (
    <Screen
      title="Notifications"
      actions={
        notifs.some((n) => !n.read) && (
          <Tap onPress={markAllRead} style={{ padding: 8 }}>
            <Copy size={14} weight="medium" style={{ color: t.primary }}>
              Mark all read
            </Copy>
          </Tap>
        )
      }
    >
      <View>
        {["Today", "Yesterday", "Earlier"].map((label) => {
          const list = [...notifs]
            .sort((a, b) => b.at.localeCompare(a.at))
            .filter((n) => {
              const d = dayKey(new Date(n.at))
              return (
                (d === today
                  ? "Today"
                  : d === yesterday
                    ? "Yesterday"
                    : "Earlier") === label
              )
            })
          return !list.length ? null : (
            <View key={label}>
              <SectionHeading>{label}</SectionHeading>
              <Frame style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
                {list.map((n) => {
                  const I = icons[n.kind]
                  return (
                    <SwipeRow
                      key={n.id}
                      background={t.card}
                      completeLabel={n.read ? "Read" : "Mark read"}
                      completeIcon={MailOpen}
                      onComplete={() => markNotifRead(n.id)}
                      dismissLabel="Dismiss"
                      onDismiss={() => {
                        const before = dashStore.get().notifs
                        dashStore.set((s) => ({
                          ...s,
                          notifs: s.notifs.filter((x) => x.id !== n.id),
                        }))
                        undo("Notification dismissed", () =>
                          dashStore.set((s) => ({ ...s, notifs: before })),
                        )
                      }}
                    >
                      <Tap
                        onPress={() => {
                          markNotifRead(n.id)
                          go(n.href)
                        }}
                        style={{
                          flexDirection: "row",
                          alignItems: "flex-start",
                          gap: 12,
                          paddingHorizontal: 4,
                          paddingVertical: 10,
                        }}
                      >
                        <View
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: 18,
                            marginTop: 2,
                            backgroundColor:
                              n.kind === "achievement"
                                ? border(t.life, 0.15)
                                : t.soft,
                            justifyContent: "center",
                            alignItems: "center",
                          }}
                        >
                          <I
                            size={16}
                            color={n.kind === "achievement" ? t.life : t.muted}
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Copy
                            size={14}
                            weight={n.read ? "body" : "semibold"}
                            lines={1}
                          >
                            {n.title}
                          </Copy>
                          <Copy size={12} muted lines={2}>
                            {n.body}
                          </Copy>
                        </View>
                        <View style={{ alignItems: "flex-end", gap: 4 }}>
                          <Copy size={10} muted>
                            {new Date(n.at).toLocaleTimeString("en-PH", {
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </Copy>
                          {!n.read && (
                            <View
                              style={{
                                width: 8,
                                height: 8,
                                borderRadius: 4,
                                backgroundColor: t.primary,
                              }}
                            />
                          )}
                        </View>
                      </Tap>
                    </SwipeRow>
                  )
                })}
              </Frame>
            </View>
          )
        })}
        {!notifs.length && (
          <View style={{ alignItems: "center", padding: 32, gap: 12 }}>
            <Bell size={32} color={t.muted} />
            <Copy weight="semibold">All quiet</Copy>
            <Copy size={14} muted>
              Reminders, trophies and reviews land here for 30 days.
            </Copy>
          </View>
        )}
        <Tap onPress={() => go("/me/settings")} style={{ marginTop: 24 }}>
          <Copy size={12} muted style={{ textAlign: "center" }}>
            Push schedule lives in{" "}
            <Copy size={12} style={{ color: t.primary }}>
              Settings
            </Copy>
            .
          </Copy>
        </Tap>
      </View>
    </Screen>
  )
}
const refOf = (i: CalendarItem) =>
  i.module === "habits" && i.id.startsWith("habit-")
    ? { kind: "habit", id: i.id.slice(6, -(i.day.length + 1)) }
    : i.module === "tasks" && i.id.startsWith("task:")
      ? { kind: "task", id: i.id.slice(5) }
      : null
export function WrapUp() {
  const t = useTheme(),
    today = dayKey(),
    ring = useTodayRing(),
    target = useOnTarget(7),
    items = useAllCalendar(today, today),
    misses = useAllMisses(today, today),
    s = dashStore.use((s) => s),
    sealed = s.wrapups[today],
    [dismissed, setDismissed] = useState<string[]>([]),
    [text, setText] = useState(""),
    ratio = ring.due ? ring.done / ring.due : 1,
    onTarget = ring.due > 0 && ratio >= s.targetThreshold,
    open = items.filter(
      (i) =>
        !i.done &&
        ["habits", "tasks"].includes(i.module) &&
        !dismissed.includes(i.id),
    ),
    letGo = items.filter((i) => dismissed.includes(i.id))
  const dot = (module: keyof typeof colors) => (
    <View
      style={{
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: t[colors[module]],
      }}
    />
  )
  return (
    <Screen title="Wrap up">
      <View>
        <View
          style={{
            padding: 16,
            borderWidth: 1,
            borderColor: t.line,
            borderRadius: 16,
            flexDirection: "row",
            alignItems: "center",
            gap: 16,
          }}
        >
          <Ring
            value={ratio}
            size={84}
            strokeWidth={8}
            color={onTarget ? t.life : t.primary}
          >
            <Copy size={18} weight="semibold">
              {ring.done}/{ring.due}
            </Copy>
          </Ring>
          <View style={{ flex: 1 }}>
            <Copy size={12} muted style={{ letterSpacing: 1 }}>
              TODAY'S RESULT
            </Copy>
            <Copy size={24} weight="display">
              {!ring.due
                ? "Neutral day"
                : onTarget
                  ? "On target ✓"
                  : "Off target"}
            </Copy>
            <Copy size={14} muted>
              {onTarget
                ? `Streak ${target.current + (target.current === 0 ? 1 : 0)} days — nice.`
                : !ring.due
                  ? "Nothing was due. Streak safe."
                  : `${Math.max(0, Math.ceil(ring.due * s.targetThreshold) - ring.done)} more to hit the target`}
            </Copy>
          </View>
        </View>
        <Line style={{ marginTop: 12, gap: 8 }}>
          {(["fitness", "finance"] as const)
            .filter((k) => ring.per[k].due > 0)
            .map((k) => (
              <Frame key={k} style={{ flex: 1, padding: 12 }}>
                <Line style={{ gap: 6 }}>
                  {dot(k)}
                  <Copy size={12} muted>
                    {AREA[k].label}
                  </Copy>
                </Line>
                <Copy weight="semibold">
                  {ring.per[k].done}/{ring.per[k].due} done
                </Copy>
              </Frame>
            ))}
        </Line>
        {sealed ? (
          <Frame style={{ padding: 16, marginTop: 16, gap: 12 }}>
            <Copy weight="semibold">
              Sealed at{" "}
              {new Date(sealed.at).toLocaleTimeString("en-PH", {
                hour: "numeric",
                minute: "2-digit",
              })}
            </Copy>
            {!!sealed.reflection && (
              <Copy size={14} muted style={{ fontStyle: "italic" }}>
                “{sealed.reflection}”
              </Copy>
            )}
            <Line>
              <View style={{ flex: 1 }}>
                <Button tone="quiet" href="/journal">
                  Journal
                </Button>
              </View>
              <View style={{ flex: 1 }}>
                <Button tone="quiet" onPress={() => unsealDay(today)}>
                  Reopen day
                </Button>
              </View>
            </Line>
          </Frame>
        ) : (
          <>
            <SectionHeading>Still open · {open.length}</SectionHeading>
            <Frame style={{ paddingHorizontal: 12, paddingVertical: 4 }}>
              {!open.length ? (
                <Copy
                  size={14}
                  muted
                  style={{ textAlign: "center", padding: 12 }}
                >
                  Nothing left open.
                </Copy>
              ) : (
                open.map((i) => {
                  const r = refOf(i)
                  return (
                    <Line
                      key={i.id}
                      style={{
                        gap: 8,
                        paddingVertical: 8,
                        borderBottomWidth: 1,
                        borderBottomColor: border(t.line, 0.5),
                      }}
                    >
                      {dot(i.module)}
                      <Tap onPress={() => go(i.href)} style={{ flex: 1 }}>
                        <Copy size={14} lines={1}>
                          {i.title}
                        </Copy>
                      </Tap>
                      <IconTap
                        size={44}
                        icon={Check}
                        label={`Done ${i.title}`}
                        color={t.good}
                        background={border(t.good, 0.15)}
                        onPress={() => {
                          if (r?.kind === "habit") checkHabit(r.id, i.day)
                          else if (r?.kind === "task") completeTask(r.id)
                        }}
                      />
                      {r?.kind === "task" && (
                        <IconTap
                          size={44}
                          icon={ArrowRight}
                          label={`Move ${i.title} to tomorrow`}
                          background={t.soft}
                          onPress={() => {
                            rescheduleBy(r.id, 1)
                            toast("Moved to tomorrow")
                          }}
                        />
                      )}
                      <IconTap
                        size={44}
                        icon={X}
                        label={`Didn't happen: ${i.title}`}
                        color={t.bad}
                        background={border(t.bad, 0.1)}
                        onPress={() => {
                          if (r?.kind === "habit")
                            skipHabit(r.id, i.day, "wrap-up: didn't happen")
                          setDismissed((l) => [...l, i.id])
                        }}
                      />
                    </Line>
                  )
                })
              )}
            </Frame>
            {(misses.length > 0 || letGo.length > 0) && (
              <>
                <SectionHeading
                  action={
                    <Tap onPress={() => go("/stats/misses")}>
                      <Copy size={12} style={{ color: t.primary }}>
                        See misses
                      </Copy>
                    </Tap>
                  }
                >
                  Misses today
                </SectionHeading>
                <Frame
                  style={{ paddingHorizontal: 12, paddingVertical: 8, gap: 6 }}
                >
                  {letGo.map((i) => (
                    <Line key={i.id}>
                      {dot(i.module)}
                      <Copy size={14} muted style={{ flex: 1 }} lines={1}>
                        Let go: {i.title}
                      </Copy>
                    </Line>
                  ))}
                  {misses.map((m) => (
                    <Tap key={m.id} onPress={() => go(m.href)}>
                      <Line>
                        {dot(m.module)}
                        <Copy size={14} style={{ flex: 1 }} lines={1}>
                          {m.title}
                        </Copy>
                      </Line>
                    </Tap>
                  ))}
                </Frame>
              </>
            )}
            <SectionHeading>How was today?</SectionHeading>
            <Line style={{ gap: 8 }}>
              <TextInput
                accessibilityLabel="One-line reflection"
                value={text}
                onChangeText={setText}
                maxLength={140}
                placeholder="One line. Optional."
                placeholderTextColor={t.muted}
                style={{
                  height: 48,
                  flex: 1,
                  borderWidth: 1,
                  borderColor: t.line,
                  borderRadius: 12,
                  backgroundColor: t.card,
                  paddingHorizontal: 12,
                  fontSize: 14,
                  fontFamily: fonts.body,
                  color: t.text,
                }}
              />
              <IconTap
                size={48}
                icon={Mic}
                label="Say it instead"
                background={t.soft}
                onPress={() => openCapture({ mode: "voice", hint: "journal" })}
              />
            </Line>
            <Copy
              size={12}
              muted
              style={{ marginTop: 4, paddingHorizontal: 4 }}
            >
              Saved to your journal. Never shown on share cards.
            </Copy>
            <View style={{ marginTop: 20 }}>
              <Button
                onPress={() => {
                  sealDay(today, {
                    onTarget,
                    done: ring.done,
                    due: ring.due,
                    reflection: text.trim() || undefined,
                  })
                  if (text.trim())
                    addJournalEntry({
                      body: text.trim(),
                      day: today,
                      source: "wrapup",
                    })
                  toast.success(
                    onTarget ? "Day sealed — on target ✓" : "Day sealed",
                    {
                      description: text.trim()
                        ? "Reflection saved to your journal."
                        : "See you tomorrow.",
                    },
                  )
                  go("/today")
                }}
              >
                Done — seal the day
              </Button>
            </View>
          </>
        )}
      </View>
    </Screen>
  )
}
