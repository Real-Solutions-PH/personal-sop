"use client"

import {
  ArrowRight,
  Bell,
  Check,
  ChevronRight,
  CloudSun,
  Eye,
  EyeOff,
  Mic,
  Moon,
  PartyPopper,
  Plus,
  Share2,
  Smartphone,
  Sparkles,
  Target,
  Trophy,
  X,
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { addJournalEntry } from "../capture/actions"
import type { CalendarItem } from "../contract"
import { checkHabit, skipHabit } from "../habits/actions"
import { openCapture } from "../lib/capture"
import { dayKey, dayOffset, isEvening } from "../lib/day"
import { privacyStore, togglePrivacy } from "../lib/privacy"
import { modules } from "../modules"
import { completeTask, rescheduleBy } from "../tasks/actions"
import { Bar, Btn, Card, Empty, Ring, Screen, SectionTitle } from "../ui/kit"
import { AREA, type Notif, weekStartKey } from "./data"
import { DayHero } from "./day-hero"
import {
  fmtGoal,
  useAllCalendar,
  useAllMisses,
  useEnabled,
  useGoals,
  useOnTarget,
  useTodayRing,
  useTrophies,
} from "./hooks"
import { AppLauncher } from "./launcher"
import { SetupCard } from "./setup"
import {
  dashStore,
  markAllRead,
  markNotifRead,
  sealDay,
  setInstallDismissed,
  unsealDay,
} from "./store"
import {
  ErrorCard,
  Loading,
  ModuleDot,
  useQueryParam,
  useViewState,
} from "./ui"

// DSH-10 Today · DSH-11 empty day · DSH-12 wrap-up · DSH-14 inbox.

type ItemRef = { kind: "habit" | "task"; id: string } | null

/** Parse a CalendarItem id back to the owning module's record (1-tap writes). */
function refOf(i: CalendarItem): ItemRef {
  if (i.module === "habits" && i.id.startsWith("habit-"))
    return { kind: "habit", id: i.id.slice(6, -(i.day.length + 1)) }
  if (i.module === "tasks" && i.id.startsWith("task:"))
    return { kind: "task", id: i.id.slice(5) }
  return null
}

function completeItem(i: CalendarItem): boolean {
  const r = refOf(i)
  if (r?.kind === "habit") return !!checkHabit(r.id, i.day)
  if (r?.kind === "task") {
    completeTask(r.id)
    return true
  }
  return false
}

const cleanTitle = (t: string) =>
  t.replace(/^\p{Extended_Pictographic}\s*/u, "")

function useLongPress(cb: () => void, ms = 600) {
  const t = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clear = () => {
    if (t.current) clearTimeout(t.current)
    t.current = null
  }
  return {
    onPointerDown: () => {
      clear()
      t.current = setTimeout(cb, ms)
    },
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
  }
}

const greeting = () => {
  const h = new Date().getHours()
  if (h >= 4 && h < 12) return "Good morning"
  if (h >= 12 && h < 18) return "Good afternoon"
  return "Good evening"
}

function useIsStandalone() {
  const [v, setV] = useState(true)
  useEffect(() => {
    setV(
      window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true,
    )
  }, [])
  return v
}

/** Morning vs evening layout from the clock and the user's "Evening starts at"
 *  setting; re-checked each minute and on return to the app. `?mode=` pins it
 *  for demos. */
function useEvening(modeParam: string | null) {
  const start = dashStore.use((s) => s.eveningStart)
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const tick = () => setNow(new Date())
    const id = setInterval(tick, 60_000)
    document.addEventListener("visibilitychange", tick)
    return () => {
      clearInterval(id)
      document.removeEventListener("visibilitychange", tick)
    }
  }, [])
  if (modeParam === "evening") return true
  if (modeParam === "morning") return false
  return isEvening(now, start)
}

// ================================================================= Today

