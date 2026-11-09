// Every expense the Projection can count, in one list on the Projection
// page: what is planned to go out (bills, installments, downpayments, what-if
// drafts), each with a switch that says whether the Projection counts it.
// A row opens its planned item, where it is edited or deleted.
import * as A from "@domain/finance/actions"
import * as C from "@domain/finance/calc"
import type { FinState, PlannedItem } from "@domain/finance/data"
import { finStore } from "@domain/finance/store"
import { dayKey } from "@domain/lib/day"
import { View } from "react-native"
import { border, Copy, Frame, Line, SectionHeading, Tap } from "../native-kit"
import { go } from "../navigation"
import { Switch } from "../switch"
import { useTheme } from "../theme"
import { useMoney } from "./finance"
import { FinPill, PlannedIcon, plannedWhere } from "./finance-planned"

/** Money out the Projection can count: not income, not over. */
export function projectedExpenses(s: FinState, today = C.today()) {
  const next = (p: PlannedItem) => C.nextOccurrence(s, p, today) ?? "~"
  return s.planned
    .filter((p) => p.type !== "income" && !p.archived && !C.hasEnded(p, today))
    .filter(
      // A one-off already behind us is history, not something to plan.
      (p) => p.schedule.kind !== "once" || p.schedule.date >= today,
    )
    .sort(
      (a, b) =>
        Number(a.isWhatIf) - Number(b.isWhatIf) ||
        next(a).localeCompare(next(b)),
    )
}

export function ProjectedExpenses() {
  const s = finStore.use((s) => s),
    t = useTheme(),
    money = useMoney(),
    today = dayKey(),
    excluded = s.settings.projExcludedPlanned,
    list = projectedExpenses(s, today),
    counted = (p: PlannedItem) =>
      !p.isWhatIf && p.inProjection && !excluded.includes(p.id),
    on = list.filter(counted).length
  const setCounted = (p: PlannedItem, v: boolean) => {
    if (v) {
      if (p.isWhatIf || !p.inProjection)
        A.updatePlanned(p.id, { isWhatIf: false, inProjection: true })
      if (excluded.includes(p.id))
        A.updateSettings({
          projExcludedPlanned: excluded.filter((id) => id !== p.id),
        })
    } else {
      A.updateSettings({ projExcludedPlanned: [...excluded, p.id] })
    }
  }
  return (
    <View testID="projected-expenses" style={{ marginTop: -12 }}>
      <SectionHeading
        action={
          <Tap onPress={() => go("/finance/planned")}>
            <Copy size={12} style={{ color: t.fin }}>
              All scheduled
            </Copy>
          </Tap>
        }
      >
        Projected expenses
      </SectionHeading>
      <Copy size={12} muted style={{ marginTop: -4, marginBottom: 8 }}>
        {list.length
          ? `${on} of ${list.length} counted. Switch one off to see the month without it; tap it to edit or delete.`
          : "Bills, installments and purchases you plan land here."}
      </Copy>
      <Frame style={{ paddingHorizontal: 12, paddingVertical: 4 }}>
        {list.map((p, i) => {
          const next = C.nextOccurrence(s, p, today),
            isOn = counted(p),
            down = p.schedule.kind === "once" && C.companionOf(s, p)
          return (
            <Line
              key={p.id}
              style={{
                paddingVertical: 10,
                paddingHorizontal: 4,
                gap: 10,
                alignItems: "flex-start",
                borderTopWidth: i ? 1 : 0,
                borderColor: border(t.line, 0.4),
              }}
            >
              <Tap
                label={`${p.name}, ${money(p.amount)}, ${C.scheduleLabel(p)}. Open to edit or delete`}
                onPress={() => go(`/finance/planned/${p.id}`)}
                style={{ flex: 1 }}
              >
                <Line style={{ gap: 10, alignItems: "flex-start" }}>
                  <View style={{ opacity: isOn ? 1 : 0.5 }}>
                    <PlannedIcon p={p} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Copy weight="medium" muted={!isOn}>
                      {p.name}
                    </Copy>
                    <Line style={{ gap: 6, flexWrap: "wrap" }}>
                      {p.isWhatIf && <FinPill tone="warn">draft</FinPill>}
                      {p.isInstallment && <FinPill>installment</FinPill>}
                      {down && <FinPill>downpayment</FinPill>}
                      {!p.isWhatIf && !isOn && <FinPill>not counted</FinPill>}
                    </Line>
                    <Copy size={12} muted>
                      {C.scheduleLabel(p)}
                      {next ? ` · next ${C.dayLabel(next)}` : ""}
                    </Copy>
                    <Copy size={12} muted>
                      {plannedWhere(p, s.accounts, s.categories)}
                    </Copy>
                  </View>
                  <Copy
                    weight="semibold"
                    style={{ color: isOn ? t.bad : t.muted }}
                  >
                    −{money(p.amount)}
                  </Copy>
                </Line>
              </Tap>
              <Switch
                accent="fin"
                label={`Count ${p.name} in the projection`}
                value={isOn}
                onChange={(v) => setCounted(p, v)}
              />
            </Line>
          )
        })}
        {!list.length && (
          <View style={{ paddingVertical: 12, gap: 8 }}>
            <View style={{ opacity: 0.32 }}>
              <Line style={{ gap: 10 }}>
                <View
                  style={{
                    height: 40,
                    width: 40,
                    borderRadius: 20,
                    backgroundColor: t.soft,
                  }}
                />
                <Copy style={{ flex: 1 }}>Rent</Copy>
                <Copy>−{money(15000)}</Copy>
              </Line>
            </View>
            <Tap onPress={() => go("/finance/planned")}>
              <Copy size={12} style={{ color: t.fin }}>
                Add a bill or a planned purchase
              </Copy>
            </Tap>
          </View>
        )}
      </Frame>
    </View>
  )
}
