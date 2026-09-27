"use client"

import {
  AlertTriangle,
  Camera,
  Check,
  CheckCircle2,
  FileText,
  Image as ImageIcon,
  KeyRound,
  Loader2,
  Lock,
  RotateCcw,
  Tag,
  Trash2,
  Upload,
} from "lucide-react"
import Link from "next/link"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import {
  Btn,
  Card,
  Chip,
  Empty,
  Money,
  Row,
  Screen,
  SectionTitle,
  Segmented,
} from "../../ui/kit"
import {
  commitImport,
  deleteImport,
  parseImport,
  patchImport,
  patchRows,
  restoreImport,
  SAMPLE_FILES,
  type SampleFile,
  startImport,
  undoImport,
} from "../actions"
import {
  acctMap,
  balanceOf,
  catMap,
  diffDays,
  lastReconciledDays,
  needsAttention,
  recDay,
  rowSigned,
  shortDate,
  timeOf,
} from "../calc"
import {
  type FinRecord,
  type ImportRow,
  type StatementImport,
  signedFor,
} from "../data"
import { CategoryPicker } from "../editors"
import { openSheet } from "../sheets"
import { finStore, useFin } from "../store"
import {
  AcctIcon,
  ChipRow,
  Field,
  FinSheet,
  inputCls,
  Pill,
  undoToast,
  useDemoState,
} from "../ui"

// ------------------------------------------------------------------ FIN-25

export function ImportStart() {
  const s = useFin()
  const sp = useSearchParams()
  const router = useRouter()
  const accounts = s.accounts.filter(
    (a) => !a.archived && a.type !== "investment",
  )
  const [acct, setAcct] = useState(sp.get("account") ?? "gcash")
  const [file, setFile] = useState<SampleFile | null>(null)
  const a = s.accounts.find((x) => x.id === acct)
  const days = a ? lastReconciledDays(a) : null
  return (
    <Screen title="Import statement" back>
      <p className="px-1 text-muted-foreground text-sm">
        Upload a bank or e-wallet statement. I'll read it, match it against your
        transactions, and show you every difference before anything changes.
      </p>
      <Field label="Account">
        <ChipRow>
          {accounts.map((x) => (
            <Chip
              key={x.id}
              accent="fin"
              active={acct === x.id}
              onClick={() => setAcct(x.id)}
            >
              <AcctIcon acct={x} size="sm" /> {x.name}
            </Chip>
          ))}
        </ChipRow>
        {a && (
          <div
            className={cn(
              "text-xs",
              days !== null && days > s.settings.nudgeDays
                ? "text-warn"
                : "text-muted-foreground",
            )}
          >
            {a.lastReconciled
              ? `Last matched ${shortDate(a.lastReconciled)} (${days} days ago)`
              : "Never matched with a statement"}
          </div>
        )}
      </Field>
      <Field label="File" hint="Prototype: pick one of these sample files.">
        <div className="space-y-2">
          {SAMPLE_FILES.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFile(f.key)}
              className={cn(
                "flex w-full items-center gap-3 rounded-2xl border p-3 text-left",
                file === f.key
                  ? "border-fin bg-fin/10"
                  : "border-border bg-card",
              )}
            >
              <span className="grid size-10 place-items-center rounded-xl bg-muted">
                {f.type === "image" ? (
                  <ImageIcon className="size-5" />
                ) : f.key === "bpi-pdf" ? (
                  <Lock className="size-5" />
                ) : (
                  <FileText className="size-5" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-sm">
                  {f.name}
                </span>
                <span className="text-muted-foreground text-xs">
                  {f.size} · {f.hint}
                </span>
              </span>
              {file === f.key && <Check className="size-5 text-fin" />}
            </button>
          ))}
          <div className="grid grid-cols-2 gap-2">
            <Btn variant="secondary" onClick={() => setFile("gcash-pdf")}>
              <Upload className="size-4" /> Browse files
            </Btn>
            <Btn variant="secondary" onClick={() => setFile("maya-shot")}>
              <Camera className="size-4" /> Screenshots
            </Btn>
          </div>
        </div>
      </Field>
      <Card className="mt-2 bg-muted/40 text-muted-foreground text-xs">
        <div className="mb-1 font-medium text-foreground">Tips</div>
        GCash: Profile › Transactions › Download (PDF, emailed). BPI:
        e-Statement PDF (password is usually your birthdate). Multiple
        screenshots work — overlaps are de-duplicated. Files are deleted after
        you confirm; the read rows are kept for reference.
      </Card>
      <Btn
        accent="fin"
        className="mt-4 h-12 w-full"
        disabled={!file}
        onClick={() => {
          if (!file) return
          const id = startImport(acct, file)
          router.push(`/finance/import/${id}?file=${file}`)
        }}
      >
        Upload & read
      </Btn>
    </Screen>
  )
}

