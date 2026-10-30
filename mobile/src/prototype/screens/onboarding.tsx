import type { ModuleKey } from "@domain/contract"
import { AREA, MODULE_KEYS } from "@domain/dash/data"
import {
  IDENTITIES,
  PACES,
  PASS_THROUGH,
  type Pace,
  STARTERS,
} from "@domain/dash/onboarding"
import { dashStore, setPush } from "@domain/dash/store"
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
  Timer,
  UserRound,
  Utensils,
  Wallet,
  Zap,
} from "lucide-react-native"
import { useEffect, useRef, useState } from "react"
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { border, Copy, Frame, IconTap, Line, Tap } from "../native-kit"
import { back, go, replace } from "../navigation"
import {
  DETAIL_MAX,
  draftStore,
  editDraft,
  ensureDraft,
  type MobileStep,
  newDraft,
  OCCUPATIONS,
  REFERRAL_DETAIL,
  REFERRALS,
  startersOf,
} from "../onboarding-draft"
import { enableReminders } from "../reminders"
import { screenTimeAvailable } from "../screen-time"
import { fonts, useTheme } from "../theme"
import { TimeInput } from "../time-input"
import { AccountForm } from "./auth-sign-up"

// Before the account exists (`/get-started`) every answer goes into the
// onboarding draft, and the last step creates the account. After it
// (`/onboarding`) only the notification ask and the send-off are left; the
// web's "install" step and the welcome step (the Welcome slides introduce
// the app) are not shown on the phone.
const PRE_ACCOUNT: readonly MobileStep[] = [
  "identity",
  "about",
  "modules",
  "targets",
  "when",
  "building",
  "pledge",
  "account",
]
const POST_ACCOUNT: readonly MobileStep[] = ["notifications", "done"]
// Steps a person can skip from the header.
const SKIPPABLE: readonly MobileStep[] = ["about"]
const PASSING: readonly MobileStep[] = PASS_THROUGH

