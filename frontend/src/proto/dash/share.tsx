"use client"

import {
  AlertTriangle,
  Camera,
  Check,
  ChevronRight,
  Crown,
  Flame,
  RotateCw,
  Share2,
  ShieldCheck,
  Target,
  TrendingUp,
  Trophy,
} from "lucide-react"
import Link from "next/link"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import {
  type CardData,
  COMMON,
  TEMPLATES,
  useCardData,
} from "../../../../shared/prototype/dash/share-data"
import { Btn, Card, Screen, SectionTitle, Segmented } from "../ui/kit"
import {
  type Backdrop,
  BackdropPicker,
  type CardAccent,
  CardFoot,
  CardTitle,
  CardTop,
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
  type StatItem,
  useCardLook,
  verdict,
} from "../ui/share"
import { AREA, MODULE_KEYS, type ShareTemplate } from "./data"
import { type Facet, ShareHexagon } from "./hexagon"
import { fmtGoal, parseMetric } from "./hooks"
import { dashStore, saveShareDefaults } from "./store"
import { BottomSheet, fmtDay, pct, useQueryParam, useViewState } from "./ui"

// DSH-30 Share composer · DSH-31 Privacy check (always shown) · DSH-32 result.
// Hard rule (X-5 / OQ-DSH-7): no ₱ amount can ever render on a card.

const NO_PESO = (s: string) => (s.includes("₱") ? "—" : s)

// ---------------------------------------------------------------- data

// ---------------------------------------------------------------- card

const ACCENT: Record<ShareTemplate, CardAccent> = {
  life: "life",
  weekly: "life",
  monthly: "hab",
  streak: "life",
  finance: "fin",
  profile: "life",
  goal: "life",
}
const AREA_COLOR: Record<string, string> = {
  habits: "var(--hab)",
  tasks: "var(--tsk)",
  fitness: "var(--fit)",
  finance: "var(--fin)",
}
const WD = ["S", "M", "T", "W", "T", "F", "S"]
const dot = (v: boolean | null | undefined): Dot =>
  v ? "hit" : v === false ? "miss" : "none"
const rate = (v?: string) => {
  const n = v ? parseMetric(v) : null
  return n === null ? null : n / 100
}

/** Hexagon with its legend, sized as a share of the card width. */
function CardHexagon({
  facets,
  days,
  h,
}: {
  facets: Facet[]
  days: number
  h: number
}) {
  return (
    <div className="flex flex-col items-center">
      <div style={{ height: `${h}cqw`, width: `${h * 1.04}cqw` }}>
        <ShareHexagon facets={facets} />
      </div>
      <div className="mt-[0.6cqw] flex items-center gap-[3cqw] text-[2.8cqw] uppercase tracking-wider opacity-75">
        <span className="flex items-center gap-[1cqw]">
          <span className="h-[0.6cqw] w-[4cqw] rounded bg-life" /> Last {days}d
        </span>
        <span className="flex items-center gap-[1cqw]">
          <span className="w-[4cqw] border-current border-t border-dashed" />{" "}
          Prior {days}d
        </span>
      </div>
    </div>
  )
}

