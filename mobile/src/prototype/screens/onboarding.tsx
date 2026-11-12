import type { ModuleKey } from "@domain/contract"
import { AREA, MODULE_KEYS } from "@domain/dash/data"
import { PACES, type Pace, STARTERS } from "@domain/dash/onboarding"
import { dashStore } from "@domain/dash/store"
import { LinearGradient } from "expo-linear-gradient"
import {
  ArrowLeft,
  BookOpen,
  Check,
  Dumbbell,
  Gauge,
  LayoutGrid,
  ListChecks,
  MessageCircle,
  Moon,
  Repeat2,
  Smartphone,
  Sparkles,
  Timer,
  UserRound,
  Users,
  Utensils,
  Wallet,
} from "lucide-react-native"
import { useEffect } from "react"
import { Pressable, TextInput, View } from "react-native"
import { KeyboardAwareScrollView } from "react-native-keyboard-controller"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { liveMode } from "@/live/config"
import { companionStore } from "../companion/store"
import { holdFirstCapture, replayFirstCapture } from "../first-capture"
import { FIELD_CLEARANCE, formScrollProps } from "../form-scroll"
import { type FunnelStep, logFunnel } from "../funnel"
import { border, Copy, Frame, IconTap, Line, Tap } from "../native-kit"
import { back, go, replace } from "../navigation"
import {
  aboutOf,
  applyDraft,
  DETAIL_MAX,
  DRAFT_EXTRAS,
  type DraftExtra,
  draftStore,
  editDraft,
  ensureDraft,
  extrasOf,
  type MobileStep,
  newDraft,
  OCCUPATIONS,
  type OnboardingDraft,
  REFERRAL_DETAIL,
  REFERRALS,
} from "../onboarding-draft"
import { screenTimeAvailable } from "../screen-time"
import { sessionStore } from "../session"
import { SETUP_TIME } from "../setup-first"
import { fonts, useTheme } from "../theme"
import { TimeInput } from "../time-input"
import { AccountForm } from "./auth-sign-up"
import { FirstCaptureStep } from "./onboarding-capture"

// Account first (docs/27 K8): Welcome's "Get started" opens the account
// form (`/get-started`), with Apple and Google one tap beside email. Once
// the account exists (`/onboarding`) four short steps follow, then one
// setup step, then Today and the guided tour. Because the account exists
// before the first capture, Fern answers it live on the same screen.
//
// Screens before Today: Welcome, account, (email code, when the server asks
// for one), these four, one setup step: 7, or 8 with the code.
export const ONBOARDING_STEPS: readonly (
  | "modules"
  | "capture"
  | "about"
  | "when"
)[] = ["modules", "capture", "about", "when"]
// Steps a person can skip from the header.
const SKIPPABLE: readonly MobileStep[] = ["capture", "about"]

const modules = {
  habits: { icon: Repeat2, color: "hab" },
  tasks: { icon: ListChecks, color: "tsk" },
  fitness: { icon: Dumbbell, color: "fit" },
  nutrition: { icon: Utensils, color: "nut" },
  focus: { icon: Timer, color: "foc" },
  screen: { icon: Smartphone, color: "scr" },
  finance: { icon: Wallet, color: "fin" },
} as const
const EXTRA_ROWS: Record<
  DraftExtra,
  { icon: typeof BookOpen; label: string; note: string }
> = {
  journal: {
    icon: BookOpen,
    label: "Journal",
    note: "Your day in words · no setup",
  },
  social: {
    icon: Users,
    label: "Community",
    note: "Friends and shared wins · no setup",
  },
}
type Step = "modules" | "capture" | "about" | "when"
const isFunnelStep = (x: MobileStep): x is Step & FunnelStep =>
  (ONBOARDING_STEPS as readonly MobileStep[]).includes(x)

/** The funnel's record of finishing a step; the module step also records
 * the final choice of every module, ticked or not. */
