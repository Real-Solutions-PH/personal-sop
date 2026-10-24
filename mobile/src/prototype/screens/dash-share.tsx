import {
  AREA,
  type Goal,
  MODULE_KEYS,
  type ShareTemplate,
} from "@domain/dash/data"
import type { Facet } from "@domain/dash/facets"
import { parseMetric } from "@domain/dash/hooks"
import {
  type CardData,
  COMMON,
  TEMPLATES,
  useCardData,
} from "@domain/dash/share-data"
import { dashStore, saveShareDefaults } from "@domain/dash/store"
import { containsMoney } from "@domain/lib/money"
import { useLocalSearchParams } from "expo-router"
import {
  BookOpen,
  Check,
  Crown,
  Dumbbell,
  Flame,
  ListChecks,
  Repeat,
  ShieldCheck,
  Target,
  TrendingUp,
  Trophy,
  Utensils,
} from "lucide-react-native"
import { type ReactNode, useRef, useState } from "react"
import { Image, View } from "react-native"
import Svg, {
  Polygon,
  Line as SvgLine,
  Text as SvgText,
  TSpan,
} from "react-native-svg"
import {
  border,
  Copy,
  Frame,
  Line,
  LinkRow,
  SectionHeading,
  Tap,
} from "../native-kit"
import { fmt, pct } from "../share-format"
import {
  alpha,
  CardFrame,
  type CardLook,
  CardRing,
  Chip,
  cardInk,
  Delta,
  type Dot,
  Dots,
  Label,
  Meter,
  Num,
  ShareComposer,
  Stats,
  useCard,
  Words,
} from "../share-kit"
import { fonts, useTheme } from "../theme"
import { Button, Screen, Sheet, shareText, Toggle } from "../ui"

const areaColors = {
  habits: "hab",
  tasks: "tsk",
  fitness: "fit",
  finance: "fin",
} as const
/** A metric string, unless it carries money: share cards never show ₱. */
const safe = (s: string) => (containsMoney(s) ? "—" : s)
/** A metric's number, grouped ("1,234 kg") when it is a plain count. */
const metric = (s: string | undefined) => {
  if (!s) return "—"
  if (containsMoney(s)) return "—"
  // A plain count or percent ("1234567", "1234%", "+1,234%") is regrouped;
  // anything with words or units is shown as the area wrote it.
  const m = s.trim().match(/^([+−-]?)([\d,]+(?:\.\d+)?)(%?)$/)
  if (!m) return s
  const n = Number(m[2].replace(/,/g, ""))
  return `${m[1]}${fmt(n, m[3] ? 5 : 6)}${m[3]}`
}
/** "≥ 1.2M kg / week": the goal's target, grouped like every card number. */
const goalTarget = (g: Goal) =>
  safe(
    `${g.comparator === "gte" ? "≥" : "≤"} ${fmt(g.target, 6, 1)}${g.unit === "%" ? "%" : g.unit ? ` ${g.unit}` : ""} / ${g.period}`,
  )
const verdict = (n: number | null) =>
  n === null
    ? "Getting started"
    : n >= 0.9
      ? "Elite form"
      : n >= 0.75
        ? "On fire"
        : n >= 0.6
          ? "Locked in"
          : n >= 0.4
            ? "Building"
            : "Showing up"
const defaults = (
  key: ShareTemplate,
  saved: ReturnType<typeof dashStore.get>["share"],
) => ({
  ...Object.fromEntries(
    [...TEMPLATES.find((x) => x.key === key)!.fields, ...COMMON].map((f) => [
      f.key,
      f.on,
    ]),
  ),
  ...saved[key],
})
const short = (day: string | undefined) =>
  day
    ? new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
      })
    : ""
const dayDots = (range: CardData["w30"]["range"]): Dot[] =>
  range.map((x) =>
    x.onTarget === true ? "on" : x.onTarget === false ? "off" : "none",
  )
