"use client"

import {
  Archive,
  ChevronRight,
  Plus,
  RotateCcw,
  Target,
  Trash2,
} from "lucide-react"
import { useEffect, useId, useRef, useState } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import {
  Bar,
  Btn,
  Card,
  Empty,
  NumberInput,
  Screen,
  Segmented,
} from "../ui/kit"
import type { Goal, MetricRef } from "./data"
import {
  areaLabel,
  type BookEntry,
  fmtGoal,
  useGoals,
  useMetricBook,
} from "./hooks"
import { MetricPickerSheet, useGoalMetricItems } from "./metric-picker"
import { archiveGoal, deleteGoal, restoreGoal, saveGoal } from "./store"
import { BottomSheet, Confirm, ErrorCard, Loading, useViewState } from "./ui"

// DSH-22 Goals · DSH-23 Goal editor. Goals only exist on goal-able metric slots.

const suggest = (e: BookEntry | undefined, cmp: "gte" | "lte") => {
  if (!e || e.n === null) return 0
  const raw = cmp === "gte" ? e.n * 1.1 : e.n * 0.9
  const v = e.unit === "%" || e.module === "life" ? Math.min(100, raw) : raw
  return v >= 10 ? Math.round(v) : Math.round(v * 10) / 10
}

export function GoalEditor({
  open,
  onClose,
  goal,
  metric,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  goal?: Goal
  metric?: MetricRef
  onSaved?: (g: Goal) => void
}) {
  const b = useMetricBook()
  const bRef = useRef(b)
  bRef.current = b
  const [ref, setRef] = useState<MetricRef>(goal?.metric ?? metric ?? "life")
  const [period, setPeriod] = useState<Goal["period"]>(goal?.period ?? "week")
  const entry = (period === "week" ? b.week : b.month).get(ref)
  const [cmp, setCmp] = useState<Goal["comparator"]>(goal?.comparator ?? "gte")
  const [target, setTarget] = useState<string>(goal ? String(goal.target) : "")
  const [confirmDel, setConfirmDel] = useState(false)

  // Re-prefill whenever the sheet opens for a different metric/goal.
  useEffect(() => {
    if (!open) return
    const r = goal?.metric ?? metric ?? "life"
    const p = goal?.period ?? "week"
    const e = (p === "week" ? bRef.current.week : bRef.current.month).get(r)
    const c = goal?.comparator ?? (e?.goodWhen === "down" ? "lte" : "gte")
    setRef(r)
    setPeriod(p)
    setCmp(c)
    setTarget(goal ? String(goal.target) : String(suggest(e, c)))
  }, [open, goal, metric])

  const uid = useId()
  const [picking, setPicking] = useState(false)
  const items = useGoalMetricItems(period)
  const current = items.find((i) => i.ref === ref)
  const pick = (r: MetricRef) => {
    const e = (period === "week" ? b.week : b.month).get(r)
    const c = e?.goodWhen === "down" ? "lte" : "gte"
    setRef(r)
    setCmp(c)
    setTarget(String(suggest(e, c)))
  }

  const n = Number(target)
  const valid = target.trim() !== "" && Number.isFinite(n) && !!entry
  const save = () => {
    if (!valid || !entry) return
    const g = saveGoal({
      id: goal?.id,
      metric: ref,
      label: entry.label,
      target: n,
      unit: entry.unit,
      comparator: cmp,
      period,
      via: goal?.via ?? "manual",
    })
    toast.success(goal ? "Goal updated" : "Goal set", {
      description: `${g.label} ${fmtGoal(g)}`,
    })
    onSaved?.(g)
    onClose()
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={goal ? "Edit goal" : "Set a goal"}
      description="Pick a metric, a target and a period. Progress shows on Today and Stats."
    >
      <div className="space-y-4">
        <div>
          <div
            id={`${uid}-metric`}
            className="mb-1.5 font-medium text-muted-foreground text-xs uppercase tracking-wider"
          >
            Metric
          </div>
          <button
            type="button"
            aria-labelledby={`${uid}-metric ${uid}-metric-value`}
            aria-haspopup="dialog"
            onClick={() => setPicking(true)}
            className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-border bg-card px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-muted/60"
          >
            <span id={`${uid}-metric-value`} className="min-w-0 flex-1">
              <span className="block truncate font-medium text-sm">
                {entry?.label ?? "Choose a metric"}
              </span>
              {entry && (
                <span className="block text-muted-foreground text-xs">
                  {current?.group ?? areaLabel(entry.module)} · now{" "}
                  <b className="num text-foreground">{entry.value}</b> this{" "}
                  {period}
                </span>
              )}
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Segmented
            value={cmp}
            onChange={setCmp}
            options={[
              { value: "gte", label: "At least ≥" },
              { value: "lte", label: "At most ≤" },
            ]}
          />
          <Segmented
            value={period}
            onChange={setPeriod}
            options={[
              { value: "week", label: "Week" },
              { value: "month", label: "Month" },
            ]}
          />
        </div>
        <div>
          <label
            htmlFor={`${uid}-target`}
            className="mb-1.5 block font-medium text-muted-foreground text-xs uppercase tracking-wider"
          >
            Target
          </label>
          <div className="flex items-center gap-2">
            <NumberInput
              id={`${uid}-target`}
              inputMode="decimal"
              value={target}
              onChange={(e) =>
                setTarget(e.target.value.replace(/[^0-9.]/g, ""))
              }
              className="font-display num h-12 min-w-0 flex-1 rounded-xl border border-border bg-card px-3 font-semibold text-xl outline-none focus:border-primary"
            />
            <span className="w-10 text-muted-foreground">
              {entry?.unit.trim() || "#"}
            </span>
          </div>
          <span className="mt-1 block text-muted-foreground text-xs">
            Suggested: last period {cmp === "gte" ? "+10%" : "−10%"}, rounded.
          </span>
        </div>
        <div className="flex gap-2">
          {goal && (
            <Btn
              variant="danger"
              onClick={() => setConfirmDel(true)}
              className="px-3"
            >
              <Trash2 className="size-4" />
            </Btn>
          )}
          <Btn variant="secondary" className="flex-1" onClick={onClose}>
            Cancel
          </Btn>
          <Btn className="flex-1" disabled={!valid} onClick={save}>
            Save goal
          </Btn>
        </div>
      </div>
      <MetricPickerSheet
        open={picking}
        onClose={() => setPicking(false)}
        title="Choose a metric"
        items={items}
        selected={ref}
        onPick={(i) => pick(i.ref)}
      />
      {goal && (
        <Confirm
          open={confirmDel}
          onClose={() => setConfirmDel(false)}
          title="Delete this goal?"
          body="Its progress history goes with it. Archive instead to keep it."
          confirm="Delete"
          danger
          onConfirm={() => {
            deleteGoal(goal.id)
            onClose()
            toast("Goal deleted")
          }}
        />
      )}
    </BottomSheet>
  )
}