function funnelDone(step: MobileStep, d: OnboardingDraft) {
  if (!isFunnelStep(step)) return
  logFunnel({ event: "step_complete", step })
  if (step !== "modules") return
  for (const k of MODULE_KEYS)
    logFunnel({
      event: "module_choice",
      step: "modules",
      module: k,
      turned_on: d.enabled[k],
    })
  const extras = extrasOf(d)
  for (const k of DRAFT_EXTRAS)
    logFunnel({
      event: "module_choice",
      step: "modules",
      module: k,
      turned_on: extras[k],
    })
}

/** Live mode: the "about you" answers reach the account. Sign-up already
 * created it, and the server writes each answer only once, so sending the
 * sign-up call again with them is safe. Best effort: the answers are
 * optional. */
function sendAbout(d: OnboardingDraft) {
  const about = aboutOf(d)
  const user = sessionStore.get().user
  if (!liveMode || !about || !Object.keys(about).length || !user?.username)
    return
  const live = require("@/live/auth") as typeof import("@/live/auth")
  void live.completeProfile(user.name, user.username, about).catch(() => {})
}

/** `/get-started` is the account step; `/onboarding` is the rest. */
export function Onboarding({ phase = "post" }: { phase?: "pre" | "post" }) {
  if (phase === "pre") return <AccountStep />
  return <AfterAccount />
}

/** The account form, counted as the funnel's account step. */
function AccountStep() {
  useEffect(() => {
    logFunnel({ event: "step_view", step: "account" })
  }, [])
  return <AccountForm onBack={() => back("/welcome")} />
}

