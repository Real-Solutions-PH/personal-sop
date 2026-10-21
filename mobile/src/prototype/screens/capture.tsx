import * as A from "@domain/capture/actions"
import type { Capture, RecordCard, ReplyItem } from "@domain/capture/data"
import { resumeStuck } from "@domain/capture/engine"
import { captureStore, useOnline } from "@domain/capture/store"
import { finStore } from "@domain/finance/store"
import { closeCapture } from "@domain/lib/capture"
import {
  ArrowUp,
  BookOpen,
  CheckSquare,
  Clock,
  Dumbbell,
  Maximize2,
  Repeat2,
  Wallet,
} from "lucide-react-native"
import { useEffect, useState } from "react"
import { AppState, TextInput, View } from "react-native"
import { toast } from "sonner-native"
import { border, Copy, Frame, IconTap, Line, Tap } from "../native-kit"
import { go } from "../navigation"
import { fonts, useTheme } from "../theme"
import { Actions, Button, Card, Label, Row, Sheet, Title } from "../ui"
import { CaptureEdit } from "./capture-edit"
import { CaptureSummary } from "./capture-summary"
import { useMoney } from "./finance"

export function CaptureOverlay({ bottom = 0 }: { bottom?: number }) {
  const online = useOnline()
  useEffect(() => {
    if (!online) return
    const resume = () => {
      resumeStuck()
      A.processQueue()
    }
    resume()
    const timer = setInterval(resumeStuck, 5000)
    const app = AppState.addEventListener("change", (state) => {
      if (state === "active") resume()
    })
    return () => {
      clearInterval(timer)
      app.remove()
    }
  }, [online])
  return <CompanionDrawer bottom={bottom} />
}
// ponytail: the old sheet-based session, kept for reference until the
// companion drawer is signed off.
export function CaptureSession({
  ctx,
}: {
  ctx: { hint?: string; mode?: string }
}) {
  const t = useTheme(),
    captures = captureStore.use((s) => s.captures),
    [session, setSession] = useState<string[]>([]),
    [prefill, setPrefill] = useState(
      ctx.hint && /\s/.test(ctx.hint) && ctx.hint.length > 12 ? ctx.hint : "",
    ),
    [revision, setRevision] = useState(0)
  const aliases: Record<string, string> = {
    tasks: "task",
    todo: "task",
    reminder: "task",
    meals: "meal",
    food: "meal",
    weight: "weigh-in",
    weighin: "weigh-in",
    workouts: "workout",
    gym: "workout",
    money: "expense",
    expenses: "expense",
    receipt: "expense",
  }
  const hint = ctx.hint ? (aliases[ctx.hint] ?? ctx.hint) : undefined,
    mine = captures.filter((c) => session.includes(c.id))
  const examples: Record<string, string[]> = {
    meal: ["2 eggs, pandesal and coffee", "adobo with 1 cup rice for lunch"],
    expense: [
      "180 lunch at jollibee gcash",
      "paid 1500",
      "moved 2k from GCash to BPI",
    ],
    task: [
      "remind me to pay rent on the 30th",
      "buy eggs, milk, rice",
      "done with the report",
    ],
    journal: ["long day but I showed up anyway"],
    "weigh-in": ["78.4"],
    workout: [
      "bench 60x5x3",
      "did legs: squat 3x5 100, rdl 3x8 80",
      "ran 5k in 32 min",
    ],
  }
  return (
    <Sheet title="Capture" open onClose={closeCapture}>
      <Line>
        <AiAvatar size={32} />
        <Copy size={12} muted style={{ flex: 1 }}>
          Log or ask anything — type, talk or snap
        </Copy>
        <IconTap
          icon={Clock}
          label="Capture history"
          onPress={() => {
            closeCapture()
            go("/capture/history")
          }}
        />
        <IconTap
          icon={Maximize2}
          label="Open full thread"
          onPress={() => {
            closeCapture()
            go("/capture")
          }}
        />
      </Line>
      {mine.length ? (
        mine.map((c) => <Exchange key={c.id} cap={c} />)
      ) : (
        <>
          <Copy size={11} muted>
            TRY
          </Copy>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {(
              examples[hint ?? ""] ?? [
                "ran 5k 32 min, spent 250 on grab, remind me to pay rent on the 30th",
                "did my meditation",
                "how much did I spend on food this month?",
                "weighed 78.4",
              ]
            ).map((e) => (
              <Tap
                key={e}
                onPress={() => {
                  setPrefill(e)
                  setRevision((r) => r + 1)
                }}
                style={{
                  minHeight: 44,
                  borderRadius: 16,
                  backgroundColor: t.soft,
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                }}
              >
                <Copy size={14}>{e}</Copy>
              </Tap>
            ))}
          </View>
          <Line style={{ justifyContent: "space-between" }}>
            <Copy size={11} muted>
              RECENT
            </Copy>
            <Tap
              onPress={() => {
                closeCapture()
                go("/capture")
              }}
            >
              <Copy size={14} style={{ color: t.primary }}>
                Full thread
              </Copy>
            </Tap>
          </Line>
          {[...captures]
            .reverse()
            .slice(0, 5)
            .map((c) => (
              <CaptureRow key={c.id} cap={c} onNavigate={closeCapture} />
            ))}
        </>
      )}
      <ThreadComposer
        key={revision}
        initialHint={hint}
        initialText={prefill}
        initialMode={revision === 0 ? ctx.mode : undefined}
        onSent={(id) => setSession((s) => [...s, id])}
        onNavigate={closeCapture}
      />
    </Sheet>
  )
}

