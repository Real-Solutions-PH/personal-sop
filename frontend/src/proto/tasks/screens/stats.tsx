"use client"

import {
  CalendarClock,
  ChevronRight,
  Flame,
  Share2,
  ShieldCheck,
  TriangleAlert,
  Trophy,
} from "lucide-react"
import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { weekday } from "../../lib/day"
import {
  Bar,
  Bars,
  Btn,
  Card,
  Chip,
  Empty,
  Heatmap,
  Ring,
  Screen,
  SectionTitle,
  Segmented,
  Stat,
} from "../../ui/kit"
import {
  type Backdrop,
  BackdropPicker,
  CardFoot,
  Ring as CardRing,
  CardTitle,
  CardTop,
  Columns,
  compact,
  Delta,
  FORMAT_LABEL,
  FORMAT_PX,
  type Format,
  Hero,
  Label,
  LayoutCarousel,
  Medal,
  ShareFrame,
  ShareTargets,
  StatGrid,
  useCardLook,
  verdict,
} from "../../ui/share"
import { useStats } from "../hooks"
import { addDays, fmtDate, pct, today, WEEKDAYS } from "../logic"
import { TaskSheets } from "../sheets"
import { LoadingRows, openTriage, SyncError, useViewState } from "../ui"

// TSK-17 Task stats · TSK-18 Share card preview.

type Range = "7" | "30" | "90"
const RANGE_LABEL: Record<Range, string> = {
  "7": "this week",
  "30": "this month",
  "90": "last 90 days",
}

function Tile({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border/60 bg-card p-3",
        className,
      )}
    >
      {children}
    </div>
  )
}

