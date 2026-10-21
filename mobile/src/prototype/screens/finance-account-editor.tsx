import * as A from "@domain/finance/actions"
import type { Account } from "@domain/finance/data"
import { finStore } from "@domain/finance/store"
import { dayKey } from "@domain/lib/day"
import { useState } from "react"
import { View } from "react-native"
import { toast } from "sonner-native"
import { Copy, Line, Tap } from "../native-kit"
import { Switch } from "../switch"
import { useTheme } from "../theme"
import { Button, confirm, DateField, Field, Sheet, undo } from "../ui"
import { isDay } from "../validation"
import { FinChip } from "./finance-projection"

const COLORS = [
  "green",
  "blue",
  "emerald",
  "red",
  "rose",
  "violet",
  "orange",
  "cyan",
  "slate",
] as const
export function AccountEditor({
  account: ex,
  open,
  onClose,
}: {
  account?: Account
  open: boolean
  onClose: () => void
}) {
  const s = finStore.use((s) => s),
    t = useTheme(),
    [name, setName] = useState(ex?.name ?? ""),
    [type, setType] = useState<Account["type"]>(ex?.type ?? "ewallet"),
    [opening, setOpening] = useState(ex ? String(ex.opening) : ""),
    [date, setDate] = useState(ex?.openingDate ?? dayKey()),
    [limit, setLimit] = useState(ex?.limit ? String(ex.limit) : ""),
    [color, setColor] = useState(ex?.color ?? "var(--acct-blue)"),
    [nw, setNw] = useState(ex?.inNetWorth ?? true),
    [proj, setProj] = useState(ex?.inProjection ?? true),
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
            { v: "credit", label: "Credit card" },
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
          <Field
            label={type === "credit" ? "Balance owed ₱" : "Opening balance ₱"}
            value={opening}
            onChangeText={setOpening}
            keyboardType="decimal-pad"
          />
        </View>
        <View style={{ flex: 1 }}>
          <DateField label="As of" value={date} onChangeText={setDate} />
        </View>
      </Line>
      {type === "credit" && (
        <Field
          label="Credit limit ₱"
          value={limit}
          onChangeText={setLimit}
          keyboardType="decimal-pad"
        />
      )}
      <Copy size={12} muted>
        Colour
      </Copy>
      <Line style={{ gap: 8, flexWrap: "wrap" }}>
        {COLORS.map((c) => (
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
                  } else {
                    A.deleteAccount(ex.id)
                    toast(`${ex.name} deleted`)
                  }
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
              }
              if (ex)
                A.updateAccount(ex.id, {
                  ...input,
                  opening: Number(opening || 0),
                })
              else A.addAccount(input)
              toast(ex ? "Account updated" : `${name.trim()} added`)
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
