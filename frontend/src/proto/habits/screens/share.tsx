"use client"

import { Check, Flame, Trophy } from "lucide-react"
import { useSearchParams } from "next/navigation"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import { dayKey, dayOffset, fmtDuration } from "../../lib/day"
import { Card, Chip, Screen, SectionTitle, Segmented } from "../../ui/kit"
import {
  BackdropPicker,
  CardFoot,
  CardTitle,
  CardTop,
  compact,
  Delta,
  type Dot,
  DotGrid,
  FORMAT_LABEL,
  FORMAT_PX,
  type Format,
  Hero,
  Label,
  LayoutCarousel,
  Medal,
  Meter,
  Ring,
  ShareFrame,
  ShareTargets,
  StatGrid,
  useCardLook,
  verdict,
} from "../../ui/share"
import {
  cellFor,
  daysBetween,
  habitStats,
  logIndex,
  overallStats,
  pct,
  runActualSec,
  sortedHabits,
  streaks,
} from "../logic"
import { habitsStore } from "../store"
import { fmtDay, Gate, Toggle } from "../ui"

type Template = "streak" | "month" | "routine" | "scoreboard"

const toDot = (c: string): Dot =>
  c === "done"
    ? "hit"
    : c === "partial"
      ? "part"
      : c === "missed"
        ? "miss"
        : "none"

/** HAB-23 Share card preview. Never shows ₱ (X-5). */
export function ShareScreen() {
  return (
    <Screen title="Share card" back>
      <Gate>
        <Body />
      </Gate>
    </Screen>
  )
}

