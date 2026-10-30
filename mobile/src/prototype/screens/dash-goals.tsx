import type { Goal, MetricRef } from "@domain/dash/data"
import {
  areaLabel,
  type BookEntry,
  fmtGoal,
  useGoals,
  useMetricBook,
} from "@domain/dash/hooks"
import {
  archiveGoal,
  deleteGoal,
  restoreGoal,
  saveGoal,
} from "@domain/dash/store"
import { useLocalSearchParams } from "expo-router"
import {
  Archive,
  ChevronRight,
  Plus,
  RotateCcw,
  Target,
  Trash2,
} from "lucide-react-native"
import { useState } from "react"
import { ScrollView, TextInput, View } from "react-native"
import { toast } from "sonner-native"
import { MoneyInput } from "../money-input"
import {
  Bar,
  border,
  Copy,
  Frame,
  IconTap,
  Line,
  Segmented,
  Tap,
} from "../native-kit"
import { fonts, useTheme } from "../theme"
import { Button, confirm, Screen, Sheet } from "../ui"

const suggest = (e: BookEntry | undefined, cmp: "gte" | "lte") => {
  if (!e || e.n === null) return 0
  const raw = e.n * (cmp === "gte" ? 1.1 : 0.9),
    v = e.unit === "%" || e.module === "life" ? Math.min(100, raw) : raw
  return v >= 10 ? Math.round(v) : Math.round(v * 10) / 10
}
export function GoalEditor({
  goal,
  metric,
  onClose,
}: {
  goal?: Goal
  metric?: MetricRef
  onClose: () => void
}) {
  const t = useTheme(),
    b = useMetricBook(),
    [ref, setRef] = useState(goal?.metric ?? metric ?? "life"),
    [period, setPeriod] = useState<Goal["period"]>(goal?.period ?? "week"),
    entry = (period === "week" ? b.week : b.month).get(ref),
    [cmp, setCmp] = useState<Goal["comparator"]>(
      goal?.comparator ?? (entry?.goodWhen === "down" ? "lte" : "gte"),
    ),
    [target, setTarget] = useState(String(goal?.target ?? suggest(entry, cmp))),
    [picking, setPicking] = useState(false),
    [search, setSearch] = useState(""),
    valid = target.trim() !== "" && Number.isFinite(Number(target)) && !!entry
  const items = [...(period === "week" ? b.week : b.month).values()].filter(
    (e) =>
      e.n !== null &&
      `${e.label} ${areaLabel(e.module)}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  )
  return (
    <>
      <Sheet open title={goal ? "Edit goal" : "Set a goal"} onClose={onClose}>
        <Copy size={14} muted>
          Pick a metric, a target and a period. Progress shows on Today and
          Stats.
        </Copy>
        <View style={{ gap: 16 }}>
          <View style={{ gap: 6 }}>
            <Copy size={12} muted>
              METRIC
            </Copy>
            <Tap onPress={() => setPicking(true)}>
              <Frame
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  minHeight: 56,
                }}
              >
                <Line>
                  <View style={{ flex: 1 }}>
                    <Copy size={14} weight="medium">
                      {entry?.label ?? "Choose a metric"}
                    </Copy>
                    {entry && (
                      <Copy size={12} muted>
                        {areaLabel(entry.module)} · now{" "}
                        <Copy size={12}>{entry.value}</Copy> this {period}
                      </Copy>
                    )}
                  </View>
                  <ChevronRight size={16} color={t.muted} />
                </Line>
              </Frame>
            </Tap>
          </View>
          <Line style={{ gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Segmented
                value={cmp}
                onChange={setCmp}
                options={[
                  { value: "gte", label: "At least ≥" },
                  { value: "lte", label: "At most ≤" },
                ]}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Segmented
                value={period}
                onChange={setPeriod}
                options={[
                  { value: "week", label: "Week" },
                  { value: "month", label: "Month" },
                ]}
              />
            </View>
          </Line>
          <View style={{ gap: 6 }}>
            <Copy size={12} muted>
              TARGET
            </Copy>
            <Line style={{ gap: 8 }}>
              <MoneyInput
                bare
                label="Target"
                value={target}
                onChange={setTarget}
                style={{
                  height: 48,
                  flex: 1,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: t.line,
                  backgroundColor: t.card,
                  paddingHorizontal: 12,
                  fontSize: 20,
                  fontFamily: fonts.displayMedium,
                  color: t.text,
                }}
              />
              <Copy muted style={{ width: 40 }}>
                {entry?.unit.trim() || "#"}
              </Copy>
            </Line>
            <Copy size={12} muted>
              Suggested: last period {cmp === "gte" ? "+10%" : "−10%"}, rounded.
            </Copy>
          </View>
          <Line style={{ gap: 8 }}>
            {goal && (
              <IconTap
                size={44}
                icon={Trash2}
                label="Delete goal"
                color={t.bad}
                onPress={() =>
                  confirm(
                    "Delete this goal?",
                    "Its progress history goes with it. Archive instead to keep it.",
                    () => {
                      deleteGoal(goal.id)
                      onClose()
                      toast("Goal deleted")
                    },
                  )
                }
              />
            )}
            <View style={{ flex: 1 }}>
              <Button tone="quiet" onPress={onClose}>
                Cancel
              </Button>
            </View>
            <View style={{ flex: 1 }}>
              <Button
                disabled={!valid}
                onPress={() => {
                  if (!entry || !valid) return
                  const g = saveGoal({
                    id: goal?.id,
                    metric: ref,
                    label: entry.label,
                    target: Number(target),
                    unit: entry.unit,
                    comparator: cmp,
                    period,
                    via: goal?.via ?? "manual",
                  })
                  toast.success(goal ? "Goal updated" : "Goal set", {
                    description: `${g.label} ${fmtGoal(g)}`,
                  })
                  onClose()
                }}
              >
                Save goal
              </Button>
            </View>
          </Line>
        </View>
      </Sheet>
      <Sheet
        open={picking}
        title="Choose a metric"
        onClose={() => setPicking(false)}
      >
        <TextInput
          accessibilityLabel="Search metrics"
          value={search}
          onChangeText={setSearch}
          placeholder="Search metrics"
          placeholderTextColor={t.muted}
          style={{
            height: 44,
            paddingHorizontal: 12,
            borderRadius: 12,
            backgroundColor: t.soft,
            fontFamily: fonts.body,
            color: t.text,
          }}
        />
        <ScrollView style={{ maxHeight: 440 }}>
          {items.map((e) => (
            <Tap
              key={e.ref}
              onPress={() => {
                const c = e.goodWhen === "down" ? "lte" : "gte"
                setRef(e.ref)
                setCmp(c)
                setTarget(String(suggest(e, c)))
                setPicking(false)
              }}
              style={{
                paddingVertical: 12,
                borderBottomWidth: 1,
                borderBottomColor: t.line,
              }}
            >
              <Line>
                <View style={{ flex: 1 }}>
                  <Copy size={14} weight="medium">
                    {e.label}
                  </Copy>
                  <Copy size={12} muted>
                    {areaLabel(e.module)}
                  </Copy>
                </View>
                <Copy size={14}>{e.value}</Copy>
              </Line>
            </Tap>
          ))}
        </ScrollView>
      </Sheet>
    </>
  )
}
export function Goals() {
  const t = useTheme(),
    goals = useGoals(),
    params = useLocalSearchParams<{ new?: string; metric?: string }>(),
    [tab, setTab] = useState("active"),
    [editing, setEditing] = useState<Goal>(),
    [creating, setCreating] = useState(params.new === "1"),
    list = goals.filter((g) =>
      tab === "archived"
        ? g.goal.status === "archived"
        : g.goal.status === "active" && (tab === "hit" ? g.hit : !g.hit),
    ),
    count = (v: string) =>
      goals.filter((g) =>
        v === "archived"
          ? g.goal.status === "archived"
          : g.goal.status === "active" && (v === "hit" ? g.hit : !g.hit),
      ).length
  return (
    <Screen
      title="Goals"
      actions={
        <IconTap
          size={44}
          icon={Plus}
          label="New goal"
          background={t.primary}
          color={t.onPrimary}
          onPress={() => setCreating(true)}
        />
      }
    >
      {!!goals.length && (
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "active", label: `In play · ${count("active")}` },
            { value: "hit", label: `Hit · ${count("hit")}` },
            { value: "archived", label: `Archived · ${count("archived")}` },
          ]}
        />
      )}
      {list.length ? (
        <Frame style={{ paddingHorizontal: 12, paddingVertical: 4 }}>
          {list.map((g, i) => (
            <Line
              key={g.goal.id}
              style={{
                gap: 8,
                borderBottomWidth: i < list.length - 1 ? 1 : 0,
                borderBottomColor: border(t.line, 0.5),
              }}
            >
              <Tap
                onPress={() => setEditing(g.goal)}
                style={{ flex: 1, paddingVertical: 10 }}
              >
                <Line
                  style={{ gap: 8, alignItems: "baseline", marginBottom: 6 }}
                >
                  <Copy size={14} weight="medium" lines={1} style={{ flex: 1 }}>
                    {g.goal.label}{" "}
                    <Copy size={12} muted>
                      {fmtGoal(g.goal)}
                    </Copy>
                  </Copy>
                  <Copy
                    size={14}
                    weight="semibold"
                    style={{ color: g.hit ? t.good : t.text }}
                  >
                    {g.entry?.value ?? "—"}
                    {g.hit ? " ✓" : ""}
                  </Copy>
                </Line>
                <Bar
                  value={Math.min(1, g.pct)}
                  color={g.hit ? t.life : t.primary}
                />
              </Tap>
              <IconTap
                size={44}
                icon={g.goal.status === "active" ? Archive : RotateCcw}
                label={
                  g.goal.status === "active" ? "Archive goal" : "Restore goal"
                }
                onPress={() => {
                  if (g.goal.status === "active") {
                    archiveGoal(g.goal.id)
                    toast("Goal archived", {
                      action: {
                        label: "Undo",
                        onClick: () => restoreGoal(g.goal.id),
                      },
                    })
                  } else restoreGoal(g.goal.id)
                }}
              />
            </Line>
          ))}
        </Frame>
      ) : (
        <View style={{ padding: 28, alignItems: "center", gap: 12 }}>
          {!goals.length && <Target size={32} color={t.primary} />}
          <Copy weight="semibold">
            {!goals.length
              ? "No goals yet"
              : tab === "hit"
                ? "Nothing hit yet this period"
                : tab === "archived"
                  ? "Nothing archived"
                  : "Every active goal is hit"}
          </Copy>
          <Copy size={14} muted>
            {!goals.length
              ? "Any number on Stats can become a target — tap one and hit Set goal."
              : tab === "active"
                ? "Raise the bar or set a new one."
                : ""}
          </Copy>
          {!goals.length && (
            <Button onPress={() => setCreating(true)}>
              Set your first goal
            </Button>
          )}
        </View>
      )}
      {!!goals.length && (
        <Copy size={12} muted style={{ marginTop: 4, paddingHorizontal: 4 }}>
          Goals roll over each period. Tap a goal to edit ›
        </Copy>
      )}
      {(creating || editing) && (
        <GoalEditor
          goal={editing}
          metric={params.metric}
          onClose={() => {
            setCreating(false)
            setEditing(undefined)
          }}
        />
      )}
    </Screen>
  )
}
