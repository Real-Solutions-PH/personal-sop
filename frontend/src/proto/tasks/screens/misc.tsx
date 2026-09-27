"use client"

import {
  Camera,
  Check,
  Lock,
  MessageSquareText,
  Mic,
  Settings2,
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Btn, Chip, Empty, Screen, SectionTitle } from "../../ui/kit"
import { captureTasks, completeTask, createTask, snoozeTask } from "../actions"
import { CaptureResultCard } from "../capture-card"
import type { Task, TaskSource } from "../data"
import { useTodayData } from "../hooks"
import { fmtInstant, fmtTime } from "../logic"
import { TasksPlanView } from "../plan"
import { TaskDetailBody, TaskSheets } from "../sheets"
import { tasksStore } from "../store"
import { LoadingRows, SyncError, useViewState } from "../ui"

// TSK-01 route wrapper · TSK-03 full page (push deep link) · TSK-15 notification
// preview · TSK-14 capture demo.

export function HomeScreen() {
  return (
    <Screen
      title="Tasks"
      back
      actions={
        <Link
          href="/tasks/settings"
          aria-label="Tasks settings"
          className="grid size-10 place-items-center rounded-full hover:bg-muted"
        >
          <Settings2 className="size-[18px]" />
        </Link>
      }
    >
      <TasksPlanView />
    </Screen>
  )
}

export function TaskScreen({ id }: { id: string }) {
  const state = useViewState()
  const router = useRouter()
  const task = tasksStore.use((s) => s.tasks.find((t) => t.id === id))
  return (
    <Screen back title="Task">
      <TaskSheets />
      {state === "error" && <SyncError />}
      {state === "loading" ? (
        <LoadingRows n={3} />
      ) : !task || state === "empty" ? (
        <Empty
          title="Task not found"
          body="It may have been removed on another device."
          action={<Btn href="/tasks">All tasks</Btn>}
        />
      ) : (
        <TaskDetailBody task={task} onDone={() => router.push("/tasks")} />
      )}
    </Screen>
  )
}

// ---------------------------------------------------------------- TSK-15

