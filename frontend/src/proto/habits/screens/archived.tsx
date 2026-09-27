"use client"

import { Archive, RotateCcw, Trash2 } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import { Btn, Card, Empty, Screen, SectionTitle } from "../../ui/kit"
import {
  deleteHabit,
  deleteRoutine,
  restoreHabit,
  restoreRoutine,
} from "../actions"
import type { Habit } from "../data"
import { habitStats, logIndex, pct, streaks } from "../logic"
import { habitsStore } from "../store"
import { ConfirmDialog, fmtDay, Gate, HabitIcon } from "../ui"

const emptyArchive = (
  <Empty
    icon={<Archive className="size-10" />}
    title="Nothing archived"
    body="Archived habits keep their history and stats. Archive one from its detail screen."
    action={
      <Btn href="/habits/manage" accent="hab">
        Back to habits
      </Btn>
    }
  />
)

/** HAB-08 Archived habits (+ HAB-09 delete confirm). */
export function ArchivedScreen() {
  return (
    <Screen title="Archived" back>
      <Gate empty={emptyArchive}>
        <Body />
      </Gate>
    </Screen>
  )
}

function Body() {
  const state = habitsStore.use((s) => s)
  const [del, setDel] = useState<Habit | null>(null)
  const rows = useMemo(() => {
    const idx = logIndex(state.logs)
    return state.habits
      .filter((h) => h.status === "archived")
      .map((h) => ({
        h,
        logs: state.logs.filter((l) => l.habitId === h.id).length,
        rate: habitStats(h, idx, h.createdAt, h.archivedAt ?? h.createdAt).rate,
        best: streaks(h, idx).best,
      }))
  }, [state])
  const routines = state.routines.filter((r) => r.status === "archived")

  if (!rows.length && !routines.length) return emptyArchive

  return (
    <div className="space-y-3 pt-1">
      {rows.length > 0 && <SectionTitle>Habits</SectionTitle>}
      {rows.map(({ h, logs, rate, best }) => (
        <Card key={h.id}>
          <div className="flex items-center gap-3">
            <HabitIcon icon={h.icon} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{h.name}</div>
              <div className="text-muted-foreground text-xs">
                {fmtDay(h.createdAt, { month: "short", day: "numeric" })} –{" "}
                {h.archivedAt
                  ? fmtDay(h.archivedAt, { month: "short", day: "numeric" })
                  : "?"}{" "}
                · {pct(rate)} · best {best}-day streak · {logs} logs
              </div>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Btn
              variant="secondary"
              onClick={() => {
                restoreHabit(h.id)
                toast.success(`${h.name} restored`)
              }}
            >
              <RotateCcw className="size-4" /> Restore
            </Btn>
            <Btn variant="danger" onClick={() => setDel(h)}>
              <Trash2 className="size-4" /> Delete
            </Btn>
          </div>
        </Card>
      ))}
      {routines.length > 0 && <SectionTitle>Routines</SectionTitle>}
      {routines.map((r) => (
        <Card key={r.id} className="flex items-center gap-3">
          <HabitIcon icon={r.icon} />
          <div className="flex-1 truncate font-medium">{r.name}</div>
          <Btn
            variant="secondary"
            className="h-9"
            onClick={() => restoreRoutine(r.id)}
          >
            Restore
          </Btn>
          <Btn
            variant="danger"
            className="h-9 px-3"
            onClick={() => {
              deleteRoutine(r.id)
              toast(`${r.name} deleted`)
            }}
          >
            <Trash2 className="size-4" />
          </Btn>
        </Card>
      ))}
      {del && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setDel(null)}
          title={`Delete ${del.name} forever?`}
          body={`Deletes ${state.logs.filter((l) => l.habitId === del.id).length} logs and removes it from every routine. Stats and streaks are lost. This can't be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => {
            deleteHabit(del.id)
            toast(`${del.name} deleted`)
          }}
        />
      )}
    </div>
  )
}
