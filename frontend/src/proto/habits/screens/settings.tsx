"use client"

import { Bell, BellOff, CheckCircle2, Share, Smartphone } from "lucide-react"
import { useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { DAY_START_HOUR } from "../../lib/day"
import { resetAll } from "../../lib/store"
import { Btn, Card, Screen, SectionTitle, Segmented } from "../../ui/kit"
import { updateSettings } from "../actions"
import { habitsStore } from "../store"
import { BottomSheet, Gate, Toggle } from "../ui"
import { useNotifStatus } from "./form"

/** HAB-18 Habits settings (+ HAB-19 notifications setup). */
export function SettingsScreen() {
  return (
    <Screen title="Habit settings" back>
      <Gate>
        <Body />
      </Gate>
    </Screen>
  )
}

function Row({
  title,
  sub,
  children,
}: {
  title: string
  sub?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="font-medium text-sm">{title}</div>
        {sub && <div className="text-muted-foreground text-xs">{sub}</div>}
      </div>
      {children}
    </div>
  )
}

function Body() {
  const settings = habitsStore.use((s) => s.settings)
  const sp = useSearchParams()
  const [notifyOpen, setNotifyOpen] = useState(sp.get("notify") === "1")
  const notif = useNotifStatus()
  return (
    <div className="space-y-2 pt-1">
      <Card className="divide-y divide-border/50 py-1">
        <Row
          title="Day starts at"
          sub="A 01:30 log still counts for the previous day. Applies app-wide."
        >
          <span className="num rounded-lg bg-muted px-2.5 py-1 text-sm">
            {String(DAY_START_HOUR).padStart(2, "0")}:00
          </span>
        </Row>
        <div className="py-3">
          <div className="mb-2 font-medium text-sm">Week starts on</div>
          <Segmented
            value={String(settings.weekStart) as "0" | "1"}
            onChange={(v) => updateSettings({ weekStart: Number(v) as 0 | 1 })}
            options={[
              { value: "1", label: "Monday" },
              { value: "0", label: "Sunday" },
            ]}
          />
        </div>
        <Row
          title="Reminders on for new habits"
          sub="Push at each habit's scheduled time"
        >
          <Toggle
            checked={settings.defaultReminder}
            onChange={(v) => updateSettings({ defaultReminder: v })}
            label="Default reminder"
          />
        </Row>
        <Row
          title="Streak-at-risk nudge"
          sub="One push at 21:00 when a 3+ day streak would break today"
        >
          <Toggle
            checked={settings.streakNudge}
            onChange={(v) => updateSettings({ streakNudge: v })}
            label="Streak nudge"
          />
        </Row>
      </Card>

      <SectionTitle>Notifications</SectionTitle>
      <Card className="flex items-center gap-3">
        {notif === "granted" ? (
          <Bell className="size-5 text-good" />
        ) : (
          <BellOff className="size-5 text-warn" />
        )}
        <div className="flex-1">
          <div className="font-medium text-sm">
            {notif === "granted"
              ? "Notifications on"
              : notif === "denied"
                ? "Notifications blocked"
                : "Notifications not set up"}
          </div>
          <div className="text-muted-foreground text-xs">
            {notif === "granted"
              ? "Reminders will arrive."
              : "Reminders won't reach you yet."}
          </div>
        </div>
        {notif !== "granted" && (
          <Btn accent="hab" className="h-9" onClick={() => setNotifyOpen(true)}>
            Enable
          </Btn>
        )}
      </Card>

      <SectionTitle>Prototype</SectionTitle>
      <Card>
        <Btn
          variant="danger"
          className="w-full"
          onClick={() => {
            habitsStore.reset()
            toast("Habits data reset to the demo seed")
          }}
        >
          Reset habits demo data
        </Btn>
        <button
          type="button"
          className="mt-2 w-full text-center text-muted-foreground text-xs"
          onClick={() => {
            resetAll()
            toast("All sections reset")
          }}
        >
          Reset every section
        </button>
      </Card>

      <NotificationsSheet open={notifyOpen} onOpenChange={setNotifyOpen} />
    </div>
  )
}

/** HAB-19 Notifications setup (install guide on iOS, permission elsewhere). */
export function NotificationsSheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const [env, setEnv] = useState({ ios: false, installed: false })
  const [perm, setPerm] = useState<string>("default")
  useEffect(() => {
    setEnv({
      ios: /iPad|iPhone|iPod/.test(navigator.userAgent),
      installed: window.matchMedia("(display-mode: standalone)").matches,
    })
    setPerm(
      typeof Notification === "undefined"
        ? "unsupported"
        : Notification.permission,
    )
  }, [])
  const needInstall = env.ios && !env.installed
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Turn on reminders"
      description="Habit reminders arrive at their scheduled time. Today stays the source of truth either way."
    >
      <div className="space-y-3 pb-2">
        <Step
          done={env.installed || !env.ios}
          n={1}
          icon={<Smartphone className="size-4" />}
        >
          {env.ios
            ? "Install the app to your Home Screen"
            : "Works in this browser"}
        </Step>
        {needInstall && (
          <Card className="space-y-1.5 bg-muted/40 text-sm">
            <div className="flex items-center gap-2">
              1. Tap <Share className="size-4" /> Share in Safari
            </div>
            <div>2. Choose “Add to Home Screen”</div>
            <div>3. Open SOP from the Home Screen and come back here</div>
          </Card>
        )}
        <Step
          done={perm === "granted"}
          n={2}
          icon={<Bell className="size-4" />}
        >
          {perm === "denied"
            ? "Notifications are blocked — allow them in your browser/site settings"
            : "Allow notifications"}
        </Step>
        <Btn
          accent="hab"
          className="w-full"
          disabled={
            needInstall ||
            perm === "granted" ||
            perm === "denied" ||
            perm === "unsupported"
          }
          onClick={async () => {
            try {
              const p = await Notification.requestPermission()
              setPerm(p)
              if (p === "granted") toast.success("Reminders are on")
            } catch {
              toast.error("This browser can't show notifications")
            }
          }}
        >
          {perm === "granted" ? "All set" : "Allow notifications"}
        </Btn>
        <Btn
          variant="ghost"
          className="w-full"
          onClick={() => onOpenChange(false)}
        >
          Not now
        </Btn>
      </div>
    </BottomSheet>
  )
}

function Step({
  done,
  n,
  icon,
  children,
}: {
  done: boolean
  n: number
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-3">
      <span
        className={cn(
          "grid size-8 place-items-center rounded-full",
          done ? "bg-good/15 text-good" : "bg-muted text-muted-foreground",
        )}
      >
        {done ? <CheckCircle2 className="size-4" /> : icon}
      </span>
      <span className={cn("flex-1 text-sm", done && "text-muted-foreground")}>
        {n}. {children}
      </span>
    </div>
  )
}
