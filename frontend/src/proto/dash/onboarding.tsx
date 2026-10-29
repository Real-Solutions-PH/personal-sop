"use client"

import {
  AlarmClock,
  ArrowLeft,
  BarChart3,
  Bell,
  CalendarClock,
  Check,
  Compass,
  Fingerprint,
  LayoutGrid,
  Moon,
  MoreVertical,
  PlusSquare,
  Rocket,
  Share,
  Smartphone,
  Sparkles,
  Sun,
  Target,
  Zap,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import {
  IDENTITIES,
  NO_SKIP,
  PACES,
  PASS_THROUGH,
  type Pace,
  STARTERS,
  STEPS,
  type Step,
} from "../../../../shared/prototype/dash/onboarding"
import type { ModuleKey } from "../contract"
import { uid } from "../lib/store"
import { Btn, Card, NumberInput } from "../ui/kit"
import { AREA, MODULE_KEYS } from "./data"
import { useInstallState } from "./me"
import {
  dashStore,
  saveGoal,
  setEnabled,
  setIdentities,
  setOnboarded,
  setPush,
} from "./store"
import { AreaIcon, useQueryParam } from "./ui"

// DSH-01..06 first-run flow (J7). Install is nudged, never required (OQ-DSH-14).
// Order is deliberate: the user invests (identity, targets, times) and commits
// before we ask for anything (push, install) — asks land after value, framed
// around the plan they just built.

interface BIPEvent extends Event {
  prompt: () => Promise<void>
}

export function OnboardingScreen() {
  const router = useRouter()
  const param = useQueryParam("step")
  const [step, setStep] = useState<Step>("welcome")
  useEffect(() => {
    if (param && (STEPS as readonly string[]).includes(param))
      setStep(param as Step)
  }, [param])
  const enabled = dashStore.use((s) => s.enabled)
  const push = dashStore.use((s) => s.push.permission)
  const install = useInstallState()
  const [bip, setBip] = useState<BIPEvent | null>(null)
  const times = dashStore.use((s) => s.push)
  const [picked, setPicked] = useState<string[]>([])
  const [pace, setPace] = useState<Pace | null>("gentle")
  const [targets, setTargets] = useState<Record<ModuleKey, number | null>>(
    PACES.gentle.targets,
  )
  useEffect(() => {
    const h = (e: Event) => {
      e.preventDefault()
      setBip(e as BIPEvent)
    }
    window.addEventListener("beforeinstallprompt", h)
    return () => window.removeEventListener("beforeinstallprompt", h)
  }, [])

  const i = STEPS.indexOf(step)
  const go = (s: Step) => {
    setStep(s)
    window.history.replaceState(null, "", `/onboarding?step=${s}`)
  }
  const next = () => go(STEPS[Math.min(STEPS.length - 1, i + 1)])
  const back = () => {
    let j = i - 1
    while (j > 0 && PASS_THROUGH.includes(STEPS[j])) j--
    return i === 0 ? router.push("/me") : go(STEPS[j])
  }
  const bar = STEPS.filter((s) => !PASS_THROUGH.includes(s))
  const barAt = bar.filter((s) => STEPS.indexOf(s) <= i).length - 1

  const choosePace = (p: Pace) => {
    setPace(p)
    setTargets((t) => {
      const out = { ...t }
      for (const k of MODULE_KEYS)
        if (t[k] !== null) out[k] = PACES[p].targets[k]
      return out
    })
  }
  const activeTargets = MODULE_KEYS.filter(
    (k) => enabled[k] && targets[k] !== null,
  )

  const finish = (to: string) => {
    const existing = dashStore.get().goals
    let n = 0
    for (const k of MODULE_KEYS) {
      const t = targets[k]
      if (!enabled[k] || t === null) continue
      const s = STARTERS[k]
      if (existing.some((g) => g.metric === s.metric && g.status === "active"))
        continue
      saveGoal({ ...s, target: t, via: "onboarding" })
      n++
    }
    if (picked.length)
      setIdentities(picked.map((text) => ({ id: uid(), text })))
    setOnboarded(true)
    toast.success("You're set", {
      description: n ? `${n} starter goal${n > 1 ? "s" : ""} added` : undefined,
    })
    router.push(to)
  }

  const askPush = async () => {
    if (!("Notification" in window)) {
      setPush({ permission: "denied" })
      toast("Push isn't available here — install the app first")
      return next()
    }
    const r = await Notification.requestPermission()
    setPush({ permission: r })
    next()
  }

  return (
    <div className="flex min-h-full flex-col px-5 pt-safe pb-8">
      <div className="flex h-14 items-center gap-3">
        <button
          type="button"
          aria-label="Back"
          onClick={back}
          className="grid size-11 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-muted"
        >
          <ArrowLeft className="size-5" />
        </button>
        <div className="flex flex-1 gap-1.5">
          {bar.map((s, n) => (
            <span
              key={s}
              className={cn(
                "h-1.5 flex-1 rounded-full transition-colors",
                n <= barAt ? "bg-primary" : "bg-muted",
              )}
            />
          ))}
        </div>
        {!NO_SKIP.includes(step) && (
          <button
            type="button"
            onClick={next}
            className="px-2 text-muted-foreground text-sm"
          >
            Skip
          </button>
        )}
      </div>

      <div className="flex flex-1 flex-col">
        {step === "welcome" && (
          <Hero
            icon={<Compass className="size-9" />}
            title="Your life, one dashboard"
            body="Habits, tasks, training and money — logged in seconds, scored honestly, shareable without leaking a peso."
          >
            <Btn className="h-12 w-full text-base" onClick={next}>
              Build my plan
            </Btn>
            <p className="mt-2 text-center text-muted-foreground text-xs">
              About 90 seconds · sign-in is mocked in the prototype
            </p>
          </Hero>
        )}

        {step === "identity" && (
          <Hero
            icon={<Fingerprint className="size-9" />}
            title="Who are you becoming?"
            body="Habits stick when they're part of who you are. Pick up to three — we'll build around them."
          >
            <div className="mb-4 space-y-2">
              {IDENTITIES.map((d) => {
                const on = picked.includes(d.text)
                const full = !on && picked.length >= 3
                return (
                  <button
                    key={d.text}
                    type="button"
                    aria-pressed={on}
                    disabled={full}
                    onClick={() =>
                      setPicked((p) =>
                        on ? p.filter((x) => x !== d.text) : [...p, d.text],
                      )
                    }
                    className={cn(
                      "flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition-colors disabled:opacity-40",
                      on
                        ? "border-primary bg-primary/10"
                        : "border-border bg-card",
                    )}
                  >
                    {d.module ? (
                      <AreaIcon k={d.module} />
                    ) : (
                      <span className="grid size-8 place-items-center rounded-lg bg-muted">
                        <Sparkles className="size-4" />
                      </span>
                    )}
                    <span className="flex-1 font-medium">“{d.text}”</span>
                    <span
                      className={cn(
                        "grid size-6 place-items-center rounded-full",
                        on ? "bg-primary text-background" : "bg-muted",
                      )}
                    >
                      {on && <Check className="size-4" />}
                    </span>
                  </button>
                )
              })}
            </div>
            <Btn
              className="h-12 w-full"
              disabled={!picked.length}
              onClick={next}
            >
              {picked.length ? "That's me" : "Pick at least one"}
            </Btn>
          </Hero>
        )}

        {step === "targets" && (
          <Hero
            icon={<Target className="size-9" />}
            title="Pick your pace"
            body="Start smaller than you think. Early wins build the streak; you can raise the bar anytime."
          >
            <fieldset className="mb-3 grid grid-cols-3 gap-2">
              <legend className="sr-only">Pace</legend>
              {(Object.keys(PACES) as Pace[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={pace === p}
                  onClick={() => choosePace(p)}
                  className={cn(
                    "relative rounded-2xl border px-2 pt-4 pb-3 text-center transition-colors",
                    pace === p
                      ? "border-primary bg-primary/10"
                      : "border-border bg-card",
                  )}
                >
                  {p === "gentle" && (
                    <span className="-top-2 -translate-x-1/2 absolute left-1/2 whitespace-nowrap rounded-full bg-primary px-2 py-0.5 font-semibold text-[10px] text-background">
                      Recommended
                    </span>
                  )}
                  <div className="font-semibold text-sm">{PACES[p].label}</div>
                  <div className="text-muted-foreground text-xs">
                    {PACES[p].note}
                  </div>
                </button>
              ))}
            </fieldset>
            <div className="mb-4 space-y-2">
              {MODULE_KEYS.filter((k) => enabled[k]).map((k) => {
                const s = STARTERS[k]
                const v = targets[k]
                return (
                  <Card
                    key={k}
                    className={cn("p-3", v === null && "opacity-50")}
                  >
                    <div className="flex items-center gap-3">
                      <AreaIcon k={k} />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm">
                          {s.label} {s.comparator === "gte" ? "≥" : "≤"}
                        </div>
                        <div className="text-muted-foreground text-xs">
                          {s.hint} · per {s.period}
                        </div>
                      </div>
                      <NumberInput
                        inputMode="numeric"
                        aria-label={`${s.label} target`}
                        disabled={v === null}
                        value={v ?? ""}
                        onChange={(e) => {
                          setPace(null)
                          setTargets((t) => ({
                            ...t,
                            [k]: Number(e.target.value.replace(/\D/g, "")) || 0,
                          }))
                        }}
                        className="num h-10 w-16 rounded-xl border border-border bg-background text-center font-semibold outline-none focus:border-primary"
                      />
                      <span className="w-4 text-muted-foreground text-sm">
                        {s.unit}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setTargets((t) => ({
                          ...t,
                          [k]:
                            v === null
                              ? PACES[pace ?? "gentle"].targets[k]
                              : null,
                        }))
                      }
                      className="mt-1 pl-11 text-primary text-xs"
                    >
                      {v === null ? "Use a target" : "Skip this one"}
                    </button>
                  </Card>
                )
              })}
            </div>
            <Btn className="h-12 w-full" onClick={next}>
              Next
            </Btn>
          </Hero>
        )}

        {step === "when" && (
          <Hero
            icon={<CalendarClock className="size-9" />}
            title="When will you check in?"
            body="People who decide when and where they'll act follow through far more often than people who just intend to."
          >
            <Card className="mb-4 space-y-3">
              <TimeRow
                icon={<Sun className="size-5 text-primary" />}
                label="Plan my day"
                value={times.morning}
                onChange={(v) => setPush({ morning: v })}
              />
              <TimeRow
                icon={<Moon className="size-5 text-primary" />}
                label="Wrap it up"
                value={times.evening}
                onChange={(v) => setPush({ evening: v })}
              />
            </Card>
            <p className="mb-4 text-center text-muted-foreground text-sm">
              “Every day at{" "}
              <b className="num text-foreground">{times.morning}</b> I'll plan,
              and at <b className="num text-foreground">{times.evening}</b> I'll
              close the day.”
            </p>
            <Btn className="h-12 w-full" onClick={next}>
              Lock these in
            </Btn>
          </Hero>
        )}

        {step === "building" && (
          <Building
            lines={[
              "Weighting your Life Score",
              `Setting ${activeTargets.length || "your"} starter target${activeTargets.length === 1 ? "" : "s"}`,
              `Scheduling check-ins at ${times.morning} & ${times.evening}`,
              "Preparing your first week",
            ]}
            onDone={next}
          />
        )}

        {step === "pledge" && (
          <Hero
            icon={<Zap className="size-9" />}
            title="Your plan is ready"
            body="Make it official. A promise you commit to is one you're far more likely to keep."
          >
            <Card className="mb-4 space-y-3 text-sm">
              {picked.length > 0 && (
                <div className="space-y-1">
                  <div className="text-muted-foreground text-xs uppercase tracking-wide">
                    Who I'm becoming
                  </div>
                  {picked.map((t) => (
                    <div key={t} className="font-medium">
                      “{t}”
                    </div>
                  ))}
                </div>
              )}
              {activeTargets.length > 0 && (
                <div className="space-y-1.5 border-border/50 border-t pt-3">
                  {activeTargets.map((k) => (
                    <div key={k} className="flex items-center gap-2">
                      <AreaIcon k={k} />
                      <span className="flex-1">{STARTERS[k].label}</span>
                      <b className="num">
                        {STARTERS[k].comparator === "gte" ? "≥" : "≤"}{" "}
                        {targets[k]}
                        {STARTERS[k].unit}
                      </b>
                      <span className="text-muted-foreground text-xs">
                        /{STARTERS[k].period}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2 border-border/50 border-t pt-3 text-muted-foreground">
                <CalendarClock className="size-4" /> Check in at{" "}
                <b className="num text-foreground">{times.morning}</b> &{" "}
                <b className="num text-foreground">{times.evening}</b>
              </div>
            </Card>
            <HoldButton onDone={next}>Hold to commit</HoldButton>
          </Hero>
        )}

        {step === "install" && (
          <Hero
            icon={<Smartphone className="size-9" />}
            title="Keep your plan one tap away"
            body={
              install.standalone
                ? "You're already running the installed app. ✓"
                : "What's in sight gets done. Full screen, faster — and on iPhone it's the only way reminders work."
            }
          >
            {!install.standalone && (
              <Card className="mb-4 space-y-3 text-sm">
                <div className="font-semibold">
                  {install.ios
                    ? "On iPhone (Safari)"
                    : "On iPhone (Safari) · Android (Chrome)"}
                </div>
                <GuideStep n={1} icon={<Share className="size-4" />}>
                  Tap <b>Share</b> in Safari's toolbar
                </GuideStep>
                <GuideStep n={2} icon={<PlusSquare className="size-4" />}>
                  Scroll and tap <b>Add to Home Screen</b>
                </GuideStep>
                <GuideStep n={3} icon={<Check className="size-4" />}>
                  Tap <b>Add</b>, then open SOP from your home screen
                </GuideStep>
                {!install.ios && (
                  <div className="flex items-center gap-2 border-border/50 border-t pt-3 text-muted-foreground">
                    <MoreVertical className="size-4" /> Android: menu →{" "}
                    <b className="text-foreground">Install app</b>
                  </div>
                )}
              </Card>
            )}
            {bip && (
              <Btn
                className="mb-2 h-12 w-full"
                onClick={async () => {
                  await bip.prompt()
                  setBip(null)
                }}
              >
                Install now
              </Btn>
            )}
            <Btn
              variant={bip ? "secondary" : "primary"}
              className="h-12 w-full"
              onClick={next}
            >
              {install.standalone ? "Continue" : "I did it"}
            </Btn>
          </Hero>
        )}

        {step === "notifications" && (
          <Hero
            icon={<Bell className="size-9" />}
            title="Protect your plan"
            body="Streaks rarely die on hard days — they die on days you simply forgot. We'll nudge you at the times you picked, three a day max."
          >
            <Card className="mb-4 space-y-2.5 text-sm">
              {(
                [
                  [Sun, "Morning", `What's due today · ${times.morning}`],
                  [Moon, "Evening", `Wrap up the day · ${times.evening}`],
                  [BarChart3, "Weekly review", "Sunday 19:00"],
                  [
                    AlarmClock,
                    "Reminders",
                    "Tasks and habits you set times for",
                  ],
                ] as const
              ).map(([Icon, t, s]) => (
                <div key={t} className="flex items-center gap-3">
                  <Icon className="size-5 text-primary" />
                  <span className="flex-1">
                    <b>{t}</b>
                    <span className="block text-muted-foreground text-xs">
                      {s}
                    </span>
                  </span>
                </div>
              ))}
            </Card>
            {install.ios && !install.standalone ? (
              <>
                <Card className="mb-3 border-warn/40 bg-warn/10 text-sm">
                  On iPhone, notifications can be enabled after you install the
                  app. Everything else works now.
                </Card>
                <Btn className="h-12 w-full" onClick={next}>
                  Enable after install
                </Btn>
              </>
            ) : push === "granted" ? (
              <Btn className="h-12 w-full" onClick={next}>
                Notifications on ✓ — continue
              </Btn>
            ) : (
              <>
                <Btn className="h-12 w-full" onClick={askPush}>
                  Remind me at {times.morning} & {times.evening}
                </Btn>
                <Btn variant="ghost" className="mt-1 w-full" onClick={next}>
                  Not now
                </Btn>
              </>
            )}
          </Hero>
        )}

        {step === "modules" && (
          <Hero
            icon={<LayoutGrid className="size-9" />}
            title="What do you want to track?"
            body="Turn off what you don't need. Data is kept if you switch later."
          >
            <div className="mb-4 space-y-2">
              {MODULE_KEYS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setEnabled(k, !enabled[k])}
                  aria-pressed={enabled[k]}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition-colors",
                    enabled[k]
                      ? "border-primary bg-primary/10"
                      : "border-border bg-card",
                  )}
                >
                  <AreaIcon k={k} size="lg" />
                  <span className="flex-1 font-semibold">{AREA[k].label}</span>
                  <span
                    className={cn(
                      "grid size-6 place-items-center rounded-full",
                      enabled[k] ? "bg-primary text-background" : "bg-muted",
                    )}
                  >
                    {enabled[k] && <Check className="size-4" />}
                  </span>
                </button>
              ))}
              <div className="flex items-center gap-3 rounded-2xl border border-border border-dashed p-4 text-muted-foreground">
                <Sparkles className="size-6" />
                <span className="flex-1">Capture (chat, voice, photo)</span>
                <span className="text-xs">always on</span>
              </div>
            </div>
            <Btn
              className="h-12 w-full"
              disabled={!Object.values(enabled).some(Boolean)}
              onClick={next}
            >
              Next
            </Btn>
          </Hero>
        )}
        {step === "done" && (
          <Hero
            icon={<Rocket className="size-9" />}
            title="Day 1 starts now"
            body={`It's ${new Date().toLocaleDateString(undefined, { weekday: "long" })} — a clean slate. Tap + anytime and just say what happened: “ran 5k, spent 250 on lunch”.`}
          >
            <Card className="mb-4 text-sm">
              <div className="mb-2 flex items-center justify-between">
                <b>Your first week</b>
                <span className="text-muted-foreground text-xs">
                  Plan set ✓ · 1 of 7
                </span>
              </div>
              <div className="flex gap-1.5">
                {Array.from({ length: 7 }, (_, n) => (
                  <span
                    key={n}
                    className={cn(
                      "h-2 flex-1 rounded-full",
                      n === 0 ? "animate-pulse bg-primary" : "bg-muted",
                    )}
                  />
                ))}
              </div>
              <p className="mt-2 text-muted-foreground text-xs">
                Log one thing today to light up day 1.
              </p>
            </Card>
            <Btn
              className="h-12 w-full text-base"
              onClick={() => finish("/setup")}
            >
              Bring my data in
            </Btn>
            <Btn
              variant="ghost"
              className="mt-1 w-full"
              onClick={() => finish("/today")}
            >
              Go to Today
            </Btn>
          </Hero>
        )}
      </div>
    </div>
  )
}

