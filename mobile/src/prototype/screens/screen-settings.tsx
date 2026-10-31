// Settings → Screen time (spec 2026-10-29-screen-time-design, "Mobile
// surfaces"): the permission, the groups of apps with their daily budgets,
// and the All apps group. Without Screen Time here (a build made without
// it, which no phone setting can fix, or an iOS too old for it) the same
// screen shows dimmed under one card that says which.

import {
  addGroup,
  archiveGroup,
  ensureAllGroup,
  habitsUsing,
  updateGroup,
} from "@domain/screen/actions"
import { DEFAULT_BUDGET_MIN, type ScreenGroup } from "@domain/screen/data"
import { screenStore, useScreen } from "@domain/screen/store"
import { Smartphone } from "lucide-react-native"
import { useState } from "react"
import { View } from "react-native"
import { toast } from "sonner-native"
import { Stepper } from "../fitness-controls"
import { Copy, Frame, Line } from "../native-kit"
import { back } from "../navigation"
import {
  enableScreenTime,
  refreshScreenStatus,
  SCREEN_NOT_IN_BUILD,
  SCREEN_UNSUPPORTED,
  screenStatus,
  syncScreenTime,
  useScreenTimeState,
} from "../screen-sync"
import { pickApps } from "../screen-time"
import { Switch } from "../switch"
import { useTheme } from "../theme"
import { Button, confirm, Field, Screen } from "../ui"
import { LockedPreview } from "./locked-preview"

/** Custom groups a person can keep, besides All apps (Apple's cap is 20
 * monitored activities; 6 + 1 leaves room). */
export const MAX_CUSTOM_GROUPS = 6