function Body() {
  const sp = useSearchParams()
  const state = habitsStore.use((s) => s)
  const habits = useMemo(
    () => sortedHabits(state.habits.filter((h) => h.status !== "archived")),
    [state.habits],
  )
  const [t, setT] = useState<Template>((sp.get("t") as Template) ?? "streak")
  const [habitId, setHabitId] = useState(sp.get("habit") ?? habits[0]?.id)
  const [routineId, setRoutineId] = useState(
    sp.get("routine") ?? state.routines[0]?.id,
  )
  const [hideNames, setHideNames] = useState(false)
  const [showRate, setShowRate] = useState(true)
  const idx = logIndex(state.logs)
  const today = dayKey()
  const habit = habits.find((h) => h.id === habitId) ?? habits[0]
  const routine = state.routines.find((r) => r.id === routineId)
  const name = (n: string, i = 0) =>
    hideNames ? `Habit ${String.fromCharCode(65 + i)}` : n

  const look = useCardLook()
  const tall = look.format === "9:16"
  const o = overallStats(state, 30)
  const po = overallStats(state, 30, 30)

  const cardFor = (
    tt: Template,
  ): { node: React.ReactNode; caption: string } => {
    if (tt === "streak" && habit) {
      const st = streaks(habit, idx)
      const s = habitStats(habit, idx, dayOffset(-29), today)
      const last = daysBetween(dayOffset(-13), today).map((d) =>
        toDot(cellFor(habit, d, idx, today)),
      )
      const record = st.current > 0 && st.current >= st.best
      return {
        caption: `${st.current}-day streak on ${hideNames ? "a habit" : habit.name}`,
        node: (
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <Ring
              value={st.best ? st.current / st.best : 0}
              size={tall ? 60 : 46}
              stroke={6}
              label={`${st.current} of best ${st.best}`}
            >
              {hideNames ? (
                <Flame
                  className="size-[9cqw] fill-(--hi) text-(--hi)"
                  aria-hidden="true"
                />
              ) : (
                <span className="text-[9cqw] leading-none">{habit.icon}</span>
              )}
              <Hero
                value={String(st.current)}
                box={tall ? 38 : 28}
                max={tall ? 24 : 18}
              />
            </Ring>
            <div className="font-display mt-[4cqw] font-extrabold text-[7cqw] uppercase leading-none">
              Day streak
            </div>
            <CardTitle max={6} className="mt-[1.5cqw] font-bold opacity-85">
              {name(habit.name)}
            </CardTitle>
            <div className="mt-[3cqw] flex flex-wrap justify-center gap-[1.6cqw]">
              {record ? (
                <Medal tone="gold" icon={<Trophy />}>
                  Personal best
                </Medal>
              ) : (
                <Medal tone="plain">Best {st.best} days</Medal>
              )}
              {showRate && (
                <Medal icon={<Check />}>{pct(s.rate)} · 30 days</Medal>
              )}
            </div>
            {tall && (
              <div className="mt-[6cqw] w-full">
                <Label className="mb-[1.5cqw] text-left">Last 14 days</Label>
                <DotGrid cells={last} cols={14} label="Last 14 days" />
              </div>
            )}
          </div>
        ),
      }
    }
    if (tt === "month" && habit) {
      const days = daysBetween(dayOffset(-34), today)
      const s = habitStats(habit, idx, dayOffset(-29), today)
      return {
        caption: `${hideNames ? "A habit" : habit.name} — ${pct(s.rate)} over the last 5 weeks`,
        node: (
          <div className="flex flex-1 flex-col justify-center gap-[4cqw]">
            <div className="flex items-center gap-[3cqw]">
              {!hideNames && (
                <span className="text-[10cqw] leading-none">{habit.icon}</span>
              )}
              <div className="min-w-0 flex-1">
                <CardTitle max={9}>{name(habit.name)}</CardTitle>
                <Label className="mt-[1cqw]">Last 5 weeks</Label>
              </div>
            </div>
            <DotGrid
              cells={days.map((d) => toDot(cellFor(habit, d, idx, today)))}
              cols={7}
              label={`Last 5 weeks: ${s.done} done`}
            />
            <div className="flex items-end justify-between gap-[3cqw]">
              {showRate ? (
                <div className="min-w-0">
                  <Label>Completion</Label>
                  <Hero value={pct(s.rate)} box={50} max={22} accent />
                </div>
              ) : (
                <span />
              )}
              <Medal icon={<Flame />}>{verdict(s.rate)}</Medal>
            </div>
          </div>
        ),
      }
    }
    if (tt === "routine" && routine) {
      const run =
        state.runs.find((r) => r.id === sp.get("run")) ??
        [...state.runs]
          .reverse()
          .find((r) => r.routineId === routine.id && r.state === "completed")
      const done = run
        ? run.results.filter((r) => r.status === "done").length
        : 0
      return {
        caption: `${hideNames ? "Routine" : routine.name} done`,
        node: run ? (
          <div className="flex flex-1 flex-col justify-center gap-[4cqw]">
            <span className="text-[16cqw] leading-none">{routine.icon}</span>
            <div>
              <Medal icon={<Check />}>Complete · {fmtDay(run.day)}</Medal>
              <CardTitle className="mt-[2cqw]">
                {hideNames ? "Routine" : routine.name}
              </CardTitle>
            </div>
            <div>
              <Label>Time</Label>
              <Hero
                value={fmtDuration(runActualSec(run))}
                box={87}
                max={26}
                accent
              />
            </div>
            <Meter
              label="Steps done"
              value={run.steps.length ? done / run.steps.length : 0}
              display={`${done}/${run.steps.length}`}
            />
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center text-[4cqw] opacity-70">
            No completed run yet.
          </div>
        ),
      }
    }
    const top = habits
      .map((h) => ({ h, s: streaks(h, idx).current }))
      .sort((a, b) => b.s - a.s)
      .slice(0, tall ? 5 : 3)
    const maxS = Math.max(1, ...top.map((x) => x.s))
    const delta = Math.round((o.rate - po.rate) * 100)
    return {
      caption: `Habits: ${pct(o.rate)} completion over 30 days`,
      node: (
        <div className="flex flex-1 flex-col justify-center gap-[4cqw]">
          <div className="flex items-center gap-[4cqw]">
            <Ring value={o.rate} size={36} label={`${pct(o.rate)} completion`}>
              <Hero value={pct(o.rate)} box={22} max={10} />
              <Label className="mt-[0.6cqw] text-[2.6cqw]">done</Label>
            </Ring>
            <div className="min-w-0 flex-1">
              <CardTitle max={10}>{verdict(o.rate)}</CardTitle>
              <Label className="mt-[1cqw]">Habits · 30 days</Label>
              {delta !== 0 && (
                <Delta
                  value={delta}
                  unit="%"
                  suffix="vs prior"
                  className="mt-[2cqw]"
                />
              )}
            </div>
          </div>
          <div className="space-y-[2.6cqw]">
            <Label>Top streaks</Label>
            {top.map(({ h, s }, i) => (
              <div key={h.id} className="flex items-center gap-[2.4cqw]">
                <span className="w-[6cqw] shrink-0 text-center text-[5cqw] leading-none">
                  {hideNames ? (
                    <span className="font-display font-black text-[4.4cqw]">
                      {i + 1}
                    </span>
                  ) : (
                    h.icon
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-[3.8cqw] leading-tight">
                    {name(h.name, i)}
                  </div>
                  <div className="mt-[0.8cqw] h-[1.4cqw] rounded-full bg-(--track)">
                    <div
                      className="h-full rounded-full bg-(--hi)"
                      style={{ width: `${(s / maxS) * 100}%` }}
                    />
                  </div>
                </div>
                <span className="font-display num inline-flex shrink-0 items-center gap-[0.6cqw] font-extrabold text-[5cqw] leading-none">
                  <Flame
                    aria-hidden="true"
                    className="size-[3.8cqw] text-(--hi)"
                  />
                  {s}
                </span>
              </div>
            ))}
          </div>
          <StatGrid
            panel
            items={[
              { label: "Perfect days", value: String(o.perfect) },
              { label: "Check-ins", value: compact(o.done) },
            ]}
          />
        </div>
      ),
    }
  }
  const render = (tt: Template) => (
    <ShareFrame
      format={look.format}
      backdrop={look.backdrop}
      accent="hab"
      photo={look.photo}
    >
      <CardTop
        kicker="Habits"
        right={new Date().toLocaleDateString("en-PH", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}
      />
      {cardFor(tt).node}
      <CardFoot />
    </ShareFrame>
  )
  const caption = `${cardFor(t).caption} · Personal SOP`
  const share = async () => {
    try {
      if (navigator.share)
        await navigator.share({ title: "Personal SOP", text: caption })
      else {
        await navigator.clipboard.writeText(caption)
        toast("Caption copied — native share isn't available here")
      }
    } catch {}
  }

  return (
    <div className="space-y-3 pt-1">
      <LayoutCarousel<Template>
        value={t}
        onChange={setT}
        format={look.format}
        items={(
          [
            ["streak", "Streak"],
            ["month", "Month heatmap"],
            ["routine", "Routine run"],
            ["scoreboard", "Scoreboard"],
          ] as const
        ).map(([key, label]) => ({ key, label, render: () => render(key) }))}
      />
      <div className="pt-2">
        <ShareTargets
          onStory={share}
          onSave={() =>
            toast.success(`Saved ${FORMAT_PX[look.format]} image (prototype)`)
          }
          onCopy={async () => {
            await navigator.clipboard.writeText(caption)
            toast.success("Caption copied")
          }}
          onMore={share}
        />
      </div>
      <SectionTitle>Size</SectionTitle>
      <Segmented<Format>
        value={look.format}
        onChange={look.setFormat}
        options={(["9:16", "4:5", "1:1"] as const).map((f) => ({
          value: f,
          label: FORMAT_LABEL[f],
        }))}
      />
      <SectionTitle>Background</SectionTitle>
      <BackdropPicker
        accent="hab"
        value={look.backdrop}
        onChange={look.setBackdrop}
        photo={look.photo}
        onPhoto={look.setPhoto}
      />
      {(t === "streak" || t === "month") && (
        <>
          <SectionTitle>Habit</SectionTitle>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4">
            {habits.map((h) => (
              <Chip
                key={h.id}
                accent="hab"
                active={habit?.id === h.id}
                onClick={() => setHabitId(h.id)}
              >
                {h.icon} {h.name}
              </Chip>
            ))}
          </div>
        </>
      )}
      {t === "routine" && (
        <>
          <SectionTitle>Routine</SectionTitle>
          <div className="flex gap-2">
            {state.routines.map((r) => (
              <Chip
                key={r.id}
                accent="hab"
                active={routineId === r.id}
                onClick={() => setRoutineId(r.id)}
              >
                {r.icon} {r.name}
              </Chip>
            ))}
          </div>
        </>
      )}

      <Card className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          Hide habit names
          <Toggle
            checked={hideNames}
            onChange={setHideNames}
            label="Hide names"
          />
        </div>
        {t !== "routine" && t !== "scoreboard" && (
          <div className="flex items-center justify-between text-sm">
            Show completion rate
            <Toggle
              checked={showRate}
              onChange={setShowRate}
              label="Show rate"
            />
          </div>
        )}
      </Card>

      <p className="text-center text-[11px] text-muted-foreground">
        Share cards never include ₱ amounts.
      </p>
    </div>
  )
}
