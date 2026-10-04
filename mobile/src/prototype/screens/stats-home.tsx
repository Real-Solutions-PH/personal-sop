import { AREA, MODULE_KEYS } from "@domain/dash/data"
import { useFacets } from "@domain/dash/facets"
import * as D from "@domain/dash/hooks"
import { dashStore, resetWeights, setWeight } from "@domain/dash/store"
import { dayKey, dayOffset } from "@domain/lib/day"
import { LinearGradient } from "expo-linear-gradient"
import { useLocalSearchParams } from "expo-router"
import {
  CalendarRange,
  ChevronRight,
  Flame,
  Info,
  ListFilter,
  Share2,
  Target,
  Trophy,
} from "lucide-react-native"
import { useState } from "react"
import { ScrollView, StyleSheet, Text, View } from "react-native"
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  Polygon,
  RadialGradient,
  Stop,
  LinearGradient as SvgGradient,
  Line as SvgLine,
} from "react-native-svg"
import {
  Bar,
  border,
  Copy,
  Frame,
  IconTap,
  Line,
  LinkRow,
  SectionHeading,
  Segmented,
  Tap,
} from "../native-kit"
import { go } from "../navigation"
import { ProfileAvatar } from "../profile-avatar"
import { useTheme } from "../theme"
import { Button, Field, Screen, Sheet } from "../ui"