export function ScreenSettings() {
  const t = useTheme(),
    s = useScreen(),
    status = screenStatus(),
    state = useScreenTimeState(),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    live = s.groups
      .filter((g) => !g.archivedAt)
      .sort((a, b) => a.sortOrder - b.sortOrder),
    all = live.find((g) => g.kind === "all"),
    custom = live.filter((g) => g.kind === "custom"),
    approved = state === "connected",
    locked =
      state === "notInBuild"
        ? SCREEN_NOT_IN_BUILD
        : state === "unsupported"
          ? SCREEN_UNSUPPORTED
          : null
  // Any change to groups or budgets reaches the schedule.
  const changed = () => void syncScreenTime()
  const connect = async () => {
    setBusy(true)
    try {
      // Turns the section on too once iOS approves, so the minutes start.
      await enableScreenTime()
    } finally {
      setBusy(false)
    }
  }
  const pick = async (g: ScreenGroup) => {
    const saved = await pickApps(g.id)
    await refreshScreenStatus()
    if (saved) changed()
  }
  const archive = (g: ScreenGroup) => {
    const using = habitsUsing(g.id)
    if (using.length) {
      toast.error("Change or archive these habits first", {
        description: using.map((h) => h.name).join(", "),
      })
      return false
    }
    archiveGroup(g.id)
    changed()
    return true
  }
  const setAll = (on: boolean) => {
    if (!on) {
      if (all) archive(all)
      return
    }
    const id = ensureAllGroup()
    // The one All apps group comes back rather than a second being made.
    screenStore.set((x) => ({
      ...x,
      groups: x.groups.map((g) =>
        g.id === id && g.archivedAt ? { ...g, archivedAt: undefined } : g,
      ),
    }))
    changed()
  }
  const add = () => {
    const n = name.trim()
    if (!n || custom.length >= MAX_CUSTOM_GROUPS) return
    addGroup(n, DEFAULT_BUDGET_MIN)
    setName("")
    changed()
  }
  const statusLine = approved
    ? "Connected. Minutes are counted on this iPhone."
    : state === "denied"
      ? "Screen Time access is turned off for Unfurl."
      : state === "checking"
        ? "Checking Screen Time access…"
        : "Not connected yet."
  const body = (
    <View style={{ gap: 16 }}>
      <Frame style={{ padding: 16, gap: 10 }}>
        <Line style={{ gap: 10 }}>
          <Smartphone size={18} color={t.scr} />
          <Copy weight="semibold" style={{ flex: 1 }}>
            Screen Time
          </Copy>
        </Line>
        <Copy size={14} muted>
          {statusLine}
        </Copy>
        {state === "denied" ? (
          <>
            <Copy size={14} muted>
              Unfurl needs Screen Time access to count minutes and complete
              screen-time habits. Allow it when asked, or turn it on in Settings
              › Screen Time.
            </Copy>
            <Button onPress={connect} disabled={busy}>
              Try again
            </Button>
          </>
        ) : (
          state === "notAsked" && (
            <Button onPress={connect} disabled={busy}>
              Connect Screen Time
            </Button>
          )
        )}
        <Copy size={12} muted>
          iOS reports use in steps (1, 5, 10, 15 minutes, then every 15), so
          every figure is at least that many minutes. Best effort: a day iOS
          doesn't report shows as Not tracked.
        </Copy>
      </Frame>
      <Frame style={{ padding: 16, gap: 12 }}>
        <Line>
          <View style={{ flex: 1 }}>
            <Copy weight="medium">All apps</Copy>
            <Copy size={12} muted>
              Counts all use of this iPhone
            </Copy>
          </View>
          <Switch
            label="Count all apps"
            value={!!all}
            onChange={setAll}
            accent="scr"
          />
        </Line>
        {all && <BudgetRow group={all} />}
      </Frame>
      {custom.map((g) => (
        <Frame key={g.id} style={{ padding: 16, gap: 12 }}>
          <Line>
            <View style={{ flex: 1 }}>
              <Copy weight="medium">{g.name}</Copy>
              <Copy size={12} muted>
                {approved && status.picked[g.id]
                  ? "Apps picked on this iPhone"
                  : "No apps picked on this iPhone"}
              </Copy>
            </View>
            <Button
              small
              tone="quiet"
              onPress={() =>
                confirm(
                  `Remove ${g.name}?`,
                  "Its past days are kept in your stats.",
                  () => archive(g),
                  "Remove",
                )
              }
            >
              Remove
            </Button>
          </Line>
          <BudgetRow group={g} />
          <Button
            tone="quiet"
            disabled={!approved}
            onPress={() => void pick(g)}
          >
            {approved && status.picked[g.id] === false && hasHistory(s, g)
              ? "Pick apps again"
              : "Pick apps"}
          </Button>
        </Frame>
      ))}
      <Frame style={{ padding: 16, gap: 8 }}>
        <Copy weight="medium">Add a group</Copy>
        <Field
          label="Group name"
          value={name}
          onChangeText={setName}
          placeholder="e.g. Social, Games"
          maxLength={40}
        />
        <Button
          tone="quiet"
          disabled={!name.trim() || custom.length >= MAX_CUSTOM_GROUPS}
          onPress={add}
        >
          Add group
        </Button>
        <Copy size={12} muted>
          {custom.length >= MAX_CUSTOM_GROUPS
            ? `Up to ${MAX_CUSTOM_GROUPS} groups. Remove one to add another.`
            : "Name it, then pick its apps and categories in the iOS picker."}
        </Copy>
      </Frame>
    </View>
  )
  return (
    <Screen prototypeLayout title="Screen time">
      <LockedPreview
        locked={!!locked}
        title={locked?.title ?? ""}
        detail={locked?.detail ?? ""}
        action={{ label: "Back", onPress: () => back() }}
        color={t.scr}
        icon={Smartphone}
      >
        {body}
      </LockedPreview>
    </Screen>
  )
}

/** Whether the group already has days on record (so it was picked on some
 * phone before, and a missing pick here means it needs picking again). */
const hasHistory = (
  s: { days: { groupId: string }[] },
  g: ScreenGroup,
): boolean => s.days.some((d) => d.groupId === g.id)

/** A budget scores the Screen time area; it doesn't change what's
 * monitored, so it needs no reschedule. */
function BudgetRow({ group }: { group: ScreenGroup }) {
  return (
    <Stepper
      label={`${group.name} daily budget`}
      unit="min"
      value={group.budgetMin}
      onChange={(v) => {
        updateGroup(group.id, {
          budgetMin: Math.min(1440, Math.max(0, Math.round(v))),
        })
      }}
      step={15}
      min={0}
      max={1440}
      decimals={0}
    />
  )
}
