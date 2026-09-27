"use client"

import {
  BellOff,
  BellRing,
  Check,
  ChevronRight,
  Ellipsis,
  FlaskConical,
  Lock,
  Share,
  Smartphone,
  SquarePlus,
} from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import {
  Btn,
  Card,
  Row,
  Screen,
  SectionTitle,
  Segmented,
  Switch,
} from "../../ui/kit"
import { updateNotif, updateSettings } from "../actions"
import type { NotifState } from "../data"
import { fmtTime } from "../logic"
import { tasksStore } from "../store"
import { LoadingRows, SyncError, useViewState } from "../ui"

// TSK-12 Reminders setup (iOS Add-to-Home-Screen guide + permission, mocked)
// and TSK-13 Tasks settings. Per X-11 this flow is app-wide; it lives here
// until M6 onboarding reuses it.

const PLATFORM: Record<NotifState["platform"], string> = {
  ios: "iPhone · Safari",
  android: "Android · Chrome",
  desktop: "Desktop browser",
}

function Pill({
  ok,
  children,
}: {
  ok: boolean | null
  children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-medium text-xs",
        ok === true
          ? "bg-good/15 text-good"
          : ok === false
            ? "bg-bad/15 text-bad"
            : "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  )
}

function Step({
  n,
  title,
  body,
  art,
}: {
  n: number
  title: string
  body: string
  art: React.ReactNode
}) {
  return (
    <div className="flex gap-3">
      <div className="grid size-7 shrink-0 place-items-center rounded-full bg-tsk font-semibold text-sm text-background">
        {n}
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-medium">{title}</div>
        <div className="text-muted-foreground text-sm">{body}</div>
        <div className="mt-2">{art}</div>
      </div>
    </div>
  )
}

/** Fake phone-chrome snippets for the install guide. */
function SafariBar() {
  return (
    <div className="flex items-center justify-around rounded-xl bg-muted px-3 py-2 text-muted-foreground">
      <ChevronRight className="size-4 rotate-180" />
      <ChevronRight className="size-4" />
      <span className="relative grid size-8 place-items-center rounded-lg bg-tsk/20 text-tsk ring-2 ring-tsk">
        <Share className="size-4" />
      </span>
      <Ellipsis className="size-4" />
    </div>
  )
}
function ShareSheetArt() {
  return (
    <div className="space-y-1 rounded-xl bg-muted p-2 text-sm">
      <div className="rounded-lg px-2 py-1.5 text-muted-foreground">Copy</div>
      <div className="flex items-center justify-between rounded-lg bg-tsk/20 px-2 py-1.5 font-medium text-tsk ring-2 ring-tsk">
        Add to Home Screen <SquarePlus className="size-4" />
      </div>
      <div className="rounded-lg px-2 py-1.5 text-muted-foreground">
        Add Bookmark
      </div>
    </div>
  )
}
function HomeIconArt() {
  return (
    <div className="flex gap-3 rounded-xl bg-muted p-3">
      {["", "", "SOP", ""].map((l, i) => (
        <div key={i} className="flex flex-col items-center gap-1">
          <div
            className={cn(
              "grid size-11 place-items-center rounded-xl font-bold text-xs",
              l
                ? "bg-gradient-to-br from-primary to-hab text-white ring-2 ring-tsk"
                : "bg-background",
            )}
          >
            {l}
          </div>
          <div className="text-[9px] text-muted-foreground">
            {l ? "SOP" : "App"}
          </div>
        </div>
      ))}
    </div>
  )
}

export function RemindersScreen() {
  const state = useViewState()
  const notif = tasksStore.use((s) => s.notif)
  const [prompt, setPrompt] = useState(false)
  const [banner, setBanner] = useState(false)
  useEffect(() => {
    if (!banner) return
    const t = setTimeout(() => setBanner(false), 4000)
    return () => clearTimeout(t)
  }, [banner])

  const needsInstall = notif.platform === "ios" && !notif.installed
  const perm = state === "error" ? "denied" : notif.permission

  const test = () => {
    updateNotif({ testSentAt: new Date().toISOString() })
    setBanner(true)
  }

  return (
    <Screen back title="Reminders">
      {banner && (
        <div className="fixed inset-x-0 top-3 z-50 mx-auto w-[calc(100%-1.5rem)] max-w-sm animate-in slide-in-from-top rounded-2xl bg-card/95 p-3 shadow-2xl ring-1 ring-border backdrop-blur">
          <div className="flex items-center gap-2">
            <div className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-primary to-hab font-bold text-[10px] text-white">
              SOP
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-sm">You're set ✓</div>
              <div className="text-muted-foreground text-xs">
                Reminders will ping you right here.
              </div>
            </div>
            <span className="text-[10px] text-muted-foreground">now</span>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Pill ok={null}>
          <Smartphone className="size-3.5" /> {PLATFORM[notif.platform]}
        </Pill>
        {notif.platform === "ios" && (
          <Pill ok={notif.installed}>
            {notif.installed ? "Installed" : "Not installed"}
          </Pill>
        )}
        <Pill ok={perm === "granted" ? true : perm === "denied" ? false : null}>
          {perm === "granted"
            ? "Notifications on"
            : perm === "denied"
              ? "Blocked"
              : "Not enabled"}
        </Pill>
      </div>

      {state === "loading" ? (
        <LoadingRows n={3} />
      ) : needsInstall && state !== "error" ? (
        <>
          <Card className="mt-4 bg-gradient-to-br from-tsk/15 to-transparent">
            <BellRing className="size-6 text-tsk" />
            <div className="mt-2 font-semibold text-lg">
              One step first on iPhone
            </div>
            <p className="text-muted-foreground text-sm">
              iOS only sends reminders to apps on your Home Screen. It takes 10
              seconds and the app opens full-screen after.
            </p>
          </Card>
          <div className="mt-5 space-y-6">
            <Step
              n={1}
              title="Tap Share"
              body="The square-with-arrow in Safari's toolbar."
              art={<SafariBar />}
            />
            <Step
              n={2}
              title="Add to Home Screen"
              body="Scroll the share sheet, tap it, then Add."
              art={<ShareSheetArt />}
            />
            <Step
              n={3}
              title="Open SOP from your Home Screen"
              body="Then come back here to switch reminders on."
              art={<HomeIconArt />}
            />
          </div>
          <div className="mt-6 flex flex-col gap-2">
            <Btn
              accent="tsk"
              onClick={() => {
                updateNotif({ installed: true })
                toast.success("Opened from Home Screen (simulated)")
              }}
            >
              I've added it
            </Btn>
            <Btn
              variant="ghost"
              onClick={() => {
                updateNotif({ remindLaterAt: new Date().toISOString() })
                toast("OK — we'll ask again next week", {
                  description: "Reminders still show on your Today card.",
                })
              }}
            >
              Remind me later
            </Btn>
          </div>
        </>
      ) : perm === "denied" ? (
        <>
          <Card className="mt-4 border-bad/30 bg-bad/5">
            <BellOff className="size-6 text-bad" />
            <div className="mt-2 font-semibold text-lg">
              Blocked in {notif.platform === "ios" ? "iOS" : "browser"} settings
            </div>
            <p className="text-muted-foreground text-sm">
              Your reminders are still saved. Until pings are back on, due tasks
              show on your Today card with a “due now” badge.
            </p>
          </Card>
          <SectionTitle>How to unblock</SectionTitle>
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            {notif.platform === "ios" ? (
              <>
                <li>Open the iPhone Settings app → Notifications.</li>
                <li>Find “SOP” in the app list.</li>
                <li>Turn on Allow Notifications.</li>
              </>
            ) : (
              <>
                <li>Tap the lock icon next to the address bar.</li>
                <li>Open Site settings → Notifications.</li>
                <li>Choose Allow, then reload.</li>
              </>
            )}
          </ol>
          <Btn
            variant="secondary"
            className="mt-5 w-full"
            onClick={() => updateNotif({ permission: "default" })}
          >
            I've turned it back on
          </Btn>
        </>
      ) : perm === "granted" ? (
        <>
          <Card className="mt-4 border-good/30 bg-good/5">
            <div className="flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-full bg-good/15 text-good">
                <Check className="size-5" />
              </div>
              <div>
                <div className="font-semibold">Reminders are on</div>
                <div className="text-muted-foreground text-sm">
                  This device gets pings for tasks with a reminder.
                </div>
              </div>
            </div>
          </Card>
          <Btn variant="secondary" className="mt-4 w-full" onClick={test}>
            <BellRing className="size-4" /> Send a test ping
          </Btn>
          <p className="mt-2 text-center text-muted-foreground text-xs">
            {notif.platform === "ios"
              ? "On iPhone, tapping a ping opens the task. Done / Snooze buttons appear where the OS supports them."
              : "Pings include Done and Snooze 1h buttons."}
          </p>
          <Btn
            variant="ghost"
            className="mt-2 w-full"
            href="/tasks/notification"
          >
            Preview a reminder
          </Btn>
        </>
      ) : (
        <>
          <Card className="mt-4">
            <BellRing className="size-6 text-tsk" />
            <div className="mt-2 font-semibold text-lg">
              Get pinged at the right time
            </div>
            <p className="text-muted-foreground text-sm">
              Only for tasks you set a reminder on, plus an optional morning
              digest. Never marketing, never on first launch.
            </p>
          </Card>
          <Btn
            accent="tsk"
            className="mt-5 w-full"
            onClick={() => setPrompt(true)}
          >
            Enable notifications
          </Btn>
          <Btn
            variant="ghost"
            className="mt-2 w-full"
            onClick={() =>
              updateNotif({ remindLaterAt: new Date().toISOString() })
            }
          >
            Not now
          </Btn>
        </>
      )}

      {/* mocked OS permission prompt */}
      {prompt && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-8">
          <div
            role="dialog"
            aria-label="Allow notifications"
            className="w-full max-w-[270px] overflow-hidden rounded-2xl bg-card text-center shadow-2xl"
          >
            <div className="p-4">
              <div className="font-semibold">
                “SOP” Would Like to Send You Notifications
              </div>
              <div className="mt-1 text-muted-foreground text-xs">
                Notifications may include alerts, sounds and icon badges.
              </div>
            </div>
            <div className="grid grid-cols-2 border-border border-t text-sm">
              <button
                type="button"
                className="border-border border-r py-3 text-tsk"
                onClick={() => {
                  setPrompt(false)
                  updateNotif({ permission: "denied" })
                }}
              >
                Don't Allow
              </button>
              <button
                type="button"
                className="py-3 font-semibold text-tsk"
                onClick={() => {
                  setPrompt(false)
                  updateNotif({ permission: "granted" })
                  test()
                }}
              >
                Allow
              </button>
            </div>
          </div>
        </div>
      )}

      <PrototypeControls notif={notif} />
    </Screen>
  )
}

function PrototypeControls({ notif }: { notif: NotifState }) {
  return (
    <details className="mt-10 rounded-2xl border border-border/60 border-dashed p-3 text-sm">
      <summary className="flex cursor-pointer items-center gap-2 text-muted-foreground">
        <FlaskConical className="size-4" /> Prototype: simulate device
      </summary>
      <div className="mt-3 space-y-3">
        <Segmented<NotifState["platform"]>
          value={notif.platform}
          onChange={(platform) => updateNotif({ platform })}
          options={[
            { value: "ios", label: "iOS" },
            { value: "android", label: "Android" },
            { value: "desktop", label: "Desktop" },
          ]}
        />
        <Segmented<NotifState["permission"]>
          value={notif.permission}
          onChange={(permission) => updateNotif({ permission })}
          options={[
            { value: "default", label: "Not asked" },
            { value: "granted", label: "Allowed" },
            { value: "denied", label: "Blocked" },
          ]}
        />
        <label className="flex items-center justify-between">
          Installed to Home Screen
          <input
            type="checkbox"
            checked={notif.installed}
            onChange={(e) => updateNotif({ installed: e.target.checked })}
            className="size-5 accent-[var(--tsk)]"
          />
        </label>
      </div>
    </details>
  )
}

// ---------------------------------------------------------------- TSK-13

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <Switch checked={checked} onChange={onChange} label={label} accent="tsk" />
  )
}

