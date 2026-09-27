"use client"

// Create/edit sheets: record (FIN-04), category picker (FIN-15), account
// (FIN-11), category (FIN-14), budget (FIN-18), planned item (FIN-21).

import { Check, Paperclip, Plus, Search, Sparkles } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Btn, Chip, NumberInput, Segmented } from "../ui/kit"
import {
  addAccount,
  addBudget,
  addCategory,
  addPlanned,
  addRecord,
  categoryUses,
  deleteAccount,
  deleteBudget,
  deleteCategoryMoving,
  deletePlanned,
  deleteRecords,
  logTransfer,
  restoreRecords,
  updateAccount,
  updateBudget,
  updateCategory,
  updatePlanned,
  updateRecord,
} from "./actions"
import { avgSpend, catMap, recDay, suggestCategory, today } from "./calc"
import type {
  AccountType,
  Budget,
  Category,
  EndRule,
  FinRecord,
  PlannedItem,
  RecordType,
  Schedule,
} from "./data"
import { amt, closeSheet, openSheet, type SheetProps } from "./sheets"
import { finStore, useFin } from "./store"
import {
  AcctIcon,
  ChipRow,
  Field,
  FinSheet,
  inputCls,
  Pill,
  Toggle,
  undoToast,
} from "./ui"

const num = (v: string) => v.replace(/[^\d.]/g, "")
const localTime = (iso: string) => {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

// ------------------------------------------------------------------ FIN-15

export function CategoryPicker({
  open,
  onOpenChange,
  kind,
  multi,
  value,
  onChange,
  suggestion,
}: SheetProps & {
  kind: "expense" | "income"
  multi?: boolean
  value: string[]
  onChange: (ids: string[]) => void
  suggestion?: string
}) {
  const s = useFin()
  const [q, setQ] = useState("")
  const [sel, setSel] = useState(value)
  const cats = s.categories.filter(
    (c) => c.kind === kind && !c.archived && !c.system,
  )
  const recents = useMemo(() => {
    const seen: string[] = []
    for (let i = s.records.length - 1; i >= 0 && seen.length < 5; i--) {
      const id = s.records[i].categoryId
      if (id && !seen.includes(id) && cats.some((c) => c.id === id))
        seen.push(id)
    }
    return seen
  }, [s, cats])
  const match = (c: Category) => c.name.toLowerCase().includes(q.toLowerCase())
  const tops = cats.filter((c) => !c.parentId)
  const pick = (id: string) => {
    if (!multi) {
      onChange([id])
      onOpenChange(false)
      return
    }
    setSel((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]))
  }
  const item = (c: Category, indent = false) => (
    <button
      key={c.id}
      type="button"
      onClick={() => pick(c.id)}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left active:bg-muted",
        indent && "pl-8",
      )}
    >
      <span className="text-lg">{c.icon}</span>
      <span className="flex-1">{c.name}</span>
      {c.discretionary && <Pill>want</Pill>}
      {(multi ? sel : value).includes(c.id) && (
        <Check className="size-4 text-fin" />
      )}
    </button>
  )
  return (
    <FinSheet
      open={open}
      onOpenChange={onOpenChange}
      title={multi ? "Categories" : "Category"}
      footer={
        multi ? (
          <Btn
            accent="fin"
            className="w-full"
            onClick={() => {
              onChange(sel)
              onOpenChange(false)
            }}
          >
            Use {sel.length || "no"} categor{sel.length === 1 ? "y" : "ies"}
          </Btn>
        ) : undefined
      }
    >
      <div className="relative mb-2">
        <Search className="absolute top-3 left-3 size-4 text-muted-foreground" />
        <input
          className={cn(inputCls, "pl-9")}
          placeholder="Search categories"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {q ? (
        <>
          {cats.filter(match).map((c) => item(c))}
          <button
            type="button"
            onClick={() => {
              const c = addCategory({
                name: q.trim(),
                kind,
                icon: "🏷️",
                discretionary: kind === "expense",
              })
              pick(c.id)
              toast(`Created “${c.name}”`)
            }}
            className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-fin"
          >
            <Plus className="size-4" /> Create “{q.trim()}”
          </button>
        </>
      ) : (
        <>
          {suggestion && cats.some((c) => c.id === suggestion) && (
            <>
              <div className="mt-1 flex items-center gap-1 px-2 text-fin text-xs">
                <Sparkles className="size-3" /> Suggested
              </div>
              {item(cats.find((c) => c.id === suggestion) as Category)}
            </>
          )}
          {recents.length > 0 && (
            <>
              <div className="mt-2 px-2 text-muted-foreground text-xs">
                Recent
              </div>
              <div className="flex flex-wrap gap-2 px-2 py-1">
                {recents.map((id) => {
                  const c = cats.find((x) => x.id === id)
                  return (
                    <Chip
                      key={id}
                      accent="fin"
                      active={(multi ? sel : value).includes(id)}
                      onClick={() => pick(id)}
                    >
                      {c?.icon} {c?.name}
                    </Chip>
                  )
                })}
              </div>
            </>
          )}
          <div className="mt-2 px-2 text-muted-foreground text-xs">All</div>
          {tops.map((t) => (
            <div key={t.id}>
              {item(t)}
              {cats
                .filter((c) => c.parentId === t.id)
                .map((c) => item(c, true))}
            </div>
          ))}
          <button
            type="button"
            onClick={() => openSheet({ kind: "category", catKind: kind })}
            className="mt-1 flex w-full items-center gap-3 rounded-xl px-2 py-2 text-fin text-sm"
          >
            <Plus className="size-4" /> New category…
          </button>
        </>
      )}
    </FinSheet>
  )
}