export function StatsScreen() {
  const state = useViewState()
  const [range, setRange] = useState<Range>("7")
  const days = Number(range)
  const s = useStats(days)
  const prev = useStats(days, days)
  const heat = useStats(84)

  const trend = useMemo(() => {
    if (days === 7)
      return {
        data: s.perDay.map((d) => d.done),
        labels: s.perDay.map((d) => WEEKDAYS[weekday(d.day)].slice(0, 1)),
      }
    if (days === 30)
      return { data: s.perDay.map((d) => d.done), labels: undefined }
    const weeks: number[] = []
    s.perDay.forEach((d, i) => {
      const w = Math.floor(i / 7)
      weeks[w] = (weeks[w] ?? 0) + d.done
    })
    return {
      data: weeks,
      labels: weeks.map((_, i) => (i % 3 === 0 ? `W${i + 1}` : "")),
    }
  }, [s, days])

  const heatValues = useMemo(() => {
    const max = Math.max(1, ...heat.perDay.map((d) => d.done))
    // align to weeks starting Sunday so columns = weekdays
    const lead = weekday(heat.perDay[0]?.day ?? today())
    return [
      ...Array.from({ length: lead }, () => null),
      ...heat.perDay.map((d) => d.done / max),
    ]
  }, [heat])

  const pp = (v: number | null) => (v === null ? 0 : Math.round(v * 100))
  const maxList = Math.max(1, ...s.byList.map((b) => b.done))

  return (
    <Screen
      back
      title="Task stats"
      actions={
        <Link
          href={`/tasks/share?range=${range}`}
          aria-label="Share"
          className="grid size-10 place-items-center rounded-full hover:bg-muted"
        >
          <Share2 className="size-[18px]" />
        </Link>
      }
    >
      <TaskSheets />
      <Segmented<Range>
        value={range}
        onChange={setRange}
        options={[
          { value: "7", label: "Week" },
          { value: "30", label: "Month" },
          { value: "90", label: "90 days" },
        ]}
      />
      {state === "error" && <SyncError />}
      {state === "loading" ? (
        <LoadingRows n={6} />
      ) : state === "empty" ? (
        <Empty
          title="No stats yet"
          body="Finish a few tasks and your on-time rate, streak and follow-through show up here."
          action={<Btn href="/tasks">Go to tasks</Btn>}
        />
      ) : (
        <>
          {/* hero */}
          <Card className="mt-4 overflow-hidden bg-gradient-to-br from-tsk/15 to-transparent">
            <div className="flex items-center gap-4">
              <div className="min-w-0 flex-1">
                <div className="text-muted-foreground text-xs uppercase tracking-wider">
                  Follow-through ratio
                </div>
                <div className="num font-bold text-5xl text-tsk tracking-tight">
                  {s.followThrough.toFixed(1)}
                </div>
                <div className="mt-1 text-muted-foreground text-xs">
                  Tasks finished per task that slipped (late counts half)
                </div>
                <div className="mt-0.5 text-muted-foreground text-[11px]">
                  ({s.onTime} on-time + ½×{s.late} late) ÷ ({s.overdueNow}{" "}
                  overdue + {s.reschedules} pushed)
                </div>
              </div>
              <Ring value={s.onTimeRate ?? 0} size={84} stroke={8} accent="tsk">
                <div>
                  <div
                    className={cn(
                      "num font-semibold text-lg",
                      (s.onTimeRate ?? 1) < 0.6 && "text-warn",
                    )}
                  >
                    {pct(s.onTimeRate)}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    on time
                  </div>
                </div>
              </Ring>
            </div>
          </Card>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <Tile>
              <Stat
                label="Tasks done"
                value={s.done}
                delta={s.done - prev.done}
                accent="tsk"
              />
            </Tile>
            <Tile>
              <Stat
                label="On-time rate"
                value={pct(s.onTimeRate)}
                delta={pp(s.onTimeRate) - pp(prev.onTimeRate)}
              />
            </Tile>
            <Tile>
              <Stat
                label={`Done streak · best ${s.bestStreak}`}
                value={
                  <span className="inline-flex items-center gap-1">
                    <Flame aria-hidden="true" className="size-5 text-warn" />
                    {s.streak}-day
                  </span>
                }
              />
            </Tile>
            <Tile>
              <Stat label="Clear days" value={`${s.clearDays}/${s.dueDays}`} />
              <Bar
                value={s.dueDays ? s.clearDays / s.dueDays : 0}
                accent="tsk"
                className="mt-2 h-1.5"
              />
            </Tile>
          </div>

          <SectionTitle>Trend · {RANGE_LABEL[range]}</SectionTitle>
          <Card>
            <Bars
              data={trend.data}
              labels={trend.labels}
              accent="tsk"
              height={96}
            />
          </Card>

          <SectionTitle>Honest reflection</SectionTitle>
          <Card className="border-warn/25">
            <button
              type="button"
              onClick={openTriage}
              className="flex w-full items-center gap-3 text-left"
            >
              <TriangleAlert className="size-5 text-warn" />
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  <span className="num">{s.overdueNow}</span> overdue now
                </div>
                <div className="text-muted-foreground text-xs">
                  Always visible, never hidden. Tap to sort them out.
                </div>
              </div>
              <ChevronRight className="size-4 text-muted-foreground" />
            </button>
            <div className="mt-4 grid grid-cols-2 gap-3 border-border/50 border-t pt-3">
              <Stat
                label="Reschedules"
                value={s.reschedules}
                delta={s.reschedules - prev.reschedules}
                goodWhen="down"
              />
              <Stat
                label="Avg lateness"
                value={
                  s.avgLateness === null ? "—" : `${s.avgLateness.toFixed(1)}d`
                }
                goodWhen="down"
              />
            </div>
            <div className="mt-2 text-muted-foreground text-xs">
              {s.reschedules > 0
                ? `Pushed ${s.reschedules}× ${RANGE_LABEL[range]}. `
                : ""}
              Avg {s.avgReschedules.toFixed(2)} pushes per finished task.
              Lateness uses the original due date.
            </div>
            {s.topPushed.length > 0 && (
              <div className="mt-3 space-y-1.5">
                <div className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
                  Most pushed
                </div>
                {s.topPushed.map((t) => (
                  <Link
                    key={t.id}
                    href={`/tasks/task/${t.id}`}
                    className="flex items-center gap-2 text-sm"
                  >
                    <CalendarClock className="size-3.5 text-warn" />
                    <span className="min-w-0 flex-1 truncate">{t.title}</span>
                    <span className="num text-warn">{t.rescheduleCount}×</span>
                  </Link>
                ))}
              </div>
            )}
          </Card>

          <SectionTitle>Last 12 weeks</SectionTitle>
          <Card>
            <Heatmap
              values={heatValues}
              accent="tsk"
              flow="column"
              rowLabels={["S", "M", "T", "W", "T", "F", "S"]}
            />
            <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
              <span>{fmtDate(addDays(today(), -83))}</span>
              <span>Today</span>
            </div>
          </Card>

          <SectionTitle>By list</SectionTitle>
          <Card className="space-y-3">
            {s.byList.length === 0 && (
              <div className="text-muted-foreground text-sm">
                Nothing done in this range.
              </div>
            )}
            {s.byList.map((b) => (
              <div key={b.id ?? "inbox"}>
                <div className="mb-1 flex justify-between text-sm">
                  <span>{b.name}</span>
                  <span className="num text-muted-foreground">{b.done}</span>
                </div>
                <Bar value={b.done / maxList} accent="tsk" className="h-1.5" />
              </div>
            ))}
          </Card>

          <div className="mt-3 flex items-center justify-between px-1 text-muted-foreground text-xs">
            <span>
              Captured by AI: {pct(s.captureShare)} of {s.created} new tasks
            </span>
            <Link href="/tasks/settings" className="text-tsk">
              Groceries in stats?
            </Link>
          </div>

          <Btn
            href={`/tasks/share?range=${range}`}
            accent="tsk"
            className="mt-5 w-full"
          >
            <Share2 className="size-4" /> Share {RANGE_LABEL[range]}
          </Btn>
        </>
      )}
    </Screen>
  )
}

