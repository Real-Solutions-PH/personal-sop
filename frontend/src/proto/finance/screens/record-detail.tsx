"use client"

import { Copy, Pencil, Receipt, RotateCcw, Trash2 } from "lucide-react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { type ReactNode, useMemo } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Btn, Card, Empty, Money, Screen } from "../../ui/kit"
import { confirmRecord, duplicateRecord, updateRecord } from "../actions"
import { acctMap, catMap, dayLabel, recDay, timeOf } from "../calc"
import { confirmDeleteRecords, openSheet } from "../sheets"
import { useFin } from "../store"
import { AcctIcon, CatIcon, Pill, sourceLabel } from "../ui"

export function RecordDetail() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const s = useFin()
  const r = s.records.find((x) => x.id === id)
  const cats = useMemo(() => catMap(s), [s])
  const accts = useMemo(() => acctMap(s), [s])
  if (!r)
    return (
      <Screen title="Transaction" back="/finance/records">
        <Empty
          title="Transaction not found"
          body="It may have been deleted or undone by an import undo."
          action={<Btn href="/finance/records">All transactions</Btn>}
        />
      </Screen>
    )
  const cat = cats.get(r.categoryId ?? "")
  const parent = cat?.parentId ? cats.get(cat.parentId) : undefined
  const acct = accts.get(r.accountId)
  const to = r.toAccountId ? accts.get(r.toAccountId) : undefined
  const planned = r.plannedId
    ? s.planned.find((p) => p.id === r.plannedId)
    : undefined
  const imp = r.importId
    ? s.imports.find((i) => i.id === r.importId)
    : undefined
  const fee = s.records.find((x) => x.feeOf === r.id)
  const value =
    r.type === "income" ? r.amount : r.type === "expense" ? -r.amount : r.amount

  const rows: [string, ReactNode][] = [
    [
      "Type",
      <span key="t" className="capitalize">
        {r.isRefund ? "Refund (income)" : r.type}
      </span>,
    ],
    [
      r.type === "transfer" ? "From" : "Account",
      <span key="a" className="flex items-center gap-2">
        <AcctIcon acct={acct} size="sm" /> {acct?.name}
      </span>,
    ],
    ...(to
      ? ([
          [
            "To",
            <span key="to" className="flex items-center gap-2">
              <AcctIcon acct={to} size="sm" /> {to.name}
            </span>,
          ],
        ] as [string, ReactNode][])
      : []),
    ...(r.type !== "transfer"
      ? ([
          [
            "Category",
            <span key="c">
              {parent ? `${parent.name} › ` : ""}
              {cat?.name ?? "Uncategorised"}
            </span>,
          ],
        ] as [string, ReactNode][])
      : []),
    ["When", `${dayLabel(recDay(r))} · ${timeOf(r.at)}`],
    ["Payee", r.payee ?? "—"],
    ["Note", r.note ?? "—"],
    ["Logged via", sourceLabel(r.source)],
  ]

  return (
    <Screen
      title="Transaction"
      back
      actions={
        <button
          type="button"
          aria-label="Edit"
          onClick={() => openSheet({ kind: "record", id: r.id })}
          className="grid size-10 place-items-center rounded-full hover:bg-muted"
        >
          <Pencil className="size-5" />
        </button>
      }
    >
      <div className="flex flex-col items-center py-4 text-center">
        {r.type === "transfer" ? (
          <span className="grid size-14 place-items-center rounded-full bg-muted text-2xl">
            ⇄
          </span>
        ) : (
          <div className="scale-125">
            <CatIcon cat={cat} />
          </div>
        )}
        <div className="mt-3 font-medium">
          {r.payee ?? cat?.name ?? "Transfer"}
        </div>
        <Money
          value={value}
          signed={r.type !== "transfer"}
          className={cn(
            "font-semibold text-4xl tracking-tight",
            r.type === "expense" && "text-foreground",
          )}
        />
        <div className="mt-2 flex gap-1.5">
          {r.status === "pending" && <Pill tone="warn">needs review</Pill>}
          {r.isRefund && <Pill tone="good">refund</Pill>}
          {r.isAdjustment && <Pill>excluded from spend</Pill>}
          {r.type === "transfer" && <Pill>not spending</Pill>}
        </div>
      </div>

      {r.status === "pending" && (
        <Card className="mb-3 border-warn/40 bg-warn/5">
          <div className="text-sm">AI wasn't sure about this one. {r.note}</div>
          <div className="mt-3 flex gap-2">
            <Btn accent="fin" onClick={() => confirmRecord(r.id)}>
              Looks right
            </Btn>
            <Btn
              variant="secondary"
              onClick={() => openSheet({ kind: "record", id: r.id })}
            >
              Fix it
            </Btn>
          </div>
        </Card>
      )}

      <Card className="divide-y divide-border/60 py-1">
        {rows.map(([k, v]) => (
          <div
            key={k}
            className="flex items-center justify-between gap-4 py-2.5 text-sm"
          >
            <span className="text-muted-foreground">{k}</span>
            <span className="min-w-0 truncate text-right">{v}</span>
          </div>
        ))}
      </Card>

      {(r.receipt || planned || imp || fee || r.editedAt) && (
        <Card className="mt-3 space-y-2 text-sm">
          {r.receipt && (
            <div className="flex items-center gap-3">
              <div className="grid h-16 w-12 place-items-center rounded-md bg-[#f7f3e8] text-neutral-500">
                <Receipt className="size-5" />
              </div>
              <div className="flex-1">
                <div className="font-medium">Receipt</div>
                <button
                  type="button"
                  className="text-fin text-xs"
                  onClick={() => toast("Opening receipt image (mock)")}
                >
                  View image
                </button>
              </div>
            </div>
          )}
          {planned && (
            <Link
              href={`/finance/planned/${planned.id}`}
              className="flex justify-between"
            >
              <span className="text-muted-foreground">Planned item</span>
              <span className="text-fin">{planned.name} ›</span>
            </Link>
          )}
          {imp && (
            <Link href={`/finance/imports`} className="flex justify-between">
              <span className="text-muted-foreground">
                Matched from statement import
              </span>
              <span className="text-fin">{imp.fileName.slice(0, 22)}… ›</span>
            </Link>
          )}
          {fee && (
            <Link
              href={`/finance/records/${fee.id}`}
              className="flex justify-between"
            >
              <span className="text-muted-foreground">Transfer fee</span>
              <Money value={fee.amount} className="text-fin" />
            </Link>
          )}
          {r.editedAt && (
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Last change</span>
              <span>
                {new Date(r.editedAt).toLocaleString("en-PH", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </span>
            </div>
          )}
        </Card>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Btn
          variant="secondary"
          onClick={() => openSheet({ kind: "record", id: r.id })}
        >
          <Pencil className="size-4" /> Edit
        </Btn>
        <Btn
          variant="secondary"
          onClick={() => {
            const d = duplicateRecord(r.id)
            if (d) {
              toast("Duplicated to now")
              router.push(`/finance/records/${d.id}`)
            }
          }}
        >
          <Copy className="size-4" /> Duplicate
        </Btn>
        {r.type === "income" && (
          <Btn
            variant="secondary"
            onClick={() => {
              updateRecord(r.id, {
                isRefund: !r.isRefund,
                categoryId: r.isRefund ? "other-in" : "shopping",
              })
              toast(
                r.isRefund
                  ? "No longer a refund"
                  : "Marked as refund — nets against Shopping",
              )
            }}
          >
            <RotateCcw className="size-4" />{" "}
            {r.isRefund ? "Not a refund" : "Mark refund"}
          </Btn>
        )}
        <Btn
          variant="danger"
          onClick={() => confirmDeleteRecords([r.id], () => router.back())}
        >
          <Trash2 className="size-4" /> Delete
        </Btn>
      </div>
    </Screen>
  )
}
