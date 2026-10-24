import { addJournalEntry } from "@domain/capture/actions"
import {
  AREA,
  addDaysKey,
  type MetricRef,
  MODULE_KEYS,
  monthStartKey,
  weekStartKey,
} from "@domain/dash/data"
import {
  onTargetStats,
  useAllMetrics,
  useAllMisses,
  useEnabled,
  useLifeScore,
  useOnTarget,
  useTrophies,
} from "@domain/dash/hooks"
import { dashStore, saveReview } from "@domain/dash/store"
import { dayKey } from "@domain/lib/day"
import {
  Check,
  ChevronRight,
  Share2,
  Sparkles,
  Star,
  Trophy,
} from "lucide-react-native"
import { useState } from "react"
import { TextInput, View } from "react-native"
import { toast } from "sonner-native"
import {
  border,
  Copy,
  Frame,
  IconTap,
  Line,
  SectionHeading,
  Segmented,
  Tap,
} from "../native-kit"
import { go } from "../navigation"
import { fonts, useTheme } from "../theme"
import { Button, Screen } from "../ui"
import { GoalEditor } from "./dash-goals"

const fmt = (day: string, opts?: Intl.DateTimeFormatOptions) =>
  new Date(`${day}T12:00:00`).toLocaleDateString(
    "en-PH",
    opts ?? { month: "short", day: "numeric" },
  )