export function NotificationScreen() {
  const d = useTodayData()
  const digestTime = tasksStore.use((s) => s.settings.digestTime)
  const notif = tasksStore.use((s) => s.notif)
  const router = useRouter()
  const [gone, setGone] = useState<string[]>([])
  const reminders = useMemo(
    () =>
      [...d.due, ...d.upcoming.flatMap((g) => g.tasks)]
        .filter((t) => t.remindAt && !gone.includes(t.id))
        .slice(0, 3),
    [d, gone],
  )
  const actions = notif.platform !== "ios"

  return (
    <Screen back title="Notification preview">
      <p className="mb-3 text-muted-foreground text-sm">
        What the lock screen shows. Tap a ping to open the task.
        {actions ? "" : " iPhone shows no action buttons — tap opens the app."}
      </p>
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-b from-slate-800 to-slate-950 p-4 pb-8 text-white">
        <div className="flex flex-col items-center py-4">
          <Lock className="size-4 opacity-70" />
          <div className="num mt-1 font-light text-6xl">
            {fmtTime(new Date().toTimeString().slice(0, 5)).replace(
              / (AM|PM)/,
              "",
            )}
          </div>
          <div className="text-sm opacity-75">
            {new Date().toLocaleDateString("en-PH", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </div>
        </div>
        <div className="space-y-2">
          <Ping
            title="Good morning"
            body={`${d.due.length} task${d.due.length === 1 ? "" : "s"} today · ${d.overdue.length} overdue`}
            time={fmtTime(digestTime)}
            onOpen={() => router.push("/tasks")}
          />
          {reminders.map((t: Task) => (
            <Ping
              key={t.id}
              title={t.title}
              body={t.dueTime ? fmtTime(t.dueTime) : "Reminder"}
              time={
                t.remindAt ? fmtInstant(t.remindAt).replace(/^Today /, "") : ""
              }
              onOpen={() => router.push(`/tasks/task/${t.id}`)}
              onDone={
                actions
                  ? () => {
                      completeTask(t.id)
                      setGone((g) => [...g, t.id])
                      toast.success(`Done · ${t.title}`)
                    }
                  : undefined
              }
              onSnooze={
                actions
                  ? () => {
                      snoozeTask(t.id, 60)
                      setGone((g) => [...g, t.id])
                      toast(`Snoozed 1h · ${t.title}`, {
                        description: "Reminder only — due date unchanged.",
                      })
                    }
                  : undefined
              }
            />
          ))}
        </div>
      </div>
      <p className="mt-3 text-center text-muted-foreground text-xs">
        Simulating {notif.platform}. Change it under{" "}
        <Link href="/tasks/reminders" className="text-tsk">
          Reminders
        </Link>
        .
      </p>
    </Screen>
  )
}

function Ping({
  title,
  body,
  time,
  onOpen,
  onDone,
  onSnooze,
}: {
  title: string
  body: string
  time: string
  onOpen: () => void
  onDone?: () => void
  onSnooze?: () => void
}) {
  return (
    <div className="overflow-hidden rounded-2xl bg-white/15 backdrop-blur-md">
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-start gap-2 p-3 text-left"
      >
        <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-primary to-hab font-bold text-[10px]">
          SOP
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex justify-between gap-2">
            <span className="truncate font-semibold text-sm">{title}</span>
            <span className="shrink-0 text-[11px] opacity-70">{time}</span>
          </div>
          <div className="text-sm opacity-85">{body}</div>
        </div>
      </button>
      {(onDone || onSnooze) && (
        <div className="grid grid-cols-2 border-white/15 border-t text-sm">
          <button
            type="button"
            onClick={onDone}
            className="border-white/15 border-r py-2 font-medium"
          >
            Done
          </button>
          <button type="button" onClick={onSnooze} className="py-2 font-medium">
            Snooze 1h
          </button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- TSK-14 demo

const EXAMPLES = [
  "buy eggs and rice, call Mark tomorrow 3pm, finish deck for work by Fri",
  "remind me to pay meralco on the 5th every month",
  "email client after lunch",
  "gym bag, protein, laundry detergent",
]

export function CaptureDemoScreen() {
  const state = useViewState()
  const [text, setText] = useState(EXAMPLES[0])
  const [source, setSource] = useState<TaskSource>("capture-text")
  const [results, setResults] = useState<
    { q: string; ids: string[]; followUp?: string; failed?: boolean }[]
  >([])

  const send = () => {
    if (!text.trim()) return
    if (state === "error") {
      // AI parse failed → raw single task in Inbox
      const t = createTask({ title: text, listId: null, source })
      setResults((r) => [...r, { q: text, ids: [t.id], failed: true }])
    } else {
      const { tasks, followUp } = captureTasks(text, source)
      setResults((r) => [
        ...r,
        { q: text, ids: tasks.map((t) => t.id), followUp },
      ])
    }
    setText("")
  }

  return (
    <Screen back title="Capture → tasks">
      <TaskSheets />
      <p className="mb-3 text-muted-foreground text-sm">
        Simulated AI split. The Capture sheet renders the same result card.
      </p>
      <div className="space-y-4">
        {results.map((r, i) => (
          <div key={i} className="space-y-2">
            <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3 py-2 text-primary-foreground text-sm">
              {r.q}
            </div>
            {r.failed && (
              <div className="text-warn text-xs">
                Couldn't split — saved as one task in Inbox. Edit?
              </div>
            )}
            <CaptureResultCard taskIds={r.ids} followUp={r.followUp} />
          </div>
        ))}
      </div>
      <SectionTitle>Try a phrase</SectionTitle>
      <div className="flex flex-wrap gap-2">
        {EXAMPLES.map((e) => (
          <Chip
            key={e}
            className="h-auto max-w-full py-1.5 text-left text-xs"
            onClick={() => setText(e)}
          >
            <span className="line-clamp-2">{e}</span>
          </Chip>
        ))}
      </div>
      <div className="mt-4 flex gap-2">
        {(
          [
            ["capture-text", MessageSquareText, "Text"],
            ["capture-voice", Mic, "Voice"],
            ["capture-photo", Camera, "Photo"],
          ] as const
        ).map(([v, I, l]) => (
          <Chip
            key={v}
            accent="tsk"
            active={source === v}
            onClick={() => setSource(v)}
          >
            <I className="size-3.5" /> {l}
          </Chip>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
        className="sticky bottom-0 mt-3 flex gap-2 bg-background py-2"
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="Capture text"
          placeholder="Dump anything…"
          className="h-12 flex-1 rounded-xl border border-border/60 bg-card px-3 text-base outline-none"
        />
        <button
          type="submit"
          aria-label="Send"
          className={cn(
            "grid size-12 place-items-center rounded-xl bg-tsk text-background",
            !text && "opacity-40",
          )}
        >
          <Check className="size-5" />
        </button>
      </form>
    </Screen>
  )
}
