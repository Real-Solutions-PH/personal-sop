import * as D from "@domain/dash/hooks"
import { dashStore } from "@domain/dash/store"
import { startFresh } from "@domain/finance/actions"
import { fitStore } from "@domain/fitness/store"
import { habitsStore } from "@domain/habits/store"
import { DAY_START_HOUR } from "@domain/lib/day"
import { privacyStore, togglePrivacy } from "@domain/lib/privacy"
import { resetAll } from "@domain/lib/store"
import { tasksStore } from "@domain/tasks/store"
import { LinearGradient } from "expo-linear-gradient"
import {
  Bell,
  BookOpen,
  Bot,
  Brain,
  CalendarRange,
  ChartColumn,
  CheckSquare,
  Clock,
  CloudUpload,
  Dumbbell,
  Eye,
  Flame,
  LayoutGrid,
  ListChecks,
  LogOut,
  Pencil,
  RotateCcw,
  Scale,
  Share2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  SunMoon,
  Target,
  Trophy,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react-native"
import { Platform, View } from "react-native"
import { toast } from "sonner-native"
import { liveMode } from "@/live/config"
import { AppLauncher } from "../app-launcher"
import { memoryCount } from "../companion/memory-labels"
import { companionStore } from "../companion/store"
import {
  Bar,
  Copy,
  Frame,
  IconTap,
  Line,
  LinkRow,
  SectionHeading,
  SmallButton,
  Tap,
} from "../native-kit"
import { go, replace } from "../navigation"
import { ProfileAvatar } from "../profile-avatar"
import { enableReminders } from "../reminders"
import { sessionStore, signOut } from "../session"
import { Switch } from "../switch"
import { fonts, useTheme } from "../theme"
import { confirm, Screen } from "../ui"
export function Me() {
  const t = useTheme(),
    s = dashStore.use((s) => s),
    p = s.profile,
    goals = D.useGoals(),
    score = D.useLifeScore(30),
    target = D.useOnTarget(30),
    hidden = privacyStore.use((s) => s.hidden),
    account = sessionStore.use((s) => s.user?.email),
    companionName = companionStore.use((s) => s.name),
    memories = companionStore.use((s) => s.memories)
  const fresh = () =>
    confirm(
      "Start as a new user?",
      "Every section is emptied for first-time setup. Reset demo data brings the samples back.",
      () => {
        startFresh()
        habitsStore.set((s) => ({
          ...s,
          habits: [],
          logs: [],
          routines: [],
          runs: [],
          timer: null,
        }))
        tasksStore.set((s) => ({ ...s, tasks: [], events: [] }))
        fitStore.set((s) => ({
          ...s,
          templates: [],
          workouts: [],
          weighIns: [],
          meals: [],
          activeId: null,
          rest: null,
        }))
        dashStore.set((s) => ({
          ...s,
          goals: [],
          reviews: {},
          notifs: [],
          missNotes: {},
          wrapups: {},
          onboarded: false,
          setupSkipped: [],
          setupHidden: false,
          profile: { ...s.profile, identities: [] },
        }))
        go("/onboarding")
      },
    )
  return (
    <Screen
      root
      prototypeLayout
      title="Me"
      actions={
        <IconTap
          size={44}
          icon={Pencil}
          label="Edit profile"
          color={t.text}
          onPress={() => go("/me/profile")}
        />
      }
    >
      <View>
        <Frame>
          <LinearGradient
            colors={[`${t.hab}26`, `${t.hab}00`, `${t.fit}1a`]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ padding: 16 }}
          >
            <Line style={{ gap: 16 }}>
              <ProfileAvatar size={72} />
              <View style={{ flex: 1 }}>
                <Copy
                  size={20}
                  weight="display"
                  style={{ letterSpacing: -0.5 }}
                >
                  {p.name}
                </Copy>
                <Copy size={14} muted>
                  {p.handle}
                </Copy>
                <Line style={{ gap: 12, marginTop: 4 }}>
                  <Copy size={12}>
                    <Copy size={12} weight="semibold">
                      {score.score ?? "—"}
                    </Copy>
                    <Copy size={12} muted>
                      {" "}
                      Life Score
                    </Copy>
                  </Copy>
                  <Line style={{ gap: 2 }}>
                    <Flame size={12} color={t.life} />
                    <Copy size={12} weight="semibold">
                      {target.current}
                      <Copy size={12} muted>
                        {" "}
                        streak
                      </Copy>
                    </Copy>
                  </Line>
                </Line>
              </View>
            </Line>
            {p.identities.length > 0 && (
              <View style={{ marginTop: 12, gap: 8 }}>
                {p.identities.map((i) => {
                  const g = goals.find((g) => g.goal.id === i.goalId)
                  return (
                    <Tap
                      key={i.id}
                      onPress={() => go(g ? "/stats/goals" : "/me/profile")}
                      style={{
                        padding: 10,
                        borderRadius: 12,
                        backgroundColor: `${t.bg}99`,
                      }}
                    >
                      <Copy size={14}>“{i.text}”</Copy>
                      {g ? (
                        <Line style={{ marginTop: 6, gap: 8 }}>
                          <Bar
                            value={g.pct}
                            color={g.hit ? t.life : t.primary}
                          />
                          <Copy
                            size={11}
                            weight="display"
                            muted
                            style={{ fontFamily: fonts.displayRegular }}
                          >
                            {g.entry?.value ?? "—"} {D.fmtGoal(g.goal)}
                          </Copy>
                        </Line>
                      ) : (
                        <Copy
                          size={11}
                          style={{ marginTop: 4, color: t.primary }}
                        >
                          Link a goal →
                        </Copy>
                      )}
                    </Tap>
                  )
                })}
              </View>
            )}
          </LinearGradient>
        </Frame>
        <View style={{ marginTop: 12 }}>
          <AppLauncher title="Apps" />
        </View>
        {(Platform.OS === "web" || s.push.permission !== "granted") && (
          <Frame
            style={{
              marginTop: 12,
              padding: 16,
              borderColor: `${t.primary}4d`,
              backgroundColor: `${t.primary}0d`,
            }}
          >
            <Line>
              <Smartphone size={20} color={t.primary} />
              <View style={{ flex: 1 }}>
                <Copy size={14} weight="medium">
                  {Platform.OS === "web"
                    ? "Not installed"
                    : "Reminders are off"}
                </Copy>
                <Copy size={12} muted>
                  {Platform.OS === "web"
                    ? "Install for full-screen and reminders."
                    : `Notifications: ${s.push.permission}`}
                </Copy>
              </View>
              <SmallButton
                accent="primary"
                onPress={() =>
                  Platform.OS === "web"
                    ? go("/onboarding?step=install")
                    : void enableReminders()
                }
              >
                Fix
              </SmallButton>
            </Line>
          </Frame>
        )}
        <SectionHeading>Progress</SectionHeading>
        <Frame style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
          <LinkRow
            title="Stats"
            detail="Life score, trends and reviews"
            icon={ChartColumn}
            accent="life"
            href="/stats"
          />
          <LinkRow
            title="Social profile"
            detail="Your streaks, goals and progress posts"
            icon={Users}
            accent="primary"
            href="/social/u/me"
          />
          <LinkRow
            title="Goals"
            detail={`${goals.filter((g) => g.goal.status === "active").length} active`}
            icon={Target}
            accent="primary"
            href="/stats/goals"
          />
          <LinkRow
            title="Trophy case"
            icon={Trophy}
            accent="life"
            href="/stats/trophies"
          />
          <LinkRow
            title="Reviews"
            detail="Weekly & monthly"
            icon={CalendarRange}
            accent="hab"
            href="/stats/reviews"
          />
          <LinkRow
            title="Share a card"
            detail="Story or post, no amounts ever"
            icon={Share2}
            accent="fit"
            href="/stats/share"
          />
          <LinkRow
            title="Journal"
            detail="Wrap-up & review reflections"
            icon={BookOpen}
            accent="tsk"
            href="/journal"
          />
        </Frame>
        <SectionHeading>Setup</SectionHeading>
        <Frame style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
          <LinkRow
            title="Sections & settings"
            icon={LayoutGrid}
            href="/me/settings"
          />
          <LinkRow
            title="Life Score weights"
            icon={Scale}
            href="/me/settings"
          />
          <LinkRow
            title="Notifications"
            detail={
              s.push.permission === "granted"
                ? "On"
                : s.push.permission === "denied"
                  ? "Blocked"
                  : "Not set up"
            }
            icon={Bell}
            href="/me/settings"
          />
          <LinkRow
            title="Day & time"
            detail={`Day starts ${String(DAY_START_HOUR).padStart(2, "0")}:00 · Evening ${s.eveningStart} · Asia/Manila`}
            icon={Clock}
            href="/me/settings"
          />
          <LinkRow
            title="Appearance"
            detail={`Follows system · ${t.dark ? "dark" : "light"} now`}
            icon={SunMoon}
            href="/me/settings"
          />
          <LinkRow title="AI & connector" icon={Bot} href="/capture/settings" />
          {liveMode && (
            <LinkRow
              title="Re-upload this phone's data"
              detail="Sends everything on this phone to the server again"
              icon={CloudUpload}
              onPress={() =>
                confirm(
                  "Re-upload this phone's data?",
                  "Use this if the server lost your data. Everything saved on this phone is sent to the server again; nothing on the phone changes.",
                  () => {
                    const live =
                      require("@/live/runtime") as typeof import("@/live/runtime")
                    const n = live.reuploadAll()
                    if (n === null) toast.error("Not signed in to the server")
                    else toast.success(`Sending ${n} items to the server…`)
                  },
                )
              }
            />
          )}
          <LinkRow
            title={`What ${companionName} remembers`}
            detail={memoryCount(memories.length)}
            icon={Brain}
            accent="hab"
            href="/me/memories"
          />
          <LinkRow
            title="Privacy mode"
            detail="Blur every money amount"
            icon={Eye}
            onPress={togglePrivacy}
            right={
              <Switch
                label="Privacy mode"
                value={hidden}
                onChange={togglePrivacy}
                accent="primary"
              />
            }
          />
        </Frame>
        <SectionHeading>Sections</SectionHeading>
        <Frame style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
          <LinkRow
            title="Habits"
            detail="Habits · Routines · Habit settings"
            icon={Target}
            accent="hab"
            href="/habits/settings"
          />
          <LinkRow
            title="Tasks"
            detail="Lists · Task settings"
            icon={CheckSquare}
            accent="tsk"
            href="/tasks/settings"
          />
          <LinkRow
            title="Fitness"
            detail="Exercises · Macro targets · Fitness settings"
            icon={Dumbbell}
            accent="fit"
            href="/fitness/settings"
          />
          <LinkRow
            title="Finance"
            detail="Accounts · Categories · Budgets · Finance settings"
            icon={Wallet}
            accent="fin"
            href="/finance/settings"
          />
        </Frame>
        <SectionHeading>App</SectionHeading>
        <Frame style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
          <LinkRow
            title="Account & security"
            detail="Email, password, export, delete account"
            icon={ShieldCheck}
            href="/me/account"
          />
          <LinkRow title="Run setup again" icon={Sparkles} href="/onboarding" />
          <LinkRow
            title="Set up my data"
            detail="Accounts, habits, training, tasks — pick up where you left off"
            icon={ListChecks}
            href="/setup"
          />
          {/* Demo-only: a live account's data is real and synced, so it is
              never replaced by samples or wiped from here. */}
          {!liveMode && (
            <>
              <LinkRow
                title="Start as a new user"
                detail="Demo: empty every section and run first-time setup"
                icon={UserPlus}
                onPress={fresh}
              />
              <LinkRow
                title="Reset demo data"
                detail="Restores every section's sample data"
                icon={RotateCcw}
                onPress={() =>
                  confirm(
                    "Reset all demo data?",
                    "Every section goes back to its sample data. Anything you logged in this walkthrough is gone.",
                    () => {
                      resetAll()
                      toast.success("Demo data reset")
                      go("/today")
                    },
                  )
                }
              />
            </>
          )}
          <LinkRow
            title="Sign out"
            detail={account ? `Signed in as ${account}` : undefined}
            icon={LogOut}
            onPress={() =>
              confirm(
                "Sign out?",
                liveMode
                  ? "Anything not yet synced is sent first, then this device is cleared. Sign back in any time."
                  : "Your data stays on this device. Sign back in any time.",
                () => {
                  signOut()
                  replace("/welcome")
                  toast.success("Signed out")
                },
              )
            }
          />
        </Frame>
        <Copy size={12} muted style={{ textAlign: "center", marginTop: 16 }}>
          {liveMode ? "Unfurl" : "Unfurl · prototype build"}
        </Copy>
      </View>
    </Screen>
  )
}