// ------------------------------------------------------------------ FIN-04

export function RecordEditor({
  open,
  onOpenChange,
  id,
  prefill,
}: SheetProps & { id?: string; prefill?: Partial<FinRecord> }) {
  const s = useFin()
  const existing = id ? s.records.find((r) => r.id === id) : undefined
  const init = { ...existing, ...prefill }
  const [type, setType] = useState<RecordType>(init.type ?? "expense")
  const [amount, setAmount] = useState(init.amount ? String(init.amount) : "")
  const [acct, setAcct] = useState(
    init.accountId ?? s.settings.lastAccountId ?? s.settings.defaultAccountId,
  )
  const [to, setTo] = useState(init.toAccountId ?? "")
  const [cat, setCat] = useState(init.categoryId ?? "")
  const [date, setDate] = useState(
    init.at ? recDay(init as FinRecord) : today(),
  )
  const [time, setTime] = useState(
    init.at ? localTime(init.at) : localTime(new Date().toISOString()),
  )
  const [payee, setPayee] = useState(init.payee ?? "")
  const [note, setNote] = useState(init.note ?? "")
  const [fee, setFee] = useState("")
  const [refund, setRefund] = useState(!!init.isRefund)
  const [receipt, setReceipt] = useState(!!init.receipt)
  const [picker, setPicker] = useState(false)
  const [tried, setTried] = useState(false)
  const cats = useMemo(() => catMap(s), [s])
  const accounts = s.accounts.filter((a) => !a.archived)
  const suggestion = useMemo(() => suggestCategory(s, payee), [s, payee])
  const n = Number(amount || 0)
  const errors = {
    amount: n > 0 ? null : "Enter an amount above ₱0",
    to:
      type === "transfer" && (!to || to === acct)
        ? "Pick a different destination account"
        : null,
    cat: type !== "transfer" && !cat ? "Pick a category" : null,
  }
  const valid = !errors.amount && !errors.to && !errors.cat
  const catKind = type === "income" && !refund ? "income" : "expense"

  const save = (again: boolean) => {
    setTried(true)
    if (!valid) return
    const at = new Date(`${date}T${time}:00`).toISOString()
    if (existing) {
      updateRecord(existing.id, {
        type,
        amount: n,
        accountId: acct,
        toAccountId: type === "transfer" ? to : undefined,
        categoryId: type === "transfer" ? undefined : cat,
        at,
        payee: payee || undefined,
        note: note || undefined,
        isRefund: type === "income" && refund,
        receipt,
        status: "cleared",
      })
      toast("Transaction updated")
      onOpenChange(false)
      return
    }
    let created: FinRecord[]
    if (type === "transfer") {
      const r = logTransfer({
        from: acct,
        to,
        amount: n,
        fee: Number(fee || 0) || undefined,
        note: note || undefined,
        at,
      })
      created = [r.transfer, ...(r.fee ? [r.fee] : [])]
    } else {
      created = [
        addRecord({
          type,
          amount: n,
          accountId: acct,
          categoryId: cat,
          at,
          payee: payee || undefined,
          note: note || undefined,
          isRefund: type === "income" && refund,
          receipt,
          source: "manual",
        }),
      ]
    }
    undoToast(`Saved ${amt(n)}`, () => deleteRecords(created.map((c) => c.id)))
    if (again) {
      setAmount("")
      setPayee("")
      setNote("")
      setFee("")
      setTried(false)
    } else onOpenChange(false)
  }

  return (
    <FinSheet
      open={open}
      onOpenChange={onOpenChange}
      title={existing ? "Edit transaction" : "New transaction"}
      footer={
        <div className="flex gap-2">
          {existing ? (
            <Btn
              variant="danger"
              onClick={() => {
                const gone = deleteRecords([existing.id])
                onOpenChange(false)
                undoToast("Transaction deleted", () => restoreRecords(gone))
              }}
            >
              Delete
            </Btn>
          ) : (
            <Btn variant="secondary" onClick={() => save(true)}>
              Save & add another
            </Btn>
          )}
          <Btn accent="fin" className="flex-1" onClick={() => save(false)}>
            Save
          </Btn>
        </div>
      }
    >
      <Segmented
        value={type}
        onChange={(v) => {
          setType(v)
          setCat("")
        }}
        options={[
          { value: "expense", label: "Expense" },
          { value: "income", label: "Income" },
          { value: "transfer", label: "Transfer" },
        ]}
      />
      <Field label="Amount ₱" error={tried ? errors.amount : null}>
        <NumberInput
          inputMode="decimal"
          className={cn(inputCls, "h-14 text-3xl font-semibold")}
          placeholder="0"
          value={amount}
          onChange={(e) => setAmount(num(e.target.value))}
        />
      </Field>
      <Field label={type === "transfer" ? "From" : "Account"}>
        <ChipRow>
          {accounts.map((a) => (
            <Chip
              key={a.id}
              active={acct === a.id}
              accent="fin"
              onClick={() => setAcct(a.id)}
            >
              <AcctIcon acct={a} size="sm" /> {a.name}
            </Chip>
          ))}
        </ChipRow>
      </Field>
      {type === "transfer" ? (
        <>
          <Field label="To" error={tried ? errors.to : null}>
            <ChipRow>
              {accounts
                .filter((a) => a.id !== acct)
                .map((a) => (
                  <Chip
                    key={a.id}
                    active={to === a.id}
                    accent="fin"
                    onClick={() => setTo(a.id)}
                  >
                    <AcctIcon acct={a} size="sm" /> {a.name}
                  </Chip>
                ))}
            </ChipRow>
          </Field>
          {!existing && (
            <Field
              label="Fee ₱ (optional)"
              hint="Logged as a separate Fees expense — the transfer itself isn't spending."
            >
              <NumberInput
                inputMode="decimal"
                className={inputCls}
                placeholder="e.g. 15"
                value={fee}
                onChange={(e) => setFee(num(e.target.value))}
              />
            </Field>
          )}
        </>
      ) : (
        <>
          <Field label="Payee">
            <input
              className={inputCls}
              placeholder="e.g. Jollibee"
              value={payee}
              onChange={(e) => setPayee(e.target.value)}
              onBlur={() => {
                if (!cat && suggestion) setCat(suggestion)
              }}
            />
          </Field>
          <Field label="Category" error={tried ? errors.cat : null}>
            <button
              type="button"
              onClick={() => setPicker(true)}
              className={cn(inputCls, "flex items-center gap-2 text-left")}
            >
              {cat ? (
                <>
                  <span>{cats.get(cat)?.icon}</span>
                  <span className="flex-1">{cats.get(cat)?.name}</span>
                </>
              ) : (
                <span className="flex-1 text-muted-foreground">Choose…</span>
              )}
              {!cat && suggestion && (
                <Pill tone="fin">
                  <Sparkles className="size-3" /> {cats.get(suggestion)?.name}
                </Pill>
              )}
            </button>
          </Field>
          {type === "income" && (
            <Toggle
              checked={refund}
              onChange={(v) => {
                setRefund(v)
                setCat("")
              }}
              label="This is a refund"
              hint="Reduces spending in the original category and its budget."
            />
          )}
        </>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date">
          <input
            type="date"
            className={inputCls}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label="Time">
          <input
            type="time"
            className={inputCls}
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </Field>
      </div>
      <Field label="Note">
        <textarea
          className={cn(inputCls, "h-20 py-2")}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      {type !== "transfer" && (
        <button
          type="button"
          onClick={() => setReceipt(!receipt)}
          className="flex items-center gap-2 py-2 text-sm"
        >
          <Paperclip className="size-4" />
          {receipt ? "Receipt attached · remove" : "Attach receipt"}
        </button>
      )}
      <CategoryPicker
        open={picker}
        onOpenChange={setPicker}
        kind={catKind}
        value={cat ? [cat] : []}
        onChange={(ids) => setCat(ids[0] ?? "")}
        suggestion={suggestion}
      />
    </FinSheet>
  )
}

// ------------------------------------------------------------------ FIN-11

// Account swatches are theme tokens (globals.css --acct-*); the name is the a11y label.
const COLOR_NAMES = [
  "green",
  "blue",
  "emerald",
  "red",
  "rose",
  "violet",
  "orange",
  "cyan",
  "slate",
]
const COLORS = COLOR_NAMES.map((n) => `var(--acct-${n})`)
const TYPES: { v: AccountType; l: string }[] = [
  { v: "cash", l: "Cash" },
  { v: "bank", l: "Bank" },
  { v: "ewallet", l: "E-wallet" },
  { v: "credit", l: "Credit card" },
  { v: "investment", l: "Investment" },
]

export function AccountEditor({
  open,
  onOpenChange,
  id,
}: SheetProps & { id?: string }) {
  const s = useFin()
  const ex = id ? s.accounts.find((a) => a.id === id) : undefined
  const [name, setName] = useState(ex?.name ?? "")
  const [type, setType] = useState<AccountType>(ex?.type ?? "ewallet")
  const [opening, setOpening] = useState(ex ? String(ex.opening) : "")
  const [openingDate, setOpeningDate] = useState(ex?.openingDate ?? today())
  const [limit, setLimit] = useState(ex?.limit ? String(ex.limit) : "")
  const [color, setColor] = useState(ex?.color ?? COLORS[1])
  const [nw, setNw] = useState(ex?.inNetWorth ?? true)
  const [proj, setProj] = useState(ex?.inProjection ?? true)
  const [tried, setTried] = useState(false)
  const recCount = ex
    ? s.records.filter((r) => r.accountId === ex.id || r.toAccountId === ex.id)
        .length
    : 0
  const err = !name.trim() ? "Give it a name" : null
  const save = () => {
    setTried(true)
    if (err) return
    const data = {
      name: name.trim(),
      type,
      opening:
        Number(opening || 0) *
        (type === "credit" && Number(opening) > 0 ? -1 : 1),
      openingDate,
      limit: type === "credit" ? Number(limit || 0) : undefined,
      color,
      inNetWorth: nw,
      inProjection: type === "credit" || type === "investment" ? false : proj,
      manual: type === "investment",
    }
    if (ex) updateAccount(ex.id, { ...data, opening: Number(opening || 0) })
    else addAccount(data)
    toast(ex ? "Account updated" : `${data.name} added`)
    onOpenChange(false)
  }
  return (
    <FinSheet
      open={open}
      onOpenChange={onOpenChange}
      title={ex ? "Edit account" : "New account"}
      footer={
        <div className="flex gap-2">
          {ex && (
            <Btn
              variant="danger"
              onClick={() =>
                openSheet({
                  kind: "confirm",
                  title: recCount
                    ? `Archive ${ex.name}?`
                    : `Delete ${ex.name}?`,
                  body: recCount
                    ? `This account has ${recCount} transactions, so it can't be deleted. Archive hides it everywhere but keeps its history.`
                    : "It has no transactions, so it can be deleted permanently.",
                  confirm: recCount ? "Archive" : "Delete",
                  danger: true,
                  onConfirm: () => {
                    if (recCount) {
                      updateAccount(ex.id, { archived: true })
                      undoToast(`${ex.name} archived`, () =>
                        updateAccount(ex.id, { archived: false }),
                      )
                    } else {
                      deleteAccount(ex.id)
                      toast(`${ex.name} deleted`)
                    }
                  },
                })
              }
            >
              {recCount ? "Archive" : "Delete"}
            </Btn>
          )}
          <Btn accent="fin" className="flex-1" onClick={save}>
            Save
          </Btn>
        </div>
      }
    >
      <Field label="Name" error={tried ? err : null}>
        <input
          className={inputCls}
          value={name}
          placeholder="e.g. GoTyme"
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="Type">
        <div className="flex flex-wrap gap-2">
          {TYPES.map((t) => (
            <Chip
              key={t.v}
              active={type === t.v}
              accent="fin"
              onClick={() => setType(t.v)}
            >
              {t.l}
            </Chip>
          ))}
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field
          label={type === "credit" ? "Balance owed ₱" : "Opening balance ₱"}
        >
          <NumberInput
            inputMode="decimal"
            className={inputCls}
            value={opening}
            onChange={(e) => setOpening(e.target.value.replace(/[^\d.-]/g, ""))}
          />
        </Field>
        <Field label="As of">
          <input
            type="date"
            className={inputCls}
            value={openingDate}
            onChange={(e) => setOpeningDate(e.target.value)}
          />
        </Field>
      </div>
      {type === "credit" && (
        <Field label="Credit limit ₱">
          <NumberInput
            inputMode="decimal"
            className={inputCls}
            value={limit}
            onChange={(e) => setLimit(num(e.target.value))}
          />
        </Field>
      )}
      <Field label="Colour">
        <div className="flex flex-wrap gap-2">
          {COLORS.map((c, i) => (
            <button
              key={c}
              type="button"
              aria-label={COLOR_NAMES[i]}
              onClick={() => setColor(c)}
              className={cn(
                "size-8 rounded-full ring-offset-2 ring-offset-background",
                color === c && "ring-2 ring-foreground",
              )}
              style={{ background: c }}
            />
          ))}
        </div>
      </Field>
      <Toggle
        checked={nw}
        onChange={setNw}
        label="Include in net worth"
        hint={type === "credit" ? "Counted as a liability." : undefined}
      />
      {type !== "credit" && type !== "investment" && (
        <Toggle
          checked={proj}
          onChange={setProj}
          label="Include in savings projection"
          hint="Counts as available money in the forecast."
        />
      )}
      {type === "investment" && (
        <p className="text-muted-foreground text-xs">
          Investment balances are updated by hand: update the value from the
          account screen.
        </p>
      )}
    </FinSheet>
  )
}

// ------------------------------------------------------------------ FIN-14

const EMOJI = [
  "🍽️",
  "☕",
  "🛒",
  "🚗",
  "🏠",
  "💡",
  "📶",
  "🎬",
  "🛍️",
  "🎟️",
  "💊",
  "🎁",
  "🐶",
  "📚",
  "✈️",
  "🏋️",
  "👶",
  "🏷️",
]

export function CategoryEditor({
  open,
  onOpenChange,
  id,
  catKind,
  parentId,
}: SheetProps & {
  id?: string
  catKind?: "expense" | "income"
  parentId?: string
}) {
  const s = useFin()
  const ex = id ? s.categories.find((c) => c.id === id) : undefined
  const preParent = parentId
    ? s.categories.find((c) => c.id === parentId)
    : undefined
  const [name, setName] = useState(ex?.name ?? "")
  const [kind, setKind] = useState<"expense" | "income">(
    ex?.kind ?? preParent?.kind ?? catKind ?? "expense",
  )
  const [parent, setParent] = useState(ex?.parentId ?? preParent?.id ?? "")
  const [icon, setIcon] = useState(ex?.icon ?? "🏷️")
  const [disc, setDisc] = useState(
    ex?.discretionary ?? preParent?.discretionary ?? true,
  )
  const uses = ex ? s.records.filter((r) => r.categoryId === ex.id).length : 0
  const parents = s.categories.filter(
    (c) =>
      c.kind === kind && !c.parentId && !c.archived && !c.system && c.id !== id,
  )
  const save = () => {
    if (!name.trim()) return toast.error("Give it a name")
    const data = {
      name: name.trim(),
      kind,
      parentId: parent || undefined,
      icon,
      discretionary: kind === "expense" && disc,
    }
    if (ex) updateCategory(ex.id, data)
    else addCategory(data)
    toast(ex ? "Category updated" : `“${data.name}” added`)
    onOpenChange(false)
  }
  return (
    <FinSheet
      open={open}
      onOpenChange={onOpenChange}
      title={ex ? "Edit category" : "New category"}
      description={ex ? `Used in ${uses} transactions` : undefined}
      footer={
        <div className="flex gap-2">
          {ex && (
            <Btn variant="danger" onClick={() => confirmDeleteCategory(ex.id)}>
              Delete
            </Btn>
          )}
          <Btn accent="fin" className="flex-1" onClick={save}>
            Save
          </Btn>
        </div>
      }
    >
      <Field label="Name">
        <input
          className={inputCls}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      {!ex && !preParent && (
        <Field label="Type">
          <Segmented
            value={kind}
            onChange={(k) => {
              setKind(k)
              setParent("")
            }}
            options={[
              { value: "expense", label: "Expense" },
              { value: "income", label: "Income" },
            ]}
          />
        </Field>
      )}
      <Field label="Icon">
        <div className="grid grid-cols-9 gap-1">
          {EMOJI.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setIcon(e)}
              className={cn(
                "grid aspect-square place-items-center rounded-lg text-lg",
                icon === e ? "bg-fin/20 ring-1 ring-fin" : "bg-muted/50",
              )}
            >
              {e}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Sub-category of">
        <ChipRow>
          <Chip active={!parent} accent="fin" onClick={() => setParent("")}>
            None — main category
          </Chip>
          {parents.map((p) => (
            <Chip
              key={p.id}
              active={parent === p.id}
              accent="fin"
              onClick={() => setParent(p.id)}
            >
              {p.icon} {p.name}
            </Chip>
          ))}
        </ChipRow>
      </Field>
      {kind === "expense" && (
        <Toggle
          checked={disc}
          onChange={setDisc}
          label="Want"
          hint="Spending on wants breaks a no-spend day. Turn off for bills and essentials."
        />
      )}
    </FinSheet>
  )
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`

/** Delete: a plain confirm when nothing uses it, else the move-to sheet. */
export function confirmDeleteCategory(id: string) {
  const s = finStore.get()
  const c = s.categories.find((x) => x.id === id)
  if (!c) return
  const u = categoryUses(s, id)
  if (u.records + u.planned + u.budgets > 0) {
    openSheet({ kind: "category-delete", id })
    return
  }
  const subs = s.categories.filter((x) => x.parentId === id && !x.archived)
  openSheet({
    kind: "confirm",
    title: `Delete ${c.name}?`,
    body: subs.length
      ? `Nothing uses it. Its ${plural(subs.length, "sub-category", "sub-categories")} (${subs.map((x) => x.name).join(", ")}) will become main categories.`
      : "Nothing uses it.",
    confirm: "Delete",
    danger: true,
    onConfirm: () => {
      const undo = deleteCategoryMoving(id)
      undoToast(`${c.name} deleted`, undo)
    },
  })
}

/** Delete-with-move: pick where its transactions go, then delete. */
export function CategoryDelete({
  open,
  onOpenChange,
  id,
}: SheetProps & { id: string }) {
  const s = useFin()
  const [to, setTo] = useState("")
  const c = s.categories.find((x) => x.id === id)
  if (!c) return null
  const u = categoryUses(s, id)
  const subs = s.categories.filter((x) => x.parentId === id && !x.archived)
  const targets = s.categories.filter(
    (x) =>
      x.kind === c.kind &&
      x.id !== id &&
      x.parentId !== id &&
      !x.archived &&
      !x.system,
  )
  const tops = targets.filter((x) => !x.parentId)
  const used = [
    u.records && plural(u.records, "transaction", "transactions"),
    u.planned && plural(u.planned, "scheduled payment", "scheduled payments"),
    u.budgets && plural(u.budgets, "budget", "budgets"),
  ].filter(Boolean) as string[]
  const usedText =
    used.length > 1
      ? `${used.slice(0, -1).join(", ")} and ${used[used.length - 1]}`
      : used[0]
  const option = (x: Category, indent = false) => (
    <label
      key={x.id}
      className={cn(
        "flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-xl px-2 text-foreground has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
        indent && "pl-8",
        to === x.id ? "bg-fin/15" : "active:bg-muted",
      )}
    >
      <input
        type="radio"
        name={`move-${id}`}
        value={x.id}
        checked={to === x.id}
        onChange={() => setTo(x.id)}
        className="sr-only"
      />
      <span className="text-lg">{x.icon}</span>
      <span className="flex-1">{x.name}</span>
      {to === x.id && <Check className="size-4 text-fin" aria-hidden />}
    </label>
  )
  const target = targets.find((x) => x.id === to)
  return (
    <FinSheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete ${c.name}?`}
      description={`It's used in ${usedText}. Move them to:`}
      footer={
        <div className="flex flex-col gap-2">
          <Btn
            variant="danger"
            disabled={!target}
            onClick={() => {
              if (!target) return
              const undo = deleteCategoryMoving(id, target.id)
              undoToast(`${c.name} deleted · moved to ${target.name}`, undo)
              onOpenChange(false)
            }}
          >
            Move & delete
          </Btn>
          <Btn variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Btn>
        </div>
      }
    >
      {subs.length > 0 && (
        <p className="mb-3 rounded-xl bg-muted/50 px-3 py-2 text-muted-foreground text-sm">
          Its {plural(subs.length, "sub-category", "sub-categories")} (
          {subs.map((x) => x.name).join(", ")}) will become main categories and
          keep their own transactions.
        </p>
      )}
      <fieldset aria-label={`Move ${c.name}'s items to`}>
        {tops.map((t) => (
          <div key={t.id}>
            {option(t)}
            {targets
              .filter((x) => x.parentId === t.id)
              .map((x) => option(x, true))}
          </div>
        ))}
      </fieldset>
    </FinSheet>
  )
}