/** The six area facets as a hexagon: this period solid, the last dashed. */
function Hexagon({
  facets,
  size,
  days,
}: {
  facets: Facet[]
  size: number
  days: number
}) {
  const { q, c } = useCard(),
    life = c.area("life"),
    point = (i: number, r: number) => [
      160 + r * Math.cos(((-90 + i * 60) * Math.PI) / 180),
      160 + r * Math.sin(((-90 + i * 60) * Math.PI) / 180),
    ],
    poly = (v: number[]) =>
      v
        .map((v, i) => point(i, 100 * Math.max(0.04, Math.min(1, v))).join(","))
        .join(" ")
  return (
    <View style={{ alignItems: "center", gap: q }}>
      <Svg width={size * q * 1.04} height={size * q} viewBox="-12 -6 344 332">
        {[0.25, 0.5, 0.75, 1].map((v) => (
          <Polygon
            key={v}
            points={poly(Array(6).fill(v))}
            fill="none"
            stroke={c.track}
            strokeWidth={1.5}
          />
        ))}
        {facets.map((f, i) => {
          const [x, y] = point(i, 100)
          return (
            <SvgLine
              key={f.key}
              x1={160}
              y1={160}
              x2={x}
              y2={y}
              stroke={c.track}
              strokeWidth={1.5}
            />
          )
        })}
        <Polygon
          points={poly(facets.map((f) => (f.off ? 0 : f.prev)))}
          fill="none"
          stroke={c.muted}
          strokeDasharray="6 5"
          strokeWidth={2}
        />
        <Polygon
          points={poly(facets.map((f) => (f.off ? 0 : f.value)))}
          fill={alpha(life, 0.28)}
          stroke={life}
          strokeWidth={3.5}
          strokeLinejoin="round"
        />
        {facets.map((f, i) => {
          const [x, y] = point(i, 136)
          return (
            <SvgText key={f.key} x={x} y={y} textAnchor="middle">
              <TSpan
                x={x}
                dy="-.1em"
                fontFamily={fonts.mono}
                fontSize={28}
                fill={c.ink}
              >
                {f.off ? "—" : Math.round(f.value * 100)}
              </TSpan>
              <TSpan
                x={x}
                dy="1.1em"
                fontFamily={fonts.medium}
                fontSize={18}
                fill={c.muted}
              >
                {f.label}
              </TSpan>
            </SvgText>
          )
        })}
      </Svg>
      <Line style={{ gap: 3 * q }}>
        <Line style={{ gap: q }}>
          <View
            style={{ width: 4 * q, height: 0.6 * q, backgroundColor: life }}
          />
          <Label>{`Last ${days} days`}</Label>
        </Line>
        <Line style={{ gap: q }}>
          <View
            style={{
              width: 4 * q,
              height: 0,
              borderTopWidth: 0.6 * q,
              borderStyle: "dashed",
              borderColor: c.muted,
            }}
          />
          <Label>{`Prior ${days} days`}</Label>
        </Line>
      </Line>
    </View>
  )
}
/** Area bars: one per enabled area, its on-target rate. */
function AreaMeters({ d }: { d: CardData }) {
  const { q, c } = useCard()
  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        rowGap: 3 * q,
        columnGap: 5 * q,
      }}
    >
      {MODULE_KEYS.filter((k) => d.enabled[k]).map((k) => (
        <View key={k} style={{ width: "46%", gap: q }}>
          <Line style={{ justifyContent: "space-between", gap: q }}>
            <View style={{ flexShrink: 1 }}>
              <Label>{AREA[k].label}</Label>
            </View>
            <Num size={3.6}>{pct(d.life.rates[k])}</Num>
          </Line>
          <Meter value={d.life.rates[k]} color={c.area(areaColors[k])} />
        </View>
      ))}
    </View>
  )
}
function Weekdays({ range }: { range: CardData["w7"]["range"] }) {
  const { q } = useCard()
  return (
    <Line style={{ gap: 1.4 * q, marginTop: q }}>
      {range.map((x) => (
        <View key={x.day} style={{ flex: 1 }}>
          <Label align="center">
            {"SMTWTFS"[new Date(`${x.day}T12:00:00`).getDay()]}
          </Label>
        </View>
      ))}
    </Line>
  )
}
export function Artwork({
  kind,
  width,
  look,
  on,
  d,
}: {
  kind: ShareTemplate
  width: number
  look: CardLook
  on: Record<string, boolean>
  d: CardData
}) {
  const c = cardInk(look),
    q = width / 100,
    tall = look.format === "9:16",
    sq = look.format === "1:1",
    life = c.area("life"),
    date =
      kind === "weekly"
        ? `${short(d.w7.range[0]?.day)} – ${short(d.w7.range.at(-1)?.day)}`
        : ["life", "monthly", "finance"].includes(kind)
          ? "Last 30 days"
          : new Date().toLocaleDateString("en-GB", {
              month: "long",
              year: "numeric",
            })
  let body: ReactNode = null,
    kicker = "Life Score"
  if (kind === "life") {
    const size = sq ? 38 : tall ? 54 : 40
    const score = (
      <View style={{ alignItems: "center", gap: 2.5 * q }}>
        <CardRing value={(d.life.score ?? 0) / 100} size={size} color={life}>
          <Num size={size * 0.34} align="center">
            {d.life.score === null ? "—" : fmt(d.life.score)}
          </Num>
          <Label align="center">of 100</Label>
        </CardRing>
        <View style={{ alignItems: "center", gap: 1.4 * q }}>
          {on.level && (
            <Chip icon={Crown} tone={life}>
              {d.level}
            </Chip>
          )}
          {on.delta && (
            <Delta n={d.life.delta} unit=" pts" suffix="vs last month" />
          )}
        </View>
      </View>
    )
    body = (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          flexDirection: sq ? "row" : "column",
          gap: 4 * q,
        }}
      >
        {score}
        {on.hexagon && (
          <Hexagon
            facets={d.facets30}
            days={30}
            size={sq ? 40 : tall ? 46 : 34}
          />
        )}
        {on.areas && (tall || !on.hexagon) && !sq && (
          <View style={{ alignSelf: "stretch" }}>
            <AreaMeters d={d} />
          </View>
        )}
      </View>
    )
  }
  if (kind === "weekly") {
    kicker = "Week recap"
    const delta = (n?: number) =>
      on.deltas && n ? <Delta n={n} suffix="vs last wk" /> : undefined
    const items = [
      ...(on.habits && d.habits7
        ? [
            {
              label: "Habits",
              value: metric(d.habits7.value),
              delta: delta(d.habits7.delta),
            },
          ]
        : []),
      ...(on.training && d.training7
        ? [
            {
              label: "Training",
              value: metric(d.training7.value),
              delta: delta(d.training7.delta),
            },
          ]
        : []),
      ...(on.savings && d.savings7
        ? [
            {
              label: "Saved",
              value: metric(d.savings7.value),
              delta: delta(d.savings7.delta),
            },
          ]
        : []),
    ]
    body = (
      <View style={{ flex: 1, justifyContent: "center", gap: 4 * q }}>
        <Line style={{ gap: 4 * q }}>
          {on.onTarget && (
            <CardRing value={d.w7.rate ?? 0} size={sq ? 28 : 32} color={life}>
              <Num size={8} align="center">
                {pct(d.w7.rate)}
              </Num>
              <Label align="center">on target</Label>
            </CardRing>
          )}
          <View style={{ flex: 1, gap: q }}>
            <Words size={8} weight="semibold">
              {verdict(d.w7.rate)}
            </Words>
            {on.deltas && d.w7.rate !== null && d.w7.prevRate !== null && (
              <Delta
                n={Math.round((d.w7.rate - d.w7.prevRate) * 100)}
                unit=" pts"
                suffix="vs last week"
              />
            )}
          </View>
        </Line>
        <View>
          <Dots cells={dayDots(d.w7.range)} cols={7} color={life} />
          <Weekdays range={d.w7.range} />
        </View>
        {on.hexagon && !sq && (
          <Hexagon facets={d.facets7} days={7} size={tall ? 38 : 24} />
        )}
        <Stats items={items} cols={3} size={tall ? 8 : 7} />
        {on.trophy && d.trophy && !sq && (
          <Chip icon={Trophy} tone={life}>
            {safe(d.trophy.title)}
          </Chip>
        )}
      </View>
    )
  }
  if (kind === "monthly") {
    kicker = "Month recap"
    const items = on.hero
      ? [
          { label: "On target", value: pct(d.w30.rate) },
          ...(d.habits30
            ? [{ label: "Habits", value: metric(d.habits30.value) }]
            : []),
          ...(d.training30
            ? [{ label: "Workouts", value: metric(d.training30.value) }]
            : []),
          ...(d.savings30
            ? [{ label: "Saved", value: metric(d.savings30.value) }]
            : []),
        ]
      : []
    const prs = d.prs30 ? (parseMetric(d.prs30.value) ?? 0) : 0
    body = (
      <View style={{ flex: 1, justifyContent: "center", gap: 4 * q }}>
        <View style={{ gap: 2 * q }}>
          <Words size={12} weight="semibold" lines={1}>
            {new Date().toLocaleDateString("en-GB", { month: "long" })}
          </Words>
          <View
            style={{ flexDirection: "row", flexWrap: "wrap", gap: 1.6 * q }}
          >
            <Chip icon={Flame} tone={life}>
              {verdict(d.w30.rate)}
            </Chip>
            {on.prs && prs > 0 && (
              <Chip icon={Trophy} tone={life}>
                {`${fmt(prs)} ${prs === 1 ? "PR" : "PRs"}`}
              </Chip>
            )}
            {on.streak && <Chip>{`${fmt(d.w30.best)}-day best streak`}</Chip>}
          </View>
        </View>
        {!sq && <Dots cells={dayDots(d.w30.range)} cols={10} color={life} />}
        {on.hexagon && tall && (
          <Hexagon facets={d.facets30} days={30} size={30} />
        )}
        <Stats items={items} cols={sq ? 4 : 2} size={sq ? 6.5 : 9} />
        {on.highlight && tall && !on.hexagon && (
          <Words size={3.6}>
            {`${fmt(d.w30.onTarget)} on-target days out of ${fmt(d.w30.scored)}.`}
          </Words>
        )}
      </View>
    )
  }
  if (kind === "streak") {
    kicker = "On-target streak"
    const best = d.w7.current > 0 && d.w7.current >= d.w7.best
    body = (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          gap: 3.5 * q,
        }}
      >
        <CardRing
          value={d.w7.best ? d.w7.current / d.w7.best : 0}
          size={tall ? 58 : 42}
          color={life}
        >
          <Flame size={7 * q} color={life} strokeWidth={2} />
          <Num size={tall ? 18 : 13} align="center">
            {fmt(d.w7.current)}
          </Num>
          <Label align="center">{d.w7.current === 1 ? "day" : "days"}</Label>
        </CardRing>
        <Words size={5} weight="semibold" align="center">
          On target, day after day
        </Words>
        {on.best && (
          <Chip icon={best ? Trophy : undefined} tone={life}>
            {best ? "Personal best" : `Best ${fmt(d.w7.best)} days`}
          </Chip>
        )}
        {on.grid && !sq && (
          <View style={{ alignSelf: "stretch" }}>
            <Dots cells={dayDots(d.w30.range)} cols={10} color={life} />
          </View>
        )}
      </View>
    )
  }
  if (kind === "finance") {
    kicker = "Money, in percent"
    const fin = c.area("fin"),
      sr = d.savings30 ? parseMetric(d.savings30.value) : null,
      items = [
        ...(on.spend && d.spend30
          ? [{ label: "Spend vs last month", value: metric(d.spend30.value) }]
          : []),
        ...(on.budgets && (sq || d.budgetsPct === null)
          ? [
              {
                label: "Budgets kept",
                value: d.budgetsPct === null ? "—" : `${fmt(d.budgetsPct)}%`,
              },
            ]
          : []),
        ...(on.nospend && d.nospend30
          ? [
              {
                label: "No-spend days",
                value: fmt(parseMetric(d.nospend30.value) ?? Number.NaN),
              },
            ]
          : []),
      ]
    body = (
      <View style={{ flex: 1, justifyContent: "center", gap: 5 * q }}>
        {on.savings && d.savings30 && (
          <Line style={{ gap: 5 * q }}>
            <CardRing
              value={(sr ?? 0) / 100}
              size={sq ? 30 : tall ? 44 : 38}
              color={fin}
            >
              <Num size={sq ? 8 : 10} align="center">
                {sr === null ? "—" : `${fmt(Math.round(sr), 5)}%`}
              </Num>
            </CardRing>
            <View style={{ flex: 1, gap: q }}>
              <Label>Savings rate</Label>
              <Words size={7} weight="semibold">
                {sr === null
                  ? "Tracking"
                  : sr >= 20
                    ? "Saving strong"
                    : sr > 0
                      ? "In the green"
                      : "Rebuilding"}
              </Words>
            </View>
          </Line>
        )}
        {on.budgets && d.budgetsPct !== null && !sq && (
          <View style={{ gap: 1.6 * q }}>
            <Line style={{ justifyContent: "space-between" }}>
              <Label>Budgets kept</Label>
              <Num size={4.4}>{`${fmt(d.budgetsPct)}%`}</Num>
            </Line>
            <Meter value={d.budgetsPct / 100} color={fin} height={2} />
          </View>
        )}
        <Stats
          items={items}
          cols={items.length === 2 ? 2 : Math.max(1, items.length)}
          size={tall ? 10 : 8}
        />
      </View>
    )
  }
  if (kind === "profile") {
    kicker = "Profile"
    body = (
      <View style={{ flex: 1, justifyContent: "center", gap: 4 * q }}>
        <Line style={{ gap: 4 * q }}>
          {on.photo && d.photo ? (
            <Image
              source={{ uri: d.photo }}
              style={{ width: 18 * q, height: 18 * q, borderRadius: 9 * q }}
            />
          ) : (
            <View
              style={{
                width: 18 * q,
                height: 18 * q,
                borderRadius: 9 * q,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: c.panel,
                borderWidth: 1,
                borderColor: c.line,
              }}
            >
              <Words size={6} weight="semibold" lines={1}>
                {d.name
                  .split(/\s+/)
                  .filter(Boolean)
                  .map((w) => w[0])
                  .slice(0, 2)
                  .join("")
                  .toUpperCase()}
              </Words>
            </View>
          )}
          <View style={{ flex: 1, gap: 1.5 * q }}>
            <Words size={8} weight="semibold">
              {d.name}
            </Words>
            <Chip icon={Crown} tone={life}>
              {d.level}
            </Chip>
          </View>
        </Line>
        {on.identity &&
          !sq &&
          d.identities.slice(0, 3).map((x) => (
            <Words key={x} size={3.6} muted>
              {`“${x}”`}
            </Words>
          ))}
        {on.hexagon && !sq && (
          <Hexagon facets={d.facets30} days={30} size={tall ? 40 : 28} />
        )}
        <Stats
          items={[
            {
              label: "Score",
              value: d.life.score === null ? "—" : fmt(d.life.score),
            },
            { label: "Hit rate", value: pct(d.w30.rate) },
            { label: "Best streak", value: fmt(d.w30.best), unit: "d" },
            ...(d.savings30
              ? [{ label: "Saved", value: metric(d.savings30.value) }]
              : []),
          ]}
          cols={2}
          size={7}
        />
        {on.records && (
          <View
            style={{ flexDirection: "row", flexWrap: "wrap", gap: 1.6 * q }}
          >
            {d.trophies.slice(0, sq ? 2 : 3).map((x) => (
              <Chip key={x.id} icon={Trophy} tone={life}>
                {`${metric(x.value)} · ${safe(x.title)}`}
              </Chip>
            ))}
          </View>
        )}
      </View>
    )
  }
  if (kind === "goal") {
    kicker = "Goal"
    const g = d.goal,
      fin = g?.goal.metric.startsWith("finance:"),
      Icon = g?.hit ? Target : TrendingUp,
      shown = g ? `${fmt(Math.round(Math.min(g.pct, 99.99) * 100), 5)}%` : "—"
    body = g ? (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          gap: 3 * q,
        }}
      >
        <CardRing value={g.pct} size={tall ? 52 : sq ? 36 : 40} color={life}>
          <Icon size={7 * q} color={life} strokeWidth={2} />
          <Num size={tall ? 11 : 9} align="center">
            {shown}
          </Num>
        </CardRing>
        <Chip icon={g.hit ? Check : undefined} tone={c.good}>
          {g.hit ? "Goal hit" : "In progress"}
        </Chip>
        <Words size={7} weight="semibold" align="center">
          {safe(g.goal.label)}
        </Words>
        <View style={{ alignItems: "center", alignSelf: "stretch" }}>
          <Num size={tall ? 14 : 11} align="center">
            {fin ? shown : metric(g.entry?.value)}
          </Num>
          {on.target && (
            <Label align="center">
              {fin ? "of target" : `Target ${goalTarget(g.goal)}`}
            </Label>
          )}
        </View>
      </View>
    ) : (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <Words size={4} muted align="center">
          No goals yet
        </Words>
      </View>
    )
  }
  return (
    <CardFrame
      width={width}
      look={look}
      kicker={kicker}
      date={on.dates ? date : ""}
      mark={on.mark}
      foot={[
        on.handle ? d.handle : "",
        kind === "finance"
          ? "Percentages only. Amounts never leave the app."
          : "",
      ]
        .filter(Boolean)
        .join(" · ")}
    >
      {body}
    </CardFrame>
  )
}
export function ShareCard() {
  const t = useTheme(),
    params = useLocalSearchParams<{ t?: ShareTemplate; goal?: string }>(),
    saved = dashStore.use((s) => s.share),
    [kind, setKind] = useState<ShareTemplate>(
      TEMPLATES.some((x) => x.key === params.t) ? params.t! : "life",
    ),
    [on, setOn] = useState(() => defaults(kind, saved)),
    [check, setCheck] = useState(false),
    [remember, setRemember] = useState(false),
    [currentLook, setCurrentLook] = useState<CardLook>({
      format: "9:16",
      backdrop: "dark",
      photo: null,
    }),
    proceed = useRef<(() => Promise<void>) | null>(null),
    d = useCardData(params.goal ?? null),
    tpl = TEMPLATES.find((x) => x.key === kind)!,
    fields = [...tpl.fields, ...COMMON],
    caption = `${d.name.split(" ")[0]}'s ${tpl.label.toLowerCase()}: Life Score ${d.life.score === null ? "—" : fmt(d.life.score)} (${d.level}), on-target streak ${fmt(d.w7.current)} days · Unfurl`
  const change = (k: ShareTemplate) => {
    setKind(k)
    setOn(defaults(k, saved))
  }
  return (
    <Screen title="Share card">
      <ShareComposer
        onLookChange={setCurrentLook}
        shareRef={proceed}
        value={kind}
        onChange={change}
        items={TEMPLATES.map((x) => ({
          key: x.key,
          label: x.label,
          render: (width, look) => (
            <Artwork
              kind={x.key}
              width={width}
              look={{
                ...look,
                format: x.formats.includes(look.format)
                  ? look.format
                  : x.formats[0],
              }}
              on={x.key === kind ? on : defaults(x.key, saved)}
              d={d}
            />
          ),
        }))}
        formats={tpl.formats}
        caption={caption}
        beforeShare={(action) => {
          proceed.current = action
          setCheck(true)
        }}
      >
        <View>
          <SectionHeading>Show on card</SectionHeading>
          <Frame style={{ paddingHorizontal: 12, paddingVertical: 4 }}>
            {fields.map((f) => (
              <Tap
                key={f.key}
                onPress={() => setOn((o) => ({ ...o, [f.key]: !o[f.key] }))}
              >
                <Line
                  style={{
                    minHeight: 44,
                    gap: 12,
                    borderBottomWidth: 1,
                    borderBottomColor: border(t.line, 0.5),
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Copy size={14}>{f.label}</Copy>
                    {f.sensitive && (
                      <Copy size={10} style={{ color: t.warn }}>
                        {f.sensitive}
                      </Copy>
                    )}
                  </View>
                  <View
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 3,
                      borderWidth: 1,
                      borderColor: on[f.key] ? t.primary : t.muted,
                      backgroundColor: on[f.key] ? t.primary : "transparent",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {on[f.key] && <Check size={16} color={t.bg} />}
                  </View>
                </Line>
              </Tap>
            ))}
          </Frame>
          <Line
            style={{
              alignItems: "flex-start",
              gap: 6,
              marginTop: 8,
              paddingHorizontal: 4,
            }}
          >
            <ShieldCheck size={14} color={t.muted} />
            <Copy size={12} muted style={{ flex: 1 }}>
              Money amounts, body weight, task titles, journal text and account
              names never appear on a card.
            </Copy>
          </Line>
          <View style={{ marginTop: 16 }}>
            <Button onPress={() => setCheck(true)}>Share</Button>
          </View>
          <SectionHeading>More cards</SectionHeading>
          <Frame style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
            <LinkRow
              title="Habit streaks & routines"
              icon={Repeat}
              accent="hab"
              href="/habits/share"
            />
            <LinkRow
              title="Workout & PRs"
              icon={Dumbbell}
              accent="fit"
              href="/fitness"
            />
            <LinkRow
              title="Task follow-through"
              icon={ListChecks}
              accent="tsk"
              href="/tasks/share"
            />
            <LinkRow
              title="Food day"
              icon={Utensils}
              accent="nut"
              href="/fitness/nutrition/share"
            />
            <LinkRow
              title="Journal streak"
              icon={BookOpen}
              accent="life"
              href="/journal/share"
            />
          </Frame>
        </View>
      </ShareComposer>
      <Sheet title="Privacy check" open={check} onClose={() => setCheck(false)}>
        <Copy size={14} muted>
          This is exactly what will be shared.
        </Copy>
        <View style={{ alignItems: "center" }}>
          <Artwork kind={kind} width={180} look={currentLook} on={on} d={d} />
        </View>
        {fields.some((f) => f.sensitive && on[f.key]) && (
          <Frame style={{ padding: 12, backgroundColor: border(t.warn, 0.15) }}>
            <Copy size={14} style={{ color: t.warn }}>
              This shows{" "}
              {fields
                .filter((f) => f.sensitive && on[f.key])
                .map((f) => f.label.toLowerCase())
                .join(" and ")}
              . Continue?
            </Copy>
          </Frame>
        )}
        {fields
          .filter((f) => on[f.key])
          .map((f) => (
            <Line key={f.key} style={{ gap: 8 }}>
              <Check size={16} color={f.sensitive ? t.warn : t.good} />
              <Copy size={14} style={{ flex: 1 }}>
                {f.label}
              </Copy>
              {f.sensitive && (
                <Copy size={12} style={{ color: t.warn }}>
                  sensitive
                </Copy>
              )}
            </Line>
          ))}
        <Copy size={14} muted>
          No money amounts. Cards never show them.
        </Copy>
        <Toggle
          label={`Remember these as defaults for ${tpl.label}`}
          value={remember}
          onChange={setRemember}
        />
        <Line style={{ gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Button tone="quiet" onPress={() => setCheck(false)}>
              Edit
            </Button>
          </View>
          <View style={{ flex: 1 }}>
            <Button
              onPress={() => {
                if (remember) saveShareDefaults(kind, on)
                setCheck(false)
                if (proceed.current) void proceed.current()
                else void shareText(caption)
              }}
            >
              Confirm & share
            </Button>
          </View>
        </Line>
      </Sheet>
    </Screen>
  )
}
