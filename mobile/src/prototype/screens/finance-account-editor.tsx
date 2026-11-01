import * as A from "@domain/finance/actions"
import type { Account } from "@domain/finance/data"
import { finStore } from "@domain/finance/store"
import { dayKey } from "@domain/lib/day"
import { useCurrency } from "@domain/lib/money"
import { useState } from "react"
import { View } from "react-native"
import { toast } from "sonner-native"
import { MoneyInput } from "../money-input"
import { Copy, Line, Tap } from "../native-kit"
import { Switch } from "../switch"
import { useTheme } from "../theme"
import { Button, confirm, DateField, Field, Sheet, undo } from "../ui"
import { isDay } from "../validation"
import { ACCOUNT_COLORS, accountColorKey } from "./finance-account-card"
import { FinChip } from "./finance-projection"

export function AccountEditor({
  account,
  prefill,
  open,
  onClose,
}: {
  account?: Account
  /** Starting values for a new account (from the rates directory). */
  prefill?: Partial<Account>
  open: boolean
  onClose: () => void
}) {
  const ex = account,
    seed = ex ?? prefill
  const s = finStore.use((s) => s),
    t = useTheme(),
    sym = useCurrency().symbol,
    [name, setName] = useState(seed?.name ?? ""),
    [type, setType] = useState<Account["type"]>(
      !ex && seed?.type === "credit" ? "ewallet" : (seed?.type ?? "ewallet"),
    ),
    [rate, setRate] = useState(
      seed?.rate !== undefined ? String(seed.rate) : "",
    ),
    [deposit, setDeposit] = useState(Boolean(seed?.maturesOn)),
    [matures, setMatures] = useState(seed?.maturesOn ?? dayKey()),
    [goal, setGoal] = useState(seed?.goal ? String(seed.goal) : ""),
    [dated, setDated] = useState(Boolean(seed?.goalBy)),
    [goalBy, setGoalBy] = useState(seed?.goalBy ?? dayKey()),
    // A card's balance owed is typed as a positive amount and stored negative.
    [opening, setOpening] = useState(
      ex
        ? String(ex.type === "credit" ? Math.abs(ex.opening) : ex.opening)
        : "",
    ),
    [date, setDate] = useState(ex?.openingDate ?? dayKey()),
    [limit, setLimit] = useState(ex?.limit ? String(ex.limit) : ""),
    // An account drawn in a colour nobody picked shows that colour picked.
    [color, setColor] = useState(() => {
      if (!ex) return "var(--acct-blue)"
      const key = accountColorKey(ex)
      return key.startsWith("#") ? key : `var(--${key})`
    }),
    [nw, setNw] = useState(ex?.inNetWorth ?? true),
    [proj, setProj] = useState(ex?.inProjection ?? !seed?.maturesOn),
    [tried, setTried] = useState(false),
    count = ex
      ? s.records.filter(
          (r) => r.accountId === ex.id || r.toAccountId === ex.id,
        ).length
      : 0
  return (
    <Sheet
      title={ex ? "Edit account" : "New account"}
      open={open}
      onClose={onClose}
    >
      <Field
        label="Name"
        placeholder="e.g. GoTyme"
        value={name}
        onChangeText={setName}
        error={tried && !name.trim() ? "Give it a name" : undefined}
      />
      <Copy size={12} muted>
        Type
      </Copy>
      <Line style={{ gap: 8, flexWrap: "wrap" }}>
        {(
          [
            { v: "cash", label: "Cash" },
            { v: "bank", label: "Bank" },
            { v: "ewallet", label: "E-wallet" },
            // Credit cards can't be added any more; a card made before that
            // keeps its type (and its owed balance and limit) when edited.
            ...(ex?.type === "credit"
              ? [{ v: "credit", label: "Credit card" } as const]
              : []),
            { v: "investment", label: "Investment" },
          ] as const
        ).map((o) => (
          <FinChip
            key={o.v}
            label={o.label}
            active={type === o.v}
            onPress={() => setType(o.v)}
          />
        ))}
      </Line>
      <Line style={{ alignItems: "flex-start" }}>
        <View style={{ flex: 1 }}>
          <MoneyInput
            label={
              type === "credit"
                ? `Balance owed ${sym}`
                : `Opening balance ${sym}`
            }
            value={opening}
            onChange={setOpening}
            signed={type !== "credit"}
          />
        </View>
        <View style={{ flex: 1 }}>
          <DateField label="As of" value={date} onChangeText={setDate} />
        </View>
      </Line>
      {type === "credit" && (
        <MoneyInput
          label={`Credit limit ${sym}`}
          value={limit}
          onChange={setLimit}
        />
      )}
      {type !== "credit" && (
        <>
          <Line style={{ alignItems: "flex-start" }}>
            <View style={{ flex: 1 }}>
              <Field
                label="Interest % a year"
                placeholder="e.g. 4.5"
                value={rate}
                onChangeText={setRate}
                keyboardType="decimal-pad"
              />
            </View>
            <View style={{ flex: 1 }}>
              <MoneyInput
                label={`Savings goal ${sym}`}
                placeholder="Optional"
                value={goal}
                onChange={setGoal}
              />
            </View>
          </Line>
          {!!goal && (
            <Line style={{ paddingVertical: 4 }}>
              <Copy size={14} weight="medium" style={{ flex: 1 }}>
                Reach the goal by a date
              </Copy>
              <Switch
                label="Reach the goal by a date"
                accent="fin"
                value={dated}
                onChange={setDated}
              />
            </Line>
          )}
          {!!goal && dated && (
            <DateField
              label="Goal date"
              value={goalBy}
              onChangeText={setGoalBy}
            />
          )}
          <Line style={{ paddingVertical: 4 }}>
            <View style={{ flex: 1 }}>
              <Copy size={14} weight="medium">
                Time deposit
              </Copy>
              <Copy size={12} muted>
                Locked until it matures.
              </Copy>
            </View>
            <Switch
              label="Time deposit"
              accent="fin"
              value={deposit}
              onChange={(v) => {
                setDeposit(v)
                // Locked money isn't spendable in the forecast.
                if (v && !ex) setProj(false)
              }}
            />
          </Line>
          {deposit && (
            <DateField
              label="Matures on"
              value={matures}
              onChangeText={setMatures}
            />
          )}
        </>
      )}
      <Copy size={12} muted>
        Colour
      </Copy>
      <Line style={{ gap: 8, flexWrap: "wrap" }}>
        {ACCOUNT_COLORS.map((c) => (
          <Tap
            key={c}
            label={c}
            onPress={() => setColor(`var(--acct-${c})`)}
            style={{
              width: 32,
              height: 32,
              borderRadius: 16,
              backgroundColor: t[`acct-${c}`],
              borderWidth: color === `var(--acct-${c})` ? 2 : 0,
              borderColor: t.text,
            }}
          >
            {null}
          </Tap>
        ))}
      </Line>
      <Line style={{ paddingVertical: 12 }}>
        <View style={{ flex: 1 }}>
          <Copy size={14} weight="medium">
            Include in net worth
          </Copy>
          {type === "credit" && (
            <Copy size={12} muted>
              Counted as a liability.
            </Copy>
          )}
        </View>
        <Switch
          label="Include in net worth"
          accent="fin"
          value={nw}
          onChange={setNw}
        />
      </Line>
      {type !== "credit" && type !== "investment" && (
        <Line style={{ paddingVertical: 12 }}>
          <View style={{ flex: 1 }}>
            <Copy size={14} weight="medium">
              Include in savings projection
            </Copy>
            <Copy size={12} muted>
              Counts as available money in the forecast.
            </Copy>
          </View>
          <Switch
            label="Include in savings projection"
            accent="fin"
            value={proj}
            onChange={setProj}
          />
        </Line>
      )}
      {type === "investment" && (
        <Copy size={12} muted>
          Investment balances are updated by hand: update the value from the
          account screen.
        </Copy>
      )}
      <Line style={{ gap: 8 }}>
        {ex && (
          <Button
            tone="danger"
            onPress={() =>
              confirm(
                `${count ? "Archive" : "Delete"} ${ex.name}?`,
                count
                  ? `This account has ${count} transactions, so it can't be deleted. Archive hides it everywhere but keeps its history.`
                  : "It has no transactions, so it can be deleted permanently.",
                () => {
                  if (count) {
                    A.updateAccount(ex.id, { archived: true })
                    undo(`${ex.name} archived`, () =>
                      A.updateAccount(ex.id, { archived: false }),
                    )
                  } else A.deleteAccount(ex.id)
                  onClose()
                },
              )
            }
          >
            {count ? "Archive" : "Delete"}
          </Button>
        )}
        <View style={{ flex: 1 }}>
          <Button
            onPress={() => {
              setTried(true)
              if (!name.trim()) return
              if (
                !isDay(date) ||
                !Number.isFinite(Number(opening)) ||
                !Number.isFinite(Number(limit))
              ) {
                toast.error("Check the balance and date")
                return
              }
              const savings = type !== "credit"
              if (
                savings &&
                (!(Number(rate) >= 0 && Number(rate) <= 100) ||
                  !(Number(goal) >= 0) ||
                  (deposit && !isDay(matures)) ||
                  (goal && dated && !isDay(goalBy)))
              ) {
                toast.error("Check the interest, goal and dates")
                return
              }
              const input = {
                name: name.trim(),
                type,
                opening:
                  Number(opening || 0) *
                  (type === "credit" && Number(opening) > 0 ? -1 : 1),
                openingDate: date,
                limit: type === "credit" ? Number(limit || 0) : undefined,
                color,
                inNetWorth: nw,
                inProjection:
                  type === "credit" || type === "investment" ? false : proj,
                manual: type === "investment",
                rate: savings && rate ? Number(rate) : undefined,
                maturesOn: savings && deposit ? matures : undefined,
                goal: savings && Number(goal) > 0 ? Number(goal) : undefined,
                goalBy:
                  savings && Number(goal) > 0 && dated ? goalBy : undefined,
              }
              if (ex) A.updateAccount(ex.id, input)
              else A.addAccount(input)
              onClose()
            }}
          >
            Save
          </Button>
        </View>
      </Line>
    </Sheet>
  )
}