function Delta({
  value,
  down = false,
}: {
  value?: number | null
  down?: boolean
}) {
  const t = useTheme()
  if (value == null) return null
  return (
    <Copy
      size={12}
      style={{
        color: value === 0 ? t.muted : value > 0 !== down ? t.good : t.bad,
      }}
    >
      {value > 0 ? "▲" : value < 0 ? "▼" : "—"}
      {Math.abs(value)}
    </Copy>
  )
}
function LifeHero({
  days,
  onWeights,
}: {
  days: number
  onWeights: () => void
}) {
  const t = useTheme(),
    ls = D.useLifeScore(days),
    enabled = D.useEnabled(),
    level = D.levelFor(ls.score),
    value = Math.max(0, Math.min(1, (ls.score ?? 0) / 100)),
    toNext =
      level.next && ls.score !== null
        ? (ls.score - level.floor) / (level.next.floor - level.floor)
        : 1,
    size = 148,
    stroke = 11,
    r = (size - stroke) / 2,
    c = 2 * Math.PI * r
  return (
    <Frame style={{ borderRadius: 24, boxShadow: "0px 12px 18px #0000001a" }}>
      <LinearGradient
        colors={[t["hero-from"], t["hero-via"], t["hero-to"]]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ padding: 20 }}
      >
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Svg width="100%" height="100%">
            <Defs>
              <RadialGradient id="gold">
                <Stop offset="0" stopColor={t.life} stopOpacity={0.25} />
                <Stop offset="1" stopColor={t.life} stopOpacity={0} />
              </RadialGradient>
              <RadialGradient id="purple">
                <Stop offset="0" stopColor={t.hab} stopOpacity={0.3} />
                <Stop offset="1" stopColor={t.hab} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Ellipse cx="90%" cy="10%" rx="65%" ry="75%" fill="url(#gold)" />
            <Ellipse cx="15%" cy="95%" rx="60%" ry="60%" fill="url(#purple)" />
          </Svg>
        </View>
        <Line style={{ gap: 16 }}>
          <Tap
            label="How the Life Score is weighted"
            onPress={onWeights}
            style={{
              width: size,
              height: size,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Svg width={size} height={size} style={{ position: "absolute" }}>
              <Defs>
                <SvgGradient id="life-score" x1="0" y1="0" x2="1" y2="1">
                  <Stop offset="0" stopColor={t.hab} />
                  <Stop offset="0.5" stopColor={t.life} />
                  <Stop offset="1" stopColor={t.fit} />
                </SvgGradient>
              </Defs>
              <G transform={`rotate(-90 ${size / 2} ${size / 2})`}>
                <Circle
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  stroke={border(t.soft, 0.7)}
                  strokeWidth={stroke}
                />
                <Circle
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  stroke="url(#life-score)"
                  strokeWidth={stroke}
                  strokeLinecap="round"
                  strokeDasharray={c}
                  strokeDashoffset={c * (1 - value)}
                />
              </G>
            </Svg>
            <Copy
              size={48}
              weight="display"
              style={{ color: "white", lineHeight: 48, letterSpacing: -2.4 }}
            >
              {ls.score ?? "—"}
            </Copy>
            <Copy
              size={10}
              style={{ color: "#ffffff99", letterSpacing: 2, marginTop: 4 }}
            >
              LIFE SCORE
            </Copy>
          </Tap>
          <View style={{ flex: 1 }}>
            <Copy size={10} style={{ color: "#ffffff99", letterSpacing: 2 }}>
              LEVEL
            </Copy>
            <Copy
              size={24}
              weight="display"
              style={{
                color: t.life,
                fontStyle: "italic",
                letterSpacing: -0.6,
              }}
            >
              {level.name.toUpperCase()}
            </Copy>
            {level.next && (
              <View style={{ marginTop: 4 }}>
                <View
                  style={{
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: "#ffffff26",
                  }}
                >
                  <View
                    style={{
                      height: 6,
                      borderRadius: 3,
                      width: `${Math.max(4, toNext * 100)}%`,
                      backgroundColor: t.life,
                    }}
                  />
                </View>
                <Copy size={11} style={{ color: "#ffffff99", marginTop: 4 }}>
                  {level.next.floor - (ls.score ?? 0)} to {level.next.name}
                </Copy>
              </View>
            )}
            <Line style={{ gap: 6, marginTop: 8 }}>
              <Delta value={ls.delta} />
              <Copy size={12} style={{ color: "#ffffff99" }}>
                vs prior {days}d
              </Copy>
            </Line>
            <Tap onPress={onWeights} style={{ marginTop: 8 }}>
              <Line style={{ gap: 4 }}>
                <Info size={12} color="#ffffffb3" />
                <Copy size={11} style={{ color: "#ffffffb3" }}>
                  How it's weighted
                </Copy>
              </Line>
            </Tap>
          </View>
        </Line>
        <Line style={{ marginTop: 16, gap: 8 }}>
          {MODULE_KEYS.map((k) => (
            <View key={k} style={{ flex: 1, opacity: enabled[k] ? 1 : 0.3 }}>
              <View
                style={{
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: "#ffffff26",
                }}
              >
                <View
                  style={{
                    height: 6,
                    borderRadius: 3,
                    width: `${ls.rates[k] * 100}%`,
                    backgroundColor: t[AREA[k].accent],
                  }}
                />
              </View>
              <Line
                style={{
                  marginTop: 4,
                  gap: 4,
                  justifyContent: "space-between",
                }}
              >
                <Copy size={10} style={{ color: "#ffffffb3" }}>
                  {AREA[k].label}
                </Copy>
                <Copy size={10} weight="semibold" style={{ color: "white" }}>
                  {enabled[k] ? Math.round(ls.rates[k] * 100) : "off"}
                </Copy>
              </Line>
            </View>
          ))}
        </Line>
      </LinearGradient>
    </Frame>
  )
}
function DailyForm({ days }: { days: number }) {
  const t = useTheme(),
    target = D.useOnTarget(days),
    vals = target.range.map((d) => (d.due ? d.done / d.due : null)),
    scored = vals.filter((v): v is number => v !== null),
    avg = scored.length
      ? Math.round((scored.reduce((a, b) => a + b, 0) / scored.length) * 100)
      : null
  const heat = vals.slice(-(days >= 365 ? 364 : 91)),
    cell = days >= 365 ? 5 : 14
  return (
    <Frame style={{ padding: 16 }}>
      <Line
        style={{ justifyContent: "space-between", gap: 4, marginBottom: 8 }}
      >
        <Copy size={14} weight="semibold">
          Daily form
        </Copy>
        <Copy size={12} muted>
          habits + tasks done per day
        </Copy>
      </Line>
      {days <= 30 ? (
        <>
          <Line
            style={{
              alignItems: "flex-end",
              height: days === 7 ? 72 : 56,
              gap: 4,
            }}
          >
            {vals.map((v, i) => (
              <View
                key={target.range[i].day}
                style={{
                  flex: 1,
                  height: `${Math.max(2, (v ?? 0) * 100)}%`,
                  borderTopLeftRadius: 6,
                  borderTopRightRadius: 6,
                  backgroundColor: t.life,
                  opacity: i === vals.length - 1 ? 1 : 0.45,
                }}
              />
            ))}
          </Line>
          {days === 7 && (
            <Line style={{ gap: 4, marginTop: 4 }}>
              {target.range.map((d) => (
                <Copy
                  key={d.day}
                  size={10}
                  muted
                  style={{ flex: 1, textAlign: "center" }}
                >
                  {new Date(`${d.day}T12:00:00`).toLocaleDateString("en-PH", {
                    weekday: "narrow",
                  })}
                </Copy>
              ))}
            </Line>
          )}
        </>
      ) : (
        <ScrollView horizontal>
          <Line style={{ gap: 3 }}>
            {Array.from({ length: Math.ceil(heat.length / 7) }, (_, col) => (
              <View key={col} style={{ gap: 3 }}>
                {heat.slice(col * 7, col * 7 + 7).map((v, row) => (
                  <View
                    key={row}
                    style={{
                      width: cell,
                      height: cell,
                      borderRadius: 2,
                      backgroundColor: v === null ? t.soft : t.life,
                      opacity: v === null ? 1 : Math.max(0.15, v),
                    }}
                  />
                ))}
              </View>
            ))}
          </Line>
        </ScrollView>
      )}
      <Copy size={12} muted style={{ marginTop: 8 }}>
        Avg {avg ?? "—"}% done · {target.onTarget}/{target.scored} days on
        target
      </Copy>
    </Frame>
  )
}
function Areas({ days }: { days: number }) {
  const t = useTheme(),
    facets = useFacets(days),
    metrics = D.useAllMetrics(days),
    [sel, setSel] = useState<string | null>(null),
    [all, setAll] = useState(false),
    facet = facets.find((f) => f.key === sel)
  const point = (i: number, r: number) => [
      160 + r * Math.cos(((-90 + i * 60) * Math.PI) / 180),
      160 + r * Math.sin(((-90 + i * 60) * Math.PI) / 180),
    ],
    poly = (values: number[]) =>
      values
        .map((v, i) => point(i, 100 * Math.max(0.04, Math.min(1, v))).join(","))
        .join(" ")
  return (
    <>
      <SectionHeading
        action={
          <Tap onPress={() => setAll(true)}>
            <Line style={{ gap: 4 }}>
              <ListFilter size={14} color={t.primary} />
              <Copy size={12} style={{ color: t.primary }}>
                All metrics
              </Copy>
            </Line>
          </Tap>
        }
      >
        Areas
      </SectionHeading>
      <Frame style={{ paddingHorizontal: 8, paddingTop: 8, paddingBottom: 16 }}>
        <View
          style={{
            width: "100%",
            maxWidth: 340,
            aspectRatio: 1,
            alignSelf: "center",
          }}
        >
          <Svg
            width="100%"
            height="100%"
            viewBox="0 0 320 320"
            accessibilityLabel={`Area hexagon: ${facets.map((f) => `${f.label} ${Math.round(f.value * 100)}`).join(", ")}`}
          >
            {[0.25, 0.5, 0.75, 1].map((v) => (
              <Polygon
                key={v}
                points={poly(Array(6).fill(v))}
                fill="none"
                stroke={v === 1 ? `${t.muted}66` : t.line}
                strokeWidth={1}
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
                  stroke={t.line}
                />
              )
            })}
            <Polygon
              points={poly(facets.map((f) => (f.off ? 0 : f.prev)))}
              fill="none"
              strokeDasharray="4 4"
              strokeWidth={1.5}
              stroke={t.muted}
            />
            <Polygon
              points={poly(facets.map((f) => (f.off ? 0 : f.value)))}
              fill={`${t.life}40`}
              stroke={t.life}
              strokeWidth={2.5}
              strokeLinejoin="round"
            />
            {facets.map((f, i) => {
              const [x, y] = point(
                i,
                100 * Math.max(0.04, Math.min(1, f.off ? 0 : f.value)),
              )
              return (
                <Circle
                  key={f.key}
                  cx={x}
                  cy={y}
                  r={f.key === sel ? 6 : 4}
                  fill={t.life}
                  stroke={t.bg}
                  strokeWidth={2}
                />
              )
            })}
          </Svg>
          {facets.map((f, i) => {
            const [x, y] = point(i, 138),
              delta = Math.round((f.value - f.prev) * 100)
            return (
              <Tap
                key={f.key}
                label={`${f.label}: ${f.off ? "off" : Math.round(f.value * 100)}. Show details`}
                onPress={() => setSel(sel === f.key ? null : f.key)}
                style={{
                  position: "absolute",
                  left: `${(x / 320) * 100}%`,
                  top: `${(y / 320) * 100}%`,
                  width: 88,
                  minHeight: 44,
                  transform: [{ translateX: -44 }, { translateY: -22 }],
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 12,
                  backgroundColor: sel === f.key ? t.soft : "transparent",
                }}
              >
                <Copy
                  size={20}
                  weight="display"
                  style={{ color: f.off ? t.muted : t[AREA[f.module].accent] }}
                >
                  {f.off ? "—" : Math.round(f.value * 100)}
                </Copy>
                <Copy size={11} muted>
                  {f.label}
                  {!f.off && delta !== 0 && (
                    <Text style={{ color: delta > 0 ? t.good : t.bad }}>
                      {" "}
                      {delta > 0 ? "▲" : "▼"}
                      {Math.abs(delta)}
                    </Text>
                  )}
                </Copy>
              </Tap>
            )
          })}
        </View>
        <Line style={{ justifyContent: "center", gap: 16, marginTop: 4 }}>
          <Copy size={12} muted>
            <Text style={{ color: t.life }}>━</Text> This {days}d
          </Copy>
          <Copy size={12} muted>
            ┄ Previous {days}d
          </Copy>
        </Line>
        {facet ? (
          <View
            style={{
              marginTop: 12,
              paddingTop: 12,
              paddingHorizontal: 8,
              borderTopWidth: 1,
              borderColor: border(t.line, 0.6),
            }}
          >
            <Copy weight="semibold">
              {AREA[facet.module].label}
              {facet.label !== AREA[facet.module].label
                ? ` · ${facet.label}`
                : ""}
            </Copy>
            <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
              {[
                ...metrics[facet.module].filter(
                  (m) => !facet.metricKeys || facet.metricKeys.includes(m.key),
                ),
                ...(facet.extra ?? []),
              ].map((m) => (
                <Tap
                  key={m.key}
                  onPress={() =>
                    go(
                      `/stats/metric/${encodeURIComponent(`${facet.module}:${m.key}`)}?range=${days}`,
                    )
                  }
                  style={{ width: "50%", padding: 8 }}
                >
                  <Copy size={20} weight="display">
                    {m.value}
                  </Copy>
                  <Copy size={12} muted>
                    {m.label}
                  </Copy>
                  <Delta value={m.delta} down={m.goodWhen === "down"} />
                </Tap>
              ))}
            </View>
            <LinkRow title={`Open ${facet.label} details`} href={facet.href} />
          </View>
        ) : (
          <Copy size={12} muted style={{ marginTop: 12, textAlign: "center" }}>
            Tap an area for its stats
          </Copy>
        )}
      </Frame>
      <Sheet title="All metrics" open={all} onClose={() => setAll(false)}>
        {MODULE_KEYS.map((k) => (
          <View key={k}>
            <SectionHeading>{AREA[k].label}</SectionHeading>
            {metrics[k].map((m) => (
              <LinkRow
                key={m.key}
                title={m.label}
                detail={m.value}
                href={`/stats/metric/${encodeURIComponent(`${k}:${m.key}`)}`}
              />
            ))}
          </View>
        ))}
      </Sheet>
    </>
  )
}
export function StatsHome() {
  const t = useTheme(),
    p = dashStore.use((s) => s.profile),
    params = useLocalSearchParams<{ range?: string }>(),
    [range, setRange] = useState(params.range ?? "7d"),
    days = range === "1y" ? 365 : Number.parseInt(range, 10) || 7,
    target = D.useOnTarget(days),
    trophies = D.useTrophies().slice(0, 3),
    notes = dashStore.use((s) => s.missNotes),
    enabled = D.useEnabled(),
    cur = D.useAllMisses(dayOffset(-(days - 1)), dayKey()),
    prev = D.useAllMisses(dayOffset(-(days * 2 - 1)), dayOffset(-days)),
    goals = D.useGoals()
      .filter((g) => g.goal.status === "active")
      .slice(0, 3),
    weights = D.useWeights(),
    [weightSheet, setWeightSheet] = useState(false),
    score = D.useLifeScore(days)
  const count = (items: typeof cur, k?: string) =>
      items.filter((m) => (!k || m.module === k) && !notes[m.id]).length,
    delta =
      target.rate !== null && target.prevRate !== null
        ? Math.round((target.rate - target.prevRate) * 100)
        : undefined
  return (
    <Screen
      root
      prototypeLayout
      title="Stats"
      actions={
        <IconTap
          size={44}
          icon={Share2}
          label="Share profile card"
          color={t.text}
          onPress={() => go("/stats/share?t=profile")}
        />
      }
    >
      <View>
        <Line style={{ gap: 16, paddingTop: 4 }}>
          <ProfileAvatar />
          <View style={{ flex: 1 }}>
            <Copy size={20} weight="display" style={{ letterSpacing: -0.5 }}>
              {p.name}
            </Copy>
            <Copy size={14} muted>
              {p.handle} · since{" "}
              {new Date(`${p.since}T12:00:00`).toLocaleDateString("en-PH", {
                month: "short",
                year: "numeric",
              })}
            </Copy>
            <Line style={{ gap: 4, flexWrap: "wrap", marginTop: 6 }}>
              {p.identities.map((i) => (
                <View
                  key={i.id}
                  style={{
                    borderRadius: 16,
                    backgroundColor: t.soft,
                    paddingHorizontal: 8,
                    paddingVertical: 2,
                  }}
                >
                  <Copy size={11}>{i.text}</Copy>
                </View>
              ))}
            </Line>
          </View>
        </Line>
        {target.logged < 3 ? (
          <Frame style={{ padding: 24, marginTop: 16 }}>
            <Copy size={24} weight="display">
              Stats appear after 3 logged days
            </Copy>
            <Copy muted>
              You're at {target.logged}/3. Keep logging — the profile fills
              itself.
            </Copy>
            <Button href="/today">Go to Today</Button>
          </Frame>
        ) : (
          <>
            <View style={{ marginTop: 16 }}>
              <Segmented
                value={range}
                onChange={setRange}
                options={["7d", "30d", "90d", "1y"].map((value) => ({
                  value,
                  label: value,
                }))}
              />
            </View>
            <View style={{ marginTop: 12 }}>
              <LifeHero days={days} onWeights={() => setWeightSheet(true)} />
            </View>
            <Line style={{ gap: 8, marginTop: 12, alignItems: "stretch" }}>
              <Frame style={{ flex: 1, padding: 12 }}>
                <Copy size={30} weight="display" style={{ lineHeight: 36 }}>
                  {target.rate === null
                    ? "—"
                    : `${Math.round(target.rate * 100)}%`}
                </Copy>
                <Line style={{ gap: 6 }}>
                  <Copy size={12} muted>
                    On target
                  </Copy>
                  <Delta value={delta} />
                </Line>
              </Frame>
              <Frame style={{ flex: 1, padding: 12 }}>
                <Line style={{ gap: 2, height: 32 }}>
                  <Flame size={20} color={t.life} fill={t.life} />
                  <Copy size={24} weight="display" style={{ color: t.life }}>
                    {target.current}
                  </Copy>
                </Line>
                <Copy size={12} muted>
                  Streak · best {target.best}
                </Copy>
              </Frame>
              <Frame style={{ flex: 1, padding: 12 }}>
                <Copy size={30} weight="display" style={{ lineHeight: 36 }}>
                  {target.onTarget}
                  <Text style={{ fontSize: 16, color: t.muted }}>
                    /{target.scored}
                  </Text>
                </Copy>
                <Copy size={12} muted>
                  On-target days
                </Copy>
              </Frame>
            </Line>
            <View style={{ marginTop: 12 }}>
              <DailyForm days={days} />
            </View>
            {trophies.length > 0 && (
              <>
                <SectionHeading
                  action={
                    <Tap onPress={() => go("/stats/trophies")}>
                      <Copy size={12} style={{ color: t.primary }}>
                        Trophy case
                      </Copy>
                    </Tap>
                  }
                >
                  Personal bests
                </SectionHeading>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 8, paddingBottom: 4 }}
                >
                  {trophies.map((tr) => (
                    <Tap
                      key={tr.id}
                      onPress={() =>
                        go(`/stats/trophies?open=${encodeURIComponent(tr.id)}`)
                      }
                      style={{ width: 144 }}
                    >
                      <Frame style={{ borderColor: `${t.life}4d` }}>
                        <LinearGradient
                          colors={[`${t.life}26`, `${t.life}00`]}
                          style={{ padding: 12 }}
                        >
                          <Trophy size={16} color={t.life} />
                          <Copy
                            size={20}
                            weight="display"
                            style={{ marginTop: 4 }}
                          >
                            {tr.value}
                          </Copy>
                          <Copy size={12} lines={1}>
                            {tr.title}
                          </Copy>
                          <Copy size={10} muted>
                            {new Date(`${tr.day}T12:00:00`).toLocaleDateString(
                              "en-PH",
                              { month: "short", day: "numeric" },
                            )}
                          </Copy>
                        </LinearGradient>
                      </Frame>
                    </Tap>
                  ))}
                </ScrollView>
              </>
            )}
            <Areas days={days} />
            <SectionHeading
              action={
                <Tap onPress={() => go("/stats/misses")}>
                  <Copy size={12} style={{ color: t.primary }}>
                    Misses & leaks
                  </Copy>
                </Tap>
              }
            >
              Misses & leaks
            </SectionHeading>
            <Frame style={{ padding: 16 }}>
              <Tap onPress={() => go(`/stats/misses?range=${days}`)}>
                <Line style={{ gap: 8 }}>
                  <Copy size={30} weight="display">
                    {count(cur)}
                  </Copy>
                  <Copy size={14} muted style={{ flex: 1 }}>
                    misses in {days}d
                  </Copy>
                  <Delta value={count(cur) - count(prev)} down />
                </Line>
                <Line style={{ gap: 8, marginTop: 8 }}>
                  {MODULE_KEYS.filter((k) => enabled[k]).map((k) => (
                    <View
                      key={k}
                      style={{
                        flex: 1,
                        padding: 8,
                        borderRadius: 12,
                        backgroundColor: border(t.soft, 0.5),
                        alignItems: "center",
                      }}
                    >
                      <Copy
                        weight="semibold"
                        style={{ color: t[AREA[k].accent] }}
                      >
                        {count(cur, k)}
                      </Copy>
                      <Copy size={10} muted>
                        {AREA[k].label}
                      </Copy>
                    </View>
                  ))}
                </Line>
              </Tap>
            </Frame>
            <SectionHeading
              action={
                <Tap onPress={() => go("/stats/goals")}>
                  <Copy size={12} style={{ color: t.primary }}>
                    All goals
                  </Copy>
                </Tap>
              }
            >
              Goals
            </SectionHeading>
            <Frame style={{ paddingHorizontal: 12, paddingVertical: 4 }}>
              {goals.map((g) => (
                <Tap
                  key={g.goal.id}
                  onPress={() => go("/stats/goals")}
                  style={{ paddingVertical: 10 }}
                >
                  <Line style={{ gap: 8, marginBottom: 6 }}>
                    <Copy size={14} weight="medium" style={{ flex: 1 }}>
                      {g.goal.label}
                      <Copy size={12} muted>
                        {" "}
                        {D.fmtGoal(g.goal)}
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
                  <Bar value={g.pct} color={g.hit ? t.life : t.primary} />
                </Tap>
              ))}
              <Tap
                onPress={() => go("/stats/goals?new=1")}
                style={{
                  borderTopWidth: 1,
                  borderColor: border(t.line, 0.5),
                  paddingVertical: 10,
                }}
              >
                <Line style={{ gap: 6, justifyContent: "center" }}>
                  <Target size={16} color={t.primary} />
                  <Copy size={14} weight="medium" style={{ color: t.primary }}>
                    Set a goal
                  </Copy>
                </Line>
              </Tap>
            </Frame>
            <Line style={{ marginTop: 24, gap: 8 }}>
              {[
                {
                  title: "Reviews",
                  href: "/stats/reviews",
                  icon: CalendarRange,
                },
                { title: "Share card", href: "/stats/share", icon: Share2 },
              ].map((item) => (
                <Frame key={item.href} style={{ flex: 1, padding: 16 }}>
                  <Tap onPress={() => go(item.href)}>
                    <Line style={{ gap: 8 }}>
                      <item.icon size={20} color={t.primary} />
                      <Copy size={14} weight="medium" style={{ flex: 1 }}>
                        {item.title}
                      </Copy>
                      <ChevronRight size={16} color={t.muted} />
                    </Line>
                  </Tap>
                </Frame>
              ))}
            </Line>
          </>
        )}
      </View>
      <Sheet
        title="Life Score weights"
        open={weightSheet}
        onClose={() => setWeightSheet(false)}
      >
        <Copy size={14}>
          Life Score = weighted mean of each area's rate over the range. Weights
          are relative — only their ratio matters. Now: {score.score ?? "—"}
        </Copy>
        {MODULE_KEYS.map((k) => (
          <View key={k}>
            <Copy weight="medium">
              {AREA[k].label} · rate {Math.round(score.rates[k] * 100)}%
            </Copy>
            <Field
              label={`${AREA[k].label} weight`}
              keyboardType="numeric"
              value={String(weights[k])}
              onChangeText={(v) => {
                if (/^\d+$/.test(v)) setWeight(k, Number(v))
              }}
            />
          </View>
        ))}
        <Button tone="quiet" onPress={resetWeights}>
          Reset weights
        </Button>
      </Sheet>
    </Screen>
  )
}
