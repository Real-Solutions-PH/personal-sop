"use client"

import { CalendarPlus, Pencil, Plus } from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import {
  Btn,
  Card,
  Empty,
  Money,
  Row,
  Screen,
  SectionTitle,
  Segmented,
  Stat,
} from "../../ui/kit"
import { skipOccurrence, unskipOccurrence, updatePlanned } from "../actions"
import {
  acctMap,
  addDays,
  catMap,
  dayLabel,
  monthlyEq,
  occurrencesIn,
  scheduleLabel,
  shortDate,
  today,
} from "../calc"
import type { PlannedItem } from "../data"
import { openSheet } from "../sheets"
import { useFin } from "../store"
import { CatIcon, LoadingList, Pill, undoToast, useDemoState } from "../ui"

function PlannedIcon({ p }: { p: PlannedItem }) {
  const s = useFin()
  if (p.type === "transfer")
    return (
      <span className="grid size-10 place-items-center rounded-full bg-muted text-lg">
        ⇄
      </span>
    )
  return <CatIcon cat={s.categories.find((c) => c.id === p.categoryId)} />
}

const signed = (p: PlannedItem) =>
  p.type === "income" ? p.amount : p.type === "expense" ? -p.amount : p.amount

// ------------------------------------------------------------------ FIN-19

export function PlannedScreen() {
  const s = useFin()
  const demo = useDemoState()
  const [tab, setTab] = useState<"recurring" | "once" | "whatif">("recurring")
  const live = s.planned.filter((p) => !p.archived)
  const totals = useMemo(() => {
    let inflow = 0
    let out = 0
    for (const p of live) {
      if (p.isWhatIf) continue
      const m = monthlyEq(p)
      if (p.type === "income") inflow += m
      else if (
        p.type === "expense" ||
        p.isInstallment ||
        p.toAccountId === "col"
      )
        out += m
    }
    return { inflow, out }
  }, [live])
  const upcoming = useMemo(() => {
    const t = today()
    return occurrencesIn(s, t, addDays(t, 30)).filter(
      (o) => o.status !== "paid" && o.status !== "skipped",
    )
  }, [s])
  const list = live.filter((p) =>
    tab === "whatif"
      ? p.isWhatIf
      : tab === "once"
        ? !p.isWhatIf && p.schedule.kind === "once"
        : !p.isWhatIf && p.schedule.kind !== "once",
  )
  const add = (
    <button
      type="button"
      aria-label="Add scheduled payment"
      onClick={() =>
        openSheet({
          kind: "planned",
          prefill:
            tab === "whatif"
              ? {
                  isWhatIf: true,
                  schedule: { kind: "once", date: addDays(today(), 60) },
                }
              : undefined,
        })
      }
      className="grid size-10 place-items-center rounded-full hover:bg-muted"
    >
      <Plus className="size-5" />
    </button>
  )
  if (demo === "loading")
    return (
      <Screen title="Scheduled" back actions={add}>
        <LoadingList />
      </Screen>
    )
  if (demo === "empty" || live.length === 0)
    return (
      <Screen title="Scheduled" back actions={add}>
        <Empty
          icon={<CalendarPlus className="size-10" />}
          title="Add salary and bills to unlock your projection"
          body="Semi-monthly paydays (15th & 30th), rent, Meralco, subscriptions, card installments."
          action={
            <Btn
              accent="fin"
              onClick={() =>
                openSheet({
                  kind: "planned",
                  prefill: {
                    type: "income",
                    name: "Salary",
                    schedule: { kind: "semimonthly", days: [15, 30] },
                  },
                })
              }
            >
              Add salary
            </Btn>
          }
        />
      </Screen>
    )
  const cats = catMap(s)
  return (
    <Screen title="Scheduled" back actions={add}>
      <Card className="grid grid-cols-3 gap-2">
        <Stat
          label="In / month"
          value={<Money value={totals.inflow} className="text-good" />}
        />
        <Stat label="Out / month" value={<Money value={totals.out} />} />
        <Stat
          label="Net / month"
          value={<Money value={totals.inflow - totals.out} />}
          accent="fin"
        />
      </Card>

      <SectionTitle
        action={
          <Link href="/finance/projection" className="text-fin text-xs">
            Projection
          </Link>
        }
      >
        Next 30 days
      </SectionTitle>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {upcoming.slice(0, 14).map((o) => (
          <button
            key={`${o.item.id}-${o.orig}`}
            type="button"
            onClick={() =>
              openSheet({ kind: "due", plannedId: o.item.id, day: o.orig })
            }
            className={cn(
              "w-32 shrink-0 rounded-2xl border bg-card p-3 text-left",
              o.status === "overdue"
                ? "border-bad/50"
                : o.status === "due"
                  ? "border-warn/50"
                  : "border-border/60",
            )}
          >
            <div className="text-muted-foreground text-[11px]">
              {dayLabel(o.day)}
            </div>
            <div className="mt-1 truncate font-medium text-sm">
              {o.item.name}
            </div>
            <Money
              value={signed(o.item)}
              signed={o.item.type !== "transfer"}
              className="text-sm"
            />
            {o.status === "overdue" && (
              <Pill tone="bad" className="mt-1">
                overdue
              </Pill>
            )}
          </button>
        ))}
      </div>

      <div className="mt-5">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "recurring", label: "Recurring" },
            { value: "once", label: "One-off" },
            { value: "whatif", label: "What-if drafts" },
          ]}
        />
      </div>
      <Card className="mt-3 px-3 py-1">
        {list.length === 0 && (
          <div className="py-6 text-center text-muted-foreground text-sm">
            {tab === "whatif" ? (
              <>
                No drafts. Try one from the{" "}
                <Link href="/finance/projection?whatif=1" className="text-fin">
                  projection
                </Link>
                .
              </>
            ) : (
              "Nothing here yet."
            )}
          </div>
        )}
        {list.map((p) => (
          <Row
            key={p.id}
            href={`/finance/planned/${p.id}`}
            icon={<PlannedIcon p={p} />}
            title={
              <span className="flex items-center gap-1.5">
                {p.name}
                {p.isInstallment && <Pill>installment</Pill>}
                {p.autoLog && <Pill tone="fin">auto</Pill>}
              </span>
            }
            subtitle={`${scheduleLabel(p)}${p.type !== "transfer" ? ` · ${cats.get(p.categoryId ?? "")?.name ?? ""}` : ""}`}
            right={
              <div>
                <Money
                  value={signed(p)}
                  signed={p.type !== "transfer"}
                  className="font-semibold"
                />
                {p.estimated && (
                  <div className="text-[10px] text-muted-foreground">
                    estimate
                  </div>
                )}
              </div>
            }
          />
        ))}
      </Card>
    </Screen>
  )
}

