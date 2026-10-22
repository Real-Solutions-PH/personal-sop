import { AREA, MODULE_KEYS } from "@domain/dash/data"
import { fmtGoal, useGoals, useLifeScore } from "@domain/dash/hooks"
import {
  dashStore,
  resetWeights,
  setEnabled,
  setEveningStart,
  setIdentities,
  setProfilePhoto,
  setTargetThreshold,
  setWeight,
  updateProfile,
} from "@domain/dash/store"
import { privacyStore, togglePrivacy } from "@domain/lib/privacy"
import { uid } from "@domain/lib/store"
import {
  Camera,
  ChevronRight,
  Dumbbell,
  ListChecks,
  Minus,
  Plus,
  Repeat2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wallet,
} from "lucide-react-native"
import { useState } from "react"
import { ScrollView, TextInput, View } from "react-native"
import { toast } from "sonner-native"
import { pickPhoto } from "../media"
import {
  border,
  Copy,
  Frame,
  IconTap,
  Line,
  LinkRow,
  SectionHeading,
  Segmented,
  Tap,
} from "../native-kit"
import { go } from "../navigation"
import { ProfileAvatar } from "../profile-avatar"
import { Switch } from "../switch"
import { appearanceStore, fonts, useTheme } from "../theme"
import { TimeInput } from "../time-input"
import { Button, confirm, Screen, Sheet } from "../ui"