function AfterAccount() {
  const t = useTheme(),
    safe = useSafeAreaInsets(),
    fern = companionStore.use((s) => s.name),
    onboarded = dashStore.use((s) => s.onboarded),
    d = draftStore.use((s) => s.draft) ?? newDraft(),
    step: Step = isFunnelStep(d.step) ? d.step : "modules",
    setStep = (x: MobileStep) => editDraft({ step: x }),
    enabled = d.enabled,
    extras = extrasOf(d),
    index = ONBOARDING_STEPS.indexOf(step),
    finish = () => {
      // The answers become the account's; setup is the last part.
      applyDraft()
      go("/setup")
    },
    advance = () =>
      index >= ONBOARDING_STEPS.length - 1
        ? finish()
        : setStep(ONBOARDING_STEPS[index + 1]),
    // Leaving a step forward counts as finishing it (Skip says skip).
    next = () => {
      funnelDone(step, d)
      if (step === "about") sendAbout(d)
      advance()
    }
  // Every step shown counts once per showing, for the funnel.
  useEffect(() => {
    logFunnel({ event: "step_view", step })
  }, [step])
  useEffect(() => {
    ensureDraft()
  }, [])
  // Onboarding is the first run only; "Run setup again" is /setup.
  useEffect(() => {
    if (onboarded) replace("/today")
  }, [onboarded])
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
  const configs: Partial<
      Record<
        MobileStep,
        { icon: typeof LayoutGrid; title: string; body: string }
      >
    > = {
      modules: {
        icon: LayoutGrid,
        title: "What do you want to track?",
        body: "Start with what matters. Add the rest anytime.",
      },
      capture: {
        icon: MessageCircle,
        title: "Tell me one thing from today",
        body: `Something you did, ate, spent or need to do. ${fern} sorts it into the right place.`,
      },
      about: {
        icon: UserRound,
        title: "A little about you",
        body: "Two quick questions. Both are optional.",
      },
      when: {
        icon: Gauge,
        title: "Set your pace",
        body: "Start smaller than you think. You can raise it anytime.",
      },
    },
    c = configs[step] ?? configs.modules!,
    I = c.icon
  const ticked = (k: ModuleKey | DraftExtra) =>
    k in enabled ? enabled[k as ModuleKey] : extras[k as DraftExtra]
  const anyTicked =
    Object.values(enabled).some(Boolean) || Object.values(extras).some(Boolean)
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
              onPress={() => setStep(ONBOARDING_STEPS[index - 1])}
            />
          ) : (
            <View style={{ width: 44 }} />
          )}
          <View
            style={{ flex: 1, flexDirection: "row", gap: 6 }}
            accessible
            accessibilityLabel={`Step ${index + 1} of ${ONBOARDING_STEPS.length}`}
          >
            {ONBOARDING_STEPS.map((x, i) => (
              <View
                key={x}
                style={{
                  height: 6,
                  flex: 1,
                  borderRadius: 3,
                  backgroundColor: i <= index ? t.primary : t.soft,
                }}
              />
            ))}
          </View>
          {SKIPPABLE.includes(step) ? (
            <Tap
              onPress={() => {
                // Skipping "about you" leaves both answers unanswered.
                if (step === "about")
                  editDraft({
                    occupation: null,
                    occupationDetail: "",
                    referralSource: null,
                    referralDetail: "",
                  })
                logFunnel({ event: "step_skip", step })
                advance()
              }}
              style={{ padding: 8, minHeight: 44, justifyContent: "center" }}
            >
              <Copy size={14} muted>
                Skip
              </Copy>
            </Tap>
          ) : (
            <View style={{ width: 44 }} />
          )}
        </Line>
      </View>
      <KeyboardAwareScrollView
        {...formScrollProps}
        bottomOffset={FIELD_CLEARANCE}
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: 20,
          paddingBottom: 32,
        }}
      >
        <View
          style={{
            alignItems: "center",
            paddingTop: 8,
            paddingBottom: 24,
          }}
        >
          <LinearGradient
            colors={[
              border(t.primary, 0.25),
              border(t.hab, 0.2),
              border(t.fit, 0.2),
            ]}
            style={{
              width: 64,
              height: 64,
              borderRadius: 20,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <I size={30} color={t.primary} />
          </LinearGradient>
          <Copy
            size={24}
            weight="display"
            style={{ marginTop: 16, letterSpacing: -0.6, textAlign: "center" }}
          >
            {c.title}
          </Copy>
          <Copy
            muted
            style={{ marginTop: 8, maxWidth: 320, textAlign: "center" }}
          >
            {c.body}
          </Copy>
        </View>
        <View style={{ flex: 1 }}>
          {step === "modules" && (
            <>
              <View style={{ gap: 8, marginBottom: 16 }}>
                {/* Choices only: Screen time's iOS permission is asked for
                    in setup. */}
                {MODULE_KEYS.map((k) => (
                  <ChoiceRow
                    key={k}
                    on={ticked(k)}
                    icon={areaIcon(k, 40)}
                    label={AREA[k].label}
                    note={
                      k !== "screen"
                        ? `${SETUP_TIME[k]} setup`
                        : screenTimeAvailable()
                          ? `${SETUP_TIME[k]} setup · needs Screen Time access`
                          : "Not in this version of Unfurl yet"
                    }
                    onPress={() => {
                      logFunnel({
                        event: "module_toggle",
                        step: "modules",
                        module: k,
                        turned_on: !enabled[k],
                      })
                      editDraft({ enabled: { ...enabled, [k]: !enabled[k] } })
                    }}
                  />
                ))}
                {DRAFT_EXTRAS.map((k) => {
                  const on = extras[k],
                    X = EXTRA_ROWS[k].icon
                  return (
                    <ChoiceRow
                      key={k}
                      on={on}
                      label={EXTRA_ROWS[k].label}
                      note={EXTRA_ROWS[k].note}
                      icon={
                        <View
                          style={{
                            width: 40,
                            height: 40,
                            borderRadius: 40 / 3,
                            backgroundColor: border(t.life, 0.15),
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <X size={20} color={t.life} />
                        </View>
                      }
                      onPress={() => {
                        logFunnel({
                          event: "module_toggle",
                          step: "modules",
                          module: k,
                          turned_on: !on,
                        })
                        editDraft({ extras: { ...extras, [k]: !on } })
                      }}
                    />
                  )
                })}
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
                    {fern}: type, talk or snap a photo
                  </Copy>
                  <Copy size={12} muted>
                    always on
                  </Copy>
                </Line>
              </View>
              {button(
                anyTicked ? "Next" : "Pick at least one",
                next,
                false,
                !anyTicked,
              )}
            </>
          )}
          {step === "capture" && (
            <FirstCaptureStep
              onSend={(c) => {
                holdFirstCapture(c)
                replayFirstCapture()
              }}
              onNext={next}
              button={button}
            />
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
          {step === "when" && (
            <PaceStep
              d={d}
              fern={fern}
              onDone={next}
              button={button}
              icon={areaIcon}
            />
          )}
        </View>
      </KeyboardAwareScrollView>
    </View>
  )
}

/** A tickable row: icon, label and note, a check at the end. */
function ChoiceRow({
  on,
  icon,
  label,
  note,
  onPress,
}: {
  on: boolean
  icon: React.ReactNode
  label: string
  note: string
  onPress: () => void
}) {
  const t = useTheme()
  return (
    <Tap
      label={`${label}, ${on ? "on" : "off"}`}
      selected={on}
      onPress={onPress}
      style={{
        padding: 14,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: on ? t.primary : t.line,
        backgroundColor: on ? border(t.primary, 0.1) : t.card,
      }}
    >
      <Line style={{ gap: 12 }}>
        {icon}
        <View style={{ flex: 1 }}>
          <Copy weight="semibold">{label}</Copy>
          <Copy size={12} muted>
            {note}
          </Copy>
        </View>
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
}

/** Pace (the starter targets) and the daily check-in time, on one screen. */
function PaceStep({
  d,
  fern,
  onDone,
  button,
  icon,
}: {
  d: OnboardingDraft
  fern: string
  onDone: () => void
  button: (label: string, press: () => void) => React.ReactNode
  icon: (k: keyof typeof modules, size?: number) => React.ReactNode
}) {
  const t = useTheme()
  const pace = d.pace ?? "gentle"
  const on = MODULE_KEYS.filter((k) => d.enabled[k])
  const setPace = (p: Pace) =>
    editDraft({
      pace: p,
      targets: Object.fromEntries(
        MODULE_KEYS.map((k) => [
          k,
          d.targets[k] === null ? null : PACES[p].targets[k],
        ]),
      ) as Record<ModuleKey, number | null>,
    })
  return (
    <>
      <View
        accessibilityRole="radiogroup"
        style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}
      >
        {(Object.keys(PACES) as Pace[]).map((p) => (
          <Tap
            key={p}
            role="radio"
            selected={pace === p}
            label={`${PACES[p].label}, ${PACES[p].note}`}
            onPress={() => setPace(p)}
            style={{
              flex: 1,
              paddingHorizontal: 8,
              paddingVertical: 14,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: pace === p ? t.primary : t.line,
              backgroundColor: pace === p ? border(t.primary, 0.1) : t.card,
              alignItems: "center",
              gap: 2,
            }}
          >
            <Copy size={14} weight="semibold">
              {PACES[p].label}
            </Copy>
            <Copy size={12} muted style={{ textAlign: "center" }}>
              {PACES[p].note}
            </Copy>
          </Tap>
        ))}
      </View>
      {on.length > 0 && (
        <Frame style={{ padding: 12, gap: 8, marginBottom: 12 }}>
          {on.map((k) => (
            <Line key={k} style={{ gap: 12 }}>
              {icon(k, 28)}
              <Copy size={14} style={{ flex: 1 }}>
                {STARTERS[k].label}
              </Copy>
              <Copy
                size={14}
                weight="semibold"
                style={{ fontFamily: fonts.mono }}
              >
                ≥ {PACES[pace].targets[k]}
                {STARTERS[k].unit}
              </Copy>
              <Copy size={12} muted>
                /{STARTERS[k].period}
              </Copy>
            </Line>
          ))}
        </Frame>
      )}
      <Frame style={{ padding: 16, gap: 8, marginBottom: 16 }}>
        <Line>
          <Moon size={20} color={t.primary} />
          <Copy size={14} weight="medium" style={{ flex: 1 }}>
            Daily check-in
          </Copy>
          <TimeInput
            label="Daily check-in"
            value={d.pushEvening}
            onChange={(v) => editDraft({ pushEvening: v })}
          />
        </Line>
        <Copy size={12} muted>
          {`With notifications on: at most one nudge a day, near this time. ${fern} learns when you usually log and moves it there.`}
        </Copy>
      </Frame>
      {button("Start my day", onDone)}
    </>
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