function Hero({
  icon,
  title,
  body,
  children,
}: {
  icon: React.ReactNode
  title: string
  body: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col items-center justify-center py-6 text-center">
        <div className="grid size-20 place-items-center rounded-3xl bg-gradient-to-br from-primary/25 via-hab/20 to-fit/20 text-4xl text-primary">
          {icon}
        </div>
        <h1 className="font-display mt-5 font-bold text-2xl tracking-tight">
          {title}
        </h1>
        <p className="mt-2 max-w-xs text-muted-foreground">{body}</p>
      </div>
      <div>{children}</div>
    </div>
  )
}

function GuideStep({
  n,
  icon,
  children,
}: {
  n: number
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="num grid size-7 shrink-0 place-items-center rounded-full bg-primary font-semibold text-background text-xs">
        {n}
      </span>
      <span className="flex-1">{children}</span>
      <span className="grid size-8 place-items-center rounded-lg bg-muted">
        {icon}
      </span>
    </div>
  )
}

function TimeRow({
  icon,
  label,
  value,
  onChange,
}: {
  icon: React.ReactNode
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <label className="flex items-center gap-3">
      {icon}
      <span className="flex-1 font-medium text-sm">{label}</span>
      <input
        type="time"
        value={value}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        className="num h-10 rounded-xl border border-border bg-background px-3 font-semibold outline-none focus:border-primary"
      />
    </label>
  )
}