const modules = {
  habits: { icon: Repeat2, color: "hab" },
  tasks: { icon: ListChecks, color: "tsk" },
  fitness: { icon: Dumbbell, color: "fit" },
  nutrition: { icon: Utensils, color: "nut" },
  focus: { icon: Timer, color: "foc" },
  screen: { icon: Smartphone, color: "scr" },
  finance: { icon: Wallet, color: "fin" },
} as const
export function Onboarding({ phase = "post" }: { phase?: "pre" | "post" }) {
  const pre = phase === "pre",
    STEPS = pre ? PRE_ACCOUNT : POST_ACCOUNT,
    t = useTheme(),
    safe = useSafeAreaInsets(),
    params = useLocalSearchParams<{ step?: MobileStep }>(),
    s = dashStore.use((s) => s),
    // Pre-account answers live in the draft (and survive a restart); after
    // sign-up they are the account's.
    d = draftStore.use((s) => s.draft) ?? newDraft(),
    [postStep, setPostStep] = useState<MobileStep>(
      !pre && POST_ACCOUNT.includes(params.step as MobileStep)
        ? params.step!
        : "notifications",
    ),
    step = pre
      ? PRE_ACCOUNT.includes(d.step)
        ? d.step
        : "identity"
      : postStep,
    setStep = (x: MobileStep) =>
      pre ? editDraft({ step: x }) : setPostStep(x),
    picked = d.identities,
    setPicked = (f: (p: string[]) => string[]) =>
      editDraft({ identities: f(ensureDraft().identities) }),
    enabled = d.enabled,
    pace = d.pace,
    setPace = (p: Pace | null) => editDraft({ pace: p }),
    targets = d.targets,
    setTargets = (
      f: (
        old: Record<ModuleKey, number | null>,
      ) => Record<ModuleKey, number | null>,
    ) => editDraft({ targets: f(ensureDraft().targets) }),
    push = pre ? { morning: d.pushMorning, evening: d.pushEvening } : s.push,
    setTime = (key: "morning" | "evening", v: string) =>
      pre
        ? editDraft(key === "morning" ? { pushMorning: v } : { pushEvening: v })
        : setPush({ [key]: v }),
    [building, setBuilding] = useState(0),
    [holding, setHolding] = useState(false),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    index = STEPS.indexOf(step),
    bar = STEPS.filter((x) => !PASSING.includes(x)),
    active = startersOf(d),
    next = () => setStep(STEPS[Math.min(STEPS.length - 1, index + 1)])
  // Start (or resume) the draft as soon as onboarding opens.
  useEffect(() => {
    if (pre) ensureDraft()
  }, [pre])
  useEffect(() => {
    if (step !== "building") return
    setBuilding(0)
    let n = 0
    const id = setInterval(() => {
      n++
      setBuilding(n)
      if (n > 4) {
        clearInterval(id)
        // "building" is a pre-account step: the step lives in the draft.
        editDraft({ step: "pledge" })
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
  // Onboarding is the first run only; "Run setup again" is /setup. Before
  // sign-up the dash store holds the demo seed, so this is post-account only.
  useEffect(() => {
    if (!pre && s.onboarded) replace("/today")
  }, [pre, s.onboarded])
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
  // The answers were written to the account at sign-up (applyDraft). Setup
  // is the last part of onboarding; it marks onboarding finished.
  const finish = () => go("/setup")
  const configs: Record<
      MobileStep,
      { icon: typeof Compass; title: string; body: string }
    > = {
      welcome: {
        icon: Compass,
        title: "Your life, one dashboard",
        body: "Habits, tasks, training, food and money — logged in seconds, scored honestly, shareable without leaking a cent.",
      },
      about: {
        icon: UserRound,
        title: "A little about you",
        body: "Two quick questions so Unfurl fits your days. Both are optional.",
      },
      account: { icon: UserRound, title: "Create your account", body: "" },
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
  const goBack = () => {
    let i = index - 1
    while (i > 0 && PASSING.includes(STEPS[i])) i--
    setStep(STEPS[i])
  }
  // The account form is its own screen, keyboard handling included.
  if (step === "account") return <AccountForm onBack={goBack} />
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: t.bg, paddingTop: safe.top }}
    >
      <View style={{ paddingHorizontal: 20 }}>
        <Line style={{ height: 56, gap: 12 }}>
          {index > 0 ? (
            <IconTap
              size={44}
              icon={ArrowLeft}
              label="Back"
              color={t.text}
              onPress={goBack}
            />
          ) : pre ? (
            <IconTap
              size={44}
              icon={ArrowLeft}
              label="Back"
              color={t.text}
              onPress={() => back("/welcome")}
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
          {pre && SKIPPABLE.includes(step) && (
            // Skipping "about you" leaves both answers unanswered.
            <Tap
              onPress={() => {
                editDraft({
                  occupation: null,
                  occupationDetail: "",
                  referralSource: null,
                  referralDetail: "",
                })
                next()
              }}
              style={{ padding: 8 }}
            >
              <Copy size={14} muted>
                Skip
              </Copy>
            </Tap>
          )}
          {/* Anyone with an account already leaves here; the draft stays
              until a sign-in succeeds, so Back returns to this step. */}
          {pre && (
            <Tap
              label="I already have an account"
              onPress={() => go("/login")}
              style={{ padding: 8 }}
            >
              <Copy size={14} style={{ color: t.primary }}>
                Sign in
              </Copy>
            </Tap>
          )}
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
                next,
                false,
                !picked.length,
              )}
            </>
          )}
          {step === "about" && (
            <>
              <View style={{ gap: 8, marginBottom: 16 }}>
                <Copy size={14} weight="semibold">
                  What do you do?
                </Copy>
                <Chips
                  options={OCCUPATIONS}
                  value={d.occupation}
                  onChange={(v) => editDraft({ occupation: v })}
                />
                <DetailInput
                  label="Field of study or line of work"
                  value={d.occupationDetail}
                  onChange={(v) => editDraft({ occupationDetail: v })}
                />
                <Copy size={14} weight="semibold" style={{ marginTop: 12 }}>
                  How did you hear about Unfurl?
                </Copy>
                <Chips
                  options={REFERRALS}
                  value={d.referralSource}
                  onChange={(v) => editDraft({ referralSource: v })}
                />
                {d.referralSource &&
                  REFERRAL_DETAIL.includes(d.referralSource) && (
                    <DetailInput
                      label={
                        d.referralSource === "friend"
                          ? "Who told you? (optional)"
                          : "Where? (optional)"
                      }
                      value={d.referralDetail}
                      onChange={(v) => editDraft({ referralDetail: v })}
                    />
                  )}
              </View>
              {button("Continue", next)}
            </>
          )}
          {step === "modules" && (
            <>
              <View style={{ gap: 8, marginBottom: 16 }}>
                {/* Choices only: Screen time's iOS permission is asked for
                    in setup, once the account exists. */}
                {MODULE_KEYS.map((k) => (
                  <Tap
                    key={k}
                    onPress={() =>
                      editDraft({ enabled: { ...enabled, [k]: !enabled[k] } })
                    }
                    style={{
                      padding: 16,
                      borderRadius: 16,
                      borderWidth: 1,
                      borderColor: enabled[k] ? t.primary : t.line,
                      backgroundColor: enabled[k]
                        ? border(t.primary, 0.1)
                        : t.card,
                    }}
                  >
                    <Line style={{ gap: 12 }}>
                      {areaIcon(k, 40)}
                      <View style={{ flex: 1 }}>
                        <Copy weight="semibold">{AREA[k].label}</Copy>
                        {k === "screen" && (
                          <Copy size={12} muted>
                            {screenTimeAvailable()
                              ? "Needs Screen Time access"
                              : "Not in this version of Unfurl yet"}
                          </Copy>
                        )}
                      </View>
                      <View
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 12,
                          backgroundColor: enabled[k] ? t.primary : t.soft,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {enabled[k] && <Check size={16} color={t.bg} />}
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
                !Object.values(enabled).some(Boolean),
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
                      setTargets(
                        (old) =>
                          Object.fromEntries(
                            MODULE_KEYS.map((k) => [
                              k,
                              old[k] === null ? null : PACES[p].targets[k],
                            ]),
                          ) as Record<ModuleKey, number | null>,
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
                {MODULE_KEYS.filter((k) => enabled[k]).map((k) => (
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
                      value={push[x.key]}
                      onChange={(v) => setTime(x.key, v)}
                    />
                  </Line>
                ))}
              </Frame>
              <Copy
                size={14}
                muted
                style={{ textAlign: "center", marginBottom: 16 }}
              >
                “Every day at {push.morning} I'll plan, and at {push.evening}{" "}
                I'll close the day.”
              </Copy>
              {button("Lock these in", next)}
            </>
          )}
          {step === "building" && (
            <View style={{ gap: 12, paddingBottom: 40 }}>
              {[
                "Weighting your Life Score",
                `Setting ${active.length || "your"} starter target${active.length === 1 ? "" : "s"}`,
                `Scheduling check-ins at ${push.morning} & ${push.evening}`,
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
                  Check in at {push.morning} & {push.evening}
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
                    sub: `What's due today · ${push.morning}`,
                  },
                  {
                    icon: Moon,
                    label: "Evening",
                    sub: `Wrap up the day · ${push.evening}`,
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
                  : `Remind me at ${push.morning} & ${push.evening}`,
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
    </KeyboardAvoidingView>
  )
}

/** One answer from a short list, as wrapping pills; tapping the picked one
 * clears it. */
function Chips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; label: string }[]
  value: T | null
  onChange: (v: T | null) => void
}) {
  const t = useTheme()
  return (
    <View
      accessibilityRole="radiogroup"
      style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}
    >
      {options.map((o) => {
        const on = value === o.value
        return (
          <Tap
            key={o.value}
            label={o.label}
            role="radio"
            selected={on}
            onPress={() => onChange(on ? null : o.value)}
            style={{
              paddingHorizontal: 14,
              minHeight: 40,
              justifyContent: "center",
              borderRadius: 20,
              borderWidth: 1,
              borderColor: on ? t.primary : t.line,
              backgroundColor: on ? border(t.primary, 0.1) : t.card,
            }}
          >
            <Copy size={14} weight={on ? "semibold" : "medium"}>
              {o.label}
            </Copy>
          </Tap>
        )
      })}
    </View>
  )
}
function DetailInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  const t = useTheme()
  return (
    <TextInput
      accessibilityLabel={label}
      placeholder={label}
      placeholderTextColor={t.muted}
      value={value}
      onChangeText={onChange}
      maxLength={DETAIL_MAX}
      returnKeyType="done"
      style={{
        height: 48,
        paddingHorizontal: 14,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: t.line,
        backgroundColor: t.card,
        fontFamily: fonts.body,
        fontSize: 15,
        color: t.text,
      }}
    />
  )
}
