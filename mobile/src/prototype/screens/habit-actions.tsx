import { dashStore } from "@domain/dash/store"
import * as A from "@domain/habits/actions"
import type { Habit } from "@domain/habits/data"
import * as L from "@domain/habits/logic"
import { habitsStore } from "@domain/habits/store"
import { dayKey } from "@domain/lib/day"
import { useEffect, useRef, useState } from "react"
import { go } from "../navigation"
import { Button, confirm, Sheet, undo } from "../ui"
import { HabitLog } from "./habits"

/** Everything a habit row can do beyond its tap: edit first, then log,
 * details, pause or resume, archive. Opened by a long press on the row. */
export function HabitActions({
  habit,
  open,
  onClose,
  day = dayKey(),
}: {
  habit: Habit
  open: boolean
  onClose: () => void
  day?: string
}) {
  const live = habitsStore.use((s) => s.habits.find((h) => h.id === habit.id))
  const screenOn = dashStore.use((s) => s.enabled.screen)
  const gone = !live || live.status === "archived"
  // What a button does runs once this sheet has fully left: iOS drops a
  // navigation, an alert or a second sheet while the first is leaving.
  const after = useRef<(() => void) | null>(null)
  const [logging, setLogging] = useState(false)
  const h = live ?? habit
  const paused = L.effectiveStatus(h) === "paused"
  // Logged by hand unless screen time drives it (a rule, Screen time on).
  const auto = !!h.rule && screenOn
  useEffect(() => {
    // Archived or deleted elsewhere while the sheet was open.
    if (open && gone) onClose()
  }, [open, gone, onClose])
  const close = (then: () => void) => {
    after.current = then
    onClose()
  }
  return (
    <>
      <Sheet
        title={`${h.icon} ${h.name}`}
        open={open && !gone}
        onClose={onClose}
        onClosed={() => {
          const then = after.current
          after.current = null
          then?.()
        }}
      >
        <Button onPress={() => close(() => go(`/habits/${h.id}/edit`))}>
          Edit habit
        </Button>
        {!auto && (
          <Button tone="quiet" onPress={() => close(() => setLogging(true))}>
            Log…
          </Button>
        )}
        <Button tone="quiet" onPress={() => close(() => go(`/habits/${h.id}`))}>
          Open details
        </Button>
        <Button
          tone="quiet"
          onPress={() =>
            close(() => {
              if (paused) A.resumeHabit(h.id)
              else go(`/habits/${h.id}?pause=1`)
            })
          }
        >
          {paused ? "Resume now" : "Pause…"}
        </Button>
        <Button
          tone="danger"
          onPress={() =>
            close(() =>
              confirm(
                `Archive ${h.name}?`,
                "History and stats are kept, and you can restore it from Archived.",
                () => {
                  A.archiveHabit(h.id)
                  undo("Habit archived", () => A.restoreHabit(h.id))
                },
              ),
            )
          }
        >
          Archive
        </Button>
      </Sheet>
      {logging && (
        <HabitLog
          habit={h}
          day={day}
          open={logging}
          onClose={() => setLogging(false)}
        />
      )}
    </>
  )
}