const modules = {
  habits: {
    icon: Repeat2,
    color: "hab",
    links: [
      ["Habits", "/habits/manage"],
      ["Routines", "/habits/routines"],
      ["Habit settings", "/habits/settings"],
    ],
  },
  tasks: {
    icon: ListChecks,
    color: "tsk",
    links: [
      ["Lists", "/tasks/lists"],
      ["Task settings", "/tasks/settings"],
    ],
  },
  fitness: {
    icon: Dumbbell,
    color: "fit",
    links: [
      ["Exercises", "/fitness/exercises"],
      ["Macro targets", "/fitness/nutrition/targets"],
      ["Fitness settings", "/fitness/settings"],
    ],
  },
  finance: {
    icon: Wallet,
    color: "fin",
    links: [
      ["Accounts", "/finance/accounts"],
      ["Categories", "/finance/categories"],
      ["Budgets", "/finance/budgets"],
      ["Finance settings", "/finance/settings"],
    ],
  },
} as const
export function Profile() {
  const t = useTheme(),
    p = dashStore.use((s) => s.profile),
    goals = useGoals().filter((g) => g.goal.status === "active")
  const [name, setName] = useState(p.name),
    [handle, setHandle] = useState(p.handle),
    [ids, setIds] = useState(p.identities),
    [photo, setPhoto] = useState(false)
  const input = {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.line,
    backgroundColor: t.card,
    paddingHorizontal: 12,
    fontFamily: fonts.body,
    fontSize: 14,
    color: t.text,
  }
  return (
    <Screen title="Edit profile">
      <View style={{ alignItems: "center", paddingVertical: 8 }}>
        <Tap label="Change profile photo" onPress={() => setPhoto(true)}>
          <ProfileAvatar size={88} />
          <View
            style={{
              position: "absolute",
              right: 0,
              bottom: 0,
              backgroundColor: t.primary,
              borderRadius: 16,
              padding: 6,
            }}
          >
            <Camera size={16} color={t.onPrimary} />
          </View>
        </Tap>
      </View>
      <View style={{ gap: 4 }}>
        <Copy size={12} muted>
          Name
        </Copy>
        <TextInput
          accessibilityLabel="Name"
          value={name}
          onChangeText={setName}
          style={input}
        />
      </View>
      <View style={{ gap: 4 }}>
        <Copy size={12} muted>
          Handle (off on share cards unless you turn it on)
        </Copy>
        <TextInput
          accessibilityLabel="Handle"
          value={handle}
          onChangeText={setHandle}
          style={input}
          autoCapitalize="none"
        />
      </View>
      <View>
        <SectionHeading>Identity statements · {ids.length}/3</SectionHeading>
        <View style={{ gap: 12 }}>
          {ids.map((i, n) => (
            <Frame key={i.id} style={{ padding: 12, gap: 8 }}>
              <Line style={{ gap: 8 }}>
                <TextInput
                  accessibilityLabel={`Identity statement ${n + 1}`}
                  placeholder="I'm someone who…"
                  placeholderTextColor={t.muted}
                  value={i.text}
                  onChangeText={(text) =>
                    setIds((l) =>
                      l.map((x) => (x.id === i.id ? { ...x, text } : x)),
                    )
                  }
                  style={{ ...input, height: 40, flex: 1 }}
                />
                <IconTap
                  icon={Trash2}
                  label={`Remove statement ${n + 1}`}
                  color={t.bad}
                  size={40}
                  onPress={() => setIds((l) => l.filter((x) => x.id !== i.id))}
                />
              </Line>
              <Copy size={12} muted>
                Linked goal (optional)
              </Copy>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 6 }}
              >
                {[
                  { id: "", label: "None" },
                  ...goals.map((g) => ({
                    id: g.goal.id,
                    label: `${g.goal.label} ${fmtGoal(g.goal)}`,
                  })),
                ].map((g) => (
                  <Tap
                    key={g.id}
                    onPress={() =>
                      setIds((l) =>
                        l.map((x) =>
                          x.id === i.id
                            ? { ...x, goalId: g.id || undefined }
                            : x,
                        ),
                      )
                    }
                    style={{
                      minHeight: 44,
                      justifyContent: "center",
                      borderRadius: 22,
                      paddingHorizontal: 12,
                      backgroundColor:
                        (i.goalId ?? "") === g.id ? t.primary : t.soft,
                    }}
                  >
                    <Copy
                      size={12}
                      style={{
                        color: (i.goalId ?? "") === g.id ? t.onPrimary : t.text,
                      }}
                    >
                      {g.label}
                    </Copy>
                  </Tap>
                ))}
              </ScrollView>
            </Frame>
          ))}
          {ids.length < 3 && (
            <Button
              tone="quiet"
              onPress={() => setIds((l) => [...l, { id: uid(), text: "" }])}
            >
              Add statement
            </Button>
          )}
        </View>
      </View>
      <View style={{ marginTop: 12 }}>
        <Button
          onPress={() => {
            updateProfile({
              name: name.trim() || p.name,
              handle: handle.trim().startsWith("@")
                ? handle.trim()
                : `@${handle.trim()}`,
            })
            setIdentities(ids.filter((i) => i.text.trim()))
            toast.success("Profile saved")
            go("/me")
          }}
        >
          Save
        </Button>
      </View>
      <Frame
        style={{ marginTop: 12, paddingHorizontal: 8, paddingVertical: 4 }}
      >
        <LinkRow
          title="Account & security"
          detail="Email, password, export, delete account"
          icon={ShieldCheck}
          href="/me/account"
        />
      </Frame>
      <Sheet open={photo} title="Profile photo" onClose={() => setPhoto(false)}>
        <Button
          onPress={() =>
            void pickPhoto().then((uri) => {
              if (uri) setProfilePhoto(uri)
              setPhoto(false)
            })
          }
        >
          Choose photo
        </Button>
        {!!p.photo && (
          <Button
            tone="danger"
            onPress={() => {
              setProfilePhoto(undefined)
              setPhoto(false)
            }}
          >
            Remove photo
          </Button>
        )}
      </Sheet>
    </Screen>
  )
}
export function WeightsEditor() {
  const t = useTheme(),
    s = dashStore.use((s) => s),
    ls = useLifeScore(30),
    total = MODULE_KEYS.filter((k) => s.enabled[k]).reduce(
      (a, k) => a + s.weights[k],
      0,
    )
  return (
    <View style={{ gap: 8 }}>
      <View
        style={{
          padding: 12,
          borderRadius: 16,
          backgroundColor: border(t.soft, 0.5),
        }}
      >
        <Copy size={14}>
          <Copy size={14} weight="semibold">
            Life Score
          </Copy>{" "}
          = weighted mean of each area's rate over the range. Weights are
          relative — only their ratio matters. Now:{" "}
          <Copy size={14} weight="semibold">
            {ls.score ?? "—"}
          </Copy>
        </Copy>
      </View>
      <View style={{ marginTop: 12, gap: 4 }}>
        {MODULE_KEYS.map((k) => {
          const m = modules[k],
            I = m.icon
          return (
            <Line
              key={k}
              style={{
                gap: 12,
                paddingVertical: 8,
                opacity: s.enabled[k] ? 1 : 0.4,
              }}
            >
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 12,
                  backgroundColor: border(t[m.color], 0.15),
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <I size={18} color={t[m.color]} />
              </View>
              <View style={{ flex: 1 }}>
                <Copy size={14} weight="medium">
                  {AREA[k].label}
                </Copy>
                <Copy size={12} muted>
                  rate{" "}
                  {ls.rates[k] === null
                    ? "—"
                    : `${Math.round((ls.rates[k] ?? 0) * 100)}%`}{" "}
                  ·{" "}
                  {s.enabled[k]
                    ? `${total ? Math.round((s.weights[k] / total) * 100) : 0}% of score`
                    : "turned off"}
                </Copy>
              </View>
              <IconTap
                size={44}
                icon={Minus}
                label={`Lower ${AREA[k].label} weight`}
                background={t.soft}
                onPress={() => {
                  if (s.enabled[k] && s.weights[k] > 0)
                    setWeight(k, s.weights[k] - 1)
                }}
              />
              <Copy
                weight="semibold"
                style={{ width: 20, textAlign: "center", color: t[m.color] }}
              >
                {s.weights[k]}
              </Copy>
              <IconTap
                size={44}
                icon={Plus}
                label={`Raise ${AREA[k].label} weight`}
                background={t.soft}
                onPress={() => {
                  if (s.enabled[k] && s.weights[k] < 5)
                    setWeight(k, s.weights[k] + 1)
                }}
              />
            </Line>
          )
        })}
      </View>
      <Copy size={12} muted style={{ marginTop: 4 }}>
        Area rates come from each section: habits = completion, tasks = on-time
        rate, fitness = sessions + calories on target, finance = savings rate +
        budgets on pace.
      </Copy>
      <Button tone="quiet" onPress={resetWeights}>
        Reset to default weights
      </Button>
    </View>
  )
}
export function Settings() {
  const t = useTheme(),
    s = dashStore.use((s) => s),
    hidden = privacyStore.use((s) => s.hidden),
    theme = appearanceStore.use((s) => s.mode)
  const row = (
    title: string,
    subtitle: string,
    right: React.ReactNode,
    onPress?: () => void,
  ) => (
    <View>
      <Line style={{ paddingVertical: 12, gap: 12 }}>
        <Tap onPress={onPress ?? (() => {})} style={{ flex: 1 }}>
          <Copy weight="medium">{title}</Copy>
          {!!subtitle && (
            <Copy size={12} muted>
              {subtitle}
            </Copy>
          )}
        </Tap>
        {right}
      </Line>
    </View>
  )
  const chev = <ChevronRight size={16} color={t.muted} />
  return (
    <Screen title="Settings">
      <View>
        <SectionHeading>Sections & settings</SectionHeading>
        <Frame style={{ paddingHorizontal: 12, paddingVertical: 4 }}>
          {MODULE_KEYS.map((k) => {
            const m = modules[k],
              I = m.icon
            const toggle = () =>
              s.enabled[k]
                ? confirm(
                    `Turn off ${AREA[k].label}?`,
                    "Its cards, stats, share fields and misses hide. Your data is kept — turn it back on anytime.",
                    () => setEnabled(k, false),
                  )
                : setEnabled(k, true)
            return (
              <View
                key={k}
                style={{
                  paddingVertical: 8,
                  borderBottomWidth: 1,
                  borderBottomColor: border(t.line, 0.5),
                }}
              >
                <Line style={{ gap: 12, paddingVertical: 4 }}>
                  <View
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 14,
                      backgroundColor: border(t[m.color], 0.15),
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <I size={16} color={t[m.color]} />
                  </View>
                  <Copy weight="medium" style={{ flex: 1 }}>
                    {AREA[k].label}
                  </Copy>
                  <Switch
                    compact
                    accent="primary"
                    label={AREA[k].label}
                    value={s.enabled[k]}
                    onChange={toggle}
                  />
                </Line>
                {s.enabled[k] && (
                  <View
                    style={{
                      flexDirection: "row",
                      flexWrap: "wrap",
                      gap: 6,
                      paddingLeft: 36,
                      marginTop: 4,
                    }}
                  >
                    {m.links.map(([label, href]) => (
                      <Tap
                        key={href}
                        onPress={() => go(href)}
                        style={{
                          borderRadius: 20,
                          paddingHorizontal: 10,
                          paddingVertical: 4,
                          backgroundColor: t.soft,
                        }}
                      >
                        <Copy size={12}>{label}</Copy>
                      </Tap>
                    ))}
                  </View>
                )}
              </View>
            )
          })}
          <Line style={{ paddingVertical: 12 }}>
            <Sparkles size={20} color={t.muted} />
            <Copy size={14} muted style={{ flex: 1 }}>
              Capture
            </Copy>
            <Copy size={12} muted>
              always on
            </Copy>
          </Line>
        </Frame>
        <SectionHeading>Life Score weights</SectionHeading>
        <Frame style={{ padding: 16 }}>
          <WeightsEditor />
        </Frame>
        <SectionHeading>Notifications</SectionHeading>
        <Frame style={{ paddingHorizontal: 12, paddingVertical: 4 }}>
          {row(
            "Permission",
            s.push.permission === "granted"
              ? "Allowed"
              : s.push.permission === "denied"
                ? "Blocked — re-enable in your browser’s site settings"
                : "Not asked yet",
            s.push.permission !== "granted" ? (
              <Button
                small
                onPress={() =>
                  toast("Notification delivery is mocked in the prototype")
                }
              >
                Allow
              </Button>
            ) : null,
          )}
          {row("Morning digest", "", <Copy size={14}>{s.push.morning}</Copy>)}
          {row("Evening wrap-up", "", <Copy size={14}>{s.push.evening}</Copy>)}
          {row("Weekly review", "", <Copy size={14}>{s.push.review}</Copy>)}
          {row("Send a test push", "", chev, () =>
            toast("Test push", {
              description: "This is what a reminder looks like.",
            }),
          )}
        </Frame>
        <SectionHeading>Appearance</SectionHeading>
        <Frame style={{ padding: 8, gap: 8 }}>
          <Segmented
            value={theme}
            onChange={(v) => {
              appearanceStore.set({ mode: v as "system" | "light" | "dark" })
            }}
            options={["system", "light", "dark"].map((value) => ({
              value,
              label: value[0].toUpperCase() + value.slice(1),
            }))}
          />
          <Copy size={12} muted>
            System follows your phone's light or dark setting.
          </Copy>
        </Frame>
        <SectionHeading>Day & time</SectionHeading>
        <Frame style={{ paddingHorizontal: 12, paddingVertical: 4 }}>
          {row("Timezone", "", <Copy size={14}>Asia/Manila</Copy>)}
          {row(
            "Day starts at",
            "01:30 still counts as yesterday",
            <Copy size={14}>04:00</Copy>,
          )}
          {row(
            "Evening starts at",
            "Today switches to the wrap-up view",
            <TimeInput
              label="Evening starts at"
              value={s.eveningStart}
              onChange={setEveningStart}
            />,
          )}
          {row("Week starts", "", <Copy size={14}>Monday</Copy>)}
          <View style={{ paddingHorizontal: 4, paddingVertical: 8, gap: 8 }}>
            <Copy weight="medium">What counts as on target</Copy>
            <Copy size={14} muted>
              Share of due habits + tasks done to hit the day's target
            </Copy>
            <Line style={{ gap: 6 }}>
              {[0.6, 0.7, 0.8, 0.9, 1].map((v) => (
                <Tap
                  key={v}
                  onPress={() => setTargetThreshold(v)}
                  style={{
                    flex: 1,
                    height: 44,
                    justifyContent: "center",
                    alignItems: "center",
                    borderRadius: 22,
                    backgroundColor:
                      s.targetThreshold === v ? t.primary : t.soft,
                  }}
                >
                  <Copy
                    size={12}
                    style={{
                      color: s.targetThreshold === v ? t.onPrimary : t.text,
                    }}
                  >
                    {Math.round(v * 100)}%
                  </Copy>
                </Tap>
              ))}
            </Line>
          </View>
        </Frame>
        <SectionHeading>Sharing & privacy</SectionHeading>
        <Frame style={{ paddingHorizontal: 12, paddingVertical: 4 }}>
          {row(
            "Privacy mode",
            "Blur money amounts everywhere (or long-press the Today header)",
            <Switch
              compact
              accent="primary"
              label="Privacy mode"
              value={hidden}
              onChange={togglePrivacy}
            />,
            togglePrivacy,
          )}
          {row("Reset share-card defaults", "", chev, () => {
            dashStore.set((s) => ({ ...s, share: {} }))
            toast("Share defaults reset")
          })}
          <Copy size={12} muted style={{ paddingVertical: 12 }}>
            Money amounts are never allowed on share cards. The privacy check
            before sharing can't be turned off.
          </Copy>
        </Frame>
        <SectionHeading>Data & account</SectionHeading>
        <Frame style={{ paddingHorizontal: 12, paddingVertical: 4 }}>
          {row(
            "Account & security",
            "Email, password, export, sign out, delete account",
            chev,
            () => go("/me/account"),
          )}
        </Frame>
      </View>
    </Screen>
  )
}
