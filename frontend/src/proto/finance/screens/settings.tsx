"use client"

import {
  Archive,
  Download,
  FolderTree,
  RotateCcw,
  ShieldCheck,
  Sparkles,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { type ReactNode, useMemo, useState } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { privacyStore, togglePrivacy } from "../../lib/privacy"
import {
  Btn,
  Card,
  Chip,
  Empty,
  NumberInput,
  Row,
  Screen,
  SectionTitle,
  Segmented,
} from "../../ui/kit"
import {
  addAccount,
  addPlanned,
  deleteAccount,
  deleteBudget,
  deleteCategory,
  deletePlanned,
  resetFinance,
  startFresh,
  updateAccount,
  updateBudget,
  updateCategory,
  updatePlanned,
  updateSettings,
} from "../actions"
import { acctMap, catMap, recDay, today } from "../calc"
import type { AccountType } from "../data"
import { openSheet } from "../sheets"
import { useFin } from "../store"
import { ChipRow, Field, inputCls, Pill, Toggle } from "../ui"

// ------------------------------------------------------------------ FIN-35

export function FinanceSettings() {
  const s = useFin()
  const router = useRouter()
  const hidden = privacyStore.use((x) => x.hidden)
  const st = s.settings
  const [floor, setFloor] = useState(String(st.safetyFloor))
  const exportCsv = () => {
    const cats = catMap(s)
    const accts = acctMap(s)
    const lines = [
      "date,type,amount,account,to_account,category,payee,note,source",
      ...s.records.map((r) =>
        [
          recDay(r),
          r.type,
          r.amount,
          accts.get(r.accountId)?.name ?? "",
          accts.get(r.toAccountId ?? "")?.name ?? "",
          cats.get(r.categoryId ?? "")?.name ?? "",
          r.payee ?? "",
          (r.note ?? "").replace(/,/g, ";"),
          r.source,
        ]
          .map((x) => `"${String(x).replace(/"/g, '""')}"`)
          .join(","),
      ),
    ]
    const url = URL.createObjectURL(
      new Blob([lines.join("\n")], { type: "text/csv" }),
    )
    const a = document.createElement("a")
    a.href = url
    a.download = `finance-records-${today()}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast(`Exported ${s.records.length} transactions`)
  }
  return (
    <Screen title="Finance settings" back>
      <SectionTitle>Logging</SectionTitle>
      <Card>
        <Field
          label="Default account"
          hint="Pre-selected in quick-add and chat when you don't say which."
        >
          <ChipRow>
            {s.accounts
              .filter((a) => !a.archived && a.type !== "investment")
              .map((a) => (
                <Chip
                  key={a.id}
                  accent="fin"
                  active={st.defaultAccountId === a.id}
                  onClick={() => updateSettings({ defaultAccountId: a.id })}
                >
                  {a.name}
                </Chip>
              ))}
          </ChipRow>
        </Field>
        <Field
          label="Month starts on day"
          hint="Budgets, reviews and stats use this cycle."
        >
          <div className="flex items-center gap-3">
            <Btn
              variant="secondary"
              className="w-11 px-0"
              onClick={() =>
                updateSettings({
                  monthStartDay: Math.max(1, st.monthStartDay - 1),
                })
              }
            >
              −
            </Btn>
            <span className="num w-10 text-center font-semibold text-xl">
              {st.monthStartDay}
            </span>
            <Btn
              variant="secondary"
              className="w-11 px-0"
              onClick={() =>
                updateSettings({
                  monthStartDay: Math.min(28, st.monthStartDay + 1),
                })
              }
            >
              +
            </Btn>
            <div className="flex gap-1.5">
              {[1, 15].map((d) => (
                <Chip
                  key={d}
                  className="h-8"
                  accent="fin"
                  active={st.monthStartDay === d}
                  onClick={() => updateSettings({ monthStartDay: d })}
                >
                  {d === 1 ? "1st" : "15th (payday)"}
                </Chip>
              ))}
            </div>
          </div>
        </Field>
        <Toggle
          checked={hidden}
          onChange={() => togglePrivacy()}
          label="Privacy mode"
          hint="Blurs every ₱ amount app-wide. Percentages stay visible."
        />
      </Card>

      <SectionTitle>Forecast</SectionTitle>
      <Card>
        <Field label="Forecast length">
          <Segmented
            value={String(st.horizon) as "6" | "12" | "24"}
            onChange={(v) =>
              updateSettings({ horizon: Number(v) as 6 | 12 | 24 })
            }
            options={[
              { value: "6", label: "6 months" },
              { value: "12", label: "12 months" },
              { value: "24", label: "24 months" },
            ]}
          />
        </Field>
        <Toggle
          checked={st.includeUnplanned}
          onChange={(v) => updateSettings({ includeUnplanned: v })}
          label="Include average everyday spending"
          hint="Recommended. Off shows scheduled payments only."
        />
        <Field
          label="Minimum balance ₱"
          hint="What-ifs warn when your balance would dip below this."
        >
          <NumberInput
            inputMode="decimal"
            className={inputCls}
            value={floor}
            onChange={(e) => setFloor(e.target.value.replace(/[^\d]/g, ""))}
            onBlur={() => updateSettings({ safetyFloor: Number(floor || 0) })}
          />
        </Field>
      </Card>

      <SectionTitle>AI</SectionTitle>
      <Card>
        <Field
          label="Data the AI may see"
          hint="Applies to the advisor and statement reading."
        >
          <Segmented
            value={st.aiScope}
            onChange={(v) => updateSettings({ aiScope: v })}
            options={[
              { value: "aggregates", label: "Totals only" },
              { value: "records", label: "Individual transactions" },
            ]}
          />
        </Field>
        <Row
          onClick={() => openSheet({ kind: "disclaimer" })}
          icon={<ShieldCheck className="size-5 text-fin" />}
          title="Advisor disclaimer"
          subtitle={st.disclaimerAck ? "Acknowledged" : "Not yet acknowledged"}
        />
      </Card>

      <SectionTitle>Statement matching</SectionTitle>
      <Card>
        <Field label="Remind me when an account hasn't been matched with a statement for">
          <div className="flex gap-2">
            {[14, 21, 30, 45].map((d) => (
              <Chip
                key={d}
                accent="fin"
                active={st.nudgeDays === d}
                onClick={() => updateSettings({ nudgeDays: d })}
              >
                {d} days
              </Chip>
            ))}
          </div>
        </Field>
      </Card>

      <SectionTitle>Data</SectionTitle>
      <Card className="px-3 py-1">
        <Row
          href="/finance/categories"
          icon={<FolderTree className="size-5 text-muted-foreground" />}
          title="Manage categories"
        />
        <Row
          href="/finance/archived"
          icon={<Archive className="size-5 text-muted-foreground" />}
          title="Archived items"
        />
        <Row
          onClick={exportCsv}
          icon={<Download className="size-5 text-muted-foreground" />}
          title="Export transactions (CSV)"
          subtitle={`${s.records.length} transactions`}
        />
      </Card>

      <SectionTitle>Prototype</SectionTitle>
      <Card className="px-3 py-1">
        <Row
          onClick={() => {
            resetFinance()
            toast("Finance demo data restored")
          }}
          icon={<RotateCcw className="size-5 text-muted-foreground" />}
          title="Reset demo data"
          subtitle="90 days of sample history"
        />
        <Row
          onClick={() =>
            openSheet({
              kind: "confirm",
              title: "Start fresh?",
              body: "Clears finance data so you can walk the first-run setup. Reset demo data brings it back.",
              confirm: "Start fresh",
              danger: true,
              onConfirm: () => {
                startFresh()
                router.push("/finance/setup")
              },
            })
          }
          icon={<Sparkles className="size-5 text-muted-foreground" />}
          title="Start fresh (first-run setup)"
        />
      </Card>
    </Screen>
  )
}

// ------------------------------------------------------------------ FIN-36

export function ArchivedScreen() {
  const s = useFin()
  const accounts = s.accounts.filter((a) => a.archived)
  const cats = s.categories.filter((c) => c.archived)
  const budgets = s.budgets.filter((b) => b.archived)
  const planned = s.planned.filter((p) => p.archived)
  const purge = (label: string, ok: boolean) =>
    ok
      ? toast(`${label} deleted permanently`)
      : toast.error(
          `${label} still has transactions — it can only stay archived`,
        )
  const none =
    accounts.length + cats.length + budgets.length + planned.length === 0
  const section = (
    title: string,
    items: { id: string; name: string; restore: () => void; del: () => void }[],
  ) =>
    items.length > 0 && (
      <>
        <SectionTitle>{title}</SectionTitle>
        <Card className="px-3 py-1">
          {items.map((x) => (
            <div key={x.id} className="flex items-center gap-2 py-2">
              <span className="flex-1 font-medium">{x.name}</span>
              <Btn variant="secondary" className="h-9" onClick={x.restore}>
                Restore
              </Btn>
              <Btn
                variant="danger"
                className="h-9"
                onClick={() =>
                  openSheet({
                    kind: "confirm",
                    title: `Delete ${x.name} permanently?`,
                    body: "This can't be undone. It's blocked if transactions still reference it.",
                    confirm: "Delete permanently",
                    danger: true,
                    onConfirm: x.del,
                  })
                }
              >
                Delete
              </Btn>
            </div>
          ))}
        </Card>
      </>
    )
  return (
    <Screen title="Archived" back>
      {none && (
        <Empty
          icon={<Archive className="size-10" />}
          title="Nothing archived"
          body="Archived accounts, categories, budgets and scheduled payments show up here."
        />
      )}
      {section(
        "Accounts",
        accounts.map((a) => ({
          id: a.id,
          name: a.name,
          restore: () => updateAccount(a.id, { archived: false }),
          del: () => purge(a.name, deleteAccount(a.id)),
        })),
      )}
      {section(
        "Categories",
        cats.map((c) => ({
          id: c.id,
          name: `${c.icon} ${c.name}`,
          restore: () => updateCategory(c.id, { archived: false }),
          del: () => purge(c.name, deleteCategory(c.id)),
        })),
      )}
      {section(
        "Budgets",
        budgets.map((b) => ({
          id: b.id,
          name: b.name,
          restore: () => updateBudget(b.id, { archived: false }),
          del: () => {
            deleteBudget(b.id)
            purge(b.name, true)
          },
        })),
      )}
      {section(
        "Scheduled payments",
        planned.map((p) => ({
          id: p.id,
          name: p.name,
          restore: () => updatePlanned(p.id, { archived: false }),
          del: () => purge(p.name, deletePlanned(p.id)),
        })),
      )}
    </Screen>
  )
}

// ------------------------------------------------------------------ FIN-37

interface Suggest {
  key: string
  name: string
  type: AccountType
  color: string
  on: boolean
  balance: string
  limit?: string
}

// Embedded in the app-wide setup flow (/setup) via `onDone`: no screen chrome,
// the flow owns Skip and navigation.
const Plain = ({
  children,
}: {
  children: ReactNode
  title?: string
  back?: string
}) => <div>{children}</div>

export function FinanceSetup({ onDone }: { onDone?: () => void } = {}) {
  const s = useFin()
  const router = useRouter()
  const existing = useMemo(
    () => new Set(s.accounts.map((a) => a.name.toLowerCase())),
    [s],
  )
  const [rows, setRows] = useState<Suggest[]>(() => [
    {
      key: "cash",
      name: "Cash",
      type: "cash" as const,
      color: "#16a34a",
      on: true,
      balance: "",
    },
    {
      key: "gcash",
      name: "GCash",
      type: "ewallet" as const,
      color: "#2563eb",
      on: true,
      balance: "",
    },
    {
      key: "maya",
      name: "Maya",
      type: "ewallet" as const,
      color: "#10b981",
      on: true,
      balance: "",
    },
    {
      key: "bank",
      name: "BPI Savings",
      type: "bank" as const,
      color: "#b91c1c",
      on: true,
      balance: "",
    },
    {
      key: "cc",
      name: "Credit card",
      type: "credit" as const,
      color: "#9f1239",
      on: false,
      balance: "",
      limit: "",
    },
  ])
  const [salary, setSalary] = useState("")
  const [rent, setRent] = useState("")
  const DEFAULT: Record<string, string> = {
    cash: "cash",
    gcash: "gcash",
    maya: "maya",
    bank: "bpi savings",
    cc: "credit card",
  }
  const visible = rows.filter((r) => !existing.has(DEFAULT[r.key]))
  const set = (key: string, patch: Partial<Suggest>) =>
    setRows((x) => x.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const finish = () => {
    const created: Record<string, string> = {}
    for (const r of visible.filter((x) => x.on)) {
      const a = addAccount({
        name: r.name,
        type: r.type,
        opening:
          r.type === "credit"
            ? -Number(r.balance || 0)
            : Number(r.balance || 0),
        color: r.color,
        limit: r.type === "credit" ? Number(r.limit || 0) : undefined,
        inNetWorth: true,
        inProjection: r.type !== "credit",
      })
      created[r.key] = a.id
    }
    const bank = created.bank ?? s.accounts[0]?.id
    if (Number(salary) && bank)
      addPlanned({
        name: "Salary",
        type: "income",
        amount: Number(salary),
        estimated: false,
        accountId: bank,
        categoryId: "salary",
        schedule: { kind: "semimonthly", days: [15, 30] },
        end: { kind: "never" },
        autoLog: true,
        isWhatIf: false,
        inProjection: true,
      })
    if (Number(rent) && bank)
      addPlanned({
        name: "Rent",
        type: "expense",
        amount: Number(rent),
        estimated: false,
        accountId: bank,
        categoryId: "rent",
        schedule: { kind: "monthly", day: 5 },
        end: { kind: "never" },
        autoLog: false,
        isWhatIf: false,
        inProjection: true,
      })
    if (created.gcash) updateSettings({ defaultAccountId: created.gcash })
    toast(`${Object.keys(created).length} accounts added`)
    if (onDone) onDone()
    else router.push("/finance")
  }
  const Wrap = onDone ? Plain : Screen
  return (
    <Wrap title="Set up Finance" back="/finance">
      {!onDone && (
        <p className="px-1 text-muted-foreground text-sm">
          Pick where your money lives and type today's balance. You can
          fine-tune later.
        </p>
      )}
      <div className="mt-3 space-y-2">
        {visible.map((r) => (
          <Card key={r.key} className={cn("p-3", !r.on && "opacity-60")}>
            <div className="flex items-center gap-3">
              <button
                type="button"
                aria-label={`Include ${r.name}`}
                onClick={() => set(r.key, { on: !r.on })}
                className={cn(
                  "grid size-6 place-items-center rounded-md border text-xs",
                  r.on ? "border-fin bg-fin text-background" : "border-border",
                )}
              >
                {r.on && "✓"}
              </button>
              <span
                className="size-3 rounded-full"
                style={{ background: r.color }}
              />
              <input
                className="min-w-0 flex-1 bg-transparent font-medium outline-none"
                value={r.name}
                onChange={(e) => set(r.key, { name: e.target.value })}
              />
              <NumberInput
                inputMode="decimal"
                placeholder={r.type === "credit" ? "owed ₱" : "balance ₱"}
                className="h-9 w-28 rounded-lg border border-border bg-background px-2 text-right text-sm outline-none focus:border-fin"
                value={r.balance}
                onChange={(e) =>
                  set(r.key, {
                    balance: e.target.value.replace(/[^\d.]/g, ""),
                    on: true,
                  })
                }
              />
            </div>
            {r.type === "credit" && r.on && (
              <NumberInput
                inputMode="decimal"
                placeholder="Credit limit ₱"
                className="mt-2 h-9 w-full rounded-lg border border-border bg-background px-2 text-sm outline-none focus:border-fin"
                value={r.limit}
                onChange={(e) =>
                  set(r.key, { limit: e.target.value.replace(/[^\d.]/g, "") })
                }
              />
            )}
          </Card>
        ))}
        {visible.length === 0 && (
          <div className="text-center text-muted-foreground text-sm">
            All suggested accounts already exist.
          </div>
        )}
      </div>

      <SectionTitle>
        Unlock the projection <Pill tone="fin">optional</Pill>
      </SectionTitle>
      <Card>
        <Field label="Salary per payday ₱ (15th & 30th)">
          <NumberInput
            inputMode="decimal"
            className={inputCls}
            placeholder="e.g. 27500"
            value={salary}
            onChange={(e) => setSalary(e.target.value.replace(/[^\d]/g, ""))}
          />
        </Field>
        <Field label="Rent ₱ (5th of the month)">
          <NumberInput
            inputMode="decimal"
            className={inputCls}
            placeholder="e.g. 12000"
            value={rent}
            onChange={(e) => setRent(e.target.value.replace(/[^\d]/g, ""))}
          />
        </Field>
      </Card>

      <Card className="mt-3 flex items-center gap-3">
        <Download className="size-5 text-muted-foreground" />
        <div className="flex-1 text-sm">
          Coming from Wallet (BudgetBaker)?
          <span className="block text-muted-foreground text-xs">
            Import your CSV export for instant history.
          </span>
        </div>
        <Btn
          variant="secondary"
          className="h-9"
          onClick={() =>
            toast(
              "Mock: the Wallet CSV runs through the statement-import pipeline",
            )
          }
        >
          Import
        </Btn>
      </Card>

      <div className="mt-5 flex gap-2">
        {!onDone && (
          <Btn variant="ghost" onClick={() => router.push("/finance")}>
            Skip
          </Btn>
        )}
        <Btn
          accent="fin"
          className="flex-1"
          disabled={!visible.some((r) => r.on)}
          onClick={finish}
        >
          Add {visible.filter((r) => r.on).length} accounts
        </Btn>
      </div>
    </Wrap>
  )
}