// ------------------------------------------------------------------ FIN-18

export function BudgetEditor({
  open,
  onOpenChange,
  id,
  prefill,
}: SheetProps & { id?: string; prefill?: Partial<Budget> }) {
  const s = useFin()
  const ex = id ? s.budgets.find((b) => b.id === id) : undefined
  const init = { ...ex, ...prefill }
  const [name, setName] = useState(init.name ?? "")
  const [all, setAll] = useState(init.categoryIds === null)
  const [ids, setIds] = useState<string[]>(init.categoryIds ?? [])
  const [limit, setLimit] = useState(init.limit ? String(init.limit) : "")
  const [rollover, setRollover] = useState(init.rollover ?? false)
  const [picker, setPicker] = useState(false)
  const cats = useMemo(() => catMap(s), [s])
  const hint = useMemo(
    () => Math.round(avgSpend(s, all ? null : ids) / 100) * 100,
    [s, all, ids],
  )
  const save = () => {
    if (!Number(limit)) return toast.error("Set a limit")
    if (!all && !ids.length) return toast.error("Pick at least one category")
    const data = {
      name:
        name.trim() ||
        (all ? "Monthly spend" : ids.map((x) => cats.get(x)?.name).join(" + ")),
      categoryIds: all ? null : ids,
      limit: Number(limit),
      rollover,
    }
    if (ex) updateBudget(ex.id, data)
    else addBudget(data)
    toast(ex ? "Budget updated" : `Budget “${data.name}” set`)
    onOpenChange(false)
  }
  return (
    <FinSheet
      open={open}
      onOpenChange={onOpenChange}
      title={ex ? "Edit budget" : "New budget"}
      footer={
        <div className="flex gap-2">
          {ex && (
            <Btn
              variant="danger"
              onClick={() => {
                updateBudget(ex.id, { archived: true })
                onOpenChange(false)
                undoToast(`${ex.name} archived`, () =>
                  updateBudget(ex.id, { archived: false }),
                )
              }}
            >
              Archive
            </Btn>
          )}
          {ex && (
            <Btn
              variant="ghost"
              onClick={() => {
                deleteBudget(ex.id)
                onOpenChange(false)
                toast(`${ex.name} deleted`)
              }}
            >
              Delete
            </Btn>
          )}
          <Btn accent="fin" className="flex-1" onClick={save}>
            Save
          </Btn>
        </div>
      }
    >
      <Field label="Name">
        <input
          className={inputCls}
          placeholder="e.g. Food"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="Covers">
        <Segmented
          value={all ? "all" : "cats"}
          onChange={(v) => setAll(v === "all")}
          options={[
            { value: "all", label: "All spending" },
            { value: "cats", label: "Categories" },
          ]}
        />
        {!all && (
          <button
            type="button"
            onClick={() => setPicker(true)}
            className={cn(
              inputCls,
              "mt-2 flex h-auto min-h-11 flex-wrap items-center gap-1.5 py-2 text-left",
            )}
          >
            {ids.length ? (
              ids.map((x) => (
                <Pill key={x} tone="fin">
                  {cats.get(x)?.icon} {cats.get(x)?.name}
                </Pill>
              ))
            ) : (
              <span className="text-muted-foreground">Choose categories…</span>
            )}
          </button>
        )}
      </Field>
      <Field
        label="Monthly limit ₱"
        hint={
          hint > 0 ? (
            <button
              type="button"
              className="text-fin"
              onClick={() => setLimit(String(hint))}
            >
              Your 3-month average is {amt(hint)} — use it
            </button>
          ) : undefined
        }
      >
        <NumberInput
          inputMode="decimal"
          className={cn(inputCls, "text-xl")}
          value={limit}
          onChange={(e) => setLimit(num(e.target.value))}
        />
      </Field>
      <Field label="Period">
        <div className="rounded-xl bg-muted/50 px-3 py-2.5 text-sm">
          Monthly · cycle starts on day {s.settings.monthStartDay}{" "}
          <span className="text-muted-foreground">
            (change in Finance settings)
          </span>
        </div>
      </Field>
      <Toggle
        checked={rollover}
        onChange={setRollover}
        label="Roll over unspent"
        hint="Leftover adds to next month's limit."
      />
      <CategoryPicker
        open={picker}
        onOpenChange={setPicker}
        kind="expense"
        multi
        value={ids}
        onChange={setIds}
      />
    </FinSheet>
  )
}