/** Deliberately paced so the plan reads as built for you, not pulled from a template. */
function Building({ lines, onDone }: { lines: string[]; onDone: () => void }) {
  const [n, setN] = useState(0)
  const done = useRef(onDone)
  done.current = onDone
  useEffect(() => {
    if (n > lines.length) return
    const t = setTimeout(
      () => (n === lines.length ? done.current() : setN(n + 1)),
      n === 0 ? 300 : 650,
    )
    return () => clearTimeout(t)
  }, [n, lines.length])
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center">
      <div className="grid size-20 animate-pulse place-items-center rounded-3xl bg-gradient-to-br from-primary/25 via-hab/20 to-fit/20 text-primary">
        <Sparkles className="size-9" />
      </div>
      <h1 className="font-display mt-5 font-bold text-2xl tracking-tight">
        Building your plan…
      </h1>
      <ul
        className="mt-6 w-full max-w-xs space-y-3 text-left"
        aria-live="polite"
      >
        {lines.map((l, k) => (
          <li
            key={l}
            className={cn(
              "flex items-center gap-3 text-sm transition-opacity duration-300",
              k < n ? "opacity-100" : "opacity-30",
            )}
          >
            <span
              className={cn(
                "grid size-6 shrink-0 place-items-center rounded-full",
                k < n ? "bg-primary text-background" : "bg-muted",
              )}
            >
              {k < n && <Check className="size-4" />}
            </span>
            {l}
          </li>
        ))}
      </ul>
    </div>
  )
}

const HOLD_MS = 1200

/** Press-and-hold commit. Keyboard activation (Enter/Space) commits at once. */
function HoldButton({
  onDone,
  children,
}: {
  onDone: () => void
  children: React.ReactNode
}) {
  const [holding, setHolding] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const commit = () => {
    navigator.vibrate?.(40)
    onDone()
  }
  const start = () => {
    setHolding(true)
    timer.current = setTimeout(commit, HOLD_MS)
  }
  const stop = () => {
    setHolding(false)
    clearTimeout(timer.current)
  }
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <button
      type="button"
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => e.detail === 0 && commit()}
      className="relative h-14 w-full touch-none select-none overflow-hidden rounded-xl bg-muted font-semibold text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span
        className="absolute inset-y-0 left-0 bg-primary ease-linear"
        style={{
          width: holding ? "100%" : "0%",
          transition: `width ${holding ? HOLD_MS : 200}ms linear`,
        }}
      />
      <span
        className={cn(
          "relative flex items-center justify-center gap-2",
          holding && "text-background",
        )}
      >
        <Fingerprint className="size-5" />
        {holding ? "Keep holding…" : children}
      </span>
    </button>
  )
}