function TimeInput({
  value,
  onChange,
  label,
}: {
  value: string
  onChange: (v: string) => void
  label: string
}) {
  return (
    <input
      type="time"
      aria-label={label}
      value={value}
      onChange={(e) => e.target.value && onChange(e.target.value)}
      className="num rounded-lg bg-muted px-2 py-1.5 text-sm outline-none [color-scheme:dark]"
    />
  )
}

export function SettingsScreen() {
  const state = useViewState()
  const st = tasksStore.use((s) => s.settings)
  const notif = tasksStore.use((s) => s.notif)
  const perm =
    notif.platform === "ios" && !notif.installed
      ? "Needs Home Screen install"
      : notif.permission === "granted"
        ? "On"
        : notif.permission === "denied"
          ? "Blocked"
          : "Off"
  return (
    <Screen back title="Tasks settings">
      {state === "error" && <SyncError />}
      {state === "loading" ? (
        <LoadingRows n={5} />
      ) : (
        <>
          <SectionTitle>Notifications</SectionTitle>
          <Card className="py-1">
            <Row
              href="/tasks/reminders"
              icon={
                notif.permission === "denied" ? (
                  <Lock className="size-5 text-bad" />
                ) : (
                  <BellRing className="size-5 text-tsk" />
                )
              }
              title="This device"
              subtitle={`${PLATFORM[notif.platform]} · ${perm}`}
              right={<ChevronRight className="size-4 text-muted-foreground" />}
            />
          </Card>
          <SectionTitle>Defaults</SectionTitle>
          <Card className="divide-y divide-border/50 py-1">
            <div className="flex items-center justify-between gap-3 py-3">
              <div>
                <div className="font-medium text-sm">Default reminder time</div>
                <div className="text-muted-foreground text-xs">
                  For tasks with a date but no time
                </div>
              </div>
              <TimeInput
                label="Default reminder time"
                value={st.defaultRemindTime}
                onChange={(v) => updateSettings({ defaultRemindTime: v })}
              />
            </div>
            <div className="flex items-center justify-between gap-3 py-3">
              <div>
                <div className="font-medium text-sm">Morning digest</div>
                <div className="text-muted-foreground text-xs">
                  {st.digestOn
                    ? `“5 today · 2 overdue” at ${fmtTime(st.digestTime)}`
                    : "One push with today's count"}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {st.digestOn && (
                  <TimeInput
                    label="Digest time"
                    value={st.digestTime}
                    onChange={(v) => updateSettings({ digestTime: v })}
                  />
                )}
                <Toggle
                  label="Morning digest"
                  checked={st.digestOn}
                  onChange={(v) => updateSettings({ digestOn: v })}
                />
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 py-3">
              <div>
                <div className="font-medium text-sm">Quiet hours</div>
                <div className="text-muted-foreground text-xs">
                  Pings wait until after — unless you set that exact time
                </div>
              </div>
              <div className="flex items-center gap-1 text-muted-foreground text-xs">
                <TimeInput
                  label="Quiet hours start"
                  value={st.quietStart}
                  onChange={(v) => updateSettings({ quietStart: v })}
                />
                –
                <TimeInput
                  label="Quiet hours end"
                  value={st.quietEnd}
                  onChange={(v) => updateSettings({ quietEnd: v })}
                />
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 py-3">
              <div>
                <div className="font-medium text-sm">
                  Count groceries in stats
                </div>
                <div className="text-muted-foreground text-xs">
                  In “Tasks done” only — never in on-time or follow-through
                </div>
              </div>
              <Toggle
                label="Count groceries in stats"
                checked={st.countGroceries}
                onChange={(v) => updateSettings({ countGroceries: v })}
              />
            </div>
            <div className="flex items-center justify-between gap-3 py-3">
              <div className="font-medium text-sm">Week starts on</div>
              <div className="w-40">
                <Segmented<"0" | "1">
                  value={String(st.weekStart) as "0" | "1"}
                  onChange={(v) =>
                    updateSettings({ weekStart: v === "0" ? 0 : 1 })
                  }
                  options={[
                    { value: "0", label: "Sun" },
                    { value: "1", label: "Mon" },
                  ]}
                />
              </div>
            </div>
          </Card>
          <SectionTitle>Lists</SectionTitle>
          <Card className="py-1">
            <Row
              href="/tasks/lists"
              title="Manage lists"
              subtitle="Rename, reorder, archive, shopping mode"
              right={<ChevronRight className="size-4 text-muted-foreground" />}
            />
          </Card>
        </>
      )}
    </Screen>
  )
}
