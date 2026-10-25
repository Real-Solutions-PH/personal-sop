// Where to keep savings: PH digital-bank products and their advertised rates,
// searchable and filterable. Tapping one starts a new account with its name
// and top rate filled in.
import * as C from "@domain/finance/calc"
import {
  RATES,
  RATES_AS_OF,
  type RateKind,
  type RateProduct,
  rateLabel,
} from "@domain/finance/rates"
import { useState } from "react"
import { View } from "react-native"
import { Copy, Frame, Line, Tap } from "../native-kit"
import { useTheme } from "../theme"
import { Empty, Field, Screen } from "../ui"
import { AccountEditor } from "./finance-account-editor"
import { FinChip } from "./finance-projection"

const KINDS: { v: RateKind; label: string }[] = [
  { v: "daily", label: "Daily interest" },
  { v: "monthly", label: "Monthly interest" },
  { v: "deposit", label: "Time deposit" },
]

export function Rates() {
  const t = useTheme(),
    [q, setQ] = useState(""),
    [kind, setKind] = useState<RateKind | null>(null),
    [pick, setPick] = useState<RateProduct | null>(null),
    shown = RATES.filter(
      (r) =>
        (!kind || r.kind === kind) &&
        r.bank.toLowerCase().includes(q.trim().toLowerCase()),
    )
  return (
    <Screen prototypeLayout title="Savings rates">
      <Field
        label="Search bank"
        hideLabel
        placeholder="Search bank name"
        value={q}
        onChangeText={setQ}
      />
      <Line style={{ gap: 8, flexWrap: "wrap" }}>
        {KINDS.map((k) => (
          <FinChip
            key={k.v}
            label={k.label}
            active={kind === k.v}
            onPress={() => setKind(kind === k.v ? null : k.v)}
          />
        ))}
      </Line>
      {!shown.length ? (
        <Empty title="No matching banks" detail="Try another name or filter." />
      ) : (
        <Frame style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
          {shown.map((r) => (
            <Tap
              key={`${r.bank}-${r.product}`}
              label={`${r.bank} ${r.product}, ${rateLabel(r)} a year. Add as account`}
              onPress={() => setPick(r)}
              style={{ paddingVertical: 12 }}
            >
              <Line>
                <View style={{ flex: 1 }}>
                  <Copy weight="medium">{r.bank}</Copy>
                  <Copy size={12} muted>
                    {r.product === "Time Deposit"
                      ? r.product
                      : `${r.product} · ${KINDS.find((k) => k.v === r.kind)?.label}`}
                  </Copy>
                </View>
                <Copy size={16} weight="medium" style={{ color: t.fin }}>
                  {rateLabel(r)}
                </Copy>
              </Line>
            </Tap>
          ))}
        </Frame>
      )}
      <Copy size={12} muted style={{ textAlign: "center" }}>
        Advertised rates as of {C.shortDate(RATES_AS_OF)}, per year, before tax.
        Rates change; check with the bank before you move money.
      </Copy>
      {pick && (
        <AccountEditor
          key={`${pick.bank}-${pick.product}`}
          prefill={{
            name: `${pick.bank} ${pick.product}`.slice(0, 60),
            type: "bank",
            rate: pick.max,
            maturesOn:
              pick.kind === "deposit" ? C.addDays(C.today(), 365) : undefined,
          }}
          open
          onClose={() => setPick(null)}
        />
      )}
    </Screen>
  )
}
