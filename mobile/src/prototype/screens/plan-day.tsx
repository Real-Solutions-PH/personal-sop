// What a row of the Plan day can do in place: a habit or a task ticks off
// with Today's feedback (the animated check, the row's flash, the tick toast
// with Undo; a count habit steps by one), and a bill or payday is marked
// paid or skipped where it is listed, with an Undo beside it and no toast.

import type { CalendarItem } from "@domain/contract"
import type { Occurrence } from "@domain/finance/calc"
import { habitsStore } from "@domain/habits/store"
import {
  stepItem,
  tickItem,
  tickOf,
  tickProgress,
  untickItem,
} from "@domain/schedule/ticks"
import { tasksStore } from "@domain/tasks/store"
import { Check, Minus, Plus, Undo2 } from "lucide-react-native"
import { type ReactNode, useState } from "react"
import { View } from "react-native"
import { AnimatedCheck, feel, markCompletion } from "../motion"
import { border, Copy, IconTap, Line, SmallButton, Tap } from "../native-kit"
import { useTheme } from "../theme"
import { undo } from "../ui"

/** A title without the leading emoji, for what a screen reader says. */
export const spoken = (title: string) =>
  title
    .replace(/^(?:\p{Extended_Pictographic}|\u{FE0F}|\u{200D}|\s)+/u, "")
    .trim()

/**
 * The check for a habit or task row, and a count habit's +step: nothing for
 * a row that has nothing to tick (a routine, a bill, a habit on a day still
 * to come).
 */
export function PlanCheck({
  item,
  color,
  size = 28,
  children,
}: {
  item: CalendarItem
  color: string
  size?: number
  /** Places the check and the +step apart (a row with its check on the
   * left keeps the step at its right end); by default the step sits just
   * before the check. */
  children?: (check: ReactNode, step: ReactNode) => ReactNode
}) {
  const t = useTheme()
  // Re-read on any log or task change, so the ring follows a step.
  habitsStore.use((s) => s.logs)
  tasksStore.use((s) => s.tasks)
  const habits = habitsStore.use((s) => s.habits)
  const [stepped, setStepped] = useState(0)
  const tick = tickOf(item)
  if (!tick) return children ? children(null, null) : null
  const progress = tickProgress(item),
    done = Boolean(item.done) || progress >= 1,
    name = spoken(item.title)
  const habit =
    tick.kind === "habit" ? habits.find((h) => h.id === tick.habitId) : null
  const toggle = () => {
    if (done) {
      untickItem(item)
      return
    }
    const r = tickItem(item)
    if (r) undo(r.message, r.undo)
  }
  const step = () => {
    const r = stepItem(item)
    if (!r) return
    if (!r.completed) {
      feel.tap()
      return
    }
    // The step that reaches the target completes it, as a tick would.
    markCompletion()
    setStepped((n) => n + 1)
    undo(r.message, r.undo)
  }
  const stepButton = habit?.type === "count" && !done && (
    <Tap
      label={`Add ${habit.step ?? 1} ${habit.unit ?? ""}`.trim()}
      onPress={step}
      style={{
        minWidth: 36,
        height: 32,
        paddingHorizontal: 6,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: t.input,
        backgroundColor: t.card,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Copy size={12} weight="semibold">
        +{habit.step ?? 1}
      </Copy>
    </Tap>
  )
  const check = (
    <AnimatedCheck
      checked={done}
      onToggle={toggle}
      label={`${done ? "Reopen" : "Complete"} ${name}`}
      color={color}
      idle={border(t.muted, 0.3)}
      size={size}
      checkColor={t.onPrimary}
      progress={progress}
      celebrate={stepped}
    />
  )
  if (children) return children(check, stepButton || null)
  return (
    <Line style={{ gap: 4 }}>
      {stepButton}
      {check}
    </Line>
  )
}

const OCC_LABEL = {
  paid: "Paid",
  overdue: "Overdue",
  due: "Due",
  upcoming: "Scheduled",
  skipped: "Skipped",
} as const

/**
 * A bill, payday or transfer on the day: its name, state and that date's
 * own amount, with Skip and Paid (Got it, for income) while open. Just
 * settled or skipped here, an Undo sits where the buttons were.
 */
export function BillRow({
  occ,
  icon,
  amount,
  acted,
  onOpen,
  onPay,
  onSkip,
  onUndo,
}: {
  occ: Occurrence
  icon?: string
  /** That date's amount, formatted with its sign. */
  amount: string
  /** Paid or skipped from this screen just now: Undo is offered. */
  acted: boolean
  onOpen: () => void
  onPay: () => void
  onSkip: () => void
  onUndo: () => void
}) {
  const t = useTheme()
  const { item, status } = occ
  const settled = status === "paid" || status === "skipped"
  const Mark = item.type === "income" ? Plus : Minus
  return (
    <Line style={{ gap: 8, minHeight: 44 }}>
      <Tap
        onPress={onOpen}
        label={`${item.name}, ${OCC_LABEL[status]}, ${amount}`}
        style={{ flex: 1, paddingVertical: 8 }}
      >
        <Line style={{ gap: 8, alignItems: "flex-start" }}>
          <View style={{ width: 20, alignItems: "center", marginTop: 1 }}>
            {icon ? (
              <Copy size={14}>{icon}</Copy>
            ) : (
              <Mark size={14} strokeWidth={3} color={t.muted} />
            )}
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Copy
              size={14}
              style={{
                color: settled ? t.muted : t.text,
                textDecorationLine: settled ? "line-through" : "none",
              }}
            >
              {item.name}
            </Copy>
            <Copy
              size={12}
              muted={status !== "overdue"}
              style={{
                color:
                  status === "overdue"
                    ? t.bad
                    : item.type === "income" && !settled
                      ? t.good
                      : undefined,
                fontVariant: ["tabular-nums"],
              }}
            >
              {`${OCC_LABEL[status]} · ${amount}`}
            </Copy>
          </View>
        </Line>
      </Tap>
      {settled ? (
        acted ? (
          <IconTap
            icon={Undo2}
            size={36}
            label={`Undo ${status === "paid" ? "paid" : "skip"} of ${item.name}`}
            color={t.muted}
            background={t.soft}
            onPress={onUndo}
          />
        ) : (
          status === "paid" && <Check size={16} color={t.good} />
        )
      ) : (
        <>
          <SmallButton small quiet label={`Skip ${item.name}`} onPress={onSkip}>
            Skip
          </SmallButton>
          <SmallButton
            small
            label={`Mark ${item.name} ${item.type === "income" ? "received" : "paid"}`}
            onPress={onPay}
          >
            {item.type === "income" ? "Got it" : "Paid"}
          </SmallButton>
        </>
      )}
    </Line>
  )
}
