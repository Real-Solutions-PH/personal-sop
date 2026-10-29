// Settings → Screen time (spec 2026-10-29-screen-time-design, "Mobile
// surfaces"): the permission, the groups of apps with their daily budgets,
// and the All apps group. Without Screen Time on this phone (simulator,
// Expo Go off iOS, a build made without it) the same screen shows dimmed
// under one card that says why.

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
import { useEffect, useState } from "react"
import { View } from "react-native"
import { toast } from "sonner-native"
import { Stepper } from "../fitness-controls"
import { Copy, Frame, Line } from "../native-kit"
import { back } from "../navigation"
import {
  refreshScreenStatus,
  screenStatus,
  syncScreenTime,
} from "../screen-sync"
import {
  pickApps,
  requestScreenTime,
  screenTimeAvailable,
} from "../screen-time"
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
    available = screenTimeAvailable(),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    live = s.groups
      .filter((g) => !g.archivedAt)
      .sort((a, b) => a.sortOrder - b.sortOrder),
    all = live.find((g) => g.kind === "all"),
    custom = live.filter((g) => g.kind === "custom"),
    approved = status.auth === "approved"
  useEffect(() => {
    void refreshScreenStatus()
  }, [])
  // Any change to groups or budgets reaches the schedule.
  const changed = () => void syncScreenTime()
  const connect = async () => {
    setBusy(true)
    try {
      await requestScreenTime()
      await refreshScreenStatus()
      changed()
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
  const statusLine =
    status.auth === "approved"
      ? "Connected. Minutes are counted on this iPhone."
      : status.auth === "denied"
        ? "Screen Time access is turned off for Unfurl."
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
        {status.auth === "denied" ? (
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
          !approved && (
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
        locked={!available || status.auth === "unavailable"}
        title="Screen Time isn't available here"
        detail="This build can't read Screen Time. It needs the iPhone app with Screen Time turned on."
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