export function TodayScreen() {
  const state = useViewState()
  const modeParam = useQueryParam("mode")
  const evening = useEvening(modeParam)

  const hidden = privacyStore.use((s) => s.hidden)
  const unread = dashStore.use((s) => s.notifs.filter((n) => !n.read).length)
  const name = dashStore.use((s) => s.profile.name)
  const enabled = useEnabled()
  const ring = useTodayRing()
  const target = useOnTarget(7)
  const threshold = dashStore.use((s) => s.targetThreshold)
  const sealed = dashStore.use((s) => s.wrapups[dayKey()])

  const press = useLongPress(() => {
    togglePrivacy()
    toast(
      privacyStore.get().hidden
        ? "Privacy mode on — amounts blurred"
        : "Privacy mode off",
    )
  })

  const anyModule = Object.values(enabled).some(Boolean)
  const isNew = state === "new" || !anyModule
  const freeDay = state === "empty" || (!isNew && ring.due === 0)
  const allDone = !freeDay && ring.due > 0 && ring.done >= ring.due
  const onTarget = ring.due > 0 && ring.done / ring.due >= threshold
  const today = new Date()

  return (
    <div className="flex min-h-full flex-col">
      <header className="pt-safe sticky top-0 z-20 bg-background/85 backdrop-blur-md">
        <div className="flex items-start gap-3 px-4 pt-3 pb-3">
          <div
            {...press}
            className="min-w-0 flex-1 select-none"
            title="Long-press to toggle privacy mode"
          >
            <div className="text-muted-foreground text-xs uppercase tracking-wider">
              {today.toLocaleDateString("en-PH", {
                weekday: "long",
                month: "short",
                day: "numeric",
              })}
            </div>
            <h1 className="font-display truncate font-semibold text-2xl tracking-tight">
              {greeting()}, {name.split(" ")[0]}
            </h1>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label={hidden ? "Show amounts" : "Hide amounts"}
              aria-pressed={hidden}
              onClick={togglePrivacy}
              className={cn(
                "grid size-11 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-muted",
                hidden ? "text-primary" : "text-muted-foreground",
              )}
            >
              {hidden ? (
                <EyeOff className="size-5" />
              ) : (
                <Eye className="size-5" />
              )}
            </button>
            <Link
              href="/today/inbox"
              aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
              className="relative grid size-11 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-muted"
            >
              <Bell className="size-5" />
              {unread > 0 && (
                <span className="font-display num absolute top-1.5 right-1.5 grid min-w-4 place-items-center rounded-full bg-bad px-1 font-semibold text-[10px] text-background">
                  {unread}
                </span>
              )}
            </Link>
          </div>
        </div>
      </header>

      <div className="flex-1 space-y-3 px-4 pb-8">
        {!isNew && (
          <DayHero threshold={threshold} sealed={!!sealed} enabled={enabled} />
        )}
        <SetupCard />
        <AppLauncher title="Your apps" />

        {state === "loading" ? (
          <Loading rows={4} />
        ) : isNew ? (
          <NewUserEmpty />
        ) : state === "empty" ? (
          <FreeDayCard />
        ) : (
          <>
            {evening ? (
              <WrapUpCard
                open={ring.due - ring.done}
                sealed={!!sealed}
                onTarget={onTarget}
              />
            ) : allDone ? null : (
              <NextUpCard />
            )}
            {allDone && <TargetHitCard streak={target.current} />}
            {freeDay && <FreeDayCard compact />}
            <InstallNudge />

            {modules
              .filter((m) => enabled[m.key])
              .map((m) =>
                state === "error" && m.key === "tasks" ? (
                  <ErrorCard key={m.key} what="Tasks" />
                ) : (
                  <m.TodayCard key={m.key} />
                ),
              )}

            <GoalsInPlay />
            {evening ? <TomorrowPreview /> : <ContextualCard />}
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- cards

function NextUpCard() {
  const today = dayKey()
  const items = useAllCalendar(today, today)
  const next = useMemo(() => {
    const now = new Date()
    const nowHm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`
    const open = items.filter((i) => !i.done && i.module !== "finance")
    const timed = open.filter((i) => i.time)
    const upcoming = timed.find((i) => (i.time ?? "") >= nowHm)
    const late = timed.filter((i) => (i.time ?? "") < nowHm).at(-1)
    return late ?? upcoming ?? open.find((i) => !i.time) ?? null
  }, [items])
  if (!next) return null
  const ref = refOf(next)
  const tint = {
    habits: "bg-hab/15 text-hab",
    tasks: "bg-tsk/15 text-tsk",
    fitness: "bg-fit/15 text-fit",
    finance: "bg-fin/15 text-fin",
  }[next.module]
  return (
    <Card className="flex items-center gap-3">
      <Link href={next.href} className="flex min-w-0 flex-1 items-center gap-3">
        <div
          className={cn(
            "grid size-11 shrink-0 place-items-center rounded-xl",
            tint,
          )}
        >
          <ArrowRight className="size-5" />
        </div>
        <div className="min-w-0">
          <div className="text-muted-foreground text-[11px] uppercase tracking-wider">
            Next up{next.time ? ` · ${next.time}` : ""}
          </div>
          <div className="truncate font-semibold">{next.title}</div>
        </div>
      </Link>
      {ref ? (
        <button
          type="button"
          aria-label={`Mark ${cleanTitle(next.title)} done`}
          onClick={() => {
            if (completeItem(next))
              toast.success(`Done: ${cleanTitle(next.title)}`)
          }}
          className="grid size-11 place-items-center rounded-full bg-good/15 text-good active:scale-95"
        >
          <Check className="size-5" strokeWidth={3} />
        </button>
      ) : (
        <ChevronRight className="size-5 text-muted-foreground" />
      )}
    </Card>
  )
}

function WrapUpCard({
  open,
  sealed,
  onTarget,
}: {
  open: number
  sealed: boolean
  onTarget: boolean
}) {
  return (
    <Card
      href="/today/wrap-up"
      className="flex items-center gap-3 bg-gradient-to-br from-hab/20 via-hab/5 to-transparent"
    >
      <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-hab/20 text-hab">
        <Moon className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-semibold">
          {sealed
            ? `Day sealed · ${onTarget ? "On target ✓" : "Off target"}`
            : open > 0
              ? `${open} item${open > 1 ? "s" : ""} open — wrap up`
              : "All done — seal the day"}
        </div>
        <div className="text-muted-foreground text-xs">
          {sealed
            ? "Tap to review or reopen"
            : "30 seconds: tick, push, reflect"}
        </div>
      </div>
      <ChevronRight className="size-5 text-muted-foreground" />
    </Card>
  )
}

function TargetHitCard({ streak }: { streak: number }) {
  return (
    <Card className="overflow-hidden bg-gradient-to-br from-life/25 via-life/5 to-transparent">
      <div className="flex items-center gap-3">
        <PartyPopper className="size-8 text-life" />
        <div className="flex-1">
          <div className="font-semibold text-lg">Target hit ✓</div>
          <div className="text-muted-foreground text-sm">
            Everything due is done. Streak: {streak} days
          </div>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <Btn href="/stats/share?t=streak" className="flex-1">
          <Share2 className="size-4" /> Share streak
        </Btn>
        <Btn href="/today/wrap-up" variant="secondary" className="flex-1">
          <Moon className="size-4" /> Wrap up
        </Btn>
      </div>
    </Card>
  )
}

function FreeDayCard({ compact }: { compact?: boolean }) {
  return (
    <Card className="bg-gradient-to-br from-fin/15 to-transparent">
      <div className="flex items-center gap-3">
        <CloudSun className="size-8 text-fin" />
        <div className="flex-1">
          <div className="font-semibold">Free day</div>
          <div className="text-muted-foreground text-sm">
            Nothing due. It's neutral — your streak is safe.
          </div>
        </div>
      </div>
      {!compact && (
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Btn href="/plan?seg=calendar" variant="secondary" className="px-2">
            Plan tomorrow
          </Btn>
          <Btn
            variant="secondary"
            className="px-2"
            onClick={() => openCapture()}
          >
            Capture
          </Btn>
          <Btn href="/fitness/workout" variant="secondary" className="px-2">
            Log workout
          </Btn>
        </div>
      )}
    </Card>
  )
}

function NewUserEmpty() {
  return (
    <div className="pt-4">
      <Card className="bg-gradient-to-br from-primary/15 via-hab/10 to-transparent text-center">
        <Sparkles className="mx-auto size-8 text-primary" />
        <div className="mt-2 font-semibold text-lg">
          Your dashboard fills as you log
        </div>
        <p className="mt-1 text-muted-foreground text-sm">
          Start with one thing. Everything you track lands here, every morning.
        </p>
      </Card>
      <div className="mt-3 space-y-2">
        <Card href="/habits/new" className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-hab/15 text-hab">
            <Plus className="size-5" />
          </span>
          <div className="flex-1 font-medium">Add a habit</div>
          <ChevronRight className="size-4 text-muted-foreground" />
        </Card>
        <Card onClick={() => openCapture()} className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-primary/15 text-primary">
            <Mic className="size-5" />
          </span>
          <div className="flex-1 font-medium">Capture anything</div>
          <ChevronRight className="size-4 text-muted-foreground" />
        </Card>
        <Card href="/finance/budgets" className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-fin/15 text-fin">
            <Target className="size-5" />
          </span>
          <div className="flex-1 font-medium">Set a budget</div>
          <ChevronRight className="size-4 text-muted-foreground" />
        </Card>
        <Btn href="/onboarding" variant="ghost" className="w-full">
          Run setup again
        </Btn>
      </div>
    </div>
  )
}

function GoalsInPlay() {
  const goals = useGoals()
  const shown = goals
    .filter((g) => g.goal.status === "active" && g.goal.period === "week")
    .slice(0, 2)
  if (!shown.length) return null
  return (
    <Card>
      <Link href="/stats/goals" className="mb-2 flex items-center gap-2">
        <Target className="size-4 text-primary" />
        <span className="flex-1 font-semibold">Goals in play</span>
        <ChevronRight className="size-4 text-muted-foreground" />
      </Link>
      <div className="space-y-3">
        {shown.map(({ goal, entry, pct, hit }) => (
          <Link
            key={goal.id}
            href={
              goal.metric.includes(":")
                ? `/stats/metric/${encodeURIComponent(goal.metric)}`
                : "/stats/goals"
            }
            className="block"
          >
            <div className="mb-1 flex items-baseline justify-between text-sm">
              <span className="truncate">
                {goal.label}{" "}
                <span className="text-muted-foreground text-xs">
                  {fmtGoal(goal)}
                </span>
              </span>
              <span className={cn("num font-medium", hit && "text-good")}>
                {entry?.value ?? "—"}
                {hit && " ✓"}
              </span>
            </div>
            <Bar value={Math.min(1, pct)} accent={hit ? "life" : "primary"} />
          </Link>
        ))}
      </div>
    </Card>
  )
}

function ContextualCard() {
  const reviews = dashStore.use((s) => s.reviews)
  const seen = dashStore.use((s) => s.seenTrophies)
  const trophies = useTrophies()
  const y = dayOffset(-1)
  const misses = useAllMisses(y, y)
  const weekKey = `w-${weekStartKey(1)}`
  const reviewPending = !reviews[weekKey]?.done
  const fresh = trophies.find((t) => !seen.includes(t.id))

  if (reviewPending)
    return (
      <Card href="/stats/reviews" className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-primary/15 text-primary">
          <Sparkles className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">Weekly review is ready</div>
          <div className="text-muted-foreground text-xs">
            3 minutes · wins, misses, one focus
          </div>
        </div>
        <ChevronRight className="size-4 text-muted-foreground" />
      </Card>
    )
  if (fresh)
    return (
      <Card href="/stats/trophies" className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-life/15 text-life">
          <Trophy className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">New: {fresh.title}</div>
          <div className="text-muted-foreground text-xs">{fresh.detail}</div>
        </div>
        <ChevronRight className="size-4 text-muted-foreground" />
      </Card>
    )
  if (misses.length)
    return (
      <Card href="/stats/misses" className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-bad/10 text-bad">
          <X className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">
            {misses.length} miss{misses.length > 1 ? "es" : ""} yesterday
          </div>
          <div className="text-muted-foreground text-xs">
            Look, note, move on.
          </div>
        </div>
        <ChevronRight className="size-4 text-muted-foreground" />
      </Card>
    )
  return null
}

function InstallNudge() {
  const standalone = useIsStandalone()
  const dismissed = dashStore.use((s) => s.installDismissed)
  if (standalone || dismissed) return null
  return (
    <Card className="flex items-center gap-3 border-primary/30 bg-primary/5">
      <Smartphone className="size-5 shrink-0 text-primary" />
      <Link href="/onboarding?step=install" className="min-w-0 flex-1">
        <div className="font-medium text-sm">Install the app</div>
        <div className="text-muted-foreground text-xs">
          Needed for reminders on iPhone
        </div>
      </Link>
      <button
        type="button"
        aria-label="Dismiss install nudge"
        onClick={() => setInstallDismissed(true)}
        className="grid size-11 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring text-muted-foreground hover:bg-muted"
      >
        <X className="size-4" />
      </button>
    </Card>
  )
}

function TomorrowPreview() {
  const t = dayOffset(1)
  const items = useAllCalendar(t, t)
  const shown = items.slice(0, 3)
  return (
    <Card>
      <Link href="/plan?seg=calendar" className="mb-1 flex items-center gap-2">
        <span className="flex-1 font-semibold">Tomorrow</span>
        <span className="text-muted-foreground text-xs">
          {items.length} item{items.length === 1 ? "" : "s"}
        </span>
        <ChevronRight className="size-4 text-muted-foreground" />
      </Link>
      {shown.length === 0 ? (
        <div className="py-2 text-muted-foreground text-sm">
          Nothing scheduled yet — a clean slate.
        </div>
      ) : (
        shown.map((i) => (
          <Link
            key={i.id}
            href={i.href}
            className="flex items-center gap-2 py-1.5 text-sm"
          >
            <ModuleDot module={i.module} />
            <span className="num w-11 text-muted-foreground text-xs">
              {i.time ?? "—"}
            </span>
            <span className="flex-1 truncate">{i.title}</span>
          </Link>
        ))
      )}
    </Card>
  )
}

// ================================================================= Wrap-up (DSH-12)

export function WrapUpScreen() {
  const router = useRouter()
  const today = dayKey()
  const ring = useTodayRing()
  const target = useOnTarget(7)
  const items = useAllCalendar(today, today)
  const misses = useAllMisses(today, today)
  const threshold = dashStore.use((s) => s.targetThreshold)
  const sealed = dashStore.use((s) => s.wrapups[today])
  const [dismissed, setDismissed] = useState<string[]>([])
  const [text, setText] = useState("")

  const open = items.filter(
    (i) =>
      !i.done &&
      (i.module === "habits" || i.module === "tasks") &&
      !dismissed.includes(i.id),
  )
  const letGo = items.filter((i) => dismissed.includes(i.id))
  const ratio = ring.due ? ring.done / ring.due : 1
  const onTarget = ring.due > 0 && ratio >= threshold
  const otherLines = (["fitness", "finance"] as const)
    .filter((k) => ring.per[k].due > 0)
    .map((k) => ({ k, ...ring.per[k] }))

  const seal = () => {
    sealDay(today, {
      onTarget,
      done: ring.done,
      due: ring.due,
      reflection: text.trim() || undefined,
    })
    // IA X-3: the wrap-up line is a journal entry (one journal, owned by M5).
    if (text.trim())
      addJournalEntry({ body: text.trim(), day: today, source: "wrapup" })
    toast.success(onTarget ? "Day sealed — on target ✓" : "Day sealed", {
      description: text.trim()
        ? "Reflection saved to your journal."
        : "See you tomorrow.",
    })
    router.push("/today")
  }

  return (
    <Screen title="Wrap up" back="/today">
      <Card
        className={cn(
          "flex items-center gap-4",
          onTarget
            ? "bg-gradient-to-br from-life/25 via-life/5 to-transparent"
            : "bg-gradient-to-br from-muted to-transparent",
        )}
      >
        <Ring
          value={ratio}
          size={84}
          stroke={8}
          accent={onTarget ? "life" : "primary"}
        >
          <span className="num font-bold text-lg">
            {ring.done}/{ring.due}
          </span>
        </Ring>
        <div className="min-w-0 flex-1">
          <div className="text-muted-foreground text-xs uppercase tracking-wider">
            Today's result
          </div>
          <div className="font-display font-bold text-2xl tracking-tight">
            {ring.due === 0
              ? "Neutral day"
              : onTarget
                ? "On target ✓"
                : "Off target"}
          </div>
          <div className="text-muted-foreground text-sm">
            {onTarget
              ? `Streak ${target.current + (target.current === 0 ? 1 : 0)} days — nice.`
              : ring.due === 0
                ? "Nothing was due. Streak safe."
                : `${Math.max(0, Math.ceil(ring.due * threshold) - ring.done)} more to hit the target`}
          </div>
        </div>
      </Card>

      {otherLines.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {otherLines.map((l) => (
            <Card key={l.k} className="p-3">
              <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
                <ModuleDot module={l.k} /> {AREA[l.k].label}
              </div>
              <div className="num mt-0.5 font-semibold">
                {l.done}/{l.due} done
              </div>
            </Card>
          ))}
        </div>
      )}

      {sealed ? (
        <Card className="mt-4">
          <div className="font-semibold">
            Sealed at{" "}
            {new Date(sealed.at).toLocaleTimeString("en-PH", {
              hour: "numeric",
              minute: "2-digit",
            })}
          </div>
          {sealed.reflection && (
            <p className="mt-1 text-muted-foreground text-sm italic">
              “{sealed.reflection}”
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <Btn href="/journal" variant="secondary" className="flex-1">
              Journal
            </Btn>
            <Btn
              variant="ghost"
              className="flex-1"
              onClick={() => unsealDay(today)}
            >
              Reopen day
            </Btn>
          </div>
        </Card>
      ) : (
        <>
          <SectionTitle>Still open · {open.length}</SectionTitle>
          {open.length === 0 ? (
            <Card className="text-center text-muted-foreground text-sm">
              Nothing left open.
            </Card>
          ) : (
            <Card className="px-3 py-1">
              {open.map((i) => {
                const ref = refOf(i)
                return (
                  <div
                    key={i.id}
                    className="flex items-center gap-2 border-border/50 border-b py-2 last:border-0"
                  >
                    <ModuleDot module={i.module} />
                    <Link
                      href={i.href}
                      className="min-w-0 flex-1 truncate text-sm"
                    >
                      {i.title}
                    </Link>
                    <button
                      type="button"
                      aria-label="Done"
                      onClick={() => completeItem(i)}
                      className="grid size-11 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring bg-good/15 text-good"
                    >
                      <Check className="size-4" strokeWidth={3} />
                    </button>
                    {ref?.kind === "task" && (
                      <button
                        type="button"
                        aria-label="Move to tomorrow"
                        onClick={() => {
                          rescheduleBy(ref.id, 1)
                          toast("Moved to tomorrow")
                        }}
                        className="grid size-11 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring bg-muted text-muted-foreground"
                      >
                        <ArrowRight className="size-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label="Didn't happen"
                      onClick={() => {
                        if (ref?.kind === "habit")
                          skipHabit(ref.id, i.day, "wrap-up: didn't happen")
                        setDismissed((d) => [...d, i.id])
                      }}
                      className="grid size-11 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring bg-bad/10 text-bad"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                )
              })}
            </Card>
          )}

          {(misses.length > 0 || letGo.length > 0) && (
            <>
              <SectionTitle
                action={
                  <Link href="/stats/misses" className="text-primary text-xs">
                    See misses
                  </Link>
                }
              >
                Misses today
              </SectionTitle>
              <Card className="space-y-1.5 px-3 py-2 text-sm">
                {letGo.map((i) => (
                  <div key={i.id} className="flex items-center gap-2">
                    <ModuleDot module={i.module} />
                    <span className="flex-1 truncate text-muted-foreground">
                      Let go: {i.title}
                    </span>
                  </div>
                ))}
                {misses.map((m) => (
                  <Link
                    key={m.id}
                    href={m.href}
                    className="flex items-center gap-2"
                  >
                    <ModuleDot module={m.module} />
                    <span className="flex-1 truncate">{m.title}</span>
                  </Link>
                ))}
              </Card>
            </>
          )}

          <SectionTitle>How was today?</SectionTitle>
          <div className="flex items-center gap-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, 140))}
              placeholder="One line. Optional."
              aria-label="One-line reflection"
              className="h-12 min-w-0 flex-1 rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-primary"
            />
            <button
              type="button"
              aria-label="Say it instead"
              onClick={() => openCapture({ mode: "voice", hint: "journal" })}
              className="grid size-12 place-items-center rounded-xl bg-muted"
            >
              <Mic className="size-5" />
            </button>
          </div>
          <p className="mt-1 px-1 text-muted-foreground text-xs">
            Saved to your journal. Never shown on share cards.
          </p>

          <Btn className="mt-5 h-12 w-full text-base" onClick={seal}>
            Done — seal the day
          </Btn>
        </>
      )}
    </Screen>
  )
}

// ================================================================= Inbox (DSH-14)

const NOTIF_ICON: Record<Notif["kind"], typeof Bell> = {
  reminder: Bell,
  achievement: Trophy,
  review: Sparkles,
  system: Target,
}

export function InboxScreen() {
  const router = useRouter()
  const state = useViewState()
  const notifs = dashStore.use((s) => s.notifs)
  const groups = useMemo(() => {
    const t = dayKey()
    const y = dayOffset(-1)
    const g: Record<string, Notif[]> = { Today: [], Yesterday: [], Earlier: [] }
    for (const n of [...notifs].sort((a, b) => b.at.localeCompare(a.at))) {
      const d = dayKey(new Date(n.at))
      g[d === t ? "Today" : d === y ? "Yesterday" : "Earlier"].push(n)
    }
    return Object.entries(g).filter(([, v]) => v.length)
  }, [notifs])
  const unread = notifs.some((n) => !n.read)

  return (
    <Screen
      title="Notifications"
      back="/today"
      actions={
        unread && (
          <button
            type="button"
            onClick={markAllRead}
            className="px-2 font-medium text-primary text-sm"
          >
            Mark all read
          </button>
        )
      }
    >
      {state === "loading" ? (
        <Loading rows={3} />
      ) : state === "error" ? (
        <ErrorCard what="notifications" />
      ) : state === "empty" || groups.length === 0 ? (
        <Empty
          icon={<Bell className="size-8" />}
          title="All quiet"
          body="Reminders, trophies and reviews land here for 30 days."
        />
      ) : (
        groups.map(([label, list]) => (
          <div key={label}>
            <SectionTitle>{label}</SectionTitle>
            <Card className="px-2 py-1">
              {list.map((n) => {
                const Icon = NOTIF_ICON[n.kind]
                return (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => {
                      markNotifRead(n.id)
                      router.push(n.href)
                    }}
                    className="flex w-full items-start gap-3 rounded-xl px-1 py-2.5 text-left active:bg-muted/60"
                  >
                    <span
                      className={cn(
                        "mt-0.5 grid size-9 shrink-0 place-items-center rounded-full",
                        n.kind === "achievement"
                          ? "bg-life/15 text-life"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "block truncate text-sm",
                          n.read ? "font-normal" : "font-semibold",
                        )}
                      >
                        {n.title}
                      </span>
                      <span className="line-clamp-2 text-muted-foreground text-xs">
                        {n.body}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(n.at).toLocaleTimeString("en-PH", {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                      {!n.read && (
                        <span className="size-2 rounded-full bg-primary" />
                      )}
                    </span>
                  </button>
                )
              })}
            </Card>
          </div>
        ))
      )}
      <p className="mt-6 text-center text-muted-foreground text-xs">
        Push schedule lives in{" "}
        <Link href="/me/settings#notifications" className="text-primary">
          Settings
        </Link>
        .
      </p>
    </Screen>
  )
}