const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`)
const colors = {
  habits: "hab",
  tasks: "tsk",
  fitness: "fit",
  nutrition: "nut",
  finance: "fin",
} as const
function periodOf(id: string) {
  const m = id.match(/^([wm])-(\d{4}-\d{2}-\d{2})$/)
  if (!m) return null
  const from = m[2],
    kind = m[1] === "w" ? "week" : "month",
    d = new Date(`${from}T12:00:00`)
  d.setMonth(d.getMonth() + 1)
  d.setDate(0)
  return {
    id,
    from,
    kind,
    to: addDaysKey(from, kind === "week" ? 6 : d.getDate() - 1),
    label:
      kind === "week"
        ? `Week of ${fmt(from)}`
        : fmt(from, { month: "long", year: "numeric" }),
  }
}
export function Reviews({ id }: { id?: string }) {
  return id ? <Review key={id} id={id} /> : <ReviewList />
}
function ReviewList() {
  const t = useTheme(),
    reviews = dashStore.use((s) => s.reviews),
    [kind, setKind] = useState("week"),
    target = useOnTarget(365),
    list = Array.from(
      { length: kind === "week" ? 8 : 3 },
      (_, i) =>
        periodOf(
          kind === "week"
            ? `w-${weekStartKey(i + 1)}`
            : `m-${monthStartKey(i + 1)}`,
        )!,
    ),
    pending = list.filter((p) => !reviews[p.id]?.done).length
  return (
    <Screen title="Reviews">
      <Segmented
        value={kind}
        onChange={setKind}
        options={[
          { value: "week", label: "Weekly" },
          { value: "month", label: "Monthly" },
        ]}
      />
      <Copy size={14} muted style={{ paddingHorizontal: 4 }}>
        {pending
          ? `${pending} pending — reviews auto-archive after 2 days but stay here.`
          : "All caught up. ✓"}
      </Copy>
      <Frame style={{ paddingHorizontal: 12, paddingVertical: 4 }}>
        {list.map((p, i) => {
          const r = reviews[p.id],
            rate = onTargetStats(
              target.series.filter((d) => d.day >= p.from && d.day <= p.to),
            ).rate,
            I = r?.done ? Check : Sparkles
          return (
            <Tap key={p.id} onPress={() => go(`/stats/reviews/${p.id}`)}>
              <Line
                style={{
                  minHeight: 56,
                  gap: 12,
                  paddingVertical: 8,
                  borderBottomWidth: i < list.length - 1 ? 1 : 0,
                  borderBottomColor: border(t.line, 0.5),
                }}
              >
                <View
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: border(r?.done ? t.good : t.primary, 0.15),
                  }}
                >
                  <I size={16} color={r?.done ? t.good : t.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Copy size={14} weight="medium">
                    {p.label}
                  </Copy>
                  <Copy size={12} muted lines={1}>
                    {r?.done
                      ? r.reflection
                        ? `“${r.reflection}”`
                        : "Reviewed"
                      : i === 0
                        ? "Ready to review"
                        : "Pending · unreviewed"}
                  </Copy>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Copy size={14} weight="semibold">
                    {pct(rate)}
                  </Copy>
                  <Copy size={10} muted>
                    on-target rate
                  </Copy>
                </View>
                <ChevronRight size={16} color={t.muted} />
              </Line>
            </Tap>
          )
        })}
      </Frame>
    </Screen>
  )
}
function Review({ id }: { id: string }) {
  const p = periodOf(id),
    t = useTheme(),
    r = dashStore.use((s) => s.reviews[id]),
    len = p?.kind === "week" ? 7 : 30,
    target = useOnTarget(365),
    metrics = useAllMetrics(len),
    ls = useLifeScore(len),
    misses = useAllMisses(p?.from ?? dayKey(), p?.to ?? dayKey()),
    trophies = useTrophies(),
    enabled = useEnabled(),
    keys = MODULE_KEYS.filter((k) => enabled[k]),
    [reflection, setReflection] = useState(r?.reflection ?? ""),
    [focus, setFocus] = useState<MetricRef | undefined>(r?.focus),
    [aiOn, setAiOn] = useState(true),
    [goalFor, setGoalFor] = useState<MetricRef | null>(null)
  if (!p)
    return (
      <Screen title="Review">
        <Copy>Review not found</Copy>
        <Button href="/stats/reviews">All reviews</Button>
      </Screen>
    )
  const series = target.series.filter((d) => d.day >= p.from && d.day <= p.to),
    cur = onTargetStats(series),
    prev = onTargetStats(
      target.series.filter(
        (d) => d.day >= addDaysKey(p.from, -len) && d.day < p.from,
      ),
    ),
    best = [...series]
      .filter((d) => d.due)
      .sort((a, b) => b.done / b.due - a.done / a.due || b.done - a.done)[0],
    wins = trophies.filter((x) => x.day >= p.from && x.day <= p.to),
    strongest = [...keys].sort((a, b) => ls.rates[b] - ls.rates[a])[0],
    weakest = [...keys].sort((a, b) => ls.rates[a] - ls.rates[b])[0],
    targetDelta =
      cur.rate !== null && prev.rate !== null
        ? Math.round((cur.rate - prev.rate) * 100)
        : null,
    share = `/stats/share?t=${p.kind === "week" ? "weekly" : "monthly"}`,
    focusOptions = [
      { ref: "life", label: "Life Score" },
      { ref: "onTarget", label: "On-target rate" },
      ...keys.flatMap((k) =>
        metrics[k]
          .slice(0, 2)
          .map((m) => ({ ref: `${k}:${m.key}`, label: m.label })),
      ),
    ]
  const delta = (
    n: number | undefined | null,
    suffix = "",
    goodWhen = "up",
  ) => (
    <Copy
      size={12}
      style={{
        color:
          n == null || n === 0
            ? t.muted
            : (goodWhen === "down" ? n < 0 : n > 0)
              ? t.good
              : t.bad,
      }}
    >
      {n == null || n === 0
        ? "—"
        : `${n > 0 ? "▲" : "▼"}${Math.abs(n)}${suffix}`}
    </Copy>
  )
  const dot = (k: keyof typeof colors) => (
    <View
      style={{
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: t[colors[k]],
      }}
    />
  )
  return (
    <Screen
      title={p.label}
      actions={
        <IconTap
          size={44}
          icon={Share2}
          label="Share recap"
          color={t.text}
          onPress={() => go(share)}
        />
      }
    >
      <View>
        <Copy size={12} muted>
          {fmt(p.from, { weekday: "short", month: "short", day: "numeric" })} –{" "}
          {fmt(p.to, { weekday: "short", month: "short", day: "numeric" })}
          {r?.done ? " · reviewed ✓" : ""}
          {p.to >= dayKey() ? " · in progress" : ""}
        </Copy>
        <Line style={{ marginTop: 12, gap: 8, alignItems: "stretch" }}>
          {[
            { label: "Life Score", value: ls.score ?? "—", d: ls.delta },
            { label: "On-target rate", value: pct(cur.rate), d: targetDelta },
            { label: "On-target days", value: `${cur.onTarget}/${cur.scored}` },
          ].map((x) => (
            <Frame key={x.label} style={{ flex: 1, padding: 12 }}>
              <Copy size={24} weight="display">
                {x.value}
              </Copy>
              <Copy size={12} muted>
                {x.label}
              </Copy>
              {"d" in x && (
                <View style={{ height: 24, justifyContent: "center" }}>
                  {delta(x.d, x.label === "On-target rate" ? "pt" : "")}
                </View>
              )}
            </Frame>
          ))}
        </Line>
        <Frame
          style={{ paddingHorizontal: 12, paddingVertical: 8, marginTop: 8 }}
        >
          {keys.map((k) => (
            <Line key={k} style={{ paddingVertical: 6, gap: 8 }}>
              {dot(k)}
              <Copy size={14} style={{ flex: 1 }}>
                {AREA[k].label}
              </Copy>
              <Copy size={12} muted lines={1} style={{ maxWidth: "45%" }}>
                {metrics[k][0]?.label} {metrics[k][0]?.value}
              </Copy>
              {delta(metrics[k][0]?.delta, "", metrics[k][0]?.goodWhen)}
            </Line>
          ))}
        </Frame>
        <SectionHeading>Wins</SectionHeading>
        <Frame style={{ paddingHorizontal: 12, paddingVertical: 8, gap: 8 }}>
          {best && (
            <Line style={{ gap: 8 }}>
              <Star size={16} color={t.life} />
              <Copy size={14} style={{ flex: 1 }}>
                Best day: {fmt(best.day, { weekday: "long" })} — {best.done}/
                {best.due} done
              </Copy>
            </Line>
          )}
          {wins.slice(0, 4).map((x) => (
            <Line key={x.id} style={{ gap: 8 }}>
              <Trophy size={16} color={t.life} />
              <Copy size={14} lines={1} style={{ flex: 1 }}>
                {x.title}
              </Copy>
              <Copy size={12} muted>
                {x.value}
              </Copy>
            </Line>
          ))}
          {!best && !wins.length && (
            <Copy size={14} muted>
              A quiet one. Showing up is the target.
            </Copy>
          )}
        </Frame>
        <SectionHeading
          action={
            <Tap onPress={() => go("/stats/misses")}>
              <Copy size={12} style={{ color: t.primary }}>
                All {misses.length}
              </Copy>
            </Tap>
          }
        >
          Misses & leaks · top 3
        </SectionHeading>
        <Frame style={{ paddingHorizontal: 12, paddingVertical: 4 }}>
          {!misses.length ? (
            <Copy
              size={14}
              muted
              style={{ paddingVertical: 12, textAlign: "center" }}
            >
              Nothing slipped.
            </Copy>
          ) : (
            misses.slice(0, 3).map((m) => (
              <Line
                key={m.id}
                style={{
                  gap: 8,
                  paddingVertical: 10,
                  borderBottomWidth: 1,
                  borderBottomColor: border(t.line, 0.5),
                }}
              >
                {dot(m.module)}
                <Copy size={14} lines={1} style={{ flex: 1 }}>
                  {m.title}
                </Copy>
                <Tap
                  onPress={() => go(m.href)}
                  style={{
                    borderRadius: 20,
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    backgroundColor: t.soft,
                  }}
                >
                  <Copy size={12} weight="medium">
                    Recover
                  </Copy>
                </Tap>
              </Line>
            ))
          )}
        </Frame>
        <SectionHeading
          action={
            <Tap onPress={() => setAiOn((v) => !v)}>
              <Copy size={12} muted>
                {aiOn ? "Hide" : "Show"}
              </Copy>
            </Tap>
          }
        >
          AI summary
        </SectionHeading>
        {aiOn && (
          <View
            style={{
              padding: 16,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: border(t.primary, 0.3),
            }}
          >
            <Line style={{ gap: 6, marginBottom: 4 }}>
              <Sparkles size={14} color={t.primary} />
              <Copy size={12} weight="medium" style={{ color: t.primary }}>
                Summary
              </Copy>
            </Line>
            <Copy size={14}>
              You hit the target on {cur.onTarget} of {cur.scored} scored days (
              {pct(cur.rate)})
              {targetDelta !== null
                ? `, ${targetDelta >= 0 ? "up" : "down"} ${Math.abs(targetDelta)} points on the ${p.kind} before`
                : ""}
              .{" "}
              {strongest
                ? `${AREA[strongest].label} carried it at ${Math.round(ls.rates[strongest] * 100)}%`
                : ""}
              {weakest && weakest !== strongest
                ? `, while ${AREA[weakest].label.toLowerCase()} lagged at ${Math.round(ls.rates[weakest] * 100)}%`
                : ""}
              .
            </Copy>
            <Copy size={14} muted style={{ marginTop: 8 }}>
              <Copy size={14} weight="semibold">
                Try:{" "}
              </Copy>
              {weakest === "tasks"
                ? "block 30 minutes on Saturday for anything pushed twice."
                : weakest === "fitness"
                  ? "book your sessions on the calendar like meetings."
                  : weakest === "finance"
                    ? "set a no-spend day midweek to cool the leak."
                    : "stack your weakest habit onto the morning routine."}
            </Copy>
          </View>
        )}
        <SectionHeading>Reflection</SectionHeading>
        <TextInput
          accessibilityLabel="Review reflection"
          value={reflection}
          onChangeText={setReflection}
          maxLength={280}
          multiline
          numberOfLines={3}
          placeholder="What went right, what went wrong, one thing to change."
          placeholderTextColor={t.muted}
          style={{
            minHeight: 84,
            padding: 12,
            borderWidth: 1,
            borderColor: t.line,
            borderRadius: 12,
            backgroundColor: t.card,
            fontFamily: fonts.body,
            fontSize: 14,
            color: t.text,
            textAlignVertical: "top",
          }}
        />
        <SectionHeading>Next focus</SectionHeading>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {focusOptions.map((o) => (
            <Tap
              key={o.ref}
              onPress={() => {
                setFocus(o.ref)
                setGoalFor(o.ref)
              }}
              style={{
                height: 44,
                borderRadius: 22,
                paddingHorizontal: 12,
                justifyContent: "center",
                backgroundColor: focus === o.ref ? t.primary : t.soft,
              }}
            >
              <Copy
                size={12}
                style={{ color: focus === o.ref ? t.onPrimary : t.text }}
              >
                {o.label}
              </Copy>
            </Tap>
          ))}
        </View>
        <Copy size={12} muted style={{ marginTop: 4, paddingHorizontal: 4 }}>
          Picking a focus offers to set or adjust its goal.
        </Copy>
        {p.kind === "month" && (
          <View style={{ marginTop: 16 }}>
            <Button tone="quiet" href="/finance/review">
              Monthly money review ›
            </Button>
          </View>
        )}
        <Line style={{ gap: 8, marginTop: 20 }}>
          <View style={{ flex: 1 }}>
            <Button tone="quiet" href={share}>
              Share
            </Button>
          </View>
          <View style={{ flex: 1 }}>
            <Button
              onPress={() => {
                saveReview(p.id, {
                  done: true,
                  doneAt: new Date().toISOString(),
                  reflection: reflection.trim() || undefined,
                  focus,
                })
                if (reflection.trim() && reflection.trim() !== r?.reflection)
                  addJournalEntry({
                    body: reflection.trim(),
                    day: dayKey(),
                    source: "text",
                    tags: [
                      p.kind === "week" ? "weekly-review" : "monthly-review",
                    ],
                  })
                toast.success("Review done", {
                  description: "Archived. See you next week.",
                })
                go("/stats/reviews")
              }}
            >
              {r?.done ? "Update" : "Mark done"}
            </Button>
          </View>
        </Line>
      </View>
      {goalFor && (
        <GoalEditor metric={goalFor} onClose={() => setGoalFor(null)} />
      )}
    </Screen>
  )
}