// ------------------------------------------------------------------ FIN-26/27

const detectedOf = (f: SampleFile) =>
  f === "bpi-pdf" ? "bpi" : f === "maya-shot" ? "maya" : "gcash"

export function ImportRun() {
  const { id } = useParams<{ id: string }>()
  const s = useFin()
  const demo = useDemoState()
  const imp = s.imports.find((x) => x.id === id)
  if (!imp)
    return (
      <Screen title="Import" back="/finance/imports">
        <Empty
          title="Import not found"
          body="It may have been deleted."
          action={<Btn href="/finance/import">New import</Btn>}
        />
      </Screen>
    )
  if (demo === "error" || imp.status === "failed")
    return <ImportFailed imp={imp} />
  if (imp.status === "parsing") return <Parsing imp={imp} />
  if (imp.status === "review") return <Review imp={imp} />
  return <ImportDone imp={imp} />
}

function Parsing({ imp }: { imp: StatementImport }) {
  const s = useFin()
  const sp = useSearchParams()
  const router = useRouter()
  const file = (sp.get("file") as SampleFile) ?? "gcash-pdf"
  const [step, setStep] = useState(0)
  const [prompt, setPrompt] = useState<
    null | "password" | "bad-password" | "wrong-account"
  >(null)
  const [pw, setPw] = useState("")
  const ran = useRef(false)
  const acct = s.accounts.find((a) => a.id === imp.accountId)
  const detected = s.accounts.find((a) => a.id === detectedOf(file))

  const run = (opts: { password?: string; forceAccount?: string } = {}) => {
    setPrompt(null)
    setStep(1)
    setTimeout(() => setStep(2), 700)
    setTimeout(() => {
      const res = parseImport(imp.id, file, opts)
      if (
        res === "password" ||
        res === "bad-password" ||
        res === "wrong-account"
      ) {
        setPrompt(res)
        setStep(0)
      } else setStep(3)
    }, 1500)
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once on mount
  useEffect(() => {
    if (ran.current) return
    ran.current = true
    run()
  }, [])

  const steps = [
    "Reading file",
    "Parsing transactions",
    "Matching to your transactions",
  ]
  return (
    <Screen title="Reading statement" back="/finance/imports">
      <Card className="mt-2 flex items-center gap-3">
        <FileText className="size-8 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-sm">{imp.fileName}</div>
          <div className="text-muted-foreground text-xs">for {acct?.name}</div>
        </div>
      </Card>
      {!prompt && (
        <Card className="mt-3 space-y-3">
          {steps.map((t, i) => (
            <div key={t} className="flex items-center gap-3 text-sm">
              {step > i ? (
                <CheckCircle2 className="size-5 text-good" />
              ) : step === i ? (
                <Loader2 className="size-5 animate-spin text-fin" />
              ) : (
                <span className="size-5 rounded-full border border-border" />
              )}
              <span className={cn(step < i && "text-muted-foreground")}>
                {t}
              </span>
            </div>
          ))}
        </Card>
      )}
      {(prompt === "password" || prompt === "bad-password") && (
        <Card className="mt-3">
          <div className="flex items-center gap-2 font-semibold">
            <KeyRound className="size-5 text-fin" /> This PDF is
            password-protected
          </div>
          <p className="mt-1 text-muted-foreground text-sm">
            Used once to open the file, never stored. (Prototype password: 1234)
          </p>
          <input
            type="password"
            className={cn(inputCls, "mt-3")}
            placeholder="PDF password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
          />
          {prompt === "bad-password" && (
            <div className="mt-1 text-bad text-xs">
              That password didn't open it. Try again.
            </div>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Btn variant="ghost" onClick={() => router.push("/finance/import")}>
              Cancel
            </Btn>
            <Btn
              accent="fin"
              disabled={!pw}
              onClick={() => run({ password: pw })}
            >
              Unlock
            </Btn>
          </div>
        </Card>
      )}
      {prompt === "wrong-account" && (
        <Card className="mt-3 border-warn/50">
          <div className="flex items-center gap-2 font-semibold text-warn">
            <AlertTriangle className="size-5" /> Looks like {detected?.name},
            not {acct?.name}
          </div>
          <p className="mt-1 text-muted-foreground text-sm">
            The header and transaction formats match a {detected?.name}{" "}
            statement.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Btn
              variant="secondary"
              onClick={() => run({ forceAccount: imp.accountId })}
            >
              Keep {acct?.name}
            </Btn>
            <Btn
              accent="fin"
              onClick={() => run({ forceAccount: detected?.id })}
            >
              Switch to {detected?.name}
            </Btn>
          </div>
        </Card>
      )}
    </Screen>
  )
}

function ImportFailed({ imp }: { imp: StatementImport }) {
  const router = useRouter()
  return (
    <Screen title="Import failed" back="/finance/imports">
      <Empty
        icon={<AlertTriangle className="size-10 text-bad" />}
        title="Couldn't read this statement"
        body={
          imp.error ??
          "The file is unreadable, for the wrong account, or has 0 rows."
        }
        action={
          <div className="flex flex-col gap-2">
            <Btn
              accent="fin"
              onClick={() => {
                patchImport(imp.id, { status: "parsing", error: undefined })
                router.replace(`/finance/import/${imp.id}?file=gcash-pdf`)
              }}
            >
              <RotateCcw className="size-4" /> Retry
            </Btn>
            <Btn
              variant="secondary"
              href={`/finance/import?account=${imp.accountId}`}
            >
              Choose another file
            </Btn>
            <Btn
              variant="ghost"
              onClick={() =>
                toast("Thanks — sent the file format to be improved (mock)")
              }
            >
              Report this format
            </Btn>
          </div>
        }
      />
    </Screen>
  )
}

type Tab = "attention" | "new" | "matched"

function Review({ imp }: { imp: StatementImport }) {
  const s = useFin()
  const router = useRouter()
  const [tab, setTab] = useState<Tab>("attention")
  const [sel, setSel] = useState<string[]>([])
  const [picker, setPicker] = useState(false)
  const [fix, setFix] = useState<string | null>(null)
  const cats = useMemo(() => catMap(s), [s])
  const acct = s.accounts.find((a) => a.id === imp.accountId)
  const recs = useMemo(() => new Map(s.records.map((r) => [r.id, r])), [s])
  const rows = imp.rows
  const counts = {
    matched: rows.filter((r) => r.state === "matched").length,
    new: rows.filter((r) => r.state === "new").length,
    probable: rows.filter((r) => r.state === "probable").length,
    duplicate: rows.filter((r) => r.state === "duplicate").length,
    ignored: rows.filter((r) => r.decision === "ignore").length,
  }
  const attention = rows.filter(needsAttention)
  const list =
    tab === "attention"
      ? attention
      : tab === "new"
        ? rows.filter((r) => r.state === "new")
        : rows.filter((r) => r.state === "matched")
  const appNow = acct ? balanceOf(s, acct, imp.to) : 0
  const after = useMemo(() => {
    let b = appNow
    for (const r of rows) {
      if (r.decision === "ignore") continue
      if (
        r.state === "new" ||
        (r.state === "duplicate" && r.decision === "accept")
      )
        b += rowSigned(r)
      if (
        r.state === "probable" &&
        r.matchId &&
        (r.decision === "take" || r.decision === "merge")
      ) {
        const x = recs.get(r.matchId)
        if (x) b += rowSigned(r) - signedFor(x, imp.accountId)
      }
    }
    return b
  }, [rows, appNow, recs, imp.accountId])
  const gap = imp.closing - after
  const caught =
    counts.matched / Math.max(1, counts.matched + counts.new + counts.probable)
  const changes = rows.filter((r) => r.decision !== "ignore").length

  const commit = () => {
    const res = commitImport(imp.id)
    toast(`Imported — ${res.created} added, ${res.updated} updated`)
    if (Math.abs(res.gap) >= 1 && acct)
      openSheet({
        kind: "adjust",
        accountId: acct.id,
        actual: balanceOf(finStore.get(), acct) + res.gap,
        note: `Gap after ${imp.fileName}`,
      })
  }

  return (
    <Screen title="Match with statement" back="/finance/imports">
      <div className="flex items-center gap-3 pb-2">
        <AcctIcon acct={acct} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{acct?.name} statement</div>
          <div className="text-muted-foreground text-xs">
            {shortDate(imp.from)} – {shortDate(imp.to)} · {rows.length} rows
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-1.5 text-center">
        {[
          { l: "matched", n: counts.matched, c: "text-good" },
          { l: "new", n: counts.new, c: "text-fin" },
          { l: "conflicts", n: counts.probable, c: "text-warn" },
          { l: "dupes", n: counts.duplicate, c: "text-muted-foreground" },
        ].map((x) => (
          <div key={x.l} className="rounded-xl bg-card py-2">
            <div className={cn("num font-semibold text-lg", x.c)}>{x.n}</div>
            <div className="text-[10px] text-muted-foreground">{x.l}</div>
          </div>
        ))}
      </div>

      <Card className="mt-3">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Statement closing</span>
          <Money value={imp.closing} className="font-semibold" />
        </div>
        <div className="mt-1 flex justify-between text-sm">
          <span className="text-muted-foreground">
            App balance after import
          </span>
          <Money value={after} className="font-semibold" />
        </div>
        <div
          className={cn(
            "mt-2 flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs",
            Math.abs(gap) < 1 ? "bg-good/10 text-good" : "bg-warn/10 text-warn",
          )}
        >
          {Math.abs(gap) < 1 ? (
            <>
              <CheckCircle2 className="size-4" /> Balances will match
            </>
          ) : (
            <>
              <AlertTriangle className="size-4" /> Off by <Money value={gap} />{" "}
              — you can log an adjustment after import
            </>
          )}
        </div>
        <div className="mt-2 text-muted-foreground text-xs">
          You caught{" "}
          <b className="text-foreground">{Math.round(caught * 100)}%</b> of
          these yourself. Nice logging.
        </div>
      </Card>

      <div className="sticky top-14 z-10 -mx-4 mt-3 bg-background/90 px-4 py-2 backdrop-blur-md">
        <Segmented
          value={tab}
          onChange={(v) => {
            setTab(v)
            setSel([])
          }}
          options={[
            {
              value: "attention",
              label: `Needs attention ${attention.length}`,
            },
            { value: "new", label: `New ${counts.new}` },
            { value: "matched", label: `Matched ${counts.matched}` },
          ]}
        />
        {tab === "new" && (
          <div className="mt-2 flex gap-2">
            <Btn
              variant="secondary"
              className="h-9 flex-1"
              onClick={() => {
                patchRows(
                  imp.id,
                  rows.filter((r) => r.state === "new").map((r) => r.id),
                  { decision: "accept" },
                )
                toast("All new rows accepted")
              }}
            >
              <Check className="size-4" /> Accept all new
            </Btn>
            <Btn
              variant="secondary"
              className="h-9 flex-1"
              disabled={!sel.length}
              onClick={() => setPicker(true)}
            >
              <Tag className="size-4" /> Category ({sel.length})
            </Btn>
          </div>
        )}
      </div>

      {list.length === 0 && (
        <div className="py-10 text-center text-muted-foreground text-sm">
          {tab === "attention"
            ? "Nothing needs your attention."
            : "No rows here."}
        </div>
      )}
      <div className="space-y-2">
        {list.map((r) => (
          <ImportRowCard
            key={r.id}
            r={r}
            rec={r.matchId ? recs.get(r.matchId) : undefined}
            catName={cats.get(r.categoryId ?? "")?.name}
            selectable={tab === "new"}
            selected={sel.includes(r.id)}
            onSelect={() =>
              setSel((x) =>
                x.includes(r.id) ? x.filter((y) => y !== r.id) : [...x, r.id],
              )
            }
            onOpen={() => setFix(r.id)}
          />
        ))}
      </div>

      <div className="sticky bottom-3 z-10 mt-5 flex gap-2 rounded-2xl border border-border bg-card p-2 shadow-xl">
        <Btn
          variant="secondary"
          onClick={() => {
            toast("Draft saved — resume from Import history")
            router.push("/finance/imports")
          }}
        >
          Save draft
        </Btn>
        <Btn accent="fin" className="flex-1" onClick={commit}>
          Apply {changes} change{changes === 1 ? "" : "s"}
        </Btn>
      </div>

      <CategoryPicker
        open={picker}
        onOpenChange={setPicker}
        kind="expense"
        value={[]}
        onChange={(ids) => {
          if (!ids[0]) return
          patchRows(imp.id, sel, { categoryId: ids[0], decision: "accept" })
          toast(`Category set on ${sel.length} rows`)
          setSel([])
        }}
      />
      {fix && <RowFix imp={imp} rowId={fix} onClose={() => setFix(null)} />}
    </Screen>
  )
}

function ImportRowCard({
  r,
  rec,
  catName,
  selectable,
  selected,
  onSelect,
  onOpen,
}: {
  r: ImportRow
  rec?: FinRecord
  catName?: string
  selectable: boolean
  selected: boolean
  onSelect: () => void
  onOpen: () => void
}) {
  const ignored = r.decision === "ignore"
  const pill =
    r.state === "matched" ? (
      <Pill tone="good">matched</Pill>
    ) : r.state === "probable" ? (
      <Pill tone="warn">conflict</Pill>
    ) : r.state === "duplicate" ? (
      <Pill>duplicate</Pill>
    ) : r.state === "pending" ? (
      <Pill>pending</Pill>
    ) : (
      <Pill tone="fin">new</Pill>
    )
  const amountDiff = rec && rec.amount !== r.amount
  const dateDiff = rec && recDay(rec) !== r.date
  return (
    <div
      className={cn(
        "flex items-stretch gap-2 rounded-2xl border border-border/60 bg-card",
        ignored && "opacity-50",
      )}
    >
      {selectable && (
        <button
          type="button"
          aria-label="Select row"
          onClick={onSelect}
          className="grid w-10 shrink-0 place-items-center"
        >
          <span
            className={cn(
              "grid size-5 place-items-center rounded-md border",
              selected ? "border-fin bg-fin text-background" : "border-border",
            )}
          >
            {selected && <Check className="size-3.5" />}
          </span>
        </button>
      )}
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "min-w-0 flex-1 py-3 pr-3 text-left",
          !selectable && "pl-3",
        )}
      >
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-medium text-sm">
            {r.payee}
          </span>
          <Money
            value={rowSigned(r)}
            signed
            className={cn(
              "font-semibold text-sm",
              r.direction === "out" && "text-foreground",
            )}
          />
        </div>
        <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
          {r.raw}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          {pill}
          <span>
            {shortDate(r.date)} {r.time}
          </span>
          {r.state === "new" && (
            <span>
              · {catName ?? <span className="text-warn">no category</span>}
            </span>
          )}
          {r.state === "new" && r.confidence < 0.7 && (
            <Pill tone="warn">unsure</Pill>
          )}
          {ignored && <span>· will ignore</span>}
        </div>
        {r.state === "probable" && rec && (
          <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg bg-muted/50 p-2 text-[11px]">
            <div>
              <div className="text-muted-foreground">Your transaction</div>
              <div className={cn(amountDiff && "text-bad line-through")}>
                <Money value={rec.amount} />
              </div>
              <div className={cn(dateDiff && "text-bad line-through")}>
                {shortDate(recDay(rec))}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Statement</div>
              <div className={cn(amountDiff && "font-semibold text-good")}>
                <Money value={r.amount} />
              </div>
              <div className={cn(dateDiff && "font-semibold text-good")}>
                {shortDate(r.date)}
              </div>
            </div>
            <div className="col-span-2 text-muted-foreground">
              Default:{" "}
              {r.decision === "take"
                ? "take statement, keep my category"
                : r.decision === "keep"
                  ? "keep mine"
                  : r.decision === "merge"
                    ? "merge"
                    : "ignore"}
            </div>
          </div>
        )}
        {r.state === "matched" && rec && (
          <div className="mt-1 text-[11px] text-muted-foreground">
            ✓ {rec.payee} · fills exact time {r.time} (you logged{" "}
            {timeOf(rec.at)})
          </div>
        )}
        {r.reason && r.state !== "probable" && (
          <div className="mt-1 text-[11px] text-muted-foreground">
            {r.reason}
          </div>
        )}
      </button>
    </div>
  )
}

// ------------------------------------------------------------------ FIN-28

function RowFix({
  imp,
  rowId,
  onClose,
}: {
  imp: StatementImport
  rowId: string
  onClose: () => void
}) {
  const s = useFin()
  const r = imp.rows.find((x) => x.id === rowId)
  const [picker, setPicker] = useState(false)
  const cats = useMemo(() => catMap(s), [s])
  const accts = useMemo(() => acctMap(s), [s])
  const rec = r?.matchId ? s.records.find((x) => x.id === r.matchId) : undefined
  const candidates = useMemo(() => {
    if (!r) return []
    const claimed = new Set(imp.rows.map((x) => x.matchId).filter(Boolean))
    return s.records
      .filter(
        (x) =>
          (x.accountId === imp.accountId || x.toAccountId === imp.accountId) &&
          !claimed.has(x.id) &&
          Math.abs(diffDays(recDay(x), r.date)) <= 5 &&
          Math.abs(x.amount - r.amount) <= Math.max(60, r.amount * 0.25),
      )
      .slice(0, 4)
  }, [s, r, imp])
  if (!r) return null
  const set = (patch: Partial<ImportRow>, msg: string) => {
    patchRows(imp.id, [r.id], patch)
    toast(msg)
    onClose()
  }
  return (
    <FinSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title="Fix row"
      description={
        r.reason ??
        (r.state === "matched"
          ? "Matched with high confidence."
          : "Not in your transactions yet.")
      }
    >
      <div className="grid grid-cols-2 gap-2 text-sm">
        <Card className="bg-muted/30 p-3">
          <div className="mb-1 text-[11px] text-muted-foreground uppercase tracking-wider">
            Statement
          </div>
          <div className="font-medium">{r.payee}</div>
          <Money value={rowSigned(r)} signed className="font-semibold" />
          <div className="text-muted-foreground text-xs">
            {shortDate(r.date)} · {r.time}
          </div>
          <div className="mt-1 break-words font-mono text-[10px] text-muted-foreground">
            {r.raw}
          </div>
          <div className="mt-1 font-mono text-[10px] text-muted-foreground">
            Ref {r.ref}
          </div>
        </Card>
        <Card className="bg-muted/30 p-3">
          <div className="mb-1 text-[11px] text-muted-foreground uppercase tracking-wider">
            Your transaction
          </div>
          {rec ? (
            <>
              <div className="font-medium">
                {rec.payee ?? cats.get(rec.categoryId ?? "")?.name}
              </div>
              <Money
                value={signedFor(rec, imp.accountId)}
                signed
                className={cn(
                  "font-semibold",
                  rec.amount !== r.amount && "text-bad",
                )}
              />
              <div
                className={cn(
                  "text-xs",
                  recDay(rec) !== r.date ? "text-bad" : "text-muted-foreground",
                )}
              >
                {shortDate(recDay(rec))} · {timeOf(rec.at)}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {cats.get(rec.categoryId ?? "")?.name ??
                  accts.get(rec.toAccountId ?? "")?.name}
              </div>
            </>
          ) : (
            <div className="text-muted-foreground text-xs">
              No matching transaction — this would be added as new.
            </div>
          )}
        </Card>
      </div>

      {(r.state === "new" ||
        r.state === "duplicate" ||
        r.state === "pending") &&
        !r.isTransfer && (
          <Field label="Category">
            <button
              type="button"
              onClick={() => setPicker(true)}
              className={cn(inputCls, "flex items-center gap-2 text-left")}
            >
              {r.categoryId ? (
                <>
                  {cats.get(r.categoryId)?.icon} {cats.get(r.categoryId)?.name}
                </>
              ) : (
                <span className="text-muted-foreground">Choose…</span>
              )}
            </button>
          </Field>
        )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        {r.state === "probable" && (
          <>
            <Btn
              variant="secondary"
              onClick={() =>
                set({ decision: "keep" }, "Keeping your transaction")
              }
            >
              Keep mine
            </Btn>
            <Btn
              accent="fin"
              onClick={() =>
                set({ decision: "take" }, "Taking the statement values")
              }
            >
              Take statement
            </Btn>
            <Btn
              variant="secondary"
              onClick={() =>
                set(
                  { decision: "merge" },
                  "Merged: statement amount, your date & category",
                )
              }
            >
              Merge
            </Btn>
          </>
        )}
        {(r.state === "new" ||
          r.state === "duplicate" ||
          r.state === "pending") && (
          <Btn
            accent="fin"
            onClick={() =>
              set(
                { decision: "accept" },
                r.state === "new" ? "Will be added" : "Will be imported anyway",
              )
            }
          >
            {r.state === "new" ? "Add as new" : "Import anyway"}
          </Btn>
        )}
        {r.state === "probable" && (
          <Btn
            variant="secondary"
            onClick={() =>
              set(
                {
                  state: "new",
                  matchId: undefined,
                  decision: "accept",
                  categoryId: rec?.categoryId,
                },
                "Will be added as a separate transaction",
              )
            }
          >
            Create new
          </Btn>
        )}
        {r.state === "matched" && (
          <Btn
            variant="secondary"
            onClick={() =>
              set(
                { state: "new", matchId: undefined, decision: "accept" },
                "Unmatched — will be added as new",
              )
            }
          >
            Not the same
          </Btn>
        )}
        <Btn
          variant="ghost"
          onClick={() => set({ decision: "ignore" }, "Row ignored")}
        >
          Ignore
        </Btn>
      </div>

      {candidates.length > 0 && r.state !== "matched" && (
        <>
          <SectionTitle>Re-match to another transaction</SectionTitle>
          {candidates.map((c) => (
            <Row
              key={c.id}
              onClick={() =>
                set(
                  {
                    state:
                      c.amount === r.amount && recDay(c) === r.date
                        ? "matched"
                        : "probable",
                    matchId: c.id,
                    decision: c.amount === r.amount ? "accept" : "take",
                  },
                  "Re-matched",
                )
              }
              title={
                c.payee ?? cats.get(c.categoryId ?? "")?.name ?? "Transaction"
              }
              subtitle={`${shortDate(recDay(c))} · ${timeOf(c.at)}`}
              right={<Money value={c.amount} />}
            />
          ))}
        </>
      )}
      <CategoryPicker
        open={picker}
        onOpenChange={setPicker}
        kind={r.direction === "in" ? "income" : "expense"}
        value={r.categoryId ? [r.categoryId] : []}
        suggestion={r.suggestedCategoryId}
        onChange={(ids) =>
          patchRows(imp.id, [r.id], { categoryId: ids[0], decision: "accept" })
        }
      />
    </FinSheet>
  )
}

function ImportDone({ imp }: { imp: StatementImport }) {
  const s = useFin()
  const acct = s.accounts.find((a) => a.id === imp.accountId)
  const undone = imp.status === "undone"
  return (
    <Screen title="Import" back="/finance/imports">
      <div className="flex flex-col items-center py-8 text-center">
        {undone ? (
          <RotateCcw className="size-12 text-muted-foreground" />
        ) : (
          <CheckCircle2 className="size-12 text-good" />
        )}
        <div className="mt-3 font-semibold text-lg">
          {undone ? "Import undone" : `${acct?.name} matched with statement`}
        </div>
        <div className="text-muted-foreground text-sm">
          {shortDate(imp.from)} – {shortDate(imp.to)} · {imp.fileName}
        </div>
      </div>
      {imp.counts && (
        <div className="grid grid-cols-4 gap-2 text-center">
          {(
            [
              ["matched", imp.counts.matched],
              ["added", imp.counts.created],
              ["updated", imp.counts.updated],
              ["ignored", imp.counts.ignored],
            ] as const
          ).map(([l, n]) => (
            <Card key={l} className="p-3">
              <div className="num font-semibold text-lg">{n}</div>
              <div className="text-[10px] text-muted-foreground">{l}</div>
            </Card>
          ))}
        </div>
      )}
      <Card className="mt-3 text-muted-foreground text-xs">
        {imp.fileKept
          ? "The statement file is still stored."
          : "The statement file was deleted after import (the read rows are kept)."}
      </Card>
      <div className="mt-4 flex flex-col gap-2">
        <Btn accent="fin" href={`/finance/accounts/${imp.accountId}`}>
          View {acct?.name}
        </Btn>
        {!undone && (
          <Btn
            variant="secondary"
            onClick={() =>
              openSheet({
                kind: "confirm",
                title: "Undo this import?",
                body: `Reverts only what it did: removes ${imp.createdIds.length} added transactions and restores ${imp.changed.length} edited ones.`,
                confirm: "Undo import",
                danger: true,
                onConfirm: () => {
                  undoImport(imp.id)
                  toast("Import undone")
                },
              })
            }
          >
            <RotateCcw className="size-4" /> Undo import
          </Btn>
        )}
        <Btn variant="ghost" href="/finance">
          Back to Finance
        </Btn>
      </div>
    </Screen>
  )
}

// ------------------------------------------------------------------ FIN-29

export function ImportHistory() {
  const s = useFin()
  const demo = useDemoState()
  const [tab, setTab] = useState<"all" | "drafts" | "done">("all")
  const accts = useMemo(() => acctMap(s), [s])
  const order = (i: StatementImport) =>
    i.status === "review" || i.status === "parsing" ? 0 : 1
  const list = [...s.imports]
    .sort(
      (a, b) => order(a) - order(b) || b.createdAt.localeCompare(a.createdAt),
    )
    .filter((i) =>
      tab === "drafts"
        ? i.status === "review" || i.status === "parsing"
        : tab === "done"
          ? i.status === "done" || i.status === "undone"
          : true,
    )
  const add = (
    <Link
      href="/finance/import"
      aria-label="New import"
      className="grid size-10 place-items-center rounded-full hover:bg-muted"
    >
      <Upload className="size-5" />
    </Link>
  )
  if (demo === "empty" || s.imports.length === 0)
    return (
      <Screen title="Imports" back actions={add}>
        <Empty
          icon={<FileText className="size-10" />}
          title="No imports yet"
          body="Upload a GCash or bank statement to catch anything you forgot to log."
          action={
            <Btn accent="fin" href="/finance/import">
              Import a statement
            </Btn>
          }
        />
      </Screen>
    )
  return (
    <Screen title="Imports" back actions={add}>
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: "all", label: "All" },
          { value: "drafts", label: "Drafts" },
          { value: "done", label: "Imported" },
        ]}
      />
      <div className="mt-3 space-y-2">
        {list.map((i) => {
          const a = accts.get(i.accountId)
          const draft = i.status === "review" || i.status === "parsing"
          return (
            <Card key={i.id}>
              <div className="flex items-center gap-3">
                <AcctIcon acct={a} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-sm">
                    {i.fileName}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {a?.name} · {shortDate(i.from)} – {shortDate(i.to)}
                  </div>
                </div>
                <Pill
                  tone={
                    i.status === "done"
                      ? "good"
                      : i.status === "failed"
                        ? "bad"
                        : i.status === "undone"
                          ? "muted"
                          : "warn"
                  }
                >
                  {draft ? "draft" : i.status}
                </Pill>
              </div>
              {i.counts && (
                <div className="mt-2 text-muted-foreground text-xs">
                  {i.counts.matched} matched · {i.counts.created} added ·{" "}
                  {i.counts.updated} updated · {i.counts.ignored} ignored
                </div>
              )}
              {draft && (
                <div className="mt-2 text-muted-foreground text-xs">
                  {i.rows.filter(needsAttention).length} rows need attention
                </div>
              )}
              {i.error && (
                <div className="mt-2 text-bad text-xs">{i.error}</div>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {draft && (
                  <Btn
                    accent="fin"
                    className="h-9"
                    href={`/finance/import/${i.id}`}
                  >
                    Resume
                  </Btn>
                )}
                {(i.status === "done" || i.status === "undone") && (
                  <Btn
                    variant="secondary"
                    className="h-9"
                    href={`/finance/import/${i.id}`}
                  >
                    Summary
                  </Btn>
                )}
                {i.status === "done" &&
                  i.createdIds.length + i.changed.length > 0 && (
                    <Btn
                      variant="secondary"
                      className="h-9"
                      onClick={() =>
                        openSheet({
                          kind: "confirm",
                          title: "Undo this import?",
                          body: `Removes ${i.createdIds.length} transactions it added and restores ${i.changed.length} it edited. Nothing else changes.`,
                          confirm: "Undo import",
                          danger: true,
                          onConfirm: () => {
                            undoImport(i.id)
                            toast("Import undone")
                          },
                        })
                      }
                    >
                      <RotateCcw className="size-4" /> Undo
                    </Btn>
                  )}
                {i.fileKept && (
                  <Btn
                    variant="ghost"
                    className="h-9"
                    onClick={() => {
                      patchImport(i.id, { fileKept: false })
                      toast("Statement file deleted")
                    }}
                  >
                    Delete file
                  </Btn>
                )}
                {(draft || i.status === "failed") && (
                  <Btn
                    variant="ghost"
                    className="h-9"
                    onClick={() => {
                      deleteImport(i.id)
                      undoToast("Import discarded", () => restoreImport(i))
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Btn>
                )}
              </div>
            </Card>
          )
        })}
      </div>
    </Screen>
  )
}
