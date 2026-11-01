// Log a focus session the timer never saw, or edit one logged before.
// Job: "I forgot to start the timer, so I put the block in afterwards and
// my day's focus and goal are right." The form asks only what fixes the
// block in time: what kind, the day, when it started and when it ended (a
// Pomodoro block ends after its sets, shown as it is typed). The label is
// optional. A refusal (future, end before start, an overlap) is said under
// the field it is about; Save stays where the thumb is.

import { PRESETS, type PresetKey } from "@domain/focus/data"
import * as L from "@domain/focus/logic"
import * as P from "@domain/focus/past"
import { useFocusState } from "@domain/focus/store"
import { AlertCircle, Clock, Trash2 } from "lucide-react-native"
import { useEffect, useState } from "react"
import { View } from "react-native"
import { Stepper } from "../fitness-controls"
import { Copy, Line, Segmented } from "../native-kit"
import { useTheme } from "../theme"
import { TimeInput } from "../time-input"
import { Button, DateField, Field, Sheet, undo } from "../ui"

const pad = (n: number) => String(n).padStart(2, "0")
const dateOf = (t: number) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const timeOf = (t: number) => {
  const d = new Date(t)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
/** A local date and "HH:mm" as epoch ms; NaN when either is unreadable. */
const at = (date: string, time: string) =>
  new Date(`${date}T${time.length === 5 ? time : "x"}:00`).getTime()
const clock = (t: number) =>
  new Date(t).toLocaleTimeString("en-PH", {
    hour: "numeric",
    minute: "2-digit",
  })

interface Draft {
  kind: P.PastKind
  date: string
  start: string
  end: string
  count: number
  preset: PresetKey
  label: string
}

function draftOf(input: P.PastInput | null, day?: string): Draft {
  if (input) {
    const end = P.pastWindow(input).end
    return {
      kind: input.kind,
      date: dateOf(input.start),
      start: timeOf(input.start),
      end: timeOf(end),
      count: input.count ?? 1,
      preset: input.preset ?? "25-5",
      label: input.label ?? "",
    }
  }
  // A fresh block: the last hour, on the day being looked at.
  const now = Date.now()
  const today = dateOf(now)
  const date = day && day < today ? day : today
  const endAt = date === today ? now : at(date, "10:00")
  return {
    kind: "focus",
    date,
    start: timeOf(endAt - 60 * 60_000),
    end: timeOf(endAt),
    count: 2,
    preset: "25-5",
    label: "",
  }
}

function inputOf(d: Draft): P.PastInput {
  const start = at(d.date, d.start)
  const label = d.label.trim()
  return d.kind === "focus"
    ? {
        kind: "focus",
        start,
        end: at(d.date, d.end),
        ...(label ? { label } : {}),
      }
    : {
        kind: "pomodoro",
        start,
        count: d.count,
        preset: d.preset,
        ...(label ? { label } : {}),
      }
}

export function PastSessionSheet({
  open,
  onClose,
  day,
  editId,
}: {
  open: boolean
  onClose: () => void
  /** The day the screen shows: a new block defaults to it. */
  day?: string
  /** A logged session to edit. */
  editId?: string
}) {
  const t = useTheme()
  const s = useFocusState()
  const [d, setD] = useState<Draft>(() =>
    draftOf(editId ? P.pastInputOf(s, editId) : null, day),
  )
  const [tried, setTried] = useState(false)
  // Each opening starts from the session (or a fresh hour), not leftovers.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on open
  useEffect(() => {
    if (!open) return
    setD(draftOf(editId ? P.pastInputOf(s, editId) : null, day))
    setTried(false)
  }, [open, editId])
  const input = inputOf(d)
  const unreadable =
    Number.isNaN(input.start) ||
    (input.kind === "focus" && Number.isNaN(input.end ?? Number.NaN))
  const errors: P.PastErrors = unreadable
    ? { start: "Enter a time like 09:30" }
    : P.pastErrors(s, input, Date.now(), editId)
  const w = unreadable ? null : P.pastWindow(input)
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }))
  const save = () => {
    setTried(true)
    if (unreadable || !P.pastOk(errors)) return
    if (P.savePastSession(input, editId)) onClose()
  }
  const remove = () => {
    if (!editId) return
    const taken = P.takeSession(editId)
    onClose()
    if (taken) undo("Focus session deleted", () => P.putBackSession(taken))
  }
  // Errors show once something was tried, or as soon as a time is set in
  // the future (that one is never a typo in progress).
  const show = (e?: string) => (tried || e?.includes("future") ? e : undefined)
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={editId ? "Edit logged session" : "Log a past session"}
    >
      <View style={{ gap: 4 }}>
        <Segmented
          value={d.kind}
          onChange={(kind) => set({ kind })}
          options={[
            { value: "focus", label: "Focus block" },
            { value: "pomodoro", label: "Pomodoros" },
          ]}
        />
        <Line style={{ alignItems: "flex-start", gap: 10, marginTop: 4 }}>
          <View style={{ flex: 1.2 }}>
            <DateField
              label="Day"
              value={d.date}
              onChangeText={(date) => set({ date })}
            />
          </View>
          <View style={{ flex: 1, gap: 6, marginVertical: 8 }}>
            <Copy size={12} muted weight="medium">
              Started
            </Copy>
            <TimeInput
              label="Started"
              value={d.start}
              onChange={(start) => set({ start })}
              field
            />
          </View>
          {d.kind === "focus" && (
            <View style={{ flex: 1, gap: 6, marginVertical: 8 }}>
              <Copy size={12} muted weight="medium">
                Ended
              </Copy>
              <TimeInput
                label="Ended"
                value={d.end}
                onChange={(end) => set({ end })}
                field
              />
            </View>
          )}
        </Line>
        {d.kind === "pomodoro" && (
          <View style={{ gap: 10 }}>
            <Segmented
              value={d.preset}
              onChange={(preset) => set({ preset })}
              options={(Object.keys(PRESETS) as PresetKey[]).map((k) => ({
                value: k,
                label: `${PRESETS[k].lengths[0]} / ${PRESETS[k].lengths[1]}`,
              }))}
            />
            <Stepper
              label="Pomodoros"
              value={d.count}
              onChange={(count) => set({ count })}
              step={1}
              min={1}
              max={P.MAX_SETS}
              decimals={0}
            />
          </View>
        )}
        {w && w.end > w.start && (
          <Line style={{ gap: 6, marginTop: 6 }}>
            <Clock size={14} color={t.foc} />
            <Copy size={14}>
              {clock(w.start)}–{clock(w.end)} ·{" "}
              {L.fmtHm(
                d.kind === "pomodoro"
                  ? d.count * PRESETS[d.preset].lengths[0] * 60
                  : (w.end - w.start) / 1000,
              )}{" "}
              focus
            </Copy>
          </Line>
        )}
        {[
          show(errors.start),
          show(errors.end),
          show(errors.count),
          show(errors.overlap),
        ]
          .filter(Boolean)
          .map((e) => (
            <Line
              key={e}
              style={{ gap: 6, alignItems: "flex-start", marginTop: 6 }}
            >
              <AlertCircle size={14} color={t.bad} />
              <Copy size={13} style={{ color: t.bad, flex: 1 }}>
                {e}
              </Copy>
            </Line>
          ))}
        <Field
          label="What was it? (optional)"
          value={d.label}
          onChangeText={(label) => set({ label })}
          placeholder="e.g. Reading chapter 3"
          maxLength={80}
        />
        <View style={{ gap: 8, marginTop: 8 }}>
          <Button icon={Clock} onPress={save}>
            {editId ? "Save changes" : "Log session"}
          </Button>
          {editId && (
            <Button icon={Trash2} tone="danger" onPress={remove}>
              Delete session
            </Button>
          )}
        </View>
      </View>
    </Sheet>
  )
}
