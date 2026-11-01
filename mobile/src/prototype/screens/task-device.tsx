import * as A from "@domain/tasks/actions"
import { useTodayData } from "@domain/tasks/hooks"
import * as L from "@domain/tasks/logic"
import { tasksStore } from "@domain/tasks/store"
import { LinearGradient } from "expo-linear-gradient"
import {
  BellRing,
  Check,
  ChevronRight,
  FlaskConical,
  Lock,
  Share,
  SquarePlus,
} from "lucide-react-native"
import { useState } from "react"
import { View } from "react-native"
import { toast } from "sonner-native"
import { sendTestReminder } from "../local-reminders"
import {
  border,
  Copy,
  Frame,
  Line,
  SectionHeading,
  Segmented,
  Tap,
} from "../native-kit"
import { go } from "../navigation"
import { enableReminders } from "../reminders"
import { Switch } from "../switch"
import { useTheme } from "../theme"
import { TimeInput } from "../time-input"
import { Button, Screen, Sheet } from "../ui"

const PLATFORM = {
  ios: "iPhone · Safari",
  android: "Android · Chrome",
  desktop: "Desktop browser",
}
export function TaskSettings() {
  const s = tasksStore.use((s) => s),
    t = useTheme(),
    st = s.settings,
    n = s.notif
  const row = (title: string, body: string, right: React.ReactNode) => (
    <Line
      style={{
        paddingVertical: 12,
        gap: 12,
        borderBottomWidth: 1,
        borderBottomColor: border(t.line, 0.5),
      }}
    >
      <View style={{ flex: 1 }}>
        <Copy size={14} weight="medium">
          {title}
        </Copy>
        {!!body && (
          <Copy size={12} muted>
            {body}
          </Copy>
        )}
      </View>
      {right}
    </Line>
  )
  return (
    <Screen title="Tasks settings">
      <View style={{ marginTop: 0 }}>
        <SectionHeading>Notifications</SectionHeading>
        <Frame style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
          <Tap onPress={() => go("/tasks/reminders")}>
            <Line style={{ paddingVertical: 12 }}>
              <BellRing size={20} color={t.tsk} />
              <View style={{ flex: 1 }}>
                <Copy weight="medium">This device</Copy>
                <Copy size={12} muted>
                  {PLATFORM[n.platform]} ·{" "}
                  {n.platform === "ios" && !n.installed
                    ? "Needs Home Screen install"
                    : n.permission === "granted"
                      ? "On"
                      : n.permission === "denied"
                        ? "Blocked"
                        : "Off"}
                </Copy>
              </View>
              <ChevronRight size={16} color={t.muted} />
            </Line>
          </Tap>
        </Frame>
        <SectionHeading>Defaults</SectionHeading>
        <Frame style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
          {row(
            "Default reminder time",
            "For tasks with a date but no time",
            <TimeInput
              label="Default reminder time"
              value={st.defaultRemindTime}
              onChange={(defaultRemindTime) =>
                A.updateSettings({ defaultRemindTime })
              }
            />,
          )}
          {row(
            "Morning digest",
            st.digestOn
              ? `“5 today · 2 overdue” at ${L.fmtTime(st.digestTime)}`
              : "One push with today's count",
            <Line style={{ gap: 8 }}>
              {st.digestOn && (
                <TimeInput
                  label="Digest time"
                  value={st.digestTime}
                  onChange={(digestTime) => A.updateSettings({ digestTime })}
                />
              )}
              <Switch
                label="Morning digest"
                value={st.digestOn}
                onChange={(digestOn) => A.updateSettings({ digestOn })}
              />
            </Line>,
          )}
          {row(
            "Quiet hours",
            "Pings wait until after — unless you set that exact time",
            <Line style={{ gap: 4 }}>
              <TimeInput
                label="Quiet hours start"
                value={st.quietStart}
                onChange={(quietStart) => A.updateSettings({ quietStart })}
              />
              <Copy size={12} muted>
                –
              </Copy>
              <TimeInput
                label="Quiet hours end"
                value={st.quietEnd}
                onChange={(quietEnd) => A.updateSettings({ quietEnd })}
              />
            </Line>,
          )}
          {row(
            "Count groceries in stats",
            "In “Tasks done” only — never in on-time or follow-through",
            <Switch
              label="Count groceries in stats"
              value={st.countGroceries}
              onChange={(countGroceries) =>
                A.updateSettings({ countGroceries })
              }
            />,
          )}
          {row(
            "Week starts on",
            "",
            <View style={{ width: 160 }}>
              <Segmented
                value={String(st.weekStart)}
                onChange={(v) =>
                  A.updateSettings({ weekStart: v === "0" ? 0 : 1 })
                }
                options={[
                  { value: "0", label: "Sun" },
                  { value: "1", label: "Mon" },
                ]}
              />
            </View>,
          )}
        </Frame>
        <SectionHeading>Lists</SectionHeading>
        <Frame style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
          <Tap onPress={() => go("/tasks/lists")}>
            <Line style={{ paddingVertical: 12 }}>
              <View style={{ flex: 1 }}>
                <Copy weight="medium">Manage lists</Copy>
                <Copy size={12} muted>
                  Rename, reorder, archive, shopping mode
                </Copy>
              </View>
              <ChevronRight size={16} color={t.muted} />
            </Line>
          </Tap>
        </Frame>
      </View>
    </Screen>
  )
}
export function TaskReminders() {
  const n = tasksStore.use((s) => s.notif),
    t = useTheme(),
    [prompt, setPrompt] = useState(false),
    [controls, setControls] = useState(false),
    install = n.platform === "ios" && !n.installed
  const test = async () => {
    A.updateNotif({ testSentAt: new Date().toISOString() })
    const sent = await sendTestReminder().catch(() => false)
    if (!sent) {
      toast.warning("Notifications are off for Unfurl")
      void enableReminders()
    }
  }
  const step = (
    i: number,
    title: string,
    body: string,
    art: React.ReactNode,
  ) => (
    <Line style={{ alignItems: "flex-start", gap: 12 }}>
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: 14,
          backgroundColor: t.tsk,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Copy size={14} weight="semibold" style={{ color: t.bg }}>
          {i}
        </Copy>
      </View>
      <View style={{ flex: 1, gap: 8 }}>
        <View>
          <Copy weight="medium">{title}</Copy>
          <Copy size={14} muted>
            {body}
          </Copy>
        </View>
        {art}
      </View>
    </Line>
  )
  return (
    <Screen title="Reminders">
      <Line style={{ gap: 8, flexWrap: "wrap" }}>
        {[
          PLATFORM[n.platform],
          ...(n.platform === "ios"
            ? [n.installed ? "Installed" : "Not installed"]
            : []),
          n.permission === "granted"
            ? "Notifications on"
            : n.permission === "denied"
              ? "Blocked"
              : "Not enabled",
        ].map((label) => (
          <View
            key={label}
            style={{
              borderRadius: 20,
              backgroundColor: t.soft,
              paddingHorizontal: 10,
              paddingVertical: 4,
            }}
          >
            <Copy size={12} muted>
              {label}
            </Copy>
          </View>
        ))}
      </Line>
      {install ? (
        <>
          <Frame style={{ padding: 16 }}>
            <LinearGradient
              colors={[`${t.tsk}26`, "transparent"]}
              style={{ position: "absolute", inset: 0 }}
            />
            <BellRing size={24} color={t.tsk} />
            <Copy size={18} weight="semibold" style={{ marginTop: 8 }}>
              One step first on iPhone
            </Copy>
            <Copy size={14} muted>
              iOS only sends reminders to apps on your Home Screen. It takes 10
              seconds and the app opens full-screen after.
            </Copy>
          </Frame>
          <View style={{ gap: 24, marginTop: 8 }}>
            {step(
              1,
              "Tap Share",
              "The square-with-arrow in Safari's toolbar.",
              <Line
                style={{
                  backgroundColor: t.soft,
                  borderRadius: 12,
                  padding: 12,
                  justifyContent: "space-around",
                }}
              >
                <ChevronRight
                  size={16}
                  color={t.muted}
                  style={{ transform: [{ rotate: "180deg" }] }}
                />
                <ChevronRight size={16} color={t.muted} />
                <Share size={24} color={t.tsk} />
                <Copy muted>•••</Copy>
              </Line>,
            )}
            {step(
              2,
              "Add to Home Screen",
              "Scroll the share sheet, tap it, then Add.",
              <View
                style={{
                  backgroundColor: t.soft,
                  padding: 8,
                  borderRadius: 12,
                  gap: 6,
                }}
              >
                <Copy size={14} muted>
                  Copy
                </Copy>
                <Line
                  style={{
                    backgroundColor: `${t.tsk}33`,
                    padding: 8,
                    borderRadius: 8,
                    justifyContent: "space-between",
                  }}
                >
                  <Copy size={14} style={{ color: t.tsk }}>
                    Add to Home Screen
                  </Copy>
                  <SquarePlus size={16} color={t.tsk} />
                </Line>
                <Copy size={14} muted>
                  Add Bookmark
                </Copy>
              </View>,
            )}
            {step(
              3,
              "Open Unfurl from your Home Screen",
              "Then come back here to switch reminders on.",
              <Line
                style={{
                  backgroundColor: t.soft,
                  padding: 12,
                  borderRadius: 12,
                }}
              >
                {["App", "App", "Unfurl", "App"].map((name, i) => (
                  <View
                    key={`${name}-${i}`}
                    style={{ alignItems: "center", gap: 4 }}
                  >
                    <View
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 12,
                        backgroundColor: name === "Unfurl" ? t.tsk : t.bg,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Copy size={12}>{name === "Unfurl" ? "Unfurl" : ""}</Copy>
                    </View>
                    <Copy size={10} muted>
                      {name}
                    </Copy>
                  </View>
                ))}
              </Line>,
            )}
          </View>
          <Button onPress={() => A.updateNotif({ installed: true })}>
            I've added it
          </Button>
          <Button
            tone="quiet"
            onPress={() =>
              A.updateNotif({ remindLaterAt: new Date().toISOString() })
            }
          >
            Remind me later
          </Button>
        </>
      ) : n.permission === "granted" ? (
        <>
          <Frame
            style={{
              padding: 16,
              borderColor: `${t.good}4d`,
              backgroundColor: `${t.good}0d`,
            }}
          >
            <Line>
              <Check size={24} color={t.good} />
              <View style={{ flex: 1 }}>
                <Copy weight="semibold">Reminders are on</Copy>
                <Copy size={14} muted>
                  This device gets pings for tasks with a reminder.
                </Copy>
              </View>
            </Line>
          </Frame>
          <Button tone="quiet" icon={BellRing} onPress={test}>
            Send a test ping
          </Button>
          <Copy size={12} muted style={{ textAlign: "center" }}>
            {n.platform === "ios"
              ? "On iPhone, tapping a ping opens the task. Done / Snooze buttons appear where the OS supports them."
              : "Pings include Done and Snooze 1h buttons."}
          </Copy>
          <Button tone="quiet" href="/tasks/notification">
            Preview a reminder
          </Button>
        </>
      ) : n.permission === "denied" ? (
        <>
          <Frame
            style={{
              padding: 16,
              borderColor: `${t.bad}4d`,
              backgroundColor: `${t.bad}0d`,
            }}
          >
            <BellRing size={24} color={t.bad} />
            <Copy size={18} weight="semibold">
              Blocked in {n.platform === "ios" ? "iOS" : "browser"} settings
            </Copy>
            <Copy size={14} muted>
              Your reminders are still saved. Until pings are back on, due tasks
              show on your Today card with a “due now” badge.
            </Copy>
          </Frame>
          <SectionHeading>How to unblock</SectionHeading>
          <Copy size={14}>
            {n.platform === "ios"
              ? "1. Open the iPhone Settings app → Notifications.\n2. Find “Unfurl” in the app list.\n3. Turn on Allow Notifications."
              : "1. Tap the lock icon next to the address bar.\n2. Open Site settings → Notifications.\n3. Choose Allow, then reload."}
          </Copy>
          <Button
            tone="quiet"
            onPress={() => A.updateNotif({ permission: "default" })}
          >
            I've turned it back on
          </Button>
        </>
      ) : (
        <>
          <Frame style={{ padding: 16 }}>
            <BellRing size={24} color={t.tsk} />
            <Copy size={18} weight="semibold" style={{ marginTop: 8 }}>
              Get pinged at the right time
            </Copy>
            <Copy size={14} muted>
              Only for tasks you set a reminder on, plus an optional morning
              digest. Never marketing, never on first launch.
            </Copy>
          </Frame>
          <Button onPress={() => setPrompt(true)}>Enable notifications</Button>
          <Button
            tone="quiet"
            onPress={() =>
              A.updateNotif({ remindLaterAt: new Date().toISOString() })
            }
          >
            Not now
          </Button>
        </>
      )}
      <Frame style={{ padding: 12, marginTop: 28, borderStyle: "dashed" }}>
        <Tap onPress={() => setControls(!controls)}>
          <Line style={{ gap: 8 }}>
            <FlaskConical size={16} color={t.muted} />
            <Copy size={14} muted>
              Prototype: simulate device
            </Copy>
          </Line>
        </Tap>
        {controls && (
          <View style={{ gap: 12, marginTop: 12 }}>
            <Copy size={12} muted>
              These preferences simulate notifications; no system alerts are
              scheduled.
            </Copy>
            <Segmented
              value={n.platform}
              onChange={(platform) => A.updateNotif({ platform })}
              options={[
                { value: "ios", label: "iOS" },
                { value: "android", label: "Android" },
                { value: "desktop", label: "Desktop" },
              ]}
            />
            <Segmented
              value={n.permission}
              onChange={(permission) => A.updateNotif({ permission })}
              options={[
                { value: "default", label: "Not asked" },
                { value: "granted", label: "Allowed" },
                { value: "denied", label: "Blocked" },
              ]}
            />
            <Line>
              <Copy style={{ flex: 1 }}>Installed to Home Screen</Copy>
              <Switch
                label="Installed to Home Screen"
                value={n.installed}
                onChange={(installed) => A.updateNotif({ installed })}
              />
            </Line>
          </View>
        )}
      </Frame>
      <Sheet
        title="Allow notifications"
        open={prompt}
        onClose={() => setPrompt(false)}
      >
        <Copy weight="semibold">
          “Unfurl” Would Like to Send You Notifications
        </Copy>
        <Copy size={12} muted>
          Prototype permission preview. Notifications may include alerts, sounds
          and icon badges.
        </Copy>
        <Button
          onPress={() => {
            setPrompt(false)
            A.updateNotif({ permission: "granted" })
            test()
          }}
        >
          Allow
        </Button>
        <Button
          tone="quiet"
          onPress={() => {
            setPrompt(false)
            A.updateNotif({ permission: "denied" })
          }}
        >
          Don't Allow
        </Button>
      </Sheet>
    </Screen>
  )
}
export function TaskNotifications() {
  const d = useTodayData(),
    s = tasksStore.use((s) => s),
    t = useTheme(),
    [gone, setGone] = useState<string[]>([]),
    reminders = [...d.due, ...d.upcoming.flatMap((g) => g.tasks)]
      .filter((task) => task.remindAt && !gone.includes(task.id))
      .slice(0, 3)
  const ping = (title: string, body: string, time: string, id?: string) => (
    <View
      key={id ?? "digest"}
      style={{
        borderRadius: 16,
        overflow: "hidden",
        backgroundColor: "#ffffff26",
      }}
    >
      <Tap
        onPress={() => go(id ? `/tasks/task/${id}` : "/tasks")}
        style={{ padding: 12 }}
      >
        <Line style={{ alignItems: "flex-start", gap: 8 }}>
          <LinearGradient
            colors={[t.primary, t.hab]}
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <Copy size={10} weight="semibold" style={{ color: "#fff" }}>
              Unfurl
            </Copy>
          </LinearGradient>
          <View style={{ flex: 1 }}>
            <Line style={{ justifyContent: "space-between", gap: 8 }}>
              <Copy
                size={14}
                weight="semibold"
                lines={1}
                style={{ color: "#fff", flex: 1 }}
              >
                {title}
              </Copy>
              <Copy size={11} style={{ color: "#ffffffb3" }}>
                {time}
              </Copy>
            </Line>
            <Copy size={14} style={{ color: "#ffffffd9" }}>
              {body}
            </Copy>
          </View>
        </Line>
      </Tap>
      {id && s.notif.platform !== "ios" && (
        <Line style={{ gap: 0, borderTopWidth: 1, borderColor: "#ffffff26" }}>
          {["Done", "Snooze 1h"].map((action) => (
            <Tap
              key={action}
              onPress={() => {
                action === "Done" ? A.completeTask(id) : A.snoozeTask(id, 60)
                setGone([...gone, id])
              }}
              style={{ flex: 1, padding: 8, alignItems: "center" }}
            >
              <Copy size={14} style={{ color: "#fff" }}>
                {action}
              </Copy>
            </Tap>
          ))}
        </Line>
      )}
    </View>
  )
  return (
    <Screen title="Notification preview">
      <Copy size={14} muted>
        What the lock screen shows. Tap a ping to open the task.
        {s.notif.platform === "ios"
          ? " iPhone shows no action buttons — tap opens the app."
          : ""}
      </Copy>
      <LinearGradient
        colors={[t["lockscreen-from"], t["lockscreen-to"]]}
        style={{ borderRadius: 24, padding: 16, paddingBottom: 32, gap: 8 }}
      >
        <View style={{ alignItems: "center", paddingVertical: 16 }}>
          <Lock size={16} color="#ffffffb3" />
          <Copy
            size={60}
            weight="displayMedium"
            style={{ color: "#fff", lineHeight: 75 }}
          >
            {L.fmtTime(new Date().toTimeString().slice(0, 5)).replace(
              / (AM|PM)/,
              "",
            )}
          </Copy>
          <Copy size={14} style={{ color: "#ffffffbf" }}>
            {new Date().toLocaleDateString("en-PH", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </Copy>
        </View>
        {ping(
          "Good morning",
          `${d.due.length} task${d.due.length === 1 ? "" : "s"} today · ${d.overdue.length} overdue`,
          L.fmtTime(s.settings.digestTime),
        )}
        {reminders.map((task) =>
          ping(
            task.title,
            task.dueTime ? L.fmtTime(task.dueTime) : "Reminder",
            task.remindAt
              ? L.fmtInstant(task.remindAt).replace(/^Today /, "")
              : "",
            task.id,
          ),
        )}
      </LinearGradient>
      <Tap onPress={() => go("/tasks/reminders")}>
        <Copy size={12} muted style={{ textAlign: "center" }}>
          Simulating {s.notif.platform}. Change it under{" "}
          <Copy size={12} style={{ color: t.tsk }}>
            Reminders
          </Copy>
          .
        </Copy>
      </Tap>
    </Screen>
  )
}
