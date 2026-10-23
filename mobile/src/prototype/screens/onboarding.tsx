import { AREA, MODULE_KEYS } from "@domain/dash/data"
import {
  STEPS as ALL_STEPS,
  IDENTITIES,
  PACES,
  PASS_THROUGH,
  type Pace,
  STARTERS,
  type Step,
} from "@domain/dash/onboarding"
import {
  dashStore,
  saveGoal,
  setEnabled,
  setIdentities,
  setPush,
} from "@domain/dash/store"
import { uid } from "@domain/lib/store"
import { LinearGradient } from "expo-linear-gradient"
import { useLocalSearchParams } from "expo-router"
import {
  AlarmClock,
  ArrowLeft,
  BarChart3,
  Bell,
  CalendarClock,
  Check,
  Compass,
  Dumbbell,
  Fingerprint,
  LayoutGrid,
  ListChecks,
  Moon,
  Repeat2,
  Rocket,
  Smartphone,
  Sparkles,
  Sun,
  Target,
  Wallet,
  Zap,
} from "lucide-react-native"
import { useEffect, useRef, useState } from "react"
import { Pressable, ScrollView, TextInput, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { toast } from "sonner-native"
import { border, Copy, Frame, IconTap, Line, Tap } from "../native-kit"
import { go, replace } from "../navigation"
import { enableReminders } from "../reminders"
import { fonts, useTheme } from "../theme"
import { TimeInput } from "../time-input"

// "Install" is the web's add-to-home-screen step; the app is installed.
const STEPS: readonly Step[] = ALL_STEPS.filter((x) => x !== "install")

const modules = {
  habits: { icon: Repeat2, color: "hab" },
  tasks: { icon: ListChecks, color: "tsk" },
  fitness: { icon: Dumbbell, color: "fit" },
  finance: { icon: Wallet, color: "fin" },
} as const
export function Onboarding() {
  const t = useTheme(),
    safe = useSafeAreaInsets(),
    params = useLocalSearchParams<{ step?: Step }>(),
    [step, setStep] = useState<Step>(
      STEPS.includes(params.step as Step) ? params.step! : "welcome",
    ),
    s = dashStore.use((s) => s),
    [picked, setPicked] = useState<string[]>([]),
    [pace, setPace] = useState<Pace | null>("gentle"),
    [targets, setTargets] = useState<Record<string, number | null>>({
      ...PACES.gentle.targets,
    }),
    [building, setBuilding] = useState(0),
    [holding, setHolding] = useState(false),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    index = STEPS.indexOf(step),
    bar = STEPS.filter((x) => !PASS_THROUGH.includes(x)),
    active = MODULE_KEYS.filter((k) => s.enabled[k] && targets[k] !== null),
    next = () => setStep(STEPS[Math.min(STEPS.length - 1, index + 1)])
  useEffect(() => {
    if (step !== "building") return
    setBuilding(0)
    let n = 0
    const id = setInterval(() => {
      n++
      setBuilding(n)
      if (n > 4) {
        clearInterval(id)
        setStep("pledge")
      }
    }, 650)
    return () => clearInterval(id)
  }, [step])
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  // Onboarding is the first run only; "Run setup again" is /setup.
  useEffect(() => {
    if (s.onboarded) replace("/today")
  }, [s.onboarded])
  const button = (
    label: string,
    press: () => void,
    quiet = false,
    disabled = false,
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={press}
      style={{
        height: 48,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: quiet ? "transparent" : t.primary,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Copy weight="semibold" style={{ color: quiet ? t.text : t.onPrimary }}>
        {label}
      </Copy>
    </Pressable>
  )
  const areaIcon = (k: keyof typeof modules, size = 32) => {
    const I = modules[k].icon,
      color = t[modules[k].color]
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 3,
          backgroundColor: border(color, 0.15),
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <I size={size / 2} color={color} />
      </View>
    )
  }
  const finish = () => {
    let n = 0
    for (const k of active) {
      const starter = STARTERS[k]
      if (
        s.goals.some(
          (g) => g.metric === starter.metric && g.status === "active",
        )
      )
        continue
      saveGoal({ ...starter, target: targets[k]!, via: "onboarding" })
      n++
    }
    if (picked.length)
      setIdentities(picked.map((text) => ({ id: uid(), text })))
    if (n)
      toast.success(`${n} starter goal${n > 1 ? "s" : ""} added`, {
        description: "Next, set up your workspace",
      })
    // Setup is the last part of onboarding; it marks onboarding finished.
    go("/setup")
  }
  const configs = {
      welcome: {
        icon: Compass,
        title: "Your life, one dashboard",
        body: "Habits, tasks, training and money — logged in seconds, scored honestly, shareable without leaking a cent.",
      },
      identity: {
        icon: Fingerprint,
        title: "Who are you becoming?",
        body: "Habits stick when they're part of who you are. Pick up to three — we'll build around them.",
      },
      modules: {
        icon: LayoutGrid,
        title: "What do you want to track?",
        body: "Turn off what you don't need. Data is kept if you switch later.",
      },
      targets: {
        icon: Target,
        title: "Pick your pace",
        body: "Start smaller than you think. Early wins build the streak; you can raise the bar anytime.",
      },
      when: {
        icon: CalendarClock,
        title: "When will you check in?",
        body: "People who decide when and where they'll act follow through far more often than people who just intend to.",
      },
      building: { icon: Sparkles, title: "Building your plan…", body: "" },
      pledge: {
        icon: Zap,
        title: "Your plan is ready",
        body: "Make it official. A promise you commit to is one you're far more likely to keep.",
      },
      notifications: {
        icon: Bell,
        title: "Protect your plan",
        body: "Streaks rarely die on hard days — they die on days you simply forgot. We'll nudge you at the times you picked, three a day max.",
      },
      install: {
        icon: Smartphone,
        title: "Keep your plan one tap away",
        body: "You're already running the installed app. ✓",
      },
      done: {
        icon: Rocket,
        title: "Day 1 starts now",
        body: `It's ${new Date().toLocaleDateString(undefined, { weekday: "long" })} — a clean slate. Tap + anytime and just say what happened: “ran 5k, spent 250 on lunch”.`,
      },
    },
    c = configs[step],
    I = c.icon
  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: safe.top }}>
      <View style={{ paddingHorizontal: 20 }}>
        <Line style={{ height: 56, gap: 12 }}>
          {index > 0 ? (
            <IconTap
              size={44}
              icon={ArrowLeft}
              label="Back"
              color={t.text}
              onPress={() => {
                let i = index - 1
                while (i > 0 && PASS_THROUGH.includes(STEPS[i])) i--
                setStep(STEPS[i])
              }}
            />
          ) : (
            <View style={{ width: 44 }} />
          )}
          <Line style={{ flex: 1, gap: 6 }}>
            {bar.map((x) => (
              <View
                key={x}
                style={{
                  height: 6,
                  flex: 1,
                  borderRadius: 3,
                  backgroundColor:
                    STEPS.indexOf(x) <= index ? t.primary : t.soft,
                }}
              />
            ))}
          </Line>
        </Line>
      </View>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: 20,
          paddingBottom: 32,
        }}
      >
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            paddingVertical: 24,
          }}
        >
          <LinearGradient
            colors={[
              border(t.primary, 0.25),
              border(t.hab, 0.2),
              border(t.fit, 0.2),
            ]}
            style={{
              width: 80,
              height: 80,
              borderRadius: 24,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <I size={36} color={t.primary} />
          </LinearGradient>
          <Copy
            size={24}
            weight="display"
            style={{ marginTop: 20, letterSpacing: -0.6, textAlign: "center" }}
          >
            {c.title}
          </Copy>
          {!!c.body && (
            <Copy
              muted
              style={{ marginTop: 8, maxWidth: 320, textAlign: "center" }}
            >
              {c.body}
            </Copy>
          )}
        </View>
        <View>
          {step === "welcome" && (
            <>
              {button("Build my plan", next)}
              <Copy
                size={12}
                muted
                style={{ marginTop: 8, textAlign: "center" }}
              >
                About 90 seconds
              </Copy>
            </>
          )}
          {step === "identity" && (
            <>
              <View style={{ gap: 8, marginBottom: 16 }}>
                {IDENTITIES.map((d) => {
                  const on = picked.includes(d.text),
                    full = !on && picked.length >= 3
                  return (
                    <Tap
                      key={d.text}
                      onPress={() => {
                        if (!full)
                          setPicked((p) =>
                            on ? p.filter((x) => x !== d.text) : [...p, d.text],
                          )
                      }}
                      style={{
                        padding: 16,
                        borderRadius: 16,
                        borderWidth: 1,
                        borderColor: on ? t.primary : t.line,
                        backgroundColor: on ? border(t.primary, 0.1) : t.card,
                        opacity: full ? 0.4 : 1,
                      }}
                    >
                      <Line style={{ gap: 12 }}>
                        {d.module ? (
                          areaIcon(d.module)
                        ) : (
                          <Sparkles size={24} color={t.muted} />
                        )}
                        <Copy weight="medium" style={{ flex: 1 }}>
                          “{d.text}”
                        </Copy>
                        <View
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: 12,
                            backgroundColor: on ? t.primary : t.soft,
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          {on && <Check size={16} color={t.bg} />}
                        </View>
                      </Line>
                    </Tap>
                  )
                })}
              </View>
              {button(
                picked.length ? "That's me" : "Pick at least one",
                () => {
                  const mods = IDENTITIES.filter((d) =>
                    picked.includes(d.text),
                  ).flatMap((d) => (d.module ? [d.module] : []))
                  if (mods.length)
                    for (const k of MODULE_KEYS) setEnabled(k, mods.includes(k))
                  next()
                },
                false,
                !picked.length,
              )}
            </>
          )}
          {step === "modules" && (
            <>
              <View style={{ gap: 8, marginBottom: 16 }}>
                {MODULE_KEYS.map((k) => (
                  <Tap
                    key={k}
                    onPress={() => setEnabled(k, !s.enabled[k])}
                    style={{
                      padding: 16,
                      borderRadius: 16,
                      borderWidth: 1,
                      borderColor: s.enabled[k] ? t.primary : t.line,
                      backgroundColor: s.enabled[k]
                        ? border(t.primary, 0.1)
                        : t.card,
                    }}
                  >
                    <Line style={{ gap: 12 }}>
                      {areaIcon(k, 40)}
                      <Copy weight="semibold" style={{ flex: 1 }}>
                        {AREA[k].label}
                      </Copy>
                      <View
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 12,
                          backgroundColor: s.enabled[k] ? t.primary : t.soft,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {s.enabled[k] && <Check size={16} color={t.bg} />}
                      </View>
                    </Line>
                  </Tap>
                ))}
                <Line
                  style={{
                    padding: 16,
                    gap: 12,
                    borderRadius: 16,
                    borderWidth: 1,
                    borderStyle: "dashed",
                    borderColor: t.line,
                  }}
                >
                  <Sparkles size={24} color={t.muted} />
                  <Copy muted style={{ flex: 1 }}>
                    Capture (chat, voice, photo)
                  </Copy>
                  <Copy size={12} muted>
                    always on
                  </Copy>
                </Line>
              </View>
              {button(
                "Next",
                next,
                false,
                !Object.values(s.enabled).some(Boolean),
              )}
            </>
          )}
          {step === "targets" && (
            <>
              <Line style={{ gap: 8, marginBottom: 12, alignItems: "stretch" }}>
                {(Object.keys(PACES) as Pace[]).map((p) => (
                  <Tap
                    key={p}
                    onPress={() => {
                      setPace(p)
                      setTargets((old) =>
                        Object.fromEntries(
                          MODULE_KEYS.map((k) => [
                            k,
                            old[k] === null ? null : PACES[p].targets[k],
                          ]),
                        ),
                      )
                    }}
                    style={{
                      flex: 1,
                      paddingHorizontal: 8,
                      paddingTop: 16,
                      paddingBottom: 12,
                      borderRadius: 16,
                      borderWidth: 1,
                      borderColor: pace === p ? t.primary : t.line,
                      backgroundColor:
                        pace === p ? border(t.primary, 0.1) : t.card,
                      alignItems: "center",
                    }}
                  >
                    {p === "gentle" && (
                      <View
                        style={{
                          position: "absolute",
                          top: -8,
                          paddingHorizontal: 8,
                          paddingVertical: 2,
                          borderRadius: 12,
                          backgroundColor: t.primary,
                        }}
                      >
                        <Copy
                          size={10}
                          weight="semibold"
                          style={{ color: t.bg }}
                        >
                          Recommended
                        </Copy>
                      </View>
                    )}
                    <Copy size={14} weight="semibold">
                      {PACES[p].label}
                    </Copy>
                    <Copy size={12} muted>
                      {PACES[p].note}
                    </Copy>
                  </Tap>
                ))}
              </Line>
              <View style={{ gap: 8, marginBottom: 16 }}>
                {MODULE_KEYS.filter((k) => s.enabled[k]).map((k) => (
                  <Frame
                    key={k}
                    style={{
                      padding: 12,
                      opacity: targets[k] === null ? 0.5 : 1,
                    }}
                  >
                    <Line style={{ gap: 12 }}>
                      {areaIcon(k)}
                      <View style={{ flex: 1 }}>
                        <Copy size={14} weight="medium">
                          {STARTERS[k].label} ≥
                        </Copy>
                        <Copy size={12} muted>
                          {STARTERS[k].hint} · per {STARTERS[k].period}
                        </Copy>
                      </View>
                      <TextInput
                        accessibilityLabel={`${STARTERS[k].label} target`}
                        editable={targets[k] !== null}
                        value={targets[k] === null ? "" : String(targets[k])}
                        onChangeText={(v) => {
                          setPace(null)
                          setTargets((old) => ({
                            ...old,
                            [k]: Number(v.replace(/\D/g, "")) || 0,
                          }))
                        }}
                        keyboardType="number-pad"
                        style={{
                          width: 64,
                          height: 40,
                          borderRadius: 12,
                          borderWidth: 1,
                          borderColor: t.line,
                          backgroundColor: t.bg,
                          textAlign: "center",
                          fontFamily: fonts.semibold,
                          color: t.text,
                        }}
                      />
                      <Copy size={14} muted style={{ width: 16 }}>
                        {STARTERS[k].unit}
                      </Copy>
                    </Line>
                    <Tap
                      onPress={() =>
                        setTargets((old) => ({
                          ...old,
                          [k]:
                            old[k] === null
                              ? PACES[pace ?? "gentle"].targets[k]
                              : null,
                        }))
                      }
                      style={{ marginTop: 4, paddingLeft: 44 }}
                    >
                      <Copy size={12} style={{ color: t.primary }}>
                        {targets[k] === null ? "Use a target" : "Skip this one"}
                      </Copy>
                    </Tap>
                  </Frame>
                ))}
              </View>
              {button("Next", next)}
            </>
          )}
          {step === "when" && (
            <>
              <Frame style={{ padding: 16, gap: 12, marginBottom: 16 }}>
                {(
                  [
                    { icon: Sun, label: "Plan my day", key: "morning" },
                    { icon: Moon, label: "Wrap it up", key: "evening" },
                  ] as const
                ).map((x) => (
                  <Line key={x.key}>
                    <x.icon size={20} color={t.primary} />
                    <Copy size={14} weight="medium" style={{ flex: 1 }}>
                      {x.label}
                    </Copy>
                    <TimeInput
                      label={x.label}
                      value={s.push[x.key]}
                      onChange={(v) => setPush({ [x.key]: v })}
                    />
                  </Line>
                ))}
              </Frame>
              <Copy
                size={14}
                muted
                style={{ textAlign: "center", marginBottom: 16 }}
              >
                “Every day at {s.push.morning} I'll plan, and at{" "}
                {s.push.evening} I'll close the day.”
              </Copy>
              {button("Lock these in", next)}
            </>
          )}
          {step === "building" && (
            <View style={{ gap: 12, paddingBottom: 40 }}>
              {[
                "Weighting your Life Score",
                `Setting ${active.length || "your"} starter target${active.length === 1 ? "" : "s"}`,
                `Scheduling check-ins at ${s.push.morning} & ${s.push.evening}`,
                "Preparing your first week",
              ].map((line, i) => (
                <Line
                  key={line}
                  style={{ gap: 12, opacity: i < building ? 1 : 0.3 }}
                >
                  <Check size={24} color={t.primary} />
                  <Copy size={14}>{line}</Copy>
                </Line>
              ))}
            </View>
          )}
          {step === "pledge" && (
            <>
              <Frame style={{ padding: 16, gap: 12, marginBottom: 16 }}>
                {!!picked.length && (
                  <View style={{ gap: 4 }}>
                    <Copy size={12} muted>
                      WHO I'M BECOMING
                    </Copy>
                    {picked.map((x) => (
                      <Copy key={x} size={14} weight="medium">
                        “{x}”
                      </Copy>
                    ))}
                  </View>
                )}
                {active.map((k) => (
                  <Line key={k} style={{ gap: 8 }}>
                    {areaIcon(k)}
                    <Copy size={14} style={{ flex: 1 }}>
                      {STARTERS[k].label}
                    </Copy>
                    <Copy size={14} weight="semibold">
                      ≥ {targets[k]}
                      {STARTERS[k].unit}
                    </Copy>
                    <Copy size={12} muted>
                      /{STARTERS[k].period}
                    </Copy>
                  </Line>
                ))}
                <Copy size={14} muted>
                  Check in at {s.push.morning} & {s.push.evening}
                </Copy>
              </Frame>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Hold to commit"
                accessibilityActions={[
                  { name: "activate", label: "Commit to plan" },
                ]}
                onAccessibilityAction={next}
                onPressIn={() => {
                  setHolding(true)
                  timer.current = setTimeout(next, 1200)
                }}
                onPressOut={() => {
                  setHolding(false)
                  if (timer.current) clearTimeout(timer.current)
                }}
                style={{
                  height: 56,
                  borderRadius: 12,
                  backgroundColor: holding ? t.primary : t.soft,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Line>
                  <Fingerprint size={20} color={holding ? t.bg : t.text} />
                  <Copy
                    weight="semibold"
                    style={{ color: holding ? t.bg : t.text }}
                  >
                    {holding ? "Keep holding…" : "Hold to commit"}
                  </Copy>
                </Line>
              </Pressable>
            </>
          )}
          {step === "notifications" && (
            <>
              <Frame style={{ padding: 16, gap: 10, marginBottom: 16 }}>
                {[
                  {
                    icon: Sun,
                    label: "Morning",
                    sub: `What's due today · ${s.push.morning}`,
                  },
                  {
                    icon: Moon,
                    label: "Evening",
                    sub: `Wrap up the day · ${s.push.evening}`,
                  },
                  {
                    icon: BarChart3,
                    label: "Weekly review",
                    sub: "Sunday 19:00",
                  },
                  {
                    icon: AlarmClock,
                    label: "Reminders",
                    sub: "Tasks and habits you set times for",
                  },
                ].map((x) => (
                  <Line key={x.label}>
                    <x.icon size={20} color={t.primary} />
                    <View style={{ flex: 1 }}>
                      <Copy size={14} weight="semibold">
                        {x.label}
                      </Copy>
                      <Copy size={12} muted>
                        {x.sub}
                      </Copy>
                    </View>
                  </Line>
                ))}
              </Frame>
              {button(
                s.push.permission === "granted"
                  ? "Notifications on ✓ — continue"
                  : `Remind me at ${s.push.morning} & ${s.push.evening}`,
                () => {
                  // The system asks; whatever the answer, onboarding goes on.
                  void enableReminders().finally(next)
                },
              )}
              {button("Not now", next, true)}
            </>
          )}
          {step === "done" && (
            <>
              <Frame style={{ padding: 16, marginBottom: 16 }}>
                <Line
                  style={{ justifyContent: "space-between", marginBottom: 8 }}
                >
                  <Copy size={14} weight="semibold">
                    Your first week
                  </Copy>
                  <Copy size={12} muted>
                    Plan set ✓ · 1 of 7
                  </Copy>
                </Line>
                <Line style={{ gap: 6 }}>
                  {Array.from({ length: 7 }, (_, i) => (
                    <View
                      key={i}
                      style={{
                        height: 8,
                        flex: 1,
                        borderRadius: 4,
                        backgroundColor: i === 0 ? t.primary : t.soft,
                      }}
                    />
                  ))}
                </Line>
                <Copy size={12} muted style={{ marginTop: 8 }}>
                  Log one thing today to light up day 1.
                </Copy>
              </Frame>
              {button("Set up my workspace", finish)}
            </>
          )}
        </View>
      </ScrollView>
    </View>
  )
}
