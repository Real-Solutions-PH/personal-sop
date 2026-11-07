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
  Dumbbell,
  ListChecks,
  Repeat,
  ShieldCheck,
  Utensils,
} from "lucide-react-native"
import { type ReactNode, useRef, useState } from "react"
import { Image, View } from "react-native"
import { petalsOf, Rosette } from "../brand/rosette"
import { useShown } from "../extras"
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
  Body,
  CardFrame,
  type CardLook,
  Change,
  ChartNote,
  cardInk,
  Delta,
  type Dot,
  dayName,
  dayRange,
  endedRun,
  Figures,
  Hero,
  LeafCal,
  Meters,
  P,
  ShareComposer,
  Stems,
  Sub,
  Title,
  useCard,
  Win,
  Words,
} from "../share-kit"
import { useTheme } from "../theme"
import { Button, Screen, Sheet, shareText, Toggle } from "../ui"

const areaColors = {
  habits: "hab",
  tasks: "tsk",
  fitness: "fit",
  nutrition: "nut",
  focus: "foc",
  screen: "scr",
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
  return `${m[1] === "-" ? "−" : m[1]}${fmt(n, m[3] ? 5 : 6)}${m[3]}`
}
/** "≥ 1.2M kg / week": the goal's target, grouped like every card number. */
const goalTarget = (g: Goal) =>
  safe(
    `${g.comparator === "gte" ? "≥" : "≤"} ${fmt(g.target, 6, 1)}${g.unit === "%" ? "%" : g.unit ? ` ${g.unit}` : ""} / ${g.period}`,
  )
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
/** A scored day as a calendar leaf: on target, off target (a miss), or a
 * day with nothing scored. */
const dayDots = (range: CardData["w30"]["range"]): Dot[] =>
  range.map((x) =>
    x.onTarget === true ? "on" : x.onTarget === false ? "miss" : "off",
  )
const plural = (n: number, one: string, many = `${one}s`) =>
  `${fmt(n)} ${n === 1 ? one : many}`
/** A day's score: what was due that got done, as a percent. */
const score = (x: CardData["w7"]["range"][number]) =>
  x.due > 0 ? Math.round((x.done / x.due) * 100) : undefined
/** The area facets as the leaf flower, the card's hero chart: it takes
 * the whole room the card leaves it (``Body fill``), up to a square, and
 * each tip carries its area's icon and value at 15 kit points. When that
 * room is too short for labels (a square card) the flower is drawn bare and
 * larger, and the card's line names the strongest and weakest area. Over a
 * photo the card's scrim and shadows carry it, with no ground behind. */