export function GoalRow({
  g,
  onClick,
}: {
  g: ReturnType<typeof useGoals>[number]
  onClick?: () => void
}) {
  // Rendered as plain content when a parent link handles the tap (no nested controls).
  const Tag = onClick ? "button" : "div"
  return (
    <Tag
      {...(onClick ? { type: "button" as const, onClick } : {})}
      className="block w-full py-2.5 text-left active:opacity-70"
    >
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate font-medium text-sm">
          {g.goal.label}
          <span className="ml-1.5 text-muted-foreground text-xs">
            {fmtGoal(g.goal)}
          </span>
        </span>
        <span className={cn("num font-semibold text-sm", g.hit && "text-good")}>
          {g.entry?.value ?? "—"}
          {g.hit && " ✓"}
        </span>
      </div>
      <Bar value={Math.min(1, g.pct)} accent={g.hit ? "life" : "primary"} />
    </Tag>
  )
}

type Tab = "active" | "hit" | "archived"

export function GoalsScreen() {
  const state = useViewState()
  const goals = useGoals()
  const [tab, setTab] = useState<Tab>("active")
  const [editing, setEditing] = useState<Goal | null>(null)
  const [creating, setCreating] = useState(false)
  const list = goals.filter((g) =>
    tab === "archived"
      ? g.goal.status === "archived"
      : g.goal.status === "active" && (tab === "hit" ? g.hit : !g.hit),
  )
  const counts = {
    active: goals.filter((g) => g.goal.status === "active" && !g.hit).length,
    hit: goals.filter((g) => g.goal.status === "active" && g.hit).length,
    archived: goals.filter((g) => g.goal.status === "archived").length,
  }
  const empty = state === "empty" || goals.length === 0

  return (
    <Screen
      title="Goals"
      back
      actions={
        <button
          type="button"
          aria-label="New goal"
          onClick={() => setCreating(true)}
          className="grid size-11 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring bg-primary text-background"
        >
          <Plus className="size-5" />
        </button>
      }
    >
      {state === "loading" ? (
        <Loading rows={3} />
      ) : state === "error" ? (
        <ErrorCard what="goals" />
      ) : empty ? (
        <Empty
          icon={<Target className="size-8" />}
          title="No goals yet"
          body="Any number on Stats can become a target — tap one and hit Set goal."
          action={
            <Btn onClick={() => setCreating(true)}>Set your first goal</Btn>
          }
        />
      ) : (
        <>
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: "active", label: `In play · ${counts.active}` },
              { value: "hit", label: `Hit · ${counts.hit}` },
              { value: "archived", label: `Archived · ${counts.archived}` },
            ]}
          />
          {list.length === 0 ? (
            <Empty
              title={
                tab === "hit"
                  ? "Nothing hit yet this period"
                  : tab === "archived"
                    ? "Nothing archived"
                    : "Every active goal is hit"
              }
              body={
                tab === "active" ? "Raise the bar or set a new one." : undefined
              }
            />
          ) : (
            <Card className="mt-3 px-3 py-1">
              {list.map((g) => (
                <div
                  key={g.goal.id}
                  className="flex items-center gap-2 border-border/50 border-b last:border-0"
                >
                  <div className="min-w-0 flex-1">
                    <GoalRow g={g} onClick={() => setEditing(g.goal)} />
                  </div>
                  {g.goal.status === "active" ? (
                    <button
                      type="button"
                      aria-label="Archive goal"
                      onClick={() => {
                        archiveGoal(g.goal.id)
                        toast("Goal archived", {
                          action: {
                            label: "Undo",
                            onClick: () => restoreGoal(g.goal.id),
                          },
                        })
                      }}
                      className="grid size-11 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring text-muted-foreground hover:bg-muted"
                    >
                      <Archive className="size-4" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      aria-label="Restore goal"
                      onClick={() => restoreGoal(g.goal.id)}
                      className="grid size-11 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring text-muted-foreground hover:bg-muted"
                    >
                      <RotateCcw className="size-4" />
                    </button>
                  )}
                </div>
              ))}
            </Card>
          )}
          <p className="mt-4 flex items-center gap-1 px-1 text-muted-foreground text-xs">
            Goals roll over each period. Tap a goal to edit
            <ChevronRight className="size-3" />
          </p>
        </>
      )}
      <GoalEditor
        open={creating || !!editing}
        goal={editing ?? undefined}
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
      />
    </Screen>
  )
}
