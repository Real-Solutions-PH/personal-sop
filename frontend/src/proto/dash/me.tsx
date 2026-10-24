"use client"

import {
  Bell,
  BookOpen,
  Bot,
  CalendarRange,
  ChevronRight,
  Clock,
  Download,
  Eye,
  Flame,
  LayoutGrid,
  ListChecks,
  Pencil,
  RotateCcw,
  Scale,
  Share2,
  Smartphone,
  Sparkles,
  SunMoon,
  Target,
  Trash2,
  Trophy,
  UserPlus,
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { type ReactNode, useEffect, useState } from "react"
import { toast } from "sonner"
import { useTheme } from "@/components/theme-provider"
import { cn } from "@/lib/utils"
import type { ModuleKey } from "../contract"
import { DAY_START_HOUR } from "../lib/day"
import { privacyStore, togglePrivacy } from "../lib/privacy"
import { resetAll, uid } from "../lib/store"
import {
  Bar,
  Btn,
  Card,
  Chip,
  Row,
  Screen,
  SectionTitle,
  Segmented,
  SwitchTrack,
} from "../ui/kit"
import { AREA, type Identity, MODULE_KEYS } from "./data"
import {
  fmtGoal,
  useEnabled,
  useGoals,
  useLifeScore,
  useOnTarget,
} from "./hooks"
import { AppLauncher } from "./launcher"
import { AvatarPhotoButton } from "./photo"
import { startAsNewUser } from "./setup"
import { Avatar, WeightsEditor } from "./stats"
import {
  dashStore,
  setEnabled,
  setEveningStart,
  setIdentities,
  setPush,
  setTargetThreshold,
  updateProfile,
} from "./store"
import { AreaIcon, Confirm } from "./ui"

// DSH-40 Me · DSH-41 Edit profile · DSH-42..48 Settings (one scrolling screen).

export const MODULE_CONFIG: Record<
  ModuleKey,
  { href: string; label: string }[]
> = {
  habits: [
    { href: "/habits/manage", label: "Habits" },
    { href: "/habits/routines", label: "Routines" },
    { href: "/habits/settings", label: "Habit settings" },
  ],
  tasks: [
    { href: "/tasks/lists", label: "Lists" },
    { href: "/tasks/settings", label: "Task settings" },
  ],
  fitness: [
    { href: "/fitness/exercises", label: "Exercises" },
    { href: "/fitness/nutrition/targets", label: "Macro targets" },
    { href: "/fitness/settings", label: "Fitness settings" },
  ],
  // The web prototype keeps meals on the Fitness page (ADR-0024 is native).
  nutrition: [{ href: "/fitness/nutrition/targets", label: "Macro targets" }],
  finance: [
    { href: "/finance/accounts", label: "Accounts" },
    { href: "/finance/categories", label: "Categories" },
    { href: "/finance/budgets", label: "Budgets" },
    { href: "/finance/settings", label: "Finance settings" },
  ],
}

export function useInstallState() {
  const [s, setS] = useState({ standalone: true, ios: false })
  useEffect(() => {
    const ua = navigator.userAgent
    setS({
      standalone:
        window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true,
      ios: /iPhone|iPad|iPod/.test(ua),
    })
  }, [])
  return s
}

function Icon({ children, tint }: { children: ReactNode; tint: string }) {
  return (
    <span className={cn("grid size-9 place-items-center rounded-xl", tint)}>
      {children}
    </span>
  )
}

const chev = <ChevronRight className="size-4 text-muted-foreground" />

// ================================================================= Me

export function MeScreen() {
  const router = useRouter()
  const p = dashStore.use((s) => s.profile)
  const push = dashStore.use((s) => s.push.permission)
  const hidden = privacyStore.use((s) => s.hidden)
  const goals = useGoals()
  const ls = useLifeScore(30)
  const target = useOnTarget(30)
  const install = useInstallState()
  const [reset, setReset] = useState(false)
  const [fresh, setFresh] = useState(false)
  const { theme, resolvedTheme } = useTheme()
  const eveningStart = dashStore.use((s) => s.eveningStart)

  return (
    <Screen
      title="Me"
      actions={
        <Link
          href="/me/profile"
          aria-label="Edit profile"
          className="grid size-11 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-muted"
        >
          <Pencil className="size-5" />
        </Link>
      }
    >
      <Card className="bg-gradient-to-br from-hab/15 via-transparent to-fit/10">
        <div className="flex items-center gap-4">
          <Avatar size={72} />
          <div className="min-w-0 flex-1">
            <div className="font-display truncate font-bold text-xl tracking-tight">
              {p.name}
            </div>
            <div className="text-muted-foreground text-sm">{p.handle}</div>
            <div className="mt-1 flex gap-3 text-xs">
              <span>
                <b className="num">{ls.score ?? "—"}</b>{" "}
                <span className="text-muted-foreground">Life Score</span>
              </span>
              <span>
                <b className="num inline-flex items-center gap-0.5">
                  <Flame className="size-3 text-life" />
                  {target.current}
                </b>{" "}
                <span className="text-muted-foreground">streak</span>
              </span>
            </div>
          </div>
        </div>
        {p.identities.length > 0 && (
          <div className="mt-3 space-y-2">
            {p.identities.map((i) => {
              const g = goals.find((x) => x.goal.id === i.goalId)
              return (
                <Link
                  key={i.id}
                  href={g ? "/stats/goals" : "/me/profile"}
                  className="block rounded-xl bg-background/60 p-2.5"
                >
                  <div className="text-sm">“{i.text}”</div>
                  {g ? (
                    <div className="mt-1.5 flex items-center gap-2">
                      <Bar
                        value={Math.min(1, g.pct)}
                        className="h-1.5 flex-1"
                        accent={g.hit ? "life" : "primary"}
                      />
                      <span className="font-display num text-[11px] text-muted-foreground">
                        {g.entry?.value ?? "—"} {fmtGoal(g.goal)}
                      </span>
                    </div>
                  ) : (
                    <div className="mt-1 text-[11px] text-primary">
                      Link a goal →
                    </div>
                  )}
                </Link>
              )
            })}
          </div>
        )}
      </Card>

      <SectionTitle>Apps</SectionTitle>
      <AppLauncher />

      {(!install.standalone || push !== "granted") && (
        <Card className="mt-3 border-primary/30 bg-primary/5">
          <div className="flex items-center gap-3">
            <Smartphone className="size-5 text-primary" />
            <div className="flex-1 text-sm">
              <div className="font-medium">
                {!install.standalone ? "Not installed" : "Reminders are off"}
              </div>
              <div className="text-muted-foreground text-xs">
                {!install.standalone
                  ? install.ios
                    ? "On iPhone, push only works after Add to Home Screen."
                    : "Install for full-screen and reminders."
                  : `Notifications: ${push}`}
              </div>
            </div>
            <Btn
              href={
                !install.standalone
                  ? "/onboarding?step=install"
                  : "/onboarding?step=notifications"
              }
              className="h-9 px-3"
            >
              Fix
            </Btn>
          </div>
        </Card>
      )}

      <SectionTitle>Progress</SectionTitle>
      <Card className="px-2 py-1">
        <Row
          icon={
            <Icon tint="bg-primary/15 text-primary">
              <Target className="size-4" />
            </Icon>
          }
          title="Goals"
          subtitle={`${goals.filter((g) => g.goal.status === "active").length} active`}
          right={chev}
          href="/stats/goals"
        />
        <Row
          icon={
            <Icon tint="bg-life/15 text-life">
              <Trophy className="size-4" />
            </Icon>
          }
          title="Trophy case"
          right={chev}
          href="/stats/trophies"
        />
        <Row
          icon={
            <Icon tint="bg-hab/15 text-hab">
              <CalendarRange className="size-4" />
            </Icon>
          }
          title="Reviews"
          subtitle="Weekly & monthly"
          right={chev}
          href="/stats/reviews"
        />
        <Row
          icon={
            <Icon tint="bg-fit/15 text-fit">
              <Share2 className="size-4" />
            </Icon>
          }
          title="Share a card"
          subtitle="Story or post, no ₱ ever"
          right={chev}
          href="/stats/share"
        />
        <Row
          icon={
            <Icon tint="bg-tsk/15 text-tsk">
              <BookOpen className="size-4" />
            </Icon>
          }
          title="Journal"
          subtitle="Wrap-up & review reflections"
          right={chev}
          href="/journal"
        />
      </Card>

      <SectionTitle>Setup</SectionTitle>
      <Card className="px-2 py-1">
        <Row
          icon={
            <Icon tint="bg-muted">
              <LayoutGrid className="size-4" />
            </Icon>
          }
          title="Sections & settings"
          right={chev}
          href="/me/settings#modules"
        />
        <Row
          icon={
            <Icon tint="bg-muted">
              <Scale className="size-4" />
            </Icon>
          }
          title="Life Score weights"
          right={chev}
          href="/me/settings#weights"
        />
        <Row
          icon={
            <Icon tint="bg-muted">
              <Bell className="size-4" />
            </Icon>
          }
          title="Notifications"
          subtitle={
            push === "granted"
              ? "On"
              : push === "denied"
                ? "Blocked"
                : "Not set up"
          }
          right={chev}
          href="/me/settings#notifications"
        />
        <Row
          icon={
            <Icon tint="bg-muted">
              <Clock className="size-4" />
            </Icon>
          }
          title="Day & time"
          subtitle={`Day starts ${String(DAY_START_HOUR).padStart(2, "0")}:00 · Evening ${eveningStart} · Asia/Manila`}
          right={chev}
          href="/me/settings#day"
        />
        <Row
          icon={
            <Icon tint="bg-muted">
              <SunMoon className="size-4" />
            </Icon>
          }
          title="Appearance"
          subtitle={
            !theme || theme === "system"
              ? `Follows system${resolvedTheme ? ` · ${resolvedTheme} now` : ""}`
              : theme === "light"
                ? "Light"
                : "Dark"
          }
          right={chev}
          href="/me/settings#appearance"
        />
        <Row
          icon={
            <Icon tint="bg-muted">
              <Bot className="size-4" />
            </Icon>
          }
          title="AI & connector"
          right={chev}
          href="/capture/settings"
        />
        <Row
          icon={
            <Icon tint="bg-muted">
              <Eye className="size-4" />
            </Icon>
          }
          title="Privacy mode"
          subtitle="Blur every ₱ amount"
          onClick={togglePrivacy}
          right={<Toggle on={hidden} />}
        />
      </Card>

      <SectionTitle>Sections</SectionTitle>
      <Card className="px-2 py-1">
        {MODULE_KEYS.map((k) => (
          <Row
            key={k}
            icon={<AreaIcon k={k} />}
            title={AREA[k].label}
            subtitle={MODULE_CONFIG[k].map((c) => c.label).join(" · ")}
            right={chev}
            href={MODULE_CONFIG[k][MODULE_CONFIG[k].length - 1].href}
          />
        ))}
      </Card>

      <SectionTitle>App</SectionTitle>
      <Card className="px-2 py-1">
        <Row
          icon={
            <Icon tint="bg-muted">
              <Sparkles className="size-4" />
            </Icon>
          }
          title="Run setup again"
          right={chev}
          href="/onboarding"
        />
        <Row
          icon={
            <Icon tint="bg-muted">
              <ListChecks className="size-4" />
            </Icon>
          }
          title="Set up my data"
          subtitle="Accounts, habits, training, tasks — pick up where you left off"
          right={chev}
          href="/setup"
        />
        <Row
          icon={
            <Icon tint="bg-muted">
              <UserPlus className="size-4" />
            </Icon>
          }
          title="Start as a new user"
          subtitle="Demo: empty every section and run first-time setup"
          onClick={() => setFresh(true)}
        />
        <Row
          icon={
            <Icon tint="bg-bad/10 text-bad">
              <RotateCcw className="size-4" />
            </Icon>
          }
          title={<span className="text-bad">Reset demo data</span>}
          subtitle="Restores every section's sample data"
          onClick={() => setReset(true)}
        />
      </Card>
      <p className="mt-4 text-center text-muted-foreground text-xs">
        Unfurl · prototype build
      </p>
      <Confirm
        open={fresh}
        onClose={() => setFresh(false)}
        title="Start as a new user?"
        body="Every section is emptied so you can walk first-time onboarding and setup. Reset demo data brings the samples back."
        confirm="Start fresh"
        danger
        onConfirm={() => {
          startAsNewUser()
          router.push("/onboarding")
        }}
      />
      <Confirm
        open={reset}
        onClose={() => setReset(false)}
        title="Reset all demo data?"
        body="Every section goes back to its sample data. Anything you logged in this walkthrough is gone."
        confirm="Reset"
        danger
        onConfirm={() => {
          resetAll()
          toast.success("Demo data reset")
          router.push("/today")
        }}
      />
    </Screen>
  )
}

export function Toggle({ on }: { on: boolean }) {
  return <SwitchTrack on={on} />
}

// ================================================================= Edit profile (DSH-41)

export function EditProfileScreen() {
  const router = useRouter()
  const p = dashStore.use((s) => s.profile)
  const goals = useGoals().filter((g) => g.goal.status === "active")
  const [name, setName] = useState(p.name)
  const [handle, setHandle] = useState(p.handle)
  const [ids, setIds] = useState<Identity[]>(p.identities)
  const input =
    "h-12 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-primary"
  const save = () => {
    updateProfile({
      name: name.trim() || p.name,
      handle: handle.trim().startsWith("@")
        ? handle.trim()
        : `@${handle.trim()}`,
    })
    setIdentities(ids.filter((i) => i.text.trim()))
    toast.success("Profile saved")
    router.push("/me")
  }
  return (
    <Screen title="Edit profile" back="/me">
      <div className="flex justify-center py-2">
        <AvatarPhotoButton size={88} />
      </div>
      <label className="mt-2 block">
        <span className="mb-1 block text-muted-foreground text-xs">Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={input}
        />
      </label>
      <label className="mt-3 block">
        <span className="mb-1 block text-muted-foreground text-xs">
          Handle (off on share cards unless you turn it on)
        </span>
        <input
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          className={input}
        />
      </label>

      <SectionTitle>Identity statements · {ids.length}/3</SectionTitle>
      <div className="space-y-3">
        {ids.map((i, n) => (
          <Card key={i.id} className="p-3">
            <div className="flex gap-2">
              <input
                value={i.text}
                placeholder="I'm someone who…"
                aria-label={`Identity statement ${n + 1}`}
                onChange={(e) =>
                  setIds((l) =>
                    l.map((x) =>
                      x.id === i.id
                        ? { ...x, text: e.target.value.slice(0, 60) }
                        : x,
                    ),
                  )
                }
                className={cn(input, "h-10")}
              />
              <button
                type="button"
                aria-label="Remove statement"
                onClick={() => setIds((l) => l.filter((x) => x.id !== i.id))}
                className="grid size-10 shrink-0 place-items-center rounded-xl bg-bad/10 text-bad"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
            <div className="mt-2 text-muted-foreground text-xs">
              Linked goal
            </div>
            <div className="-mx-3 mt-1 flex gap-1.5 overflow-x-auto px-3">
              <Chip
                active={!i.goalId}
                onClick={() =>
                  setIds((l) =>
                    l.map((x) =>
                      x.id === i.id ? { ...x, goalId: undefined } : x,
                    ),
                  )
                }
                className="h-11 text-xs"
              >
                None
              </Chip>
              {goals.map((g) => (
                <Chip
                  key={g.goal.id}
                  active={i.goalId === g.goal.id}
                  onClick={() =>
                    setIds((l) =>
                      l.map((x) =>
                        x.id === i.id ? { ...x, goalId: g.goal.id } : x,
                      ),
                    )
                  }
                  className="h-11 text-xs"
                >
                  {g.goal.label} {fmtGoal(g.goal)}
                </Chip>
              ))}
            </div>
          </Card>
        ))}
        {ids.length < 3 && (
          <Btn
            variant="secondary"
            className="w-full"
            onClick={() => setIds((l) => [...l, { id: uid(), text: "" }])}
          >
            Add statement
          </Btn>
        )}
      </div>
      <Btn className="mt-6 h-12 w-full" onClick={save}>
        Save
      </Btn>
    </Screen>
  )
}

// ================================================================= Settings (DSH-42..48)

export function SettingsScreen() {
  const enabled = useEnabled()
  const push = dashStore.use((s) => s.push)
  const { theme, setTheme } = useTheme()
  const threshold = dashStore.use((s) => s.targetThreshold)
  const eveningStart = dashStore.use((s) => s.eveningStart)
  const hidden = privacyStore.use((s) => s.hidden)
  const [off, setOff] = useState<ModuleKey | null>(null)

  const askPush = async () => {
    if (!("Notification" in window)) {
      toast("This browser can't do push — install the app first")
      return
    }
    const r = await Notification.requestPermission()
    setPush({ permission: r })
    toast(r === "granted" ? "Notifications on" : "Notifications not allowed")
  }

  return (
    <Screen title="Settings" back="/me">
      <section id="modules" className="scroll-mt-16">
        <SectionTitle>Sections & settings</SectionTitle>
        <Card className="px-3 py-1">
          {MODULE_KEYS.map((k) => (
            <div
              key={k}
              className="border-border/50 border-b py-2 last:border-0"
            >
              <button
                type="button"
                onClick={() => (enabled[k] ? setOff(k) : setEnabled(k, true))}
                className="flex w-full items-center gap-3 py-1"
              >
                <AreaIcon k={k} size="sm" />
                <span className="flex-1 text-left font-medium">
                  {AREA[k].label}
                </span>
                <Toggle on={enabled[k]} />
              </button>
              {enabled[k] && (
                <div className="mt-1 flex flex-wrap gap-1.5 pl-9">
                  {MODULE_CONFIG[k].map((c) => (
                    <Link
                      key={c.href}
                      href={c.href}
                      className="rounded-full bg-muted px-2.5 py-1 text-xs"
                    >
                      {c.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
          <div className="flex items-center gap-3 py-3 text-muted-foreground text-sm">
            <Sparkles className="size-5" />
            <span className="flex-1">Capture</span>
            <span className="text-xs">always on</span>
          </div>
        </Card>
      </section>

      <section id="weights" className="scroll-mt-16">
        <SectionTitle>Life Score weights</SectionTitle>
        <Card>
          <WeightsEditor />
        </Card>
      </section>

      <section id="notifications" className="scroll-mt-16">
        <SectionTitle>Notifications</SectionTitle>
        <Card className="px-3 py-1">
          <Row
            title="Permission"
            subtitle={
              push.permission === "granted"
                ? "Allowed"
                : push.permission === "denied"
                  ? "Blocked — re-enable in your browser's site settings"
                  : "Not asked yet"
            }
            right={
              push.permission !== "granted" && (
                <Btn className="h-9 px-3" onClick={askPush}>
                  Allow
                </Btn>
              )
            }
          />
          <Row
            title="Morning digest"
            right={<span className="num text-sm">{push.morning}</span>}
          />
          <Row
            title="Evening wrap-up"
            right={<span className="num text-sm">{push.evening}</span>}
          />
          <Row
            title="Weekly review"
            right={<span className="num text-sm">{push.review}</span>}
          />
          <Row
            title="Send a test push"
            onClick={() =>
              toast("Test push", {
                description: "This is what a reminder looks like.",
              })
            }
            right={chev}
          />
        </Card>
      </section>

      <section id="appearance" className="scroll-mt-16">
        <SectionTitle>Appearance</SectionTitle>
        <Card className="space-y-2 p-2">
          <Segmented
            value={theme ?? "system"}
            onChange={setTheme}
            options={[
              { value: "system", label: "System" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
          />
          <p className="px-1 pb-1 text-muted-foreground text-xs">
            System follows your phone's light or dark setting.
          </p>
        </Card>
      </section>

      <section id="day" className="scroll-mt-16">
        <SectionTitle>Day & time</SectionTitle>
        <Card className="px-3 py-1">
          <Row
            title="Timezone"
            right={<span className="text-sm">Asia/Manila</span>}
          />
          <Row
            title="Day starts at"
            subtitle="01:30 still counts as yesterday"
            right={
              <span className="num text-sm">
                {String(DAY_START_HOUR).padStart(2, "0")}:00
              </span>
            }
          />
          <Row
            title="Evening starts at"
            subtitle="Today switches to the wrap-up view"
            right={
              <input
                type="time"
                aria-label="Evening starts at"
                min="12:00"
                required
                value={eveningStart}
                onChange={(e) =>
                  e.target.value && setEveningStart(e.target.value)
                }
                className="num h-11 rounded-lg bg-muted px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            }
          />
          <Row
            title="Week starts"
            right={<span className="text-sm">Monday</span>}
          />
          <div className="px-1 py-2">
            <div className="font-medium">What counts as on target</div>
            <div className="text-muted-foreground text-sm">
              Share of due habits + tasks done to hit the day's target
            </div>
            <div className="mt-2 flex gap-1.5">
              {[0.6, 0.7, 0.8, 0.9, 1].map((v) => (
                <Chip
                  key={v}
                  active={threshold === v}
                  onClick={() => setTargetThreshold(v)}
                  className="h-11 flex-1 px-0 text-xs"
                >
                  {Math.round(v * 100)}%
                </Chip>
              ))}
            </div>
          </div>
        </Card>
      </section>

      <section id="privacy" className="scroll-mt-16">
        <SectionTitle>Sharing & privacy</SectionTitle>
        <Card className="px-3 py-1">
          <Row
            title="Privacy mode"
            subtitle="Blur ₱ amounts everywhere (or long-press the Today header)"
            onClick={togglePrivacy}
            right={<Toggle on={hidden} />}
          />
          <Row
            title="Reset share-card defaults"
            onClick={() => {
              dashStore.set((s) => ({ ...s, share: {} }))
              toast("Share defaults reset")
            }}
            right={chev}
          />
          <div className="py-3 text-muted-foreground text-xs">
            ₱ amounts are never allowed on share cards. The privacy check before
            sharing can't be turned off.
          </div>
        </Card>
      </section>

      <section id="data" className="scroll-mt-16">
        <SectionTitle>Data & account</SectionTitle>
        <Card className="px-3 py-1">
          <Row
            icon={<Download className="size-4" />}
            title="Export (JSON)"
            onClick={() => toast("Export is stubbed in the prototype")}
            right={chev}
          />
          <Row
            title="Sign out"
            onClick={() => toast("Sign-in is mocked in the prototype")}
            right={chev}
          />
        </Card>
      </section>

      <Confirm
        open={!!off}
        onClose={() => setOff(null)}
        title={`Turn off ${off ? AREA[off].label : ""}?`}
        body="Its cards, stats, share fields and misses hide. Your data is kept — turn it back on anytime."
        confirm="Turn off"
        onConfirm={() => {
          if (off) setEnabled(off, false)
        }}
      />
    </Screen>
  )
}
