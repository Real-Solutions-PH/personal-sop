import * as A from "@domain/finance/actions"
import * as C from "@domain/finance/calc"
import type { Budget } from "@domain/finance/data"
import { finStore } from "@domain/finance/store"
import { currencySymbol } from "@domain/lib/money"
import { Check } from "lucide-react-native"
import { useState } from "react"
import { View } from "react-native"
import { toast } from "sonner-native"
import { Copy, Line, Segmented, Tap } from "../native-kit"
import { Switch } from "../switch"
import { useTheme } from "../theme"
import { Button, Field, Sheet, undo } from "../ui"
import { useMoney } from "./finance"
import { FinPill } from "./finance-planned"
export function BudgetEditor({
  id,
  prefill,
  onClose,
}: {
  id?: string
  prefill?: Partial<Budget>
  onClose: () => void
}) {
  const s = finStore.use((s) => s),
    t = useTheme(),
    money = useMoney(),
    ex = s.budgets.find((b) => b.id === id),
    init = { ...ex, ...prefill },
    [name, setName] = useState(init.name ?? ""),
    [all, setAll] = useState(init.categoryIds === null),
    [ids, setIds] = useState(init.categoryIds ?? []),
    [limit, setLimit] = useState(init.limit ? String(init.limit) : ""),
    [rollover, setRollover] = useState(init.rollover ?? false),
    [picker, setPicker] = useState(false),
    [q, setQ] = useState(""),
    hint = Math.round(C.avgSpend(s, all ? null : ids) / 100) * 100,
    cats = s.categories.filter(
      (c) => c.kind === "expense" && !c.archived && !c.system,
    )
  return (
    <Sheet
      title={picker ? "Categories" : ex ? "Edit budget" : "New budget"}
      open
      onClose={picker ? () => setPicker(false) : onClose}
    >
      {picker ? (
        <>
          <Field label="Search categories" value={q} onChangeText={setQ} />
          {cats
            .filter((c) => c.name.toLowerCase().includes(q.toLowerCase()))
            .map((c) => (
              <Tap
                key={c.id}
                onPress={() =>
                  setIds(
                    ids.includes(c.id)
                      ? ids.filter((id) => id !== c.id)
                      : [...ids, c.id],
                  )
                }
                style={{
                  paddingVertical: 10,
                  paddingLeft: c.parentId ? 24 : 0,
                }}
              >
                <Line>
                  <Copy size={20}>{c.icon}</Copy>
                  <Copy style={{ flex: 1 }}>{c.name}</Copy>
                  {ids.includes(c.id) && <Check size={20} color={t.fin} />}
                </Line>
              </Tap>
            ))}
          <Button onPress={() => setPicker(false)}>Done</Button>
        </>
      ) : (
        <>
          <Field
            label="Name"
            placeholder="e.g. Food"
            value={name}
            onChangeText={setName}
          />
          <Copy size={12} muted>
            Covers
          </Copy>
          <Segmented
            value={all ? "all" : "cats"}
            onChange={(v) => setAll(v === "all")}
            options={[
              { value: "all", label: "All spending" },
              { value: "cats", label: "Categories" },
            ]}
          />
          {!all && (
            <Tap
              onPress={() => setPicker(true)}
              style={{
                minHeight: 44,
                borderWidth: 1,
                borderColor: t.line,
                borderRadius: 12,
                padding: 12,
              }}
            >
              <Line style={{ flexWrap: "wrap", gap: 6 }}>
                {ids.length ? (
                  ids.map((id) => (
                    <FinPill key={id} tone="fin">
                      {s.categories.find((c) => c.id === id)?.icon}{" "}
                      {s.categories.find((c) => c.id === id)?.name}
                    </FinPill>
                  ))
                ) : (
                  <Copy size={14} muted>
                    Choose categories…
                  </Copy>
                )}
              </Line>
            </Tap>
          )}
          <Field
            label={`Monthly limit ${currencySymbol()}`}
            value={limit}
            onChangeText={(v) => setLimit(v.replace(/[^\d.]/g, ""))}
            keyboardType="decimal-pad"
          />
          {hint > 0 && (
            <Tap onPress={() => setLimit(String(hint))}>
              <Copy size={12} style={{ color: t.fin }}>
                Your 3-month average is {money(hint)} — use it
              </Copy>
            </Tap>
          )}
          <Copy size={12} muted>
            Period
          </Copy>
          <View
            style={{
              paddingHorizontal: 12,
              paddingVertical: 10,
              borderRadius: 12,
              backgroundColor: t.soft,
            }}
          >
            <Copy size={14}>
              Monthly · cycle starts on day {s.settings.monthStartDay}{" "}
              <Copy size={14} muted>
                (change in Finance settings)
              </Copy>
            </Copy>
          </View>
          <Line style={{ paddingVertical: 12 }}>
            <View style={{ flex: 1 }}>
              <Copy size={14} weight="medium">
                Roll over unspent
              </Copy>
              <Copy size={12} muted>
                Leftover adds to next month's limit.
              </Copy>
            </View>
            <Switch
              label="Roll over unspent"
              accent="fin"
              value={rollover}
              onChange={setRollover}
            />
          </Line>
          <Line style={{ gap: 8 }}>
            {ex && (
              <>
                <Button
                  tone="danger"
                  onPress={() => {
                    A.updateBudget(ex.id, { archived: true })
                    undo(`${ex.name} archived`, () =>
                      A.updateBudget(ex.id, { archived: false }),
                    )
                    onClose()
                  }}
                >
                  Archive
                </Button>
                <Button
                  tone="quiet"
                  onPress={() => {
                    A.deleteBudget(ex.id)
                    toast(`${ex.name} deleted`)
                    onClose()
                  }}
                >
                  Delete
                </Button>
              </>
            )}
            <View style={{ flex: 1 }}>
              <Button
                onPress={() => {
                  if (!(Number(limit) > 0)) {
                    toast.error("Set a limit")
                    return
                  }
                  if (!all && !ids.length) {
                    toast.error("Pick at least one category")
                    return
                  }
                  const input = {
                    name:
                      name.trim() ||
                      (all
                        ? "Monthly spend"
                        : ids
                            .map(
                              (id) =>
                                s.categories.find((c) => c.id === id)?.name,
                            )
                            .join(" + ")),
                    categoryIds: all ? null : ids,
                    limit: Number(limit),
                    rollover,
                  }
                  ex ? A.updateBudget(ex.id, input) : A.addBudget(input)
                  toast(ex ? "Budget updated" : `Budget “${input.name}” set`)
                  onClose()
                }}
              >
                Save
              </Button>
            </View>
          </Line>
        </>
      )}
    </Sheet>
  )
}