function recordHref(card: RecordCard): string | undefined {
  const id = card.refs[0]
  if (!id) return
  switch (card.kind) {
    case "expense":
    case "income":
    case "transfer":
      return `/finance/records/${id}`
    case "planned":
      return `/finance/planned/${id}`
    case "task":
    case "taskComplete":
      return `/tasks/task/${id}`
    case "habitCreate":
      return `/habits/${id}`
    case "habitLog":
      return card.payload.kind === "habitLog"
        ? `/habits/${card.payload.habitId}`
        : "/habits/today"
    case "workout":
      return `/fitness/workouts/${id}`
    case "meal":
      return `/fitness/nutrition/meals/${id}`
    case "journal":
      return `/journal/${id}`
    case "weighIn":
      return "/fitness/body"
    default:
      return undefined
  }
}
function RecordReply({ card }: { card: RecordCard }) {
  const money = useMoney()
  const [answer, setAnswer] = useState("")
  const [editing, setEditing] = useState(false)
  const p = card.payload
  const _moneyValue =
    "amount" in p && typeof p.amount === "number" ? money(p.amount) : undefined
  const t = useTheme(),
    [pickAcct, setPickAcct] = useState(false),
    accounts = finStore.use((s) => s.accounts)
  const meta = {
    habits: { label: "Habits", color: t.hab, icon: Repeat2 },
    tasks: { label: "Tasks", color: t.tsk, icon: CheckSquare },
    fitness: { label: "Fitness", color: t.fit, icon: Dumbbell },
    finance: { label: "Finance", color: t.fin, icon: Wallet },
    journal: { label: "Journal", color: t.life, icon: BookOpen },
  }[card.target]
  const kinds = {
    expense: "Expense",
    income: "Income",
    transfer: "Transfer",
    planned: "Bill / recurring",
    task: "Task",
    taskComplete: "Complete task",
    habitLog: "Check-in",
    habitCreate: "New habit",
    routineStart: "Routine",
    workout: "Workout",
    weighIn: "Weigh-in",
    meal: "Meal",
    journal: "Entry",
    photo: "Photo",
    command: "Change",
  }
  const saved = ["saved", "edited"].includes(card.state),
    dead = ["undone", "discarded"].includes(card.state),
    canEdit = !["photo", "command", "routineStart", "taskComplete"].includes(
      card.kind,
    ),
    badge = {
      saved: "✓ Saved",
      edited: "✓ Edited",
      proposed: "Confirm?",
      needs_input: "Needs answer",
      undone: "Undone",
      discarded: "Discarded",
    }[card.state],
    badgeColor = saved ? t.good : dead ? t.muted : t.warn
  const edit = () => setEditing(true)
  const action = (
    label: string,
    press: () => void,
    color: string = t.muted,
  ) => (
    <Tap
      onPress={press}
      style={{
        height: 44,
        paddingHorizontal: 10,
        justifyContent: "center",
        borderRadius: 8,
      }}
    >
      <Copy size={14} weight="medium" style={{ color }}>
        {label}
      </Copy>
    </Tap>
  )
  return (
    <Frame
      style={{
        borderColor: dead ? border(t.line, 0.5) : border(meta.color, 0.3),
        opacity: dead ? 0.6 : 1,
        paddingVertical: 12,
        paddingLeft: 16,
        paddingRight: 12,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: 0,
          width: 4,
          backgroundColor: dead ? t.soft : meta.color,
        }}
      />
      <Line style={{ gap: 8, marginBottom: 8 }}>
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: 8,
            backgroundColor: border(meta.color, 0.12),
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <meta.icon size={14} color={meta.color} />
        </View>
        <Copy size={12} weight="medium" muted lines={1} style={{ flex: 1 }}>
          {meta.label} › {kinds[card.kind]}
          {p.kind === "task" && p.tasks.length > 1 ? ` ×${p.tasks.length}` : ""}
        </Copy>
        <View
          style={{
            paddingHorizontal: 8,
            paddingVertical: 2,
            borderRadius: 20,
            backgroundColor: border(badgeColor, 0.12),
          }}
        >
          <Copy size={11} weight="semibold" style={{ color: badgeColor }}>
            {badge}
          </Copy>
        </View>
      </Line>
      <CaptureSummary
        card={card}
        onAccount={
          !dead && p.kind === "expense"
            ? () => setPickAcct((v) => !v)
            : undefined
        }
      />
      {pickAcct && p.kind === "expense" && (
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: 6,
            marginTop: 8,
          }}
        >
          {accounts
            .filter((a) => !a.archived && a.type !== "investment")
            .map((a) => (
              <Button
                key={a.id}
                small
                tone="quiet"
                onPress={() => {
                  A.editCard(card.id, { ...p, accountId: a.id })
                  setPickAcct(false)
                }}
              >
                {a.name}
              </Button>
            ))}
        </View>
      )}
      {!!card.warn && !dead && (
        <View
          style={{
            marginTop: 8,
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 8,
            backgroundColor: border(t.warn, 0.12),
          }}
        >
          <Copy size={12} style={{ color: t.warn }}>
            {card.warn}
          </Copy>
        </View>
      )}
      {!!card.note && saved && (
        <Copy size={12} muted style={{ marginTop: 8 }}>
          {card.note}
        </Copy>
      )}
      {card.state === "needs_input" && card.ask && (
        <View style={{ marginTop: 12, gap: 8 }}>
          <Copy size={14} weight="medium">
            {card.ask.question}
          </Copy>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {card.ask.options.map((o) => (
              <Button
                key={o.value}
                small
                tone="quiet"
                onPress={() => A.answerCard(card.id, o.value)}
              >
                {o.label}
              </Button>
            ))}
          </View>
          {card.ask.free && (
            <Line style={{ gap: 6 }}>
              <TextInput
                accessibilityLabel="Answer"
                placeholder="Or type…"
                placeholderTextColor={t.muted}
                value={answer}
                onChangeText={setAnswer}
                onSubmitEditing={() => {
                  if (answer.trim()) A.answerCard(card.id, answer)
                }}
                style={{
                  flex: 1,
                  minHeight: 44,
                  borderRadius: 22,
                  borderWidth: 1,
                  borderColor: t.line,
                  paddingHorizontal: 12,
                  fontFamily: fonts.body,
                  fontSize: 14,
                  color: t.text,
                  backgroundColor: t.bg,
                }}
              />
              <IconTap
                icon={ArrowUp}
                label="Send answer"
                size={44}
                background={t.primary}
                color={t.onPrimary}
                onPress={() => {
                  if (answer.trim()) A.answerCard(card.id, answer)
                }}
              />
            </Line>
          )}
          <Line style={{ justifyContent: "space-between" }}>
            {action("Skip for now", () => A.skipAsk(card.id))}
            {action("Discard", () => A.discardCard(card.id))}
          </Line>
        </View>
      )}
      {card.state === "proposed" && (
        <Line style={{ gap: 8, marginTop: 12 }}>
          <Tap
            onPress={() => {
              A.confirmCard(card.id)
              if (p.kind === "routineStart" && p.routineId)
                go(`/habits/routines/${p.routineId}/play`)
            }}
            style={{
              height: 44,
              flex: 1,
              borderRadius: 12,
              backgroundColor: meta.color,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Copy size={14} weight="semibold" style={{ color: "#fff" }}>
              {card.warn?.startsWith("Looks like")
                ? "Keep both"
                : card.kind === "routineStart"
                  ? "Start routine"
                  : card.kind === "command"
                    ? "Do it"
                    : "Confirm"}
            </Copy>
          </Tap>
          {canEdit && (
            <Button tone="quiet" onPress={edit}>
              Edit
            </Button>
          )}
          <Button tone="quiet" onPress={() => A.discardCard(card.id)}>
            ×
          </Button>
        </Line>
      )}
      {saved && (
        <Line style={{ gap: 4, marginTop: 10 }}>
          {card.refs.length > 0 && action("↶ Undo", () => A.undoCard(card.id))}
          {canEdit && card.refs.length > 0 && action("Edit", edit)}
          <View style={{ flex: 1 }} />
          {action(
            "Open →",
            () => go(recordHref(card) ?? `/${card.target}`),
            meta.color,
          )}
        </Line>
      )}
      {card.state === "undone" && (
        <Line style={{ marginTop: 8, justifyContent: "space-between" }}>
          <Copy size={12} muted>
            Reverted — nothing kept.
          </Copy>
          {action("↷ Redo", () => A.redoCard(card.id), t.text)}
        </Line>
      )}
      {editing && <CaptureEdit card={card} onClose={() => setEditing(false)} />}
    </Frame>
  )
}
export function Reply({
  item,
  capture,
}: {
  item: ReplyItem
  capture: Capture
}) {
  const money = useMoney()
  if (item.t === "record") return <RecordReply card={item} />
  if (item.t === "answer")
    return (
      <Card>
        <Title>{item.title}</Title>
        <Label large>
          {item.money !== undefined ? money(item.money) : item.value}
        </Label>
        <Label>{item.sub}</Label>
        {item.list?.map((row, i) => (
          <Row key={i} title={row.label} detail={row.value} href={row.href} />
        ))}
        <Label muted>{item.basis}</Label>
        <Actions>
          {item.links.map((link) => (
            <Button key={link.href} small tone="quiet" href={link.href}>
              {link.label}
            </Button>
          ))}
        </Actions>
      </Card>
    )
  return (
    <Card>
      <Title>{item.title}</Title>
      <Label>{item.body}</Label>
      <Actions>
        {item.actions.map((action, i) => (
          <Button
            key={i}
            small
            tone="quiet"
            onPress={() => {
              if (action.href) go(action.href)
              else if (action.do === "retry") A.retryCapture(capture.id)
              else if (action.do === "journal") {
                A.addJournalEntry({ body: capture.text })
                toast.success("Saved to journal")
              } else if (action.prompt) A.sendCapture({ text: action.prompt })
              else go("/tasks/new")
            }}
          >
            {action.label}
          </Button>
        ))}
      </Actions>
    </Card>
  )
}
export { CaptureSettings } from "./capture-settings"
export { Journal } from "./journal"

import { CaptureDetail, CaptureHistory, CaptureQueue } from "./capture-history"
export function CaptureThread({
  id,
  history = false,
  queue = false,
}: {
  id?: string
  history?: boolean
  queue?: boolean
}) {
  return id ? (
    <CaptureDetail id={id} />
  ) : history ? (
    <CaptureHistory />
  ) : queue ? (
    <CaptureQueue />
  ) : (
    <CompanionChat />
  )
}

import { CompanionChat, CompanionDrawer } from "../companion/chat"
import { CaptureRow } from "./capture-history"
import { AiAvatar, Exchange, ThreadComposer } from "./capture-thread"