export function ShareCard({
  t,
  format,
  backdrop,
  photo,
  on,
  d,
}: {
  t: ShareTemplate
  format: Format
  backdrop: Backdrop
  photo?: string | null
  on: Record<string, boolean>
  d: CardData
}) {
  const tall = format === "9:16"
  const sq = format === "1:1"
  const range =
    t === "weekly"
      ? `${fmtDay(d.w7.range[0]?.day ?? "")} – ${fmtDay(d.w7.range.at(-1)?.day ?? "")}`
      : t === "monthly" || t === "finance" || t === "life"
        ? "Last 30 days"
        : new Date().toLocaleDateString("en-PH", {
            month: "long",
            year: "numeric",
          })
  const areas = MODULE_KEYS.filter((k) => d.enabled[k])
  const meters = (
    <div className="grid grid-cols-2 gap-x-[4cqw] gap-y-[3cqw]">
      {areas.map((k) => (
        <Meter
          key={k}
          label={AREA[k].label}
          value={d.life.rates[k]}
          color={AREA_COLOR[k]}
        />
      ))}
    </div>
  )

  let kicker = "Life Score"
  let body: React.ReactNode = null

  if (t === "life") {
    const ring = (size: number) => (
      <Ring
        value={(d.life.score ?? 0) / 100}
        size={size}
        label={`Life Score ${d.life.score ?? "none"}`}
      >
        <Hero
          value={String(d.life.score ?? "—")}
          box={size * 0.62}
          max={size * 0.42}
        />
        <Label className="mt-[0.8cqw]">of 100</Label>
      </Ring>
    )
    const tags = (
      <div className="flex flex-wrap gap-[1.6cqw]">
        {on.level && (
          <Medal tone="gold" icon={<Crown />}>
            {d.level}
          </Medal>
        )}
        {on.delta && d.life.delta !== null && d.life.delta !== 0 && (
          <Delta value={d.life.delta} suffix="vs last month" />
        )}
      </div>
    )
    body = sq ? (
      <div className="flex flex-1 items-center gap-[5cqw]">
        <div className="flex flex-col items-center gap-[2.5cqw]">
          {ring(38)}
          {tags}
        </div>
        <div className="min-w-0 flex-1">
          {on.hexagon ? (
            <CardHexagon facets={d.facets30} days={30} h={40} />
          ) : (
            on.areas && <div className="[&>div]:grid-cols-1">{meters}</div>
          )}
        </div>
      </div>
    ) : (
      <div className="flex flex-1 flex-col items-center justify-center gap-[4cqw] text-center">
        {ring(tall ? 54 : 40)}
        {tags}
        {on.hexagon && (
          <CardHexagon facets={d.facets30} days={30} h={tall ? 46 : 34} />
        )}
        {on.areas && (tall || !on.hexagon) && (
          <div className="w-full text-left">{meters}</div>
        )}
      </div>
    )
  }

  if (t === "weekly") {
    kicker = "Week recap"
    const wd =
      d.w7.rate !== null && d.w7.prevRate !== null
        ? Math.round((d.w7.rate - d.w7.prevRate) * 100)
        : null
    const stats: StatItem[] = []
    if (on.habits && d.habits7)
      stats.push({
        label: "Habits",
        value: d.habits7.value,
        delta: on.deltas ? d.habits7.delta : null,
      })
    if (on.training && d.training7)
      stats.push({
        label: "Training",
        value: d.training7.value,
        delta: on.deltas ? d.training7.delta : null,
      })
    if (on.savings && d.savings7)
      stats.push({
        label: "Saved",
        value: NO_PESO(d.savings7.value),
        delta: on.deltas ? d.savings7.delta : null,
      })
    body = (
      <div className="flex flex-1 flex-col justify-center gap-[4cqw]">
        <div className="flex items-center gap-[4cqw]">
          {on.onTarget && (
            <Ring
              value={d.w7.rate ?? 0}
              size={sq ? 28 : 34}
              label={`On target ${pct(d.w7.rate)}`}
            >
              <Hero value={pct(d.w7.rate)} box={sq ? 17 : 21} max={10} />
              <Label className="mt-[0.6cqw] text-[2.6cqw]">on target</Label>
            </Ring>
          )}
          <div className="min-w-0 flex-1">
            <CardTitle max={11}>{verdict(d.w7.rate)}</CardTitle>
            {wd !== null && wd !== 0 && on.deltas && (
              <Delta
                value={wd}
                unit="%"
                suffix="vs last week"
                className="mt-[2cqw]"
              />
            )}
          </div>
        </div>
        <div>
          <DotGrid
            cells={d.w7.range.map((x) => dot(x.onTarget))}
            cols={7}
            label={`${d.w7.onTarget} of 7 days on target`}
          />
          <div className="mt-[1cqw] grid grid-cols-7 text-center font-semibold text-[2.8cqw] opacity-60">
            {d.w7.range.map((x) => (
              <span key={x.day}>{WD[new Date(x.day).getDay()]}</span>
            ))}
          </div>
        </div>
        {on.hexagon && !sq && (
          <CardHexagon facets={d.facets7} days={7} h={tall ? 40 : 26} />
        )}
        <StatGrid items={stats} panel size={10} />
        {on.trophy && d.trophy && !sq && (
          <Medal tone="gold" icon={<Trophy />} className="self-start">
            {NO_PESO(d.trophy.title)}
          </Medal>
        )}
      </div>
    )
  }

  if (t === "monthly") {
    kicker = "Month recap"
    const month = new Date().toLocaleDateString("en-PH", { month: "long" })
    const hero: StatItem[] = on.hero
      ? [
          { label: "On target", value: pct(d.w30.rate) },
          ...(d.habits30 ? [{ label: "Habits", value: d.habits30.value }] : []),
          ...(d.training30
            ? [{ label: "Workouts", value: d.training30.value }]
            : []),
          ...(d.savings30
            ? [{ label: "Saved", value: NO_PESO(d.savings30.value) }]
            : []),
        ]
      : []
    body = (
      <div className="flex flex-1 flex-col justify-center gap-[4cqw]">
        <div>
          <CardTitle max={16}>{month}</CardTitle>
          <div className="mt-[2cqw] flex flex-wrap gap-[1.6cqw]">
            <Medal icon={<Flame />}>{verdict(d.w30.rate)}</Medal>
            {on.prs && d.prs30 && (parseMetric(d.prs30.value) ?? 0) > 0 && (
              <Medal tone="gold" icon={<Trophy />}>
                {d.prs30.value} PRs
              </Medal>
            )}
            {on.streak && (
              <Medal tone="plain" icon={<Flame />}>
                {d.w30.best}-day best streak
              </Medal>
            )}
          </div>
        </div>
        {!sq && (
          <DotGrid
            cells={d.w30.range.map((x) => dot(x.onTarget))}
            cols={10}
            label={`${d.w30.onTarget} of ${d.w30.scored} days on target`}
          />
        )}
        {on.hexagon && tall && (
          <CardHexagon facets={d.facets30} days={30} h={28} />
        )}
        <StatGrid items={hero} panel cols={sq ? 4 : 2} size={sq ? 8 : 11} />
        {on.highlight && tall && !on.hexagon && (
          <div className="text-[3.4cqw] opacity-80">
            {d.w30.onTarget} on-target days out of {d.w30.scored}.
          </div>
        )}
      </div>
    )
  }

  if (t === "streak") {
    kicker = "On-target streak"
    const record = d.w7.current > 0 && d.w7.current >= d.w7.best
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-[3.5cqw] text-center">
        <Ring
          value={d.w7.best ? d.w7.current / d.w7.best : 0}
          size={tall ? 58 : 42}
          stroke={6}
        >
          <Flame
            className="size-[9cqw] fill-(--hi) text-(--hi)"
            aria-hidden="true"
          />
          <Hero
            value={String(d.w7.current)}
            box={tall ? 36 : 26}
            max={tall ? 24 : 18}
          />
        </Ring>
        <div className="font-display font-extrabold text-[7cqw] uppercase leading-none">
          Day streak
        </div>
        {on.best &&
          (record ? (
            <Medal tone="gold" icon={<Trophy />}>
              Personal best
            </Medal>
          ) : (
            <Medal tone="plain">Best {d.w7.best} days</Medal>
          ))}
        {on.grid && !sq && (
          <div className="w-full">
            <DotGrid
              cells={d.w30.range.map((x) => dot(x.onTarget))}
              cols={10}
              label={`Last 30 days: ${d.w30.onTarget} on target`}
            />
          </div>
        )}
      </div>
    )
  }

  if (t === "finance") {
    kicker = "Money, in %"
    const sr = rate(d.savings30?.value)
    const items: StatItem[] = []
    if (on.spend && d.spend30)
      items.push({ label: "Spend vs last mo.", value: d.spend30.value })
    if (on.budgets && (sq || d.budgetsPct === null))
      items.push({
        label: "Budgets kept",
        value: d.budgetsPct === null ? "—" : `${d.budgetsPct}%`,
      })
    if (on.nospend && d.nospend30)
      items.push({
        label: "No-spend days",
        value: String(parseMetric(d.nospend30.value) ?? "—"),
      })
    body = (
      <div className="flex flex-1 flex-col justify-center gap-[5cqw]">
        {on.savings && d.savings30 && (
          <div className="flex items-center gap-[5cqw]">
            <Ring
              value={sr ?? 0}
              size={sq ? 32 : tall ? 46 : 40}
              label={`Savings rate ${d.savings30.value}`}
            >
              <Hero
                value={NO_PESO(d.savings30.value)}
                box={sq ? 20 : tall ? 29 : 25}
                max={14}
              />
            </Ring>
            <div className="min-w-0 flex-1">
              <Label>Savings rate</Label>
              <CardTitle max={10} className="mt-[1cqw]">
                {sr === null
                  ? "Tracking"
                  : sr >= 0.2
                    ? "Saving strong"
                    : sr > 0
                      ? "In the green"
                      : "Rebuilding"}
              </CardTitle>
            </div>
          </div>
        )}
        {on.budgets && d.budgetsPct !== null && !sq && (
          <Meter
            label="Budgets kept"
            value={d.budgetsPct / 100}
            display={`${d.budgetsPct}%`}
          />
        )}
        <StatGrid
          items={items}
          panel
          size={tall ? 13 : 10}
          cols={items.length === 2 ? 2 : undefined}
        />
      </div>
    )
  }

  if (t === "profile") {
    kicker = "Profile"
    const initials = d.name
      .split(" ")
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
    body = (
      <div className="flex flex-1 flex-col justify-center gap-[4cqw]">
        <div className="flex items-center gap-[4cqw]">
          {on.photo && d.photo ? (
            // biome-ignore lint/performance/noImgElement: local data URL on a card that is rasterised
            <img
              src={d.photo}
              alt="Profile"
              className="size-[18cqw] shrink-0 rounded-full object-cover ring-[0.8cqw] ring-(--hi)"
            />
          ) : (
            <div className="font-display grid size-[18cqw] shrink-0 place-items-center rounded-full bg-gradient-to-br from-hab via-primary to-fit font-black text-[7cqw] text-white">
              {initials}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <CardTitle max={10}>{d.name}</CardTitle>
            <Medal tone="gold" icon={<Crown />} className="mt-[1.5cqw]">
              {d.level}
            </Medal>
          </div>
        </div>
        {on.identity && !sq && d.identities.length > 0 && (
          <div className="space-y-[1cqw] text-[3.6cqw] italic leading-snug opacity-85">
            {d.identities.slice(0, 3).map((i) => (
              <div key={i}>“{i}”</div>
            ))}
          </div>
        )}
        {on.hexagon && !sq && (
          <CardHexagon facets={d.facets30} days={30} h={tall ? 42 : 30} />
        )}
        <StatGrid
          panel
          cols={4}
          size={8}
          items={[
            { label: "Score", value: String(d.life.score ?? "—") },
            { label: "Hit rate", value: pct(d.w30.rate) },
            { label: "Streak", value: `${d.w30.best}d` },
            ...(d.savings30
              ? [{ label: "Saved", value: NO_PESO(d.savings30.value) }]
              : []),
          ]}
        />
        {on.records && d.trophies.length > 0 && (
          <div className="flex flex-wrap gap-[1.6cqw]">
            {d.trophies.slice(0, sq ? 2 : 3).map((x) => (
              <Medal key={x.id} tone="plain" icon={<Trophy />}>
                {NO_PESO(x.value)} · {x.title}
              </Medal>
            ))}
          </div>
        )}
      </div>
    )
  }

  if (t === "goal") {
    kicker = "Goal"
    const g = d.goal
    const fin = g?.goal.metric.startsWith("finance:")
    const value = g
      ? fin
        ? `${Math.round(g.pct * 100)}%`
        : NO_PESO(g.entry?.value ?? "—")
      : "—"
    body = g ? (
      <div className="flex flex-1 flex-col items-center justify-center gap-[3.5cqw] text-center">
        <Ring
          value={g.pct}
          size={tall ? 54 : 40}
          stroke={6}
          label={`${Math.round(g.pct * 100)}% of target`}
        >
          {g.hit ? (
            <Target className="size-[10cqw] text-(--hi)" aria-hidden="true" />
          ) : (
            <TrendingUp
              className="size-[10cqw] text-(--hi)"
              aria-hidden="true"
            />
          )}
          <Hero
            value={`${Math.round(Math.min(g.pct, 9.99) * 100)}%`}
            box={tall ? 32 : 24}
            max={11}
          />
        </Ring>
        {g.hit ? (
          <Medal tone="gold" icon={<Check />}>
            Goal hit
          </Medal>
        ) : (
          <Medal tone="plain">In progress</Medal>
        )}
        <CardTitle max={10}>{g.goal.label}</CardTitle>
        <div className="w-full">
          <Hero
            value={value}
            box={87}
            max={18}
            accent
            className="justify-center"
          />
          {on.target && (
            <Label className="mt-[1.5cqw]">
              {fin ? "of target" : `target ${fmtGoal(g.goal)}`}
            </Label>
          )}
        </div>
      </div>
    ) : (
      <div className="flex flex-1 items-center justify-center text-[4cqw] opacity-70">
        No goals yet
      </div>
    )
  }

  return (
    <ShareFrame
      format={format}
      backdrop={backdrop}
      accent={ACCENT[t]}
      photo={photo}
    >
      <CardTop kicker={kicker} right={on.dates ? range : undefined} />
      {body}
      <CardFoot handle={on.handle ? d.handle : null} mark={on.mark}>
        {t === "finance" && "Percentages only — amounts never leave the app."}
      </CardFoot>
    </ShareFrame>
  )
}

// ---------------------------------------------------------------- composer

type Result = "shared" | "saved" | "copied" | "error" | null

export function ShareComposerScreen() {
  const state = useViewState()
  const tParam = useQueryParam("t")
  const gParam = useQueryParam("goal")
  const saved = dashStore.use((s) => s.share)
  const [t, setT] = useState<ShareTemplate>("life")
  const look = useCardLook()
  const { format } = look
  const [on, setOn] = useState<Record<string, boolean>>({})
  const [check, setCheck] = useState(false)
  const [remember, setRemember] = useState(false)
  const [result, setResult] = useState<Result>(null)
  const d = useCardData(gParam)
  const tpl = TEMPLATES.find((x) => x.key === t) ?? TEMPLATES[0]
  const fields = [...tpl.fields, ...COMMON]

  useEffect(() => {
    if (tParam && TEMPLATES.some((x) => x.key === tParam))
      setT(tParam as ShareTemplate)
  }, [tParam])
  // Load per-template defaults when the template changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only on template switch
  useEffect(() => {
    const base = Object.fromEntries(
      [...tpl.fields, ...COMMON].map((f) => [f.key, f.on]),
    )
    setOn({ ...base, ...(saved[t] ?? {}) })
    if (!tpl.formats.includes(format)) look.setFormat(tpl.formats[0])
  }, [t])

  const visible = fields.filter((f) => on[f.key])
  const sensitiveOn = visible.filter((f) => f.sensitive)
  const caption = `${d.name.split(" ")[0]}'s ${tpl.label.toLowerCase()} — Life Score ${d.life.score ?? "—"} (${d.level}), on-target streak ${d.w7.current} days · Unfurl`

  const doShare = async () => {
    setCheck(false)
    if (remember) {
      saveShareDefaults(t, on)
      toast("Saved as defaults for this template")
    }
    if (state === "error") {
      setResult("error")
      return
    }
    try {
      if (typeof navigator.share === "function") {
        // ponytail: PNG render (DOM → 1080px canvas) is stubbed; text-only share for now.
        await navigator.share({ title: tpl.label, text: caption })
        setResult("shared")
      } else {
        await navigator.clipboard.writeText(caption)
        setResult("saved")
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return
      try {
        await navigator.clipboard.writeText(caption)
        setResult("copied")
      } catch {
        setResult("error")
      }
    }
  }

  return (
    <Screen title="Share card" back>
      <LayoutCarousel<ShareTemplate>
        value={t}
        onChange={setT}
        format={format}
        items={TEMPLATES.map((x) => ({
          key: x.key,
          label: x.label,
          render: () => (
            <ShareCard
              t={x.key}
              format={x.formats.includes(format) ? format : x.formats[0]}
              backdrop={look.backdrop}
              photo={look.photo}
              on={
                x.key === t
                  ? on
                  : {
                      ...Object.fromEntries(
                        [...x.fields, ...COMMON].map((f) => [f.key, f.on]),
                      ),
                      ...(saved[x.key] ?? {}),
                    }
              }
              d={d}
            />
          ),
        }))}
      />

      <div className="mt-5">
        <ShareTargets
          onStory={() => setCheck(true)}
          onSave={() =>
            toast("Image export is stubbed in the prototype", {
              description: `Would save a ${FORMAT_PX[format]} PNG.`,
            })
          }
          onCopy={async () => {
            await navigator.clipboard?.writeText(caption)
            toast("Caption copied")
          }}
          onMore={() => setCheck(true)}
        />
      </div>

      <SectionTitle>Size</SectionTitle>
      <Segmented<Format>
        value={format}
        onChange={look.setFormat}
        options={tpl.formats.map((f) => ({ value: f, label: FORMAT_LABEL[f] }))}
      />
      <SectionTitle>Background</SectionTitle>
      <BackdropPicker
        accent={ACCENT[t]}
        value={look.backdrop}
        onChange={look.setBackdrop}
        photo={look.photo}
        onPhoto={look.setPhoto}
      />

      <SectionTitle>Show on card</SectionTitle>
      <Card className="px-3 py-1">
        {fields.map((f) => (
          <label
            key={f.key}
            className="flex min-h-11 items-center gap-3 border-border/50 border-b last:border-0"
          >
            <span className="flex-1 text-sm">
              {f.label}
              {f.sensitive && (
                <span className="ml-1.5 rounded-full bg-warn/15 px-1.5 py-0.5 text-[10px] text-warn">
                  {f.sensitive}
                </span>
              )}
            </span>
            <input
              type="checkbox"
              checked={!!on[f.key]}
              onChange={(e) =>
                setOn((o) => ({ ...o, [f.key]: e.target.checked }))
              }
              className="size-5 accent-[var(--primary)]"
            />
          </label>
        ))}
      </Card>
      <p className="mt-2 flex items-start gap-1.5 px-1 text-muted-foreground text-xs">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />₱ amounts, body
        weight, task titles, journal text and account names can never appear on
        a card.
      </p>

      <Btn
        onClick={() => setCheck(true)}
        className="mt-4 h-12 w-full text-base"
      >
        <Share2 className="size-4" /> Share
      </Btn>

      <SectionTitle>More cards</SectionTitle>
      <Card className="px-3 py-1">
        {[
          {
            href: "/fitness/workouts",
            label: "Workout card",
            sub: "Open any workout → Share",
          },
          {
            href: "/habits/share",
            label: "Habit scoreboard",
            sub: "From Habits",
          },
          { href: "/tasks/share", label: "Tasks card", sub: "From Tasks" },
        ].map((x) => (
          <Link
            key={x.href}
            href={x.href}
            className="flex min-h-12 items-center gap-2 border-border/50 border-b last:border-0"
          >
            <span className="flex-1 text-sm">
              {x.label}
              <span className="block text-muted-foreground text-xs">
                {x.sub}
              </span>
            </span>
            <ChevronRight className="size-4 text-muted-foreground" />
          </Link>
        ))}
      </Card>

      {/* DSH-31 privacy check — always shown, cannot be skipped (OQ-DSH-9) */}
      <BottomSheet
        open={check}
        onClose={() => setCheck(false)}
        title="Privacy check"
        description="This is exactly what will be shared."
      >
        <div
          className={cn(
            "mx-auto",
            format === "9:16"
              ? "w-[46%]"
              : format === "4:5"
                ? "w-[54%]"
                : "w-[60%]",
          )}
        >
          <ShareCard
            t={t}
            format={format}
            backdrop={look.backdrop}
            photo={look.photo}
            on={on}
            d={d}
          />
        </div>
        {sensitiveOn.length > 0 && (
          <div className="mt-3 flex items-start gap-2 rounded-xl bg-warn/15 p-3 text-sm text-warn">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            This shows{" "}
            {sensitiveOn.map((f) => f.label.toLowerCase()).join(" and ")}.
            Continue?
          </div>
        )}
        <div className="mt-3 space-y-1">
          {visible.map((f) => (
            <div key={f.key} className="flex items-center gap-2 text-sm">
              <Check
                className={cn(
                  "size-4",
                  f.sensitive ? "text-warn" : "text-good",
                )}
              />
              <span className="flex-1">{f.label}</span>
              {f.sensitive && (
                <span className="text-warn text-xs">sensitive</span>
              )}
            </div>
          ))}
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <ShieldCheck className="size-4 text-good" /> No ₱ amounts (never
            allowed)
          </div>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="size-4 accent-[var(--primary)]"
          />
          Remember these as defaults for {tpl.label}
        </label>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Btn variant="secondary" onClick={() => setCheck(false)}>
            Edit
          </Btn>
          <Btn onClick={doShare}>Confirm & share</Btn>
        </div>
      </BottomSheet>

      {/* DSH-32 result */}
      <BottomSheet
        open={!!result}
        onClose={() => setResult(null)}
        title={
          result === "error"
            ? "Couldn't render the card"
            : result === "shared"
              ? "Shared ✓"
              : "Saved ✓"
        }
      >
        {result === "error" ? (
          <>
            <p className="text-muted-foreground text-sm">
              Something went wrong while drawing the image. Nothing was shared.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Btn variant="secondary" onClick={() => setResult(null)}>
                Done
              </Btn>
              <Btn
                onClick={() => {
                  setResult(null)
                  setCheck(true)
                }}
              >
                <RotateCw className="size-4" /> Retry
              </Btn>
            </div>
          </>
        ) : result === "shared" ? (
          <>
            <p className="text-muted-foreground text-sm">
              Sent to the app you picked.
            </p>
            <Btn className="mt-4 w-full" onClick={() => setResult(null)}>
              Done
            </Btn>
          </>
        ) : (
          <>
            <p className="text-muted-foreground text-sm">
              Your browser can't share images directly, so the card was saved
              and the caption copied.
            </p>
            <Card className="mt-3 flex items-center gap-3 bg-muted/40">
              <Camera className="size-6 text-hab" />
              <div className="text-sm">
                Open Camera → <b>Story</b> → pick the image from your gallery →
                paste the caption.
              </div>
            </Card>
            <Btn className="mt-4 w-full" onClick={() => setResult(null)}>
              Done
            </Btn>
          </>
        )}
      </BottomSheet>
    </Screen>
  )
}
