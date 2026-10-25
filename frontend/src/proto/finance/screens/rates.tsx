"use client"

// Where to keep savings: PH digital-bank products and their advertised rates,
// searchable and filterable. Picking one starts a new account with its name
// and top rate filled in.

import { Search } from "lucide-react"
import { useState } from "react"
import { cn } from "@/lib/utils"
import { Card, Chip, Empty, Row, Screen } from "../../ui/kit"
import { addDays, shortDate, today } from "../calc"
import { RATES, RATES_AS_OF, type RateKind, rateLabel } from "../rates"
import { openSheet } from "../sheets"
import { ChipRow, inputCls } from "../ui"

const KINDS: { v: RateKind; label: string }[] = [
  { v: "daily", label: "Daily interest" },
  { v: "monthly", label: "Monthly interest" },
  { v: "deposit", label: "Time deposit" },
]

export function RatesScreen() {
  const [q, setQ] = useState("")
  const [kind, setKind] = useState<RateKind | null>(null)
  const shown = RATES.filter(
    (r) =>
      (!kind || r.kind === kind) &&
      r.bank.toLowerCase().includes(q.trim().toLowerCase()),
  )
  return (
    <Screen title="Savings rates" back="/finance/accounts">
      <div className="relative">
        <Search className="absolute top-3 left-3 size-4 text-muted-foreground" />
        <input
          aria-label="Search bank"
          className={cn(inputCls, "pl-9")}
          placeholder="Search bank name"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="mt-3">
        <ChipRow>
          {KINDS.map((k) => (
            <Chip
              key={k.v}
              accent="fin"
              active={kind === k.v}
              onClick={() => setKind(kind === k.v ? null : k.v)}
            >
              {k.label}
            </Chip>
          ))}
        </ChipRow>
      </div>
      {!shown.length ? (
        <Empty title="No matching banks" body="Try another name or filter." />
      ) : (
        <Card className="mt-3 px-3 py-1">
          {shown.map((r) => (
            <Row
              key={`${r.bank}-${r.product}`}
              title={r.bank}
              subtitle={
                r.product === "Time Deposit"
                  ? r.product
                  : `${r.product} · ${KINDS.find((k) => k.v === r.kind)?.label}`
              }
              right={
                <span className="num font-semibold text-fin">
                  {rateLabel(r)}
                </span>
              }
              onClick={() =>
                openSheet({
                  kind: "account",
                  prefill: {
                    name: `${r.bank} ${r.product}`.slice(0, 60),
                    type: "bank",
                    rate: r.max,
                    maturesOn:
                      r.kind === "deposit" ? addDays(today(), 365) : undefined,
                  },
                })
              }
            />
          ))}
        </Card>
      )}
      <p className="mt-4 text-center text-muted-foreground text-xs">
        Advertised rates as of {shortDate(RATES_AS_OF)}, per year, before tax.
        Rates change; check with the bank before you move money.
      </p>
    </Screen>
  )
}
