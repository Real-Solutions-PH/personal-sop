"use client"

// Finance sheet host. Any finance surface (screens, Today card, Plan panel)
// calls openSheet({...}); exactly one mounted <FinSheets/> renders it.

import { Camera, Link2, Mic, MoreHorizontal, ShieldCheck } from "lucide-react"
import {
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { openCapture } from "../lib/capture"
import { money } from "../lib/money"
import { privacyStore } from "../lib/privacy"
import { Btn, Chip, Money, NumberInput, Segmented } from "../ui/kit"
import {
  addRecord,
  adjustBalance,
  deleteRecords,
  restoreRecords,
  settleOccurrence,
  skipOccurrence,
  snoozeOccurrence,
  unskipOccurrence,
  updatePlanned,
  updateSettings,
} from "./actions"
import {
  acctMap,
  balances,
  catMap,
  dueNow,
  recentCategories,
  shortDate,
  today,
} from "./calc"
import type { AdvisorScope, Budget, FinRecord, PlannedItem } from "./data"
import {
  AccountEditor,
  BudgetEditor,
  CategoryDelete,
  CategoryEditor,
  PlannedEditor,
  RecordEditor,
} from "./editors"
import { useFin } from "./store"
import {
  AcctIcon,
  AmountDisplay,
  CatIcon,
  ChipRow,
  Field,
  FinSheet,
  inputCls,
  Keypad,
  Pill,
  undoToast,
} from "./ui"

export type SheetSpec =
  | { kind: "quick-add"; type?: "expense" | "income" }
  | { kind: "record"; id?: string; prefill?: Partial<FinRecord> }
  | { kind: "receipt" }
  | { kind: "account"; id?: string }
  | { kind: "adjust"; accountId: string; actual?: number; note?: string }
  | {
      kind: "category"
      id?: string
      catKind?: "expense" | "income"
      /** Preset "Sub-category of" for a new category. */
      parentId?: string
    }
  | { kind: "category-delete"; id: string }
  | { kind: "budget"; id?: string; prefill?: Partial<Budget> }
  | { kind: "planned"; id?: string; prefill?: Partial<PlannedItem> }
  | { kind: "due"; plannedId: string; day: string }
  | {
      kind: "confirm"
      title: string
      body: ReactNode
      confirm: string
      danger?: boolean
      onConfirm: () => void
      alt?: { label: string; onClick: () => void }
    }
  | { kind: "disclaimer"; onAck?: () => void }

// --- tiny non-persisted store (an open sheet must not survive a reload)
let current: { spec: SheetSpec | null; open: boolean } = {
  spec: null,
  open: false,
}
let hosts: string[] = []
const listeners = new Set<() => void>()
const emit = () => {
  for (const l of listeners) l()
}
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
const NONE = { spec: null, open: false }

export function openSheet(spec: SheetSpec) {
  current = { spec, open: true }
  emit()
}
export function closeSheet() {
  current = { ...current, open: false }
  emit()
  const closing = current
  setTimeout(() => {
    if (current === closing) {
      current = { spec: null, open: false }
      emit()
    }
  }, 300)
}

/** Mount once per page tree. Extra hosts stay inert. */
export function FinSheets() {
  const id = useId()
  const state = useSyncExternalStore(
    subscribe,
    () => current,
    () => NONE,
  )
  const [owner, setOwner] = useState(false)
  useEffect(() => {
    hosts.push(id)
    const check = () => setOwner(hosts[0] === id)
    listeners.add(check)
    emit()
    return () => {
      hosts = hosts.filter((h) => h !== id)
      listeners.delete(check)
      emit()
    }
  }, [id])
  if (!owner || !state.spec) return null
  const spec = state.spec
  const common = {
    open: state.open,
    onOpenChange: (o: boolean) => {
      if (!o) closeSheet()
    },
  }
  switch (spec.kind) {
    case "quick-add":
      return <QuickAdd {...common} type={spec.type} />
    case "record":
      return <RecordEditor {...common} id={spec.id} prefill={spec.prefill} />
    case "receipt":
      return <ReceiptReview {...common} />
    case "account":
      return <AccountEditor {...common} id={spec.id} />
    case "adjust":
      return <BalanceAdjust {...common} spec={spec} />
    case "category":
      return (
        <CategoryEditor
          {...common}
          id={spec.id}
          catKind={spec.catKind}
          parentId={spec.parentId}
        />
      )
    case "category-delete":
      return <CategoryDelete {...common} id={spec.id} />
    case "budget":
      return <BudgetEditor {...common} id={spec.id} prefill={spec.prefill} />
    case "planned":
      return <PlannedEditor {...common} id={spec.id} prefill={spec.prefill} />
    case "due":
      return (
        <DueConfirm {...common} plannedId={spec.plannedId} day={spec.day} />
      )
    case "confirm":
      return <ConfirmSheet {...common} spec={spec} />
    case "disclaimer":
      return <Disclaimer {...common} onAck={spec.onAck} />
  }
}

export interface SheetProps {
  open: boolean
  onOpenChange: (o: boolean) => void
}

/** Toast text that respects privacy mode. */
export const amt = (n: number) =>
  privacyStore.get().hidden ? "₱•••" : money(n)

// ------------------------------------------------------------------ FIN-05

function QuickAdd({
  open,
  onOpenChange,
  type: initType,
}: SheetProps & { type?: "expense" | "income" }) {
  const s = useFin()
  const [type, setType] = useState<"expense" | "income">(initType ?? "expense")
  const [value, setValue] = useState("")
  const [acct, setAcct] = useState(
    s.settings.lastAccountId ?? s.settings.defaultAccountId,
  )
  const cats = useMemo(() => catMap(s), [s])
  const accounts = useMemo(
    () =>
      s.accounts
        .filter((a) => !a.archived && a.type !== "investment")
        .sort((a, b) => a.order - b.order),
    [s],
  )
  const chips = useMemo(() => {
    if (type === "income")
      return s.categories
        .filter((c) => c.kind === "income" && !c.archived)
        .map((c) => c.id)
    const recent = recentCategories(s, 7)
    const rest = s.categories
      .filter(
        (c) =>
          c.kind === "expense" &&
          !c.archived &&
          !c.system &&
          !recent.includes(c.id) &&
          (c.parentId || !s.categories.some((x) => x.parentId === c.id)),
      )
      .map((c) => c.id)
    return [...recent, ...rest]
  }, [s, type])
  const n = Number(value || 0)
  // Edge case: logging a bill manually that's also planned → offer the link.
  const plannedHit = useMemo(
    () =>
      type === "expense" && n > 0
        ? dueNow(s).find(
            (o) =>
              o.item.type === "expense" &&
              Math.abs(o.item.amount - n) <= o.item.amount * 0.1,
          )
        : undefined,
    [s, n, type],
  )

  const save = (categoryId: string) => {
    if (!n) {
      toast.error("Type an amount first")
      return
    }
    const r = addRecord({
      type,
      amount: n,
      accountId: acct,
      categoryId,
      source: "quick-add",
    })
    onOpenChange(false)
    undoToast(
      `${type === "income" ? "+" : ""}${amt(n)} · ${cats.get(categoryId)?.name} · ${
        s.accounts.find((a) => a.id === acct)?.name
      }`,
      () => deleteRecords([r.id]),
    )
  }

  return (
    <FinSheet
      open={open}
      onOpenChange={onOpenChange}
      title={
        <div className="flex items-center justify-between pr-8">
          <span>Quick add</span>
          <div className="w-44">
            <Segmented
              value={type}
              onChange={setType}
              options={[
                { value: "expense", label: "Expense" },
                { value: "income", label: "Income" },
              ]}
            />
          </div>
        </div>
      }
      description="Type the amount, tap a category — saved."
    >
      <AmountDisplay value={value} tone={type} />
      {plannedHit && (
        <button
          type="button"
          onClick={() => {
            const r = settleOccurrence(plannedHit.item.id, plannedHit.orig, {
              amount: n,
              accountId: acct,
            })
            onOpenChange(false)
            if (r)
              undoToast(`Paid ${plannedHit.item.name}`, () =>
                deleteRecords([r.id]),
              )
          }}
          className="mb-2 flex w-full items-center gap-2 rounded-xl bg-fin/10 px-3 py-2 text-left text-fin text-sm"
        >
          <Link2 className="size-4" />
          Is this your {plannedHit.item.name}? Tap to link it.
        </button>
      )}
      <div className="mb-2 text-muted-foreground text-xs">
        Tap a category to save
      </div>
      <div className="mb-3 grid grid-cols-4 gap-2">
        {chips.slice(0, 8).map((id) => {
          const c = cats.get(id)
          return (
            <button
              key={id}
              type="button"
              onClick={() => save(id)}
              className={cn(
                "flex flex-col items-center gap-1 rounded-xl border border-border/60 bg-card px-1 py-2 active:bg-fin/15",
                !n && "opacity-60",
              )}
            >
              <span className="text-xl">{c?.icon}</span>
              <span className="w-full truncate text-center text-[11px]">
                {c?.name}
              </span>
            </button>
          )
        })}
      </div>
      <ChipRow>
        {accounts.map((a) => (
          <Chip
            key={a.id}
            active={acct === a.id}
            accent="fin"
            onClick={() => setAcct(a.id)}
          >
            <AcctIcon acct={a} size="sm" />
            {a.name}
          </Chip>
        ))}
      </ChipRow>
      <div className="mt-3">
        <Keypad value={value} onChange={setValue} />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Btn variant="secondary" onClick={() => openSheet({ kind: "receipt" })}>
          <Camera className="size-4" /> Receipt
        </Btn>
        <Btn
          variant="secondary"
          onClick={() => {
            onOpenChange(false)
            openCapture({ mode: "voice", hint: "expense" })
          }}
        >
          <Mic className="size-4" /> Say it
        </Btn>
        <Btn
          variant="secondary"
          onClick={() =>
            openSheet({
              kind: "record",
              prefill: { type, amount: n || undefined, accountId: acct },
            })
          }
        >
          <MoreHorizontal className="size-4" /> More
        </Btn>
      </div>
    </FinSheet>
  )
}

// ------------------------------------------------------------------ FIN-06

function ReceiptReview({ open, onOpenChange }: SheetProps) {
  const s = useFin()
  const [phase, setPhase] = useState<"reading" | "ok" | "fail">("reading")
  const [merchant, setMerchant] = useState("Jollibee — SM Megamall")
  const [total, setTotal] = useState("347")
  const [date, setDate] = useState(today())
  const [cat, setCat] = useState("dining")
  const [acct, setAcct] = useState(s.settings.defaultAccountId)
  const cats = useMemo(() => catMap(s), [s])
  useEffect(() => {
    if (phase !== "reading") return
    const t = setTimeout(() => setPhase("ok"), 1100)
    return () => clearTimeout(t)
  }, [phase])
  const confirm = () => {
    const r = addRecord({
      type: "expense",
      amount: Number(total),
      accountId: acct,
      categoryId: cat,
      payee: merchant,
      receipt: true,
      at: new Date(
        `${date}T${new Date().toTimeString().slice(0, 5)}:00`,
      ).toISOString(),
      source: "photo",
    })
    onOpenChange(false)
    undoToast(`${amt(r.amount)} · ${merchant} saved from receipt`, () =>
      deleteRecords([r.id]),
    )
  }
  return (
    <FinSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Receipt"
      description={
        phase === "fail"
          ? undefined
          : "Check what I read, then confirm with one tap."
      }
      footer={
        phase === "ok" ? (
          <div className="grid grid-cols-3 gap-2">
            <Btn variant="ghost" onClick={() => onOpenChange(false)}>
              Discard
            </Btn>
            <Btn variant="secondary" onClick={() => setPhase("reading")}>
              Retake
            </Btn>
            <Btn accent="fin" onClick={confirm} disabled={!Number(total)}>
              Confirm
            </Btn>
          </div>
        ) : phase === "fail" ? (
          <div className="grid grid-cols-2 gap-2">
            <Btn variant="secondary" onClick={() => setPhase("reading")}>
              <Camera className="size-4" /> Retake
            </Btn>
            <Btn
              accent="fin"
              onClick={() =>
                openSheet({ kind: "record", prefill: { type: "expense" } })
              }
            >
              Enter manually
            </Btn>
          </div>
        ) : null
      }
    >
      <div className="flex gap-4">
        <div className="w-24 shrink-0 -rotate-2 rounded-md bg-paper p-2 font-mono text-[7px] text-paper-foreground leading-tight shadow">
          <div className="text-center font-bold">JOLLIBEE</div>
          <div className="text-center">SM MEGAMALL</div>
          <div className="my-1 border-paper-foreground/40 border-t border-dashed" />
          <div>1 C1 CHICKENJOY 99</div>
          <div>1 JOLLY SPAG 70</div>
          <div>1 BURGER STEAK 99</div>
          <div>1 PINEAPPLE JCE 79</div>
          <div className="my-1 border-paper-foreground/40 border-t border-dashed" />
          <div className="font-bold">TOTAL 347.00</div>
          <div>GCASH</div>
        </div>
        <div className="min-w-0 flex-1 text-sm">
          {phase === "reading" && (
            <div className="space-y-2 pt-2">
              <div className="text-muted-foreground">Reading receipt…</div>
              <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
              <button
                type="button"
                onClick={() => setPhase("fail")}
                className="pt-2 text-muted-foreground text-xs underline"
              >
                Simulate unreadable
              </button>
            </div>
          )}
          {phase === "fail" && (
            <div className="pt-2">
              <div className="font-semibold text-bad">
                Couldn't read receipt
              </div>
              <p className="mt-1 text-muted-foreground">
                The total is cut off or blurry. Retake it in better light, or
                enter it by hand.
              </p>
            </div>
          )}
          {phase === "ok" && (
            <div className="space-y-1 pt-1">
              <Pill tone="good">92% confident</Pill>
              <div className="text-muted-foreground text-xs">
                Merchant, total and date found. Category suggested from past
                Jollibee visits.
              </div>
            </div>
          )}
        </div>
      </div>
      {phase === "ok" && (
        <div className="mt-3">
          <Field label="Merchant">
            <input
              className={inputCls}
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Total ₱">
              <NumberInput
                className={inputCls}
                inputMode="decimal"
                value={total}
                onChange={(e) =>
                  setTotal(e.target.value.replace(/[^\d.]/g, ""))
                }
              />
            </Field>
            <Field label="Date">
              <input
                type="date"
                className={inputCls}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
          </div>
          <Field
            label={
              <>
                Category <Pill tone="fin">suggested</Pill>
              </>
            }
          >
            <ChipRow>
              {["dining", "groceries", "coffee", "health"].map((id) => (
                <Chip
                  key={id}
                  active={cat === id}
                  accent="fin"
                  onClick={() => setCat(id)}
                >
                  {cats.get(id)?.icon} {cats.get(id)?.name}
                </Chip>
              ))}
            </ChipRow>
          </Field>
          <Field label="Paid with">
            <ChipRow>
              {s.accounts
                .filter((a) => !a.archived && a.type !== "investment")
                .map((a) => (
                  <Chip
                    key={a.id}
                    active={acct === a.id}
                    accent="fin"
                    onClick={() => setAcct(a.id)}
                  >
                    {a.name}
                  </Chip>
                ))}
            </ChipRow>
          </Field>
        </div>
      )}
    </FinSheet>
  )
}

// ------------------------------------------------------------------ FIN-07

function ConfirmSheet({
  open,
  onOpenChange,
  spec,
}: SheetProps & { spec: Extract<SheetSpec, { kind: "confirm" }> }) {
  return (
    <FinSheet
      open={open}
      onOpenChange={onOpenChange}
      title={spec.title}
      footer={
        <div className="flex flex-col gap-2">
          {spec.alt && (
            <Btn
              accent="fin"
              onClick={() => {
                spec.alt?.onClick()
                onOpenChange(false)
              }}
            >
              {spec.alt.label}
            </Btn>
          )}
          <Btn
            variant={spec.danger ? "danger" : "primary"}
            accent="fin"
            onClick={() => {
              spec.onConfirm()
              onOpenChange(false)
            }}
          >
            {spec.confirm}
          </Btn>
          <Btn variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Btn>
        </div>
      }
    >
      <div className="text-muted-foreground text-sm">{spec.body}</div>
    </FinSheet>
  )
}

/** FIN-07 shortcut: confirm deleting records, with undo toast afterwards. */
export function confirmDeleteRecords(ids: string[], after?: () => void) {
  openSheet({
    kind: "confirm",
    title:
      ids.length > 1
        ? `Delete ${ids.length} transactions?`
        : "Delete transaction?",
    body: "Balances, budgets and reports recompute. You can undo for a few seconds.",
    confirm: "Delete",
    danger: true,
    onConfirm: () => {
      const gone = deleteRecords(ids)
      after?.()
      undoToast(
        `Deleted ${gone.length} record${gone.length > 1 ? "s" : ""}`,
        () => restoreRecords(gone),
      )
    },
  })
}

// ------------------------------------------------------------------ FIN-12

function BalanceAdjust({
  open,
  onOpenChange,
  spec,
}: SheetProps & { spec: Extract<SheetSpec, { kind: "adjust" }> }) {
  const s = useFin()
  const acct = s.accounts.find((a) => a.id === spec.accountId)
  const current = useMemo(
    () => balances(s)[spec.accountId] ?? 0,
    [s, spec.accountId],
  )
  const [actual, setActual] = useState(
    spec.actual !== undefined ? String(Math.round(spec.actual)) : "",
  )
  const diff = actual === "" ? 0 : Number(actual) - current
  return (
    <FinSheet
      open={open}
      onOpenChange={onOpenChange}
      title={acct?.manual ? "Update market value" : "Adjust balance"}
      description={
        acct?.manual
          ? "Investment balances are updated by hand. Log today's value."
          : "Log the difference as an adjustment. It's excluded from spend and income."
      }
      footer={
        <Btn
          accent="fin"
          className="w-full"
          disabled={!diff}
          onClick={() => {
            const r = adjustBalance(spec.accountId, Number(actual), spec.note)
            onOpenChange(false)
            if (r) undoToast("Balance adjusted", () => deleteRecords([r.id]))
          }}
        >
          Log adjustment
        </Btn>
      }
    >
      <div className="flex items-center gap-3 rounded-2xl bg-muted/50 p-3">
        <AcctIcon acct={acct} />
        <div className="flex-1">
          <div className="font-medium">{acct?.name}</div>
          <div className="text-muted-foreground text-xs">App balance</div>
        </div>
        <Money value={current} className="font-semibold text-lg" />
      </div>
      <Field label={acct?.manual ? "Current value ₱" : "Actual balance ₱"}>
        <NumberInput
          inputMode="decimal"
          className={cn(inputCls, "text-xl")}
          placeholder={String(Math.round(current))}
          value={actual}
          onChange={(e) => setActual(e.target.value.replace(/[^\d.-]/g, ""))}
        />
      </Field>
      <div className="flex items-center justify-between rounded-xl border border-border/60 px-3 py-2.5 text-sm">
        <span className="text-muted-foreground">Difference</span>
        <Money
          value={diff}
          signed
          className={cn("font-semibold", diff < 0 && "text-bad")}
        />
      </div>
    </FinSheet>
  )
}

// ------------------------------------------------------------------ FIN-22

function DueConfirm({
  open,
  onOpenChange,
  plannedId,
  day,
}: SheetProps & { plannedId: string; day: string }) {
  const s = useFin()
  const p = s.planned.find((x) => x.id === plannedId)
  const [value, setValue] = useState(p ? String(p.amount) : "")
  const [acct, setAcct] = useState(p?.accountId ?? s.settings.defaultAccountId)
  const [date, setDate] = useState(today())
  const cats = useMemo(() => catMap(s), [s])
  const accts = useMemo(() => acctMap(s), [s])
  if (!p) return null
  return (
    <FinSheet
      open={open}
      onOpenChange={onOpenChange}
      title={p.name}
      description={`Due ${shortDate(p.snoozed[day] ?? day)} · expected ${p.estimated ? "≈ " : ""}${amt(p.amount)}`}
      footer={
        <div className="grid grid-cols-3 gap-2">
          <Btn
            variant="secondary"
            onClick={() => {
              skipOccurrence(p.id, day)
              onOpenChange(false)
              undoToast(`Skipped ${p.name}`, () => unskipOccurrence(p.id, day))
            }}
          >
            Skip
          </Btn>
          <Btn
            variant="secondary"
            onClick={() => {
              const prev = p.snoozed
              snoozeOccurrence(p.id, day)
              onOpenChange(false)
              undoToast(`Snoozed ${p.name} to tomorrow`, () =>
                updatePlanned(p.id, { snoozed: prev }),
              )
            }}
          >
            Snooze
          </Btn>
          <Btn
            accent="fin"
            disabled={!Number(value)}
            onClick={() => {
              const r = settleOccurrence(p.id, day, {
                amount: Number(value),
                accountId: acct,
                date,
              })
              onOpenChange(false)
              if (r)
                undoToast(
                  `${p.type === "income" ? "Received" : "Paid"} ${p.name} · ${amt(r.amount)}`,
                  () => deleteRecords([r.id]),
                )
            }}
          >
            {p.type === "income" ? "Received" : "Paid"}
          </Btn>
        </div>
      }
    >
      <div className="flex items-center gap-3 rounded-2xl bg-muted/50 p-3">
        {p.type === "transfer" ? (
          <span className="grid size-10 place-items-center rounded-full bg-muted text-lg">
            ⇄
          </span>
        ) : (
          <CatIcon cat={cats.get(p.categoryId ?? "")} />
        )}
        <div className="flex-1 text-sm">
          <div className="font-medium">
            {p.type === "transfer"
              ? `${accts.get(p.accountId)?.name} → ${accts.get(p.toAccountId ?? "")?.name}`
              : cats.get(p.categoryId ?? "")?.name}
          </div>
          <div className="text-muted-foreground text-xs">
            {p.isInstallment ? "0% installment · " : ""}
            {p.estimated
              ? "Estimated amount — edit to the actual"
              : "Fixed amount"}
          </div>
        </div>
      </div>
      <Field label="Actual amount ₱">
        <NumberInput
          inputMode="decimal"
          className={cn(inputCls, "text-xl")}
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ""))}
        />
      </Field>
      {p.type !== "transfer" && (
        <Field label="Account">
          <ChipRow>
            {s.accounts
              .filter((a) => !a.archived && a.type !== "investment")
              .map((a) => (
                <Chip
                  key={a.id}
                  active={acct === a.id}
                  accent="fin"
                  onClick={() => setAcct(a.id)}
                >
                  {a.name}
                </Chip>
              ))}
          </ChipRow>
        </Field>
      )}
      <Field label="Date">
        <input
          type="date"
          className={inputCls}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </Field>
    </FinSheet>
  )
}