// ---------------------------------------------------------------- TSK-18

type Tpl = "summary" | "streak" | "followThrough"
type MetricKey = "done" | "onTime" | "streak" | "clear" | "followThrough"

export function ShareScreen() {
  const [range, setRange] = useState<Range>("7")
  useEffect(() => {
    const r = new URLSearchParams(window.location.search).get("range")
    if (r === "7" || r === "30" || r === "90") setRange(r)
  }, [])
  const s = useStats(Number(range))
  const prev = useStats(Number(range), Number(range))
  const [tpl, setTpl] = useState<Tpl>("summary")
  const look = useCardLook()
  const [on, setOn] = useState<Record<MetricKey, boolean>>({
    done: true,
    onTime: true,
    streak: true,
    clear: false,
    followThrough: false,
  })

  const metrics: { k: MetricKey; label: string; value: string }[] = [
    { k: "done", label: "Done", value: compact(s.done) },
    { k: "onTime", label: "On time", value: pct(s.onTimeRate) },
    { k: "streak", label: "Day streak", value: String(s.streak) },
    { k: "clear", label: "Clear days", value: `${s.clearDays}/${s.dueDays}` },
    {
      k: "followThrough",
      label: "Follow-through",
      value: s.followThrough.toFixed(1),
    },
  ]
  const shown = metrics.filter((m) => on[m.k])
  const line = shown
    .map((m) => `${m.value} ${m.label.toLowerCase()}`)
    .join(" · ")
  const caption = `Tasks ${RANGE_LABEL[range]}: ${line} · Unfurl`

  const share = async () => {
    try {
      if (navigator.share)
        await navigator.share({ title: "My tasks recap", text: caption })
      else {
        await navigator.clipboard?.writeText(caption)
        toast.success("Caption copied — image export comes with the real build")
      }
    } catch {
      // user cancelled the share sheet
    }
  }

  const card = (t: Tpl) => (
    <TaskCard
      t={t}
      s={s}
      prevDone={prev.done}
      range={range}
      shown={shown}
      format={look.format}
      backdrop={look.backdrop}
      photo={look.photo}
    />
  )

  return (
    <Screen back title="Share card">
      <LayoutCarousel<Tpl>
        value={tpl}
        onChange={setTpl}
        format={look.format}
        items={[
          { key: "summary", label: "Summary", render: () => card("summary") },
          { key: "streak", label: "Streak", render: () => card("streak") },
          {
            key: "followThrough",
            label: "Follow-through",
            render: () => card("followThrough"),
          },
        ]}
      />

      <div className="mt-5">
        <ShareTargets
          onStory={share}
          onSave={() =>
            toast.success(`Saved ${FORMAT_PX[look.format]} image (simulated)`)
          }
          onCopy={async () => {
            await navigator.clipboard?.writeText(caption)
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
        accent="tsk"
        value={look.backdrop}
        onChange={look.setBackdrop}
        photo={look.photo}
        onPhoto={look.setPhoto}
      />
      <SectionTitle>Range</SectionTitle>
      <Segmented<Range>
        value={range}
        onChange={setRange}
        options={[
          { value: "7", label: "Week" },
          { value: "30", label: "Month" },
          { value: "90", label: "90 days" },
        ]}
      />
      {tpl === "summary" && (
        <>
          <SectionTitle>Show</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {metrics.map((m) => (
              <Chip
                key={m.k}
                accent="tsk"
                active={on[m.k]}
                onClick={() => setOn({ ...on, [m.k]: !on[m.k] })}
                className="h-11"
              >
                {m.label}
              </Chip>
            ))}
          </div>
        </>
      )}
      <p className="mt-4 mb-2 flex items-center gap-1.5 text-muted-foreground text-xs">
        <ShieldCheck className="size-3.5" /> Task titles never appear on a card.
      </p>
    </Screen>
  )
}

function TaskCard({
  t,
  s,
  prevDone,
  range,
  shown,
  format,
  backdrop,
  photo,
}: {
  t: Tpl
  s: ReturnType<typeof useStats>
  prevDone: number
  range: Range
  shown: { k: MetricKey; label: string; value: string }[]
  format: Format
  backdrop: Backdrop
  photo: string | null
}) {
  const tall = format === "9:16"
  const title =
    RANGE_LABEL[range][0].toUpperCase() + RANGE_LABEL[range].slice(1)
  // Per-day bars for a week, per-week bars beyond that.
  const bars =
    range === "7"
      ? s.perDay.map((d) => d.done)
      : s.perDay.reduce<number[]>((a, d, i) => {
          a[Math.floor(i / 7)] = (a[Math.floor(i / 7)] ?? 0) + d.done
          return a
        }, [])
  const labels =
    range === "7"
      ? s.perDay.map((d) => WEEKDAYS[weekday(d.day)].slice(0, 1))
      : undefined
  const delta = prevDone ? s.done - prevDone : null
  const onTime = s.onTimeRate ?? 0

  let body: React.ReactNode
  if (t === "summary") {
    const rest = shown.filter((m) => m.k !== "done")
    body = (
      <div className="flex flex-1 flex-col justify-center gap-[5cqw]">
        <div>
          <CardTitle max={9}>{title}</CardTitle>
          <div className="mt-[2cqw] flex flex-wrap gap-[1.6cqw]">
            <Medal icon={<Flame />}>{verdict(s.onTimeRate)}</Medal>
            {s.streak > 0 && s.streak >= s.bestStreak && (
              <Medal tone="gold" icon={<Trophy />}>
                Best streak
              </Medal>
            )}
          </div>
        </div>
        <div className="flex items-center gap-[5cqw]">
          <div className="min-w-0 flex-1">
            <Label>Tasks done</Label>
            <Hero value={compact(s.done)} box={44} max={30} accent />
            {delta !== null && delta !== 0 && (
              <Delta value={delta} suffix="vs last" className="mt-[1.5cqw]" />
            )}
          </div>
          <CardRing
            value={onTime}
            size={34}
            label={`On time ${pct(s.onTimeRate)}`}
          >
            <Hero value={pct(s.onTimeRate)} box={20} max={9} />
            <Label className="mt-[0.8cqw] text-[2.6cqw]">on time</Label>
          </CardRing>
        </div>
        {(tall || format === "4:5") && (
          <Columns data={bars} labels={labels} height={tall ? 18 : 12} />
        )}
        <StatGrid
          items={rest.map((m) => ({ label: m.label, value: m.value }))}
          panel
        />
      </div>
    )
  } else if (t === "streak") {
    body = (
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <CardRing
          value={s.bestStreak ? s.streak / s.bestStreak : 0}
          size={tall ? 62 : 46}
          stroke={6}
        >
          <Flame
            className="size-[9cqw] fill-(--hi) text-(--hi)"
            aria-hidden="true"
          />
          <Hero
            value={String(s.streak)}
            box={tall ? 40 : 30}
            max={tall ? 26 : 20}
          />
        </CardRing>
        <div className="font-display mt-[4cqw] font-extrabold text-[7cqw] uppercase leading-none">
          Day streak
        </div>
        <Label className="mt-[1.5cqw]">Getting things done, every day</Label>
        <div className="mt-[4cqw] flex flex-wrap justify-center gap-[1.6cqw]">
          {s.streak >= s.bestStreak && s.streak > 0 ? (
            <Medal tone="gold" icon={<Trophy />}>
              Personal best
            </Medal>
          ) : (
            <Medal tone="plain">Best {s.bestStreak} days</Medal>
          )}
        </div>
      </div>
    )
  } else {
    // Gauge: 0 → 3+ tasks finished per slip.
    const ratio = Math.min(1, s.followThrough / 3)
    body = (
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <Label>Follow-through ratio</Label>
        <CardRing value={ratio} size={tall ? 60 : 44} stroke={6}>
          <Hero
            value={s.followThrough.toFixed(1)}
            box={tall ? 38 : 28}
            max={tall ? 24 : 18}
          />
          <Label className="mt-[0.8cqw]">× per slip</Label>
        </CardRing>
        <div className="mt-[3cqw]">
          <Medal icon={<Flame />}>{verdict(ratio)}</Medal>
        </div>
        <p className="mt-[3cqw] max-w-[80%] text-[3.4cqw] leading-snug opacity-80">
          Tasks finished for every one that slipped (late counts half).
        </p>
        {tall && (
          <div className="mt-[5cqw] w-full">
            <StatGrid
              items={[
                { label: "Done", value: compact(s.done) },
                { label: "On time", value: pct(s.onTimeRate) },
                { label: "Streak", value: `${s.streak}d` },
              ]}
              panel
            />
          </div>
        )}
      </div>
    )
  }

  return (
    <ShareFrame format={format} backdrop={backdrop} accent="tsk" photo={photo}>
      <CardTop kicker="Tasks" right={`${fmtDate(s.from)} – ${fmtDate(s.to)}`} />
      {body}
      <CardFoot>Percentages & streaks only</CardFoot>
    </ShareFrame>
  )
}
