import { AREA, MODULE_KEYS, type ShareTemplate } from "@domain/dash/data"
import type { Facet } from "@domain/dash/facets"
import { fmtGoal, parseMetric } from "@domain/dash/hooks"
import {
  type CardData,
  COMMON,
  TEMPLATES,
  useCardData,
} from "@domain/dash/share-data"
import { dashStore, saveShareDefaults } from "@domain/dash/store"
import { containsMoney } from "@domain/lib/money"
import { LinearGradient } from "expo-linear-gradient"
import { useLocalSearchParams } from "expo-router"
import {
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
} from "lucide-react-native"
import { type ReactNode, useRef, useState } from "react"
import { Image, Text, View } from "react-native"
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
import { CardFrame, type CardLook, ShareComposer } from "../share-kit"
import { fonts, useTheme } from "../theme"
import { Button, Screen, Sheet, shareText } from "../ui"
import { Ring } from "../visual"

const accents = {
  life: "life",
  weekly: "life",
  monthly: "hab",
  streak: "life",
  finance: "fin",
  profile: "life",
  goal: "life",
} as const
const areaColors = {
  habits: "hab",
  tasks: "tsk",
  fitness: "fit",
  finance: "fin",
} as const
const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`)
const safe = (s: string) => (containsMoney(s) ? "—" : s)
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
function Hexagon({
  facets,
  size,
  ink,
  days,
}: {
  facets: Facet[]
  size: number
  ink: string
  days: number
}) {
  const t = useTheme(),
    point = (i: number, r: number) => [
      160 + r * Math.cos(((-90 + i * 60) * Math.PI) / 180),
      160 + r * Math.sin(((-90 + i * 60) * Math.PI) / 180),
    ],
    poly = (v: number[]) =>
      v
        .map((v, i) => point(i, 100 * Math.max(0.04, Math.min(1, v))).join(","))
        .join(" ")
  return (
    <View style={{ alignItems: "center" }}>
      <Svg width={size * 1.04} height={size} viewBox="-12 -6 344 332">
        {[0.25, 0.5, 0.75, 1].map((v) => (
          <Polygon
            key={v}
            points={poly(Array(6).fill(v))}
            fill="none"
            stroke={ink}
            strokeOpacity={v === 1 ? 0.35 : 0.15}
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
              stroke={ink}
              strokeOpacity={0.15}
              strokeWidth={1.5}
            />
          )
        })}
        <Polygon
          points={poly(facets.map((f) => (f.off ? 0 : f.prev)))}
          fill="none"
          stroke={ink}
          strokeOpacity={0.6}
          strokeDasharray="6 5"
          strokeWidth={2}
        />
        <Polygon
          points={poly(facets.map((f) => (f.off ? 0 : f.value)))}
          fill={border(t.life, 0.3)}
          stroke={t.life}
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
                fontFamily={fonts.displayHeavy}
                fontSize={30}
                fill={f.off ? ink : t[areaColors[f.module]]}
              >
                {f.off ? "—" : Math.round(f.value * 100)}
              </TSpan>
              <TSpan
                x={x}
                dy="1.05em"
                fontFamily={fonts.displayMedium}
                fontSize={18}
                fill={ink}
                fillOpacity={0.75}
              >
                {f.label}
              </TSpan>
            </SvgText>
          )
        })}
      </Svg>
      <Text
        style={{
          fontFamily: fonts.body,
          fontSize: size * 0.061,
          color: ink,
          opacity: 0.75,
          letterSpacing: 0.4,
        }}
      >
        ━ LAST {days}D ┄ PRIOR {days}D
      </Text>
    </View>
  )
}
function Artwork({
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
  const t = useTheme(),
    q = width / 100,
    tall = look.format === "9:16",
    sq = look.format === "1:1",
    ink = look.backdrop === "paper" ? t["share-paper-ink"] : "#fff",
    hi = t[accents[kind]],
    panel = look.backdrop === "paper" ? "#0000000d" : "#ffffff17",
    date =
      kind === "weekly"
        ? `${new Date(`${d.w7.range[0]?.day}T12:00:00`).toLocaleDateString("en-PH", { month: "short", day: "numeric" })} – ${new Date(`${d.w7.range.at(-1)?.day}T12:00:00`).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}`
        : ["life", "monthly", "finance"].includes(kind)
          ? "Last 30 days"
          : new Date().toLocaleDateString("en-PH", {
              month: "long",
              year: "numeric",
            })
  const text = (
    s: string,
    n: number,
    display = false,
    color = ink,
    align: "left" | "center" = "left",
  ) => (
    <Text
      numberOfLines={2}
      style={{
        fontFamily: display ? fonts.displayHeavy : fonts.semibold,
        fontSize: n * q,
        lineHeight: n * q * (display ? 1 : 1.3),
        color,
        textAlign: align,
      }}
    >
      {safe(s)}
    </Text>
  )
  const label = (s: string) => (
    <Text
      style={{
        fontFamily: fonts.semibold,
        fontSize: 3.2 * q,
        color: ink,
        opacity: 0.65,
        letterSpacing: 0.3 * q,
        textTransform: "uppercase",
      }}
    >
      {s}
    </Text>
  )
  const medal = (s: string, Icon?: typeof Crown, gold = false) => (
    <View
      style={{
        alignSelf: "flex-start",
        paddingHorizontal: 2.5 * q,
        paddingVertical: 1.5 * q,
        borderRadius: 12 * q,
        backgroundColor: gold ? border(t.life, 0.17) : panel,
        flexDirection: "row",
        alignItems: "center",
        gap: 1.4 * q,
      }}
    >
      {Icon && <Icon size={3.6 * q} color={gold ? t.life : ink} />}
      {text(s, 3.2, false, gold ? t.life : ink)}
    </View>
  )
  const delta = (n: number | null | undefined, suffix = "") =>
    n != null && n !== 0 ? (
      <View style={{ alignSelf: "flex-start" }}>
        {text(
          `${n > 0 ? "▲" : "▼"} ${Math.abs(n)} ${suffix}`,
          3.2,
          false,
          n > 0 ? t.good : t.bad,
        )}
      </View>
    ) : null
  const stats = (
    items: { label: string; value: string; delta?: number }[],
    cols = items.length,
    size = 10,
  ) => (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 2 * q }}>
      {items.map((x) => (
        <View
          key={x.label}
          style={{
            width: `${(100 - (cols - 1) * 2) / cols}%`,
            padding: 3 * q,
            backgroundColor: panel,
            borderRadius: 3 * q,
          }}
        >
          {text(x.value, size, true)}
          <View style={{ marginTop: 1 * q }}>{label(x.label)}</View>
          {x.delta !== undefined && delta(x.delta)}
        </View>
      ))}
    </View>
  )
  const grid = (range: CardData["w30"]["range"], cols: number) => (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 1.5 * q }}>
      {range.map((x) => (
        <View
          key={x.day}
          style={{
            width: `${(100 - (cols - 1) * 1.5) / cols}%`,
            aspectRatio: 1,
            borderRadius: 1.5 * q,
            backgroundColor:
              x.onTarget === true
                ? hi
                : x.onTarget === false
                  ? border(ink, 0.18)
                  : border(ink, 0.07),
          }}
        />
      ))}
    </View>
  )
  const ring = (value: number, size: number, children: ReactNode) => (
    <Ring
      value={value}
      size={size * q}
      strokeWidth={size * 0.085 * q}
      color={hi}
      hero
      gradientColors={[t.hab, hi]}
    >
      {children}
    </Ring>
  )
  const meters = (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 3 * q }}>
      {MODULE_KEYS.filter((k) => d.enabled[k]).map((k) => (
        <View key={k} style={{ width: "47%" }}>
          <Line style={{ justifyContent: "space-between", gap: q }}>
            {label(AREA[k].label)}
            {text(pct(d.life.rates[k]), 3.5)}
          </Line>
          <View
            style={{
              height: 1.8 * q,
              backgroundColor: panel,
              borderRadius: q,
              marginTop: q,
            }}
          >
            <View
              style={{
                height: "100%",
                width: `${Math.max(0, Math.min(1, d.life.rates[k])) * 100}%`,
                backgroundColor: t[areaColors[k]],
                borderRadius: q,
              }}
            />
          </View>
        </View>
      ))}
    </View>
  )
  let body: ReactNode = null,
    kicker = "Life Score"
  if (kind === "life") {
    const size = sq ? 38 : tall ? 54 : 40
    const score = (
      <View style={{ alignItems: "center", gap: 2.5 * q }}>
        {ring(
          (d.life.score ?? 0) / 100,
          size,
          <>
            {text(String(d.life.score ?? "—"), size * 0.42, true)}
            {label("of 100")}
          </>,
        )}
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: 1.6 * q,
          }}
        >
          {on.level && medal(d.level, Crown, true)}
          {on.delta && delta(d.life.delta, "vs last month")}
        </View>
      </View>
    )
    body = (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: sq ? "center" : undefined,
          flexDirection: sq ? "row" : "column",
          gap: 4 * q,
        }}
      >
        {score}
        {on.hexagon && (
          <Hexagon
            facets={d.facets30}
            days={30}
            size={(sq ? 40 : tall ? 46 : 34) * q}
            ink={ink}
          />
        )}
        {on.areas && (tall || !on.hexagon) && meters}
      </View>
    )
  }
  if (kind === "weekly") {
    kicker = "Week recap"
    const items = [
      ...(on.habits && d.habits7
        ? [
            {
              label: "Habits",
              value: d.habits7.value,
              delta: on.deltas ? d.habits7.delta : undefined,
            },
          ]
        : []),
      ...(on.training && d.training7
        ? [
            {
              label: "Training",
              value: d.training7.value,
              delta: on.deltas ? d.training7.delta : undefined,
            },
          ]
        : []),
      ...(on.savings && d.savings7
        ? [
            {
              label: "Saved",
              value: safe(d.savings7.value),
              delta: on.deltas ? d.savings7.delta : undefined,
            },
          ]
        : []),
    ]
    body = (
      <View style={{ flex: 1, justifyContent: "center", gap: 4 * q }}>
        <Line style={{ gap: 4 * q }}>
          {on.onTarget &&
            ring(
              d.w7.rate ?? 0,
              sq ? 28 : 34,
              <>
                {text(pct(d.w7.rate), 10, true)}
                {label("on target")}
              </>,
            )}
          <View style={{ flex: 1 }}>
            {text(verdict(d.w7.rate), 11, true)}
            {on.deltas &&
              d.w7.rate !== null &&
              d.w7.prevRate !== null &&
              delta(
                Math.round((d.w7.rate - d.w7.prevRate) * 100),
                "% vs last week",
              )}
          </View>
        </Line>
        <View>
          {grid(d.w7.range, 7)}
          <Line style={{ gap: 0, marginTop: q }}>
            {d.w7.range.map((x) => (
              <View key={x.day} style={{ flex: 1, alignItems: "center" }}>
                {text("SMTWTFS"[new Date(x.day).getDay()], 2.8)}
              </View>
            ))}
          </Line>
        </View>
        {on.hexagon && !sq && (
          <Hexagon
            facets={d.facets7}
            days={7}
            size={(tall ? 40 : 26) * q}
            ink={ink}
          />
        )}
        {stats(items, 3)}
        {on.trophy && d.trophy && !sq && medal(d.trophy.title, Trophy, true)}
      </View>
    )
  }
  if (kind === "monthly") {
    kicker = "Month recap"
    const items = on.hero
      ? [
          { label: "On target", value: pct(d.w30.rate) },
          ...(d.habits30 ? [{ label: "Habits", value: d.habits30.value }] : []),
          ...(d.training30
            ? [{ label: "Workouts", value: d.training30.value }]
            : []),
          ...(d.savings30
            ? [{ label: "Saved", value: safe(d.savings30.value) }]
            : []),
        ]
      : []
    body = (
      <View style={{ flex: 1, justifyContent: "center", gap: 4 * q }}>
        <View>
          {text(
            new Date().toLocaleDateString("en-PH", { month: "long" }),
            16,
            true,
          )}
          <View
            style={{
              marginTop: 2 * q,
              flexDirection: "row",
              flexWrap: "wrap",
              gap: 1.6 * q,
            }}
          >
            {medal(verdict(d.w30.rate), Flame)}
            {on.prs &&
              d.prs30 &&
              (parseMetric(d.prs30.value) ?? 0) > 0 &&
              medal(`${d.prs30.value} PRs`, Trophy, true)}
            {on.streak && medal(`${d.w30.best}-day best streak`, Flame)}
          </View>
        </View>
        {!sq && grid(d.w30.range, 10)}
        {on.hexagon && tall && (
          <Hexagon facets={d.facets30} days={30} size={28 * q} ink={ink} />
        )}
        {stats(items, sq ? 4 : 2, sq ? 8 : 11)}
        {on.highlight &&
          tall &&
          !on.hexagon &&
          text(`${d.w30.onTarget} on-target days out of ${d.w30.scored}.`, 3.4)}
      </View>
    )
  }
  if (kind === "streak") {
    kicker = "On-target streak"
    body = (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          gap: 3.5 * q,
        }}
      >
        {ring(
          d.w7.best ? d.w7.current / d.w7.best : 0,
          tall ? 58 : 42,
          <>
            <Flame size={9 * q} fill={hi} color={hi} />
            {text(String(d.w7.current), tall ? 24 : 18, true)}
          </>,
        )}
        {text("DAY STREAK", 7, true)}
        {on.best &&
          medal(
            d.w7.current > 0 && d.w7.current >= d.w7.best
              ? "Personal best"
              : `Best ${d.w7.best} days`,
            d.w7.current >= d.w7.best ? Trophy : undefined,
            d.w7.current >= d.w7.best,
          )}
        {on.grid && !sq && (
          <View style={{ width: "100%" }}>{grid(d.w30.range, 10)}</View>
        )}
      </View>
    )
  }
  if (kind === "finance") {
    kicker = "Money, in %"
    const sr = d.savings30 ? parseMetric(d.savings30.value) : null,
      items = [
        ...(on.spend && d.spend30
          ? [{ label: "Spend vs last mo.", value: d.spend30.value }]
          : []),
        ...(on.budgets && (sq || d.budgetsPct === null)
          ? [
              {
                label: "Budgets kept",
                value: d.budgetsPct === null ? "—" : `${d.budgetsPct}%`,
              },
            ]
          : []),
        ...(on.nospend && d.nospend30
          ? [
              {
                label: "No-spend days",
                value: String(parseMetric(d.nospend30.value) ?? "—"),
              },
            ]
          : []),
      ]
    body = (
      <View style={{ flex: 1, justifyContent: "center", gap: 5 * q }}>
        {on.savings && d.savings30 && (
          <Line style={{ gap: 5 * q }}>
            {ring(
              (sr ?? 0) / 100,
              sq ? 32 : tall ? 46 : 40,
              text(safe(d.savings30.value), 14, true),
            )}
            <View style={{ flex: 1 }}>
              {label("Savings rate")}
              <View style={{ marginTop: q }}>
                {text(
                  sr === null
                    ? "Tracking"
                    : sr >= 20
                      ? "Saving strong"
                      : sr > 0
                        ? "In the green"
                        : "Rebuilding",
                  10,
                  true,
                )}
              </View>
            </View>
          </Line>
        )}
        {on.budgets && d.budgetsPct !== null && !sq && (
          <View>
            <Line style={{ justifyContent: "space-between" }}>
              {label("Budgets kept")}
              {text(`${d.budgetsPct}%`, 4)}
            </Line>
            <View
              style={{
                height: 2 * q,
                borderRadius: q,
                backgroundColor: panel,
                marginTop: 2 * q,
              }}
            >
              <View
                style={{
                  height: "100%",
                  width: `${d.budgetsPct}%`,
                  borderRadius: q,
                  backgroundColor: hi,
                }}
              />
            </View>
          </View>
        )}
        {stats(
          items,
          items.length === 2 ? 2 : Math.max(1, items.length),
          tall ? 13 : 10,
        )}
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
              style={{
                width: 18 * q,
                height: 18 * q,
                borderRadius: 9 * q,
                borderWidth: 0.8 * q,
                borderColor: hi,
              }}
            />
          ) : (
            <LinearGradient
              colors={[t.hab, t.primary, t.fit]}
              style={{
                width: 18 * q,
                height: 18 * q,
                borderRadius: 9 * q,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {text(
                d.name
                  .split(" ")
                  .map((w) => w[0])
                  .slice(0, 2)
                  .join(""),
                7,
                true,
                "#fff",
              )}
            </LinearGradient>
          )}
          <View style={{ flex: 1 }}>
            {text(d.name, 10, true)}
            <View style={{ marginTop: 1.5 * q }}>
              {medal(d.level, Crown, true)}
            </View>
          </View>
        </Line>
        {on.identity &&
          !sq &&
          d.identities.slice(0, 3).map((x) => (
            <Text
              key={x}
              style={{
                fontFamily: fonts.body,
                fontSize: 3.6 * q,
                color: ink,
                fontStyle: "italic",
                opacity: 0.85,
              }}
            >
              “{x}”
            </Text>
          ))}
        {on.hexagon && !sq && (
          <Hexagon
            facets={d.facets30}
            days={30}
            size={(tall ? 42 : 30) * q}
            ink={ink}
          />
        )}
        {stats(
          [
            { label: "Score", value: String(d.life.score ?? "—") },
            { label: "Hit rate", value: pct(d.w30.rate) },
            { label: "Streak", value: `${d.w30.best}d` },
            ...(d.savings30
              ? [{ label: "Saved", value: safe(d.savings30.value) }]
              : []),
          ],
          4,
          8,
        )}
        {on.records && (
          <View
            style={{ flexDirection: "row", flexWrap: "wrap", gap: 1.6 * q }}
          >
            {d.trophies.slice(0, sq ? 2 : 3).map((x) => (
              <View key={x.id}>
                {medal(`${safe(x.value)} · ${x.title}`, Trophy)}
              </View>
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
      Icon = g?.hit ? Target : TrendingUp
    body = g ? (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          gap: 3.5 * q,
        }}
      >
        {ring(
          g.pct,
          tall ? 54 : 40,
          <>
            <Icon size={10 * q} color={hi} />
            {text(`${Math.round(Math.min(g.pct, 9.99) * 100)}%`, 11, true)}
          </>,
        )}
        {medal(
          g.hit ? "Goal hit" : "In progress",
          g.hit ? Check : undefined,
          g.hit,
        )}
        {text(g.goal.label, 10, true, ink, "center")}
        <View style={{ alignItems: "center" }}>
          {text(
            fin ? `${Math.round(g.pct * 100)}%` : safe(g.entry?.value ?? "—"),
            18,
            true,
            hi,
            "center",
          )}
          {on.target && label(fin ? "of target" : `target ${fmtGoal(g.goal)}`)}
        </View>
      </View>
    ) : (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        {text("No goals yet", 4)}
      </View>
    )
  }
  return (
    <CardFrame
      width={width}
      look={look}
      accent={accents[kind]}
      kicker={kicker}
      date={on.dates ? date : ""}
      mark={on.mark}
      foot={[
        on.handle ? d.handle : "",
        kind === "finance"
          ? "Percentages only — amounts never leave the app."
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
      backdrop: "vivid",
      photo: null,
    }),
    proceed = useRef<(() => Promise<void>) | null>(null),
    d = useCardData(params.goal ?? null),
    tpl = TEMPLATES.find((x) => x.key === kind)!,
    fields = [...tpl.fields, ...COMMON],
    caption = `${d.name.split(" ")[0]}'s ${tpl.label.toLowerCase()} — Life Score ${d.life.score ?? "—"} (${d.level}), on-target streak ${d.w7.current} days · Personal SOP`
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
        accent={accents[kind]}
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
              names can never appear on a card.
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
          No money amounts (never allowed)
        </Copy>
        <Tap onPress={() => setRemember((v) => !v)}>
          <Copy size={14}>
            {remember ? "☑" : "☐"} Remember these as defaults for {tpl.label}
          </Copy>
        </Tap>
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