function Flower({ facets }: { facets: Facet[] }) {
  const { q, c } = useCard(),
    [room, setRoom] = useState({ width: 0, height: 0 }),
    h = room.width > 0 ? Math.min(312, (312 * room.height) / room.width) : 0
  return (
    <View
      style={{ flex: 1, minHeight: 0, justifyContent: "center" }}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout
        setRoom((r) =>
          r.width === width && r.height === height ? r : { width, height },
        )
      }}
    >
      {h > 40 && (
        <Rosette
          card
          petals={petalsOf(facets, c.area)}
          height={h}
          font={15 * P * q}
          ink={{
            ink: c.ink,
            muted: c.muted,
            good: c.good,
            bad: c.bad,
            mark: c.mark,
            hub: c.bg,
          }}
        />
      )}
    </View>
  )
}
/** Area lines: one per enabled area, its on-target rate. */
function AreaMeters({ d }: { d: CardData }) {
  const { c } = useCard()
  return (
    <Meters
      rows={MODULE_KEYS.filter((k) => d.enabled[k]).map((k) => ({
        name: AREA[k].label,
        value: d.life.rates[k] ?? 0,
        label: pct(d.life.rates[k]),
        color: c.area(areaColors[k]),
      }))}
    />
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
    tall = look.format === "9:16",
    sq = look.format === "1:1",
    life = c.area("life"),
    span30 = d.w30.range.length
      ? dayRange(d.w30.range[0].day, d.w30.range[d.w30.range.length - 1].day)
      : "",
    month =
      /–/.test(span30) && !/ – /.test(span30)
        ? new Date(`${d.w30.range[0].day}T12:00:00`).toLocaleDateString(
            "en-GB",
            {
              month: "long",
            },
          )
        : "",
    date =
      kind === "weekly"
        ? d.w7.range.length
          ? dayRange(d.w7.range[0].day, d.w7.range[d.w7.range.length - 1].day)
          : ""
        : kind === "monthly" && span30
          ? span30
          : ["life", "monthly", "finance", "streak"].includes(kind)
            ? "Last 30 days"
            : new Date().toLocaleDateString("en-GB", {
                month: "long",
                year: "numeric",
              }),
    calH = tall ? 25 : sq ? 17 : 22,
    pt = (P * width) / 100
  let body: ReactNode = null
  if (kind === "life") {
    const facets = d.facets30.filter((f) => !f.off),
      ranked = [...facets].sort((a, b) => b.value - a.value),
      down = (d.life.delta ?? 0) < 0,
      line =
        ranked.length > 1
          ? `${d.level}. Strongest: ${ranked[0].label.toLowerCase()}. Weakest: ${ranked[ranked.length - 1].label.toLowerCase()}.`
          : `${d.level}.`
    body = (
      <>
        <Hero
          value={d.life.score === null ? "—" : fmt(d.life.score)}
          unit="of 100"
          delta={
            on.delta ? (
              <Delta n={d.life.delta} unit=" pts" suffix="vs last month" />
            ) : undefined
          }
        />
        {on.level && <Sub bad={down}>{line}</Sub>}
        {on.hexagon ? (
          <Body fill>
            <Flower facets={d.facets30} />
          </Body>
        ) : (
          on.areas && (
            <Body>
              <AreaMeters d={d} />
            </Body>
          )
        )}
      </>
    )
  }
  if (kind === "weekly") {
    const days = d.w7.range,
      onDays = days.filter((x) => x.onTarget === true).length,
      prev =
        d.w7.prevRate === null ? null : Math.round(d.w7.prevRate * d.w7.scored),
      change = prev === null ? 0 : onDays - prev,
      off = days.filter((x) => x.onTarget === false),
      items = [
        ...(on.habits && d.habits7
          ? [{ label: "Habits", value: metric(d.habits7.value) }]
          : []),
        ...(on.training && d.training7
          ? [{ label: "Workouts", value: metric(d.training7.value) }]
          : []),
        ...(on.savings && d.savings7
          ? [{ label: "Saved", value: metric(d.savings7.value) }]
          : []),
      ]
    body = (
      <>
        <Hero
          value={fmt(onDays)}
          unit={`of ${fmt(days.length)} days on target`}
          small
          delta={
            on.deltas ? (
              <Delta
                n={change}
                suffix={
                  change < 0 ? "fewer than last week" : "more than last week"
                }
              />
            ) : undefined
          }
        />
        {on.trophy && d.trophy && <Win>{safe(d.trophy.title)}</Win>}
        <Body end>
          {on.onTarget && (
            <Stems
              values={days.map(score)}
              labels={days.map((x) => dayName(x.day).slice(0, 1))}
              on={days.length - 1}
              leaf={(_, i) => days[i]?.onTarget === true}
              missed={(_, i) => days[i]?.onTarget === false}
              format={(v) => `${fmt(v, 5)}%`}
              height={tall ? 130 : sq ? 76 : 100}
              color={life}
              label="Daily score"
            />
          )}
          {off.length > 0 && (
            <Sub bad>
              {`Off target ${off.map((x) => dayName(x.day).split(" ")[0]).join(", ")}.`}
            </Sub>
          )}
        </Body>
        <Figures items={items} />
      </>
    )
  }
  if (kind === "monthly") {
    const days = d.w30.range,
      onDays = days.filter((x) => x.onTarget === true).length,
      missed = days.filter((x) => x.onTarget === false).length,
      prev =
        d.w30.prevRate === null
          ? null
          : Math.round(d.w30.prevRate * d.w30.scored),
      change = prev === null ? 0 : onDays - prev,
      prs = d.prs30 ? (parseMetric(d.prs30.value) ?? 0) : 0,
      items = on.hero
        ? [
            ...(on.prs ? [{ label: "Records", value: fmt(prs) }] : []),
            ...(d.training30
              ? [{ label: "Workouts", value: metric(d.training30.value) }]
              : []),
            ...(on.streak
              ? [{ label: "Best streak", value: fmt(d.w30.best), unit: "days" }]
              : []),
            ...(d.habits30
              ? [{ label: "Habits", value: metric(d.habits30.value) }]
              : []),
            ...(d.savings30
              ? [{ label: "Saved", value: metric(d.savings30.value) }]
              : []),
          ]
        : []
    body = (
      <>
        {/* A month's name only when the window is that month. */}
        {month ? <Title>{month}</Title> : null}
        <Hero
          value={fmt(onDays)}
          unit={`of ${fmt(days.length)} days on target`}
          small
          delta={
            <Delta
              n={change}
              suffix={
                change < 0 ? "fewer than last month" : "more than last month"
              }
            />
          }
        />
        {on.highlight && missed > 0 && change < 0 && (
          <Sub bad>{`${plural(missed, "day")} off target.`}</Sub>
        )}
        <Body end>
          <LeafCal
            cells={dayDots(days)}
            start={days[0]?.day}
            weeks={5}
            rowH={calH - 4}
            color={life}
          />
        </Body>
        <Figures items={items} />
      </>
    )
  }
  if (kind === "streak") {
    const best = d.w7.current > 0 && d.w7.current >= d.w7.best,
      all = dayDots(d.w30.series ?? d.w30.range),
      ended = endedRun(all),
      long = d.w30.series ?? d.w30.range,
      cells = dayDots(d.w30.range),
      first = d.w30.range[0]?.day
    body = (
      <>
        <Title>On target, day after day</Title>
        <Hero
          value={fmt(d.w7.current)}
          unit={d.w7.current === 1 ? "day" : "days"}
          delta={
            ended ? (
              <Change
                good={false}
              >{`${plural(ended.lost, "day")} lost`}</Change>
            ) : undefined
          }
        />
        {ended ? (
          <Sub bad>
            {`Off target ${dayName(long[ended.at].day)}. The ${fmt(ended.lost)}-day run ended there.`}
          </Sub>
        ) : on.best && best ? (
          <Win>Personal best</Win>
        ) : null}
        {on.grid && (
          <Body end>
            <LeafCal
              cells={cells}
              start={first}
              weeks={sq ? 3 : 4}
              rowH={calH}
              color={life}
            />
            {on.best && <ChartNote left={`Best ${plural(d.w7.best, "day")}`} />}
          </Body>
        )}
      </>
    )
  }
  if (kind === "finance") {
    const fin = c.area("fin"),
      sr = d.savings30 ? parseMetric(d.savings30.value) : null,
      rebuilding = sr !== null && sr <= 0,
      over = d.budgetsPct === null ? null : Math.max(0, 100 - d.budgetsPct),
      items = [
        ...(on.spend && d.spend30
          ? [{ label: "Spend vs last month", value: metric(d.spend30.value) }]
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
      <>
        <Title>
          {sr === null
            ? "Money, in percent"
            : rebuilding
              ? `Spent ${fmt(Math.abs(Math.round(sr)), 5)}% more than came in`
              : `Saved ${fmt(Math.round(sr), 5)}% of what came in`}
        </Title>
        {on.savings && (
          <Hero
            value={
              sr === null
                ? "—"
                : `${sr < 0 ? "−" : ""}${fmt(Math.abs(Math.round(sr)), 5)}`
            }
            unit="%"
            delta={
              <Delta
                n={d.savings30?.delta}
                unit=" pts"
                suffix="vs last month"
              />
            }
          />
        )}
        {rebuilding ? (
          <Sub bad>
            {over
              ? `Rebuilding. ${fmt(over, 5)}% of budgets went over.`
              : "Rebuilding."}
          </Sub>
        ) : sr !== null && sr >= 20 ? (
          <Win>Saving strong</Win>
        ) : sr !== null && sr > 0 ? (
          <Sub>In the green</Sub>
        ) : null}
        <Body end>
          <Meters
            rows={[
              ...(on.savings && sr !== null
                ? [
                    {
                      name: "Savings rate, goal 20%",
                      value: Math.max(0, sr) / 100,
                      mark: 0.2,
                      label: `${fmt(Math.round(sr), 5)}%`,
                      color: rebuilding ? c.bad : fin,
                      bad: rebuilding,
                    },
                  ]
                : []),
              ...(on.budgets && d.budgetsPct !== null
                ? [
                    {
                      name: "Budgets kept",
                      value: d.budgetsPct / 100,
                      label: `${fmt(d.budgetsPct, 5)}%`,
                      color: (over ?? 0) > 0 ? c.bad : fin,
                      bad: (over ?? 0) > 0,
                    },
                  ]
                : []),
            ]}
          />
        </Body>
        <Figures items={items} />
      </>
    )
  }
  if (kind === "profile") {
    body = (
      <>
        <Line style={{ gap: 12 * pt }}>
          {on.photo && d.photo ? (
            <Image
              source={{ uri: d.photo }}
              style={{
                width: 48 * pt,
                height: 48 * pt,
                borderRadius: 24 * pt,
              }}
            />
          ) : (
            <View
              style={{
                width: 48 * pt,
                height: 48 * pt,
                borderRadius: 24 * pt,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: c.panel,
              }}
            >
              <Words size={17 * P} weight="semibold" lines={1}>
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
          <View style={{ flex: 1, minWidth: 0 }}>
            <Title>{d.name}</Title>
            <Words size={14 * P} lines={1} muted>
              {d.level}
            </Words>
          </View>
        </Line>
        {on.identity &&
          !sq &&
          d.identities.slice(0, 2).map((x) => <Sub key={x}>{`“${x}”`}</Sub>)}
        {on.hexagon && (
          <Body fill>
            <Flower facets={d.facets30} />
          </Body>
        )}
        <Figures
          items={[
            {
              label: "Life Score",
              value: d.life.score === null ? "—" : fmt(d.life.score),
            },
            { label: "Hit rate", value: pct(d.w30.rate) },
            { label: "Best streak", value: fmt(d.w30.best), unit: "days" },
            ...(d.savings30
              ? [{ label: "Saved", value: metric(d.savings30.value) }]
              : []),
          ]}
        />
        {on.records &&
          d.trophies
            .slice(0, 2)
            .map((x) => (
              <Win key={x.id}>{`${metric(x.value)} · ${safe(x.title)}`}</Win>
            ))}
      </>
    )
  }
  if (kind === "goal") {
    const g = d.goal,
      fin = g?.goal.metric.startsWith("finance:"),
      share = g ? Math.round(g.pct * 100) : 0,
      gap = g?.current != null ? g.goal.target - g.current : 0,
      unit = g?.goal.unit === "%" ? "%" : g?.goal.unit ? ` ${g.goal.unit}` : ""
    body = g ? (
      <>
        <Title>{safe(g.goal.label)}</Title>
        <Hero
          value={
            fin ? `${fmt(Math.min(share, 9999), 5)}` : metric(g.entry?.value)
          }
          unit={fin ? "% of target" : undefined}
          small
          delta={
            g.hit ? (
              share > 100 ? (
                <Change good>{`${fmt(share - 100, 5)}% over`}</Change>
              ) : undefined
            ) : fin || gap <= 0 ? (
              <Change
                good={false}
              >{`${fmt(Math.max(0, 100 - share), 5)}% to go`}</Change>
            ) : (
              <Change good={false}>
                {safe(`${fmt(gap, 6, 1)}${unit} short`)}
              </Change>
            )
          }
        />
        {g.hit ? <Win>Goal hit</Win> : <Sub bad>In progress</Sub>}
        <Body end>
          <Meters
            rows={[
              {
                name: on.target
                  ? fin
                    ? "Of target"
                    : `Target ${goalTarget(g.goal)}`
                  : "Progress",
                value: Math.min(1, g.pct),
                mark: g.pct > 1 ? 1 / g.pct : undefined,
                label: `${fmt(Math.min(share, 9999), 5)}%`,
                color: g.hit ? c.good : life,
              },
            ]}
          />
        </Body>
      </>
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
      accent={kind === "finance" ? "fin" : kind === "goal" ? "fit" : "life"}
      deco={kind === "goal" ? "frond" : "sprig"}
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
    journal = useShown("journal"),
    [kind, setKind] = useState<ShareTemplate>(
      TEMPLATES.some((x) => x.key === params.t) ? params.t! : "life",
    ),
    [on, setOn] = useState(() => defaults(kind, saved)),
    [check, setCheck] = useState(false),
    [remember, setRemember] = useState(false),
    [currentLook, setCurrentLook] = useState<CardLook>({
      format: "9:16",
      backdrop: "fern",
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
                // Every card has a 4:5 layout for posting, the story-only
                // profile included.
                format: [...x.formats, "4:5"].includes(look.format)
                  ? look.format
                  : x.formats[0],
              }}
              on={x.key === kind ? on : defaults(x.key, saved)}
              d={d}
            />
          ),
        }))}
        formats={tpl.formats}
        postFormats={[...tpl.formats, "4:5"]}
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
              href="/nutrition/share"
            />
            {journal && (
              <LinkRow
                title="Journal streak"
                icon={BookOpen}
                accent="life"
                href="/journal/share"
              />
            )}
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