// ------------------------------------------------------------------ FIN-34

function Disclaimer({
  open,
  onOpenChange,
  onAck,
}: SheetProps & { onAck?: () => void }) {
  const s = useFin()
  const [scope, setScope] = useState<AdvisorScope>(s.settings.aiScope)
  return (
    <FinSheet
      open={open}
      onOpenChange={onOpenChange}
      title={
        <span className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-fin" /> Before you ask
        </span>
      }
      footer={
        <div className="flex flex-col gap-2">
          <Btn
            accent="fin"
            onClick={() => {
              updateSettings({ disclaimerAck: true, aiScope: scope })
              onOpenChange(false)
              onAck?.()
            }}
          >
            I understand
          </Btn>
          <Btn variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Btn>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        <p>
          The advisor is an AI that explains your own numbers, teaches concepts
          and suggests options. <b>It is not licensed financial advice</b> and
          never moves money.
        </p>
        <p className="text-muted-foreground">
          To answer, your finance data is sent to the AI provider (OpenRouter).
          Choose how much:
        </p>
        {(
          [
            {
              v: "aggregates",
              t: "Totals only (recommended)",
              d: "Monthly totals by category, balances, scheduled payments. No payees or notes.",
            },
            {
              v: "records",
              t: "Individual transactions when needed",
              d: "Individual transactions (payee, amount, date) for questions that need them. You'll see a chip when it's used.",
            },
          ] as const
        ).map((o) => (
          <button
            key={o.v}
            type="button"
            onClick={() => setScope(o.v)}
            className={cn(
              "w-full rounded-2xl border p-3 text-left",
              scope === o.v ? "border-fin bg-fin/10" : "border-border",
            )}
          >
            <div className="font-medium">{o.t}</div>
            <div className="text-muted-foreground text-xs">{o.d}</div>
          </button>
        ))}
      </div>
    </FinSheet>
  )
}