// ------------------------------------------------------------------ FIN-20

export function PlannedDetail() {
  const { id } = useParams<{ id: string }>()
  const s = useFin()
  const p = s.planned.find((x) => x.id === id)
  const d = useMemo(() => {
    if (!p) return null
    const t = today()
    const history = occurrencesIn(s, p.start, t, { includeWhatIf: true })
      .filter((o) => o.item.id === p.id)
      .reverse()
    const next = occurrencesIn(s, addDays(t, -14), addDays(t, 400), {
      includeWhatIf: true,
    })
      .filter(
        (o) =>
          o.item.id === p.id && o.status !== "paid" && o.status !== "skipped",
      )
      .slice(0, 5)
    const recs = new Map(s.records.map((r) => [r.id, r]))
    const paid = history
      .filter((o) => o.recordId)
      .map((o) => recs.get(o.recordId as string)?.amount ?? 0)
    const avg = paid.length ? paid.reduce((a, b) => a + b, 0) / paid.length : 0
    const accuracy = paid.length
      ? 1 -
        paid.reduce((x, a) => x + Math.abs(a - p.amount), 0) /
          paid.length /
          p.amount
      : null
    return { history, next, recs, avg, accuracy, paidCount: paid.length }
  }, [s, p])
  const accts = useMemo(() => acctMap(s), [s])
  const cats = useMemo(() => catMap(s), [s])
  if (!p || !d)
    return (
      <Screen title="Scheduled payment" back="/finance/planned">
        <Empty
          title="Not found"
          action={<Btn href="/finance/planned">All planned</Btn>}
        />
      </Screen>
    )
  const nextOcc = d.next[0]
  return (
    <Screen
      title={p.name}
      back
      actions={
        <button
          type="button"
          aria-label="Edit"
          onClick={() => openSheet({ kind: "planned", id: p.id })}
          className="grid size-10 place-items-center rounded-full hover:bg-muted"
        >
          <Pencil className="size-5" />
        </button>
      }
    >
      <div className="flex items-center gap-3 py-2">
        <PlannedIcon p={p} />
        <div className="flex-1">
          <Money
            value={signed(p)}
            signed={p.type !== "transfer"}
            className="font-semibold text-3xl"
          />
          <div className="text-muted-foreground text-xs">
            {p.estimated ? "Estimated · " : ""}
            {scheduleLabel(p)}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Pill>
          {p.type === "transfer"
            ? `${accts.get(p.accountId)?.name} → ${accts.get(p.toAccountId ?? "")?.name}`
            : `${accts.get(p.accountId)?.name} · ${cats.get(p.categoryId ?? "")?.name}`}
        </Pill>
        <Pill tone={p.autoLog ? "fin" : "muted"}>
          {p.autoLog ? "Auto-logs" : "Asks Paid / Skip"}
        </Pill>
        {p.isInstallment && <Pill tone="warn">0% installment</Pill>}
        {p.isWhatIf && <Pill tone="warn">what-if draft</Pill>}
        {!p.inProjection && !p.isWhatIf && <Pill>not in projection</Pill>}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Btn
          accent="fin"
          disabled={!nextOcc || p.isWhatIf}
          onClick={() =>
            nextOcc &&
            openSheet({ kind: "due", plannedId: p.id, day: nextOcc.orig })
          }
        >
          {p.type === "income" ? "Received now" : "Pay now"}
        </Btn>
        <Btn
          variant="secondary"
          disabled={!nextOcc}
          onClick={() => {
            if (!nextOcc) return
            skipOccurrence(p.id, nextOcc.orig)
            undoToast(`Skipped ${shortDate(nextOcc.orig)}`, () =>
              unskipOccurrence(p.id, nextOcc.orig),
            )
          }}
        >
          Skip next
        </Btn>
        {p.isWhatIf ? (
          <Btn
            variant="secondary"
            onClick={() => {
              updatePlanned(p.id, { isWhatIf: false, inProjection: true })
              toast(`${p.name} is now part of your plan`)
            }}
          >
            Make it real
          </Btn>
        ) : (
          <Btn
            variant="secondary"
            onClick={() => {
              const prev = p.end
              updatePlanned(p.id, { end: { kind: "date", date: today() } })
              undoToast(`${p.name} ends today`, () =>
                updatePlanned(p.id, { end: prev }),
              )
            }}
          >
            End it
          </Btn>
        )}
        <Btn
          variant="danger"
          onClick={() => {
            updatePlanned(p.id, { archived: true })
            undoToast(`${p.name} archived`, () =>
              updatePlanned(p.id, { archived: false }),
            )
          }}
        >
          Archive
        </Btn>
      </div>

      {d.paidCount > 0 && (
        <Card className="mt-4 grid grid-cols-3 gap-2">
          <Stat label="Times paid" value={d.paidCount} />
          <Stat label="Avg actual" value={<Money value={d.avg} />} />
          <Stat
            label="Plan accuracy"
            value={
              d.accuracy === null
                ? "—"
                : `${Math.max(0, Math.round(d.accuracy * 100))}%`
            }
            accent="fin"
          />
        </Card>
      )}

      <SectionTitle>Next dates</SectionTitle>
      <Card className="px-3 py-1">
        {d.next.length === 0 && (
          <div className="py-4 text-center text-muted-foreground text-sm">
            No more upcoming dates.
          </div>
        )}
        {d.next.map((o) => (
          <div
            key={o.orig}
            className="flex items-center justify-between py-2.5 text-sm"
          >
            <span>
              {dayLabel(o.day)}
              {o.day !== o.orig && (
                <span className="text-muted-foreground text-xs">
                  {" "}
                  (snoozed from {shortDate(o.orig)})
                </span>
              )}
            </span>
            {o.status === "overdue" ? (
              <Pill tone="bad">overdue</Pill>
            ) : o.status === "due" ? (
              <Pill tone="warn">due</Pill>
            ) : (
              <span className="text-muted-foreground text-xs">upcoming</span>
            )}
          </div>
        ))}
      </Card>

      <SectionTitle>History</SectionTitle>
      <Card className="px-3 py-1">
        {d.history.filter((o) => o.status !== "upcoming" && o.status !== "due")
          .length === 0 && (
          <div className="py-4 text-center text-muted-foreground text-sm">
            No history yet.
          </div>
        )}
        {d.history
          .filter((o) => o.status !== "upcoming" && o.status !== "due")
          .map((o) => {
            const r = o.recordId ? d.recs.get(o.recordId) : undefined
            const variance = r ? r.amount - p.amount : 0
            return (
              <Link
                key={o.orig}
                href={r ? `/finance/records/${r.id}` : "#"}
                className="flex items-center justify-between py-2.5 text-sm"
              >
                <span>{shortDate(o.orig)}</span>
                <span className="flex items-center gap-2">
                  {r ? (
                    <>
                      <Money value={r.amount} />
                      {variance !== 0 && (
                        <span
                          className={cn(
                            "num text-xs",
                            variance > 0 === (p.type === "income")
                              ? "text-good"
                              : "text-bad",
                          )}
                        >
                          {variance > 0 ? "+" : "−"}
                          {Math.abs(Math.round((variance / p.amount) * 100))}%
                        </span>
                      )}
                      <Pill tone="good">
                        {p.type === "income" ? "received" : "paid"}
                      </Pill>
                    </>
                  ) : o.status === "skipped" ? (
                    <Pill>skipped</Pill>
                  ) : (
                    <Pill tone="bad">missed</Pill>
                  )}
                </span>
              </Link>
            )
          })}
      </Card>
    </Screen>
  )
}
