import { dashStore } from "@domain/dash/store"
import * as A from "@domain/habits/actions"
import type { Habit } from "@domain/habits/data"
import * as L from "@domain/habits/logic"
import { habitsStore } from "@domain/habits/store"
import { dayKey } from "@domain/lib/day"
import {
  Archive as ArchiveIcon,
  Info,
  Pause,
  Pencil,
  PenLine,
  Play,
  Timer,
} from "lucide-react-native"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { View } from "react-native"
import { border } from "../native-kit"
import { go } from "../navigation"
import { useTheme } from "../theme"
import { Button, confirm, Sheet, undo } from "../ui"
import { HabitLog } from "./habits"

/** One group of a menu; groups after the first sit below a rule, so the
 * kinds of action read apart (docs/brand: destructive last, set apart). */
export function MenuGroup({
  children,
  divided = false,
  testID,
}: {
  children: ReactNode
  divided?: boolean
  testID?: string
}) {
  const t = useTheme()
  return (
    <View
      testID={testID}
      style={{
        gap: 8,
        ...(divided
          ? {
              marginTop: 8,
              paddingTop: 16,
              borderTopWidth: 1,
              borderColor: border(t.line, 0.6),
            }
          : {}),
      }}
    >
      {children}
    </View>
  )
}

/** Everything a habit row can do beyond its tap, grouped by meaning: today
 * (log, timer, details), then the habit itself (edit, pause or resume),
 * then Archive on its own below a rule. Opened by a long press on the row,
 * its ⋯ button or a swipe's More. */
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
  // A fresh Log sheet per opening (its fields start from the day's log),
  // kept mounted while it leaves so its own after-close step (Edit habit)
  // still runs: unmounting it on close dropped that step.
  const [logKey, setLogKey] = useState(0)
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
        {/* Grouped by meaning: today's actions on the habit first, then
            changing the habit, then archiving it, set apart below a rule. */}
        <MenuGroup testID="habit-actions-today">
          {!auto && (
            <Button
              icon={PenLine}
              onPress={() =>
                close(() => {
                  setLogKey((k) => k + 1)
                  setLogging(true)
                })
              }
            >
              Log…
            </Button>
          )}
          {!auto && h.type === "duration" && !paused && (
            <Button
              tone="quiet"
              icon={Timer}
              onPress={() => close(() => go(A.timerHref(h.id)))}
            >
              Start timer
            </Button>
          )}
          <Button
            tone="quiet"
            icon={Info}
            onPress={() => close(() => go(`/habits/${h.id}`))}
          >
            Open details
          </Button>
        </MenuGroup>
        <MenuGroup divided testID="habit-actions-edit">
          <Button
            tone="quiet"
            icon={Pencil}
            onPress={() => close(() => go(`/habits/${h.id}/edit`))}
          >
            Edit habit
          </Button>
          <Button
            tone="quiet"
            icon={paused ? Play : Pause}
            onPress={() =>
              close(() => {
                if (paused) A.resumeHabit(h.id)
                else go(`/habits/${h.id}?pause=1`)
              })
            }
          >
            {paused ? "Resume now" : "Pause…"}
          </Button>
        </MenuGroup>
        <MenuGroup divided testID="habit-actions-danger">
          <Button
            tone="danger"
            icon={ArchiveIcon}
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
        </MenuGroup>
      </Sheet>
      {logKey > 0 && (
        <HabitLog
          key={logKey}
          habit={h}
          day={day}
          open={logging}
          onClose={() => setLogging(false)}
        />
      )}
    </>
  )
}