// ------------------------------------------------------------------ FIN-21

type SchedKind = Schedule["kind"]

export function PlannedEditor({
  open,
  onOpenChange,
  id,
  prefill,
}: SheetProps & { id?: string; prefill?: Partial<PlannedItem> }) {
  const s = useFin()
  const ex = id ? s.planned.find((p) => p.id === id) : undefined
  const init = { ...ex, ...prefill }
  const [type, setType] = useState<RecordType>(init.type ?? "expense")
  const [name, setName] = useState(init.name ?? "")
  const [amount, setAmount] = useState(init.amount ? String(init.amount) : "")
  const [estimated, setEstimated] = useState(init.estimated ?? false)
  const [acct, setAcct] = useState(
    init.accountId ?? s.settings.defaultAccountId,
  )
  const [to, setTo] = useState(init.toAccountId ?? "")
  const [cat, setCat] = useState(init.categoryId ?? "")
  const sc = init.schedule
  const [kind, setKind] = useState<SchedKind>(sc?.kind ?? "monthly")
  const [day, setDay] = useState(sc?.kind === "monthly" ? sc.day : 5)
  const [days, setDays] = useState<[number, number]>(
    sc?.kind === "semimonthly" ? sc.days : [15, 30],
  )
  const [every, setEvery] = useState(sc?.kind === "weekly" ? sc.every : 1)
  const [once, setOnce] = useState(sc?.kind === "once" ? sc.date : today())
  const [start, setStart] = useState(init.start ?? today())
  const [endKind, setEndKind] = useState<EndRule["kind"]>(
    init.end?.kind ?? "never",
  )
  const [endDate, setEndDate] = useState(
    init.end?.kind === "date" ? init.end.date : today(),
  )
  const [endN, setEndN] = useState(init.end?.kind === "count" ? init.end.n : 12)
  const [auto, setAuto] = useState(init.autoLog ?? false)
  const [inst, setInst] = useState(init.isInstallment ?? false)
  const [proj, setProj] = useState(init.inProjection ?? true)
  const [whatIf, setWhatIf] = useState(init.isWhatIf ?? false)
  const [picker, setPicker] = useState(false)
  const cats = useMemo(() => catMap(s), [s])
  const accounts = s.accounts.filter((a) => !a.archived)

  const save = () => {
    if (!name.trim()) return toast.error("Name it (e.g. Netflix)")
    if (!Number(amount)) return toast.error("Set an amount")
    if (type === "transfer" && (!to || to === acct))
      return toast.error("Pick a destination account")
    if (type !== "transfer" && !cat) return toast.error("Pick a category")
    const schedule: Schedule =
      kind === "once"
        ? { kind, date: once }
        : kind === "monthly"
          ? { kind, day }
          : kind === "semimonthly"
            ? { kind, days }
            : { kind, every, anchor: start }
    const end: EndRule =
      endKind === "date"
        ? { kind: "date", date: endDate }
        : endKind === "count"
          ? { kind: "count", n: endN }
          : { kind: "never" }
    const data = {
      name: name.trim(),
      type,
      amount: Number(amount),
      estimated,
      accountId: acct,
      toAccountId: type === "transfer" ? to : undefined,
      categoryId: type === "transfer" ? undefined : cat,
      schedule,
      start,
      end,
      autoLog: auto,
      isInstallment: type === "transfer" && inst,
      inProjection: !whatIf && proj,
      isWhatIf: whatIf,
    }
    if (ex) updatePlanned(ex.id, data)
    else addPlanned(data)
    toast(ex ? "Plan updated" : `${data.name} scheduled`)
    closeSheet()
  }

  return (
    <FinSheet
      open={open}
      onOpenChange={onOpenChange}
      title={ex ? "Edit scheduled payment" : "New scheduled payment"}
      footer={
        <div className="flex gap-2">
          {ex && (
            <Btn
              variant="danger"
              onClick={() => {
                if (deletePlanned(ex.id)) toast(`${ex.name} deleted`)
                else {
                  updatePlanned(ex.id, { archived: true })
                  undoToast(`${ex.name} archived (it has history)`, () =>
                    updatePlanned(ex.id, { archived: false }),
                  )
                }
                onOpenChange(false)
              }}
            >
              {s.records.some((r) => r.plannedId === ex.id)
                ? "Archive"
                : "Delete"}
            </Btn>
          )}
          <Btn accent="fin" className="flex-1" onClick={save}>
            Save
          </Btn>
        </div>
      }
    >
      <Segmented
        value={type}
        onChange={setType}
        options={[
          { value: "expense", label: "Bill / expense" },
          { value: "income", label: "Income" },
          { value: "transfer", label: "Transfer" },
        ]}
      />
      <Field label="Name">
        <input
          className={inputCls}
          placeholder="e.g. Netflix"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="Amount ₱">
        <NumberInput
          inputMode="decimal"
          className={cn(inputCls, "text-xl")}
          value={amount}
          onChange={(e) => setAmount(num(e.target.value))}
        />
      </Field>
      <Toggle
        checked={estimated}
        onChange={setEstimated}
        label="Amount varies (estimate)"
        hint="e.g. Meralco. You'll enter the actual when it's due."
      />
      <Field label={type === "transfer" ? "From" : "Account"}>
        <ChipRow>
          {accounts.map((a) => (
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
      {type === "transfer" ? (
        <>
          <Field label="To">
            <ChipRow>
              {accounts
                .filter((a) => a.id !== acct)
                .map((a) => (
                  <Chip
                    key={a.id}
                    active={to === a.id}
                    accent="fin"
                    onClick={() => setTo(a.id)}
                  >
                    {a.name}
                  </Chip>
                ))}
            </ChipRow>
          </Field>
          <Toggle
            checked={inst}
            onChange={setInst}
            label="Credit-card installment"
            hint="0% plans: the purchase was logged in full; these payments feed the projection."
          />
        </>
      ) : (
        <Field label="Category">
          <button
            type="button"
            onClick={() => setPicker(true)}
            className={cn(inputCls, "flex items-center gap-2 text-left")}
          >
            {cat ? (
              <>
                {cats.get(cat)?.icon} {cats.get(cat)?.name}
              </>
            ) : (
              <span className="text-muted-foreground">Choose…</span>
            )}
          </button>
        </Field>
      )}
      <Field label="Repeats">
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["once", "Once"],
              ["monthly", "Monthly"],
              ["semimonthly", "15th & 30th"],
              ["weekly", "Weekly"],
            ] as const
          ).map(([k, l]) => (
            <Chip
              key={k}
              active={kind === k}
              accent="fin"
              onClick={() => setKind(k)}
            >
              {l}
            </Chip>
          ))}
        </div>
      </Field>
      {kind === "once" && (
        <Field label="Date">
          <input
            type="date"
            className={inputCls}
            value={once}
            onChange={(e) => setOnce(e.target.value)}
          />
        </Field>
      )}
      {kind === "monthly" && (
        <Field
          label="Day of month"
          hint="31 falls on the last day in shorter months."
        >
          <input
            type="number"
            min={1}
            max={31}
            className={inputCls}
            value={day}
            onChange={(e) =>
              setDay(Math.min(31, Math.max(1, Number(e.target.value))))
            }
          />
        </Field>
      )}
      {kind === "semimonthly" && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="First day">
            <input
              type="number"
              min={1}
              max={31}
              className={inputCls}
              value={days[0]}
              onChange={(e) => setDays([Number(e.target.value), days[1]])}
            />
          </Field>
          <Field label="Second day" hint="30 → last day in Feb">
            <input
              type="number"
              min={1}
              max={31}
              className={inputCls}
              value={days[1]}
              onChange={(e) => setDays([days[0], Number(e.target.value)])}
            />
          </Field>
        </div>
      )}
      {kind === "weekly" && (
        <Field label="Every N weeks (from start date)">
          <input
            type="number"
            min={1}
            max={8}
            className={inputCls}
            value={every}
            onChange={(e) => setEvery(Math.max(1, Number(e.target.value)))}
          />
        </Field>
      )}
      {kind !== "once" && (
        <>
          <Field label="Starts">
            <input
              type="date"
              className={inputCls}
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </Field>
          <Field label="Ends">
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["never", "Never"],
                  ["date", "On a date"],
                  ["count", "After N times"],
                ] as const
              ).map(([k, l]) => (
                <Chip
                  key={k}
                  active={endKind === k}
                  accent="fin"
                  onClick={() => setEndKind(k)}
                >
                  {l}
                </Chip>
              ))}
            </div>
            {endKind === "date" && (
              <input
                type="date"
                className={cn(inputCls, "mt-2")}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            )}
            {endKind === "count" && (
              <input
                type="number"
                min={1}
                className={cn(inputCls, "mt-2")}
                value={endN}
                onChange={(e) => setEndN(Math.max(1, Number(e.target.value)))}
              />
            )}
          </Field>
        </>
      )}
      <Field label="When it's due">
        <Segmented
          value={auto ? "auto" : "confirm"}
          onChange={(v) => setAuto(v === "auto")}
          options={[
            { value: "confirm", label: "Ask me (Paid / Skip)" },
            { value: "auto", label: "Auto-log" },
          ]}
        />
      </Field>
      <Toggle
        checked={proj && !whatIf}
        onChange={setProj}
        label="Count in savings projection"
      />
      <Toggle
        checked={whatIf}
        onChange={setWhatIf}
        label="Draft what-if only"
        hint="Shows in scenarios, never in the real plan."
      />
      <CategoryPicker
        open={picker}
        onOpenChange={setPicker}
        kind={type === "income" ? "income" : "expense"}
        value={cat ? [cat] : []}
        onChange={(x) => setCat(x[0] ?? "")}
      />
    </FinSheet>
  )
}
