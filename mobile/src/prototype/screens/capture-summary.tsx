import type { RecordCard } from "@domain/capture/data"
import { finStore } from "@domain/finance/store"
import { detailTotals } from "@domain/fitness/limits"
import { habitsStore } from "@domain/habits/store"
import { tasksStore } from "@domain/tasks/store"
import { View } from "react-native"
import { border, Copy, Line, Tap } from "../native-kit"
import { useTheme } from "../theme"
import { useMoney } from "./finance"
import { LimitList } from "./nutrient-limits"
export function CaptureSummary({
  card,
  onAccount,
}: {
  card: RecordCard
  onAccount?: () => void
}) {
  const t = useTheme(),
    money = useMoney(),
    f = finStore.use((s) => s),
    h = habitsStore.use((s) => s),
    tasks = tasksStore.use((s) => s),
    p = card.payload,
    cat = (id?: string) => {
      const c = f.categories.find((x) => x.id === id)
      return c ? `${c.icon} ${c.name}` : "Uncategorised"
    },
    acct = (id?: string) => f.accounts.find((x) => x.id === id)?.name ?? "—"
  switch (p.kind) {
    case "expense":
    case "income":
      return (
        <View>
          <Line style={{ gap: 8, alignItems: "baseline" }}>
            <Copy
              size={30}
              weight="displayMedium"
              style={{ letterSpacing: -0.75 }}
            >
              {p.kind === "income" ? "+" : ""}
              {money(p.amount)}
            </Copy>
            <Copy size={14} muted lines={1} style={{ flex: 1 }}>
              {cat(p.categoryId)}
            </Copy>
          </Line>
          {p.kind === "expense" ? (
            <Line style={{ gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              <Tap
                label={`Account: ${acct(p.accountId) === "—" ? "none" : acct(p.accountId)}`}
                onPress={onAccount ?? (() => {})}
                style={{
                  minHeight: 44,
                  justifyContent: "center",
                  paddingHorizontal: 10,
                  borderWidth: 1,
                  borderColor: border(t.fin, 0.3),
                  borderRadius: 8,
                }}
              >
                <Copy size={14} weight="medium" style={{ color: t.fin }}>
                  {acct(p.accountId)}
                  {onAccount ? " ⌄" : ""}
                </Copy>
              </Tap>
              {p.payee && (
                <Copy size={12} muted>
                  {p.payee}
                </Copy>
              )}
              {p.fromReceipt && (
                <Copy size={12} muted>
                  from receipt
                </Copy>
              )}
            </Line>
          ) : (
            <Copy size={12} muted style={{ marginTop: 4 }}>
              {p.accountId ? `into ${acct(p.accountId)}` : "Account?"}
            </Copy>
          )}
        </View>
      )
    case "transfer":
      return (
        <View>
          <Copy size={30} weight="displayMedium">
            {money(p.amount)}
          </Copy>
          <Copy size={14} style={{ marginTop: 4 }}>
            {p.from ? acct(p.from) : "from?"} → {p.to ? acct(p.to) : "to?"}
          </Copy>
        </View>
      )
    case "planned":
      return (
        <View>
          <Line style={{ gap: 8, alignItems: "baseline" }}>
            <Copy size={18} weight="semibold">
              {p.name}
            </Copy>
            <Copy muted>{money(p.amount)}</Copy>
          </Line>
          <Copy size={12} muted>
            {p.date
              ? `Once, due ${new Date(`${p.date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
              : `Monthly on day ${p.day}`}
            {p.type === "income" ? " · income" : ""} · {acct(p.accountId)}
          </Copy>
        </View>
      )
    case "task":
      return (
        <View style={{ gap: 6 }}>
          {p.tasks.slice(0, 6).map((x, i) => (
            <Line
              key={`${x.title}${i}`}
              style={{ gap: 8, alignItems: "flex-start" }}
            >
              <View
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 7,
                  borderWidth: 2,
                  borderColor: border(t.tsk, 0.3),
                  marginTop: 4,
                }}
              />
              <View style={{ flex: 1 }}>
                <Copy weight="medium" lines={1}>
                  {x.title}
                </Copy>
                <Copy size={12} muted>
                  {tasks.lists.find((l) => l.id === x.listId)?.name ?? "Inbox"}
                  {x.dueDate
                    ? ` · ${new Date(`${x.dueDate}T12:00:00`).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}${x.dueTime ? ` · ${x.dueTime}` : x.remind ? " · 9 AM" : ""}`
                    : ""}
                  {x.remind ? " · reminder" : ""}
                </Copy>
              </View>
            </Line>
          ))}
          {p.tasks.length > 6 && (
            <Copy size={12} muted>
              +{p.tasks.length - 6} more
            </Copy>
          )}
        </View>
      )
    case "taskComplete":
      return (
        <Copy
          weight="medium"
          style={{
            textDecorationLine:
              card.state === "saved" ? "line-through" : "none",
          }}
        >
          ✓ {tasks.tasks.find((x) => x.id === p.taskId)?.title ?? p.query}
        </Copy>
      )
    case "habitLog": {
      const item = h.habits.find((x) => x.id === p.habitId)
      return (
        <Line style={{ gap: 8 }}>
          <Copy size={24}>{item?.icon ?? "✓"}</Copy>
          <View>
            <Copy weight="semibold">{item?.name ?? "Which habit?"}</Copy>
            <Copy size={12} muted>
              {item?.type === "duration"
                ? `${p.value} min`
                : item?.type === "count"
                  ? `${p.add ? "+" : ""}${p.value} ${item.unit ?? ""}`
                  : "Done"}
              {card.dayOffset && card.dayOffset < 0 ? " · Yesterday" : ""}
            </Copy>
          </View>
        </Line>
      )
    }
    case "habitCreate":
      return (
        <Line style={{ gap: 8 }}>
          <Copy size={24}>{p.icon}</Copy>
          <View>
            <Copy weight="semibold">{p.name}</Copy>
            <Copy size={12} muted>
              {p.days.length === 7
                ? "Every day"
                : p.days.length === 5 &&
                    !p.days.includes(0) &&
                    !p.days.includes(6)
                  ? "Weekdays"
                  : p.days.map((d) => "SMTWTFS"[d]).join(" ")}
              {p.time ? ` · ${p.time}` : ""}
              {p.target
                ? ` · ${p.target} ${p.type === "duration" ? "min" : (p.unit ?? "")}`
                : ""}
            </Copy>
          </View>
        </Line>
      )
    case "routineStart": {
      const item = h.routines.find((x) => x.id === p.routineId)
      return (
        <Line style={{ gap: 8 }}>
          <Copy size={24}>{item?.icon ?? "🌅"}</Copy>
          <View>
            <Copy weight="semibold">{item?.name ?? "Which routine?"}</Copy>
            {item && (
              <Copy size={12} muted>
                {item.steps.length} steps
              </Copy>
            )}
          </View>
        </Line>
      )
    }
    case "weighIn":
      return (
        <View>
          <Copy size={30} weight="displayMedium">
            {p.kg} <Copy muted>kg</Copy>
          </Copy>
        </View>
      )
    case "journal":
      return (
        <View>
          <Copy size={15} lines={4} style={{ lineHeight: 24.375 }}>
            {p.body}
          </Copy>
          <Line style={{ gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            {p.mood && (
              <Copy
                size={12}
                muted
                style={{
                  backgroundColor: t.soft,
                  paddingHorizontal: 6,
                  paddingVertical: 2,
                  borderRadius: 6,
                }}
              >
                {["", "Rough", "Meh", "Okay", "Good", "Great"][p.mood]}
              </Copy>
            )}
            {p.area && (
              <Copy
                size={12}
                style={{
                  color: t.life,
                  backgroundColor: border(t.life, 0.15),
                  paddingHorizontal: 6,
                  paddingVertical: 2,
                  borderRadius: 6,
                  textTransform: "capitalize",
                }}
              >
                {p.area}
              </Copy>
            )}
            {p.tags.map((tag) => (
              <Copy key={tag} size={12} muted>
                #{tag}
              </Copy>
            ))}
          </Line>
        </View>
      )
    case "meal": {
      const tot = p.items.reduce(
        (a, i) => ({
          kcal: a.kcal + i.kcal,
          p: a.p + i.protein,
          c: a.c + i.carbs,
          f: a.f + i.fat,
        }),
        { kcal: 0, p: 0, c: 0, f: 0 },
      )
      const extra = detailTotals(p.items)
      return (
        <View style={{ gap: 10 }}>
          <Line style={{ gap: 8, alignItems: "baseline" }}>
            <Copy size={30} weight="displayMedium">
              {Math.round(tot.kcal)}
            </Copy>
            <Copy size={14} muted>
              kcal
            </Copy>
            <Copy
              size={12}
              muted
              style={{ marginLeft: "auto", textTransform: "capitalize" }}
            >
              {p.label}
            </Copy>
          </Line>
          {/* Amounts to reach */}
          <Line style={{ gap: 6, flexWrap: "wrap" }}>
            <Nutrient label="Protein" value={tot.p} color={t.fit} />
            <Nutrient label="Carbs" value={tot.c} />
            <Nutrient label="Fat" value={tot.f} />
            {extra.fiber !== undefined && (
              <Nutrient label="Fiber" value={extra.fiber} />
            )}
            {card.confidence !== undefined && (
              <Copy size={12} muted style={{ marginLeft: "auto" }}>
                ~{Math.round(card.confidence * 100)}% sure
              </Copy>
            )}
          </Line>
          {/* Amounts to stay under: a share of the day's limit */}
          <LimitList detail={extra} scope="meal" only />
          <View
            style={{
              paddingTop: 8,
              borderTopWidth: 1,
              borderColor: t.line,
              gap: 8,
            }}
          >
            {p.items.map((it, i) => (
              <View key={i} style={{ gap: 2 }}>
                <Line style={{ gap: 8, justifyContent: "space-between" }}>
                  <Copy size={14} weight="medium" lines={1} style={{ flex: 1 }}>
                    {it.name}
                  </Copy>
                  <Copy size={14} muted>
                    {Math.round(it.kcal)} kcal
                  </Copy>
                </Line>
                <Copy size={12} muted>
                  {[
                    `P ${fmtG(it.protein)}`,
                    `C ${fmtG(it.carbs)}`,
                    `F ${fmtG(it.fat)}`,
                    it.fiber !== undefined && `Fiber ${fmtG(it.fiber)}`,
                    it.satFat !== undefined && `Sat fat ${fmtG(it.satFat)}`,
                    it.sugar !== undefined && `Sugar ${fmtG(it.sugar)}`,
                    it.sodium !== undefined &&
                      `Sodium ${Math.round(it.sodium).toLocaleString("en-US")} mg`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Copy>
                {it.assumption && (
                  <Copy size={12} muted style={{ fontStyle: "italic" }}>
                    {it.assumption}
                  </Copy>
                )}
              </View>
            ))}
          </View>
        </View>
      )
    }
    case "workout":
      return (
        <View>
          <Copy weight="semibold">{p.name}</Copy>
          {p.cardio ? (
            <Copy size={14} muted>
              {p.cardio.km !== undefined ? `${p.cardio.km} km · ` : ""}
              {p.cardio.min !== undefined ? `${p.cardio.min}:00 time` : ""}
            </Copy>
          ) : (
            <View style={{ marginTop: 4, gap: 2 }}>
              {p.exercises.map((e, i) => (
                <Line
                  key={i}
                  style={{ justifyContent: "space-between", gap: 8 }}
                >
                  <Copy size={14} lines={1} style={{ flex: 1 }}>
                    {e.exercise}
                  </Copy>
                  <Copy size={14} muted>
                    {e.sets.length}×{e.sets[0]?.reps}
                    {e.sets[0]?.weight ? ` @ ${e.sets[0].weight} kg` : ""}
                  </Copy>
                </Line>
              ))}
            </View>
          )}
        </View>
      )
    case "photo":
      return <Copy size={15}>{p.caption}</Copy>
    case "command":
      return <Copy size={15}>{p.op}</Copy>
  }
}

const fmtG = (n: number) => `${Math.round(n * 10) / 10}g`

/** An amount to reach: a plain pill. */
function Nutrient({
  label,
  value,
  color,
}: {
  label: string
  value: number
  color?: string
}) {
  const t = useTheme()
  return (
    <View
      style={{
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 99,
        backgroundColor: t.soft,
      }}
    >
      <Copy size={12}>
        <Copy size={12} weight="semibold" style={{ color: color ?? t.text }}>
          {label}
        </Copy>{" "}
        {fmtG(value)}
      </Copy>
    </View>
  )
}
