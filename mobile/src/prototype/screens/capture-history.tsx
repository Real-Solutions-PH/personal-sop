import * as A from "@domain/capture/actions"
import type { Capture, RecordCard, Target } from "@domain/capture/data"
import { captureStore, useOnline } from "@domain/capture/store"
import { dayKey, dayOffset, fmtDuration } from "@domain/lib/day"
import { useLocalSearchParams } from "expo-router"
import {
  Camera,
  FileText,
  Mic,
  PenLine,
  RotateCw,
  Search,
  Trash2,
  Wifi,
  WifiOff,
  Zap,
} from "lucide-react-native"
import { useState } from "react"
import { Image, ScrollView, TextInput, View } from "react-native"
import { toast } from "sonner-native"
import {
  border,
  Copy,
  Frame,
  IconTap,
  Line,
  SectionHeading,
  Tap,
} from "../native-kit"
import { go } from "../navigation"
import { Switch } from "../switch"
import { fonts, useTheme } from "../theme"
import { Button, confirm, Screen } from "../ui"
import { Reply } from "./capture"

const sourceLabel = {
    text: "Text",
    voice: "Voice",
    photo: "Photo",
    file: "File",
    quick_add: "Quick add",
    connector: "Claude",
  },
  icons = {
    text: PenLine,
    voice: Mic,
    photo: Camera,
    file: FileText,
    quick_add: Zap,
    connector: Zap,
  },
  targets = {
    habits: { label: "Habits", color: "hab" },
    tasks: { label: "Tasks", color: "tsk" },
    fitness: { label: "Fitness", color: "fit" },
    finance: { label: "Finance", color: "fin" },
    journal: { label: "Journal", color: "life" },
  } as const
const kindLabel = {
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
const recsOf = (c: Capture) =>
  (c.reply?.items ?? []).filter((i): i is RecordCard => i.t === "record")
const time = (at: string) =>
  new Date(at).toLocaleTimeString("en-PH", {
    hour: "numeric",
    minute: "2-digit",
  })
const dayLabel = (d: string) =>
  d === dayKey()
    ? "Today"
    : d === dayOffset(-1)
      ? "Yesterday"
      : new Date(`${d}T12:00:00`).toLocaleDateString("en-PH", {
          weekday: "long",
          month: "short",
          day: "numeric",
        })
export function CaptureRow({
  cap,
  onNavigate,
}: {
  cap: Capture
  onNavigate?: () => void
}) {
  const t = useTheme(),
    I = icons[cap.source],
    status = {
      needs_input: "Needs answer",
      queued: "Queued",
      failed: "Failed",
      processing: "Thinking…",
      answered: "Answered",
    }[cap.status as "needs_input"],
    color =
      cap.status === "failed"
        ? t.bad
        : cap.status === "processing"
          ? t.primary
          : ["needs_input", "queued"].includes(cap.status)
            ? t.warn
            : t.muted
  return (
    <Tap
      onPress={() => {
        onNavigate?.()
        go(`/capture/history/${cap.id}`)
      }}
      style={{ minHeight: 56, paddingHorizontal: 4, paddingVertical: 10 }}
    >
      <Line style={{ gap: 12 }}>
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 16,
            backgroundColor: t.soft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <I size={16} color={t.muted} />
        </View>
        <View style={{ flex: 1 }}>
          <Copy size={14} lines={1}>
            {cap.text ||
              cap.fileName ||
              (cap.source === "photo" ? "Photo" : "—")}
          </Copy>
          <Line style={{ gap: 8, marginTop: 2 }}>
            <Copy size={11} muted>
              {time(cap.at)}
            </Copy>
            <Line style={{ gap: 2 }}>
              {recsOf(cap).map((r) => (
                <View
                  key={r.id}
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: ["undone", "discarded"].includes(r.state)
                      ? t.soft
                      : t[targets[r.target].color],
                  }}
                />
              ))}
            </Line>
          </Line>
        </View>
        {status && (
          <View
            style={{
              paddingHorizontal: 8,
              paddingVertical: 2,
              borderRadius: 20,
              backgroundColor: border(color, 0.15),
            }}
          >
            <Copy size={10} weight="semibold" style={{ color }}>
              {status}
            </Copy>
          </View>
        )}
      </Line>
    </Tap>
  )
}
export function CaptureHistory() {
  const t = useTheme(),
    all = captureStore.use((s) => s.captures),
    params = useLocalSearchParams<{ source?: string }>(),
    [q, setQ] = useState(""),
    [filter, setFilter] = useState(params.source ?? "all"),
    [mod, setMod] = useState<Target | null>(null),
    recs = all.flatMap(recsOf),
    saved = recs.filter((r) => r.log.some((l) => l.action === "saved")),
    corrected = recs.filter((r) => ["undone", "edited"].includes(r.state)),
    list = [...all].reverse().filter((c) => {
      const rs = recsOf(c)
      if (q && !c.text.toLowerCase().includes(q.toLowerCase())) return false
      if (mod && !rs.some((r) => r.target === mod)) return false
      return filter === "needs"
        ? c.status === "needs_input"
        : filter === "failed"
          ? c.status === "failed"
          : filter === "undone"
            ? rs.some((r) => r.state === "undone")
            : filter === "all" || c.source === filter
    }),
    days = [...new Set(list.map((c) => dayKey(new Date(c.at))))]
  const chip = (
    key: string,
    label: string,
    on: boolean,
    press: () => void,
    color: string = t.primary,
  ) => (
    <Tap
      key={key}
      onPress={press}
      style={{
        height: 44,
        paddingHorizontal: 14,
        borderRadius: 22,
        borderWidth: 1,
        borderColor: on ? color : t.line,
        backgroundColor: on ? color : t.card,
        justifyContent: "center",
      }}
    >
      <Copy
        size={14}
        weight="medium"
        style={{ color: on ? t.onPrimary : t.text }}
      >
        {label}
      </Copy>
    </Tap>
  )
  return (
    <Screen title="Capture history">
      <View>
        <Frame style={{ padding: 16 }}>
          <Line style={{ gap: 8 }}>
            {[
              {
                label: "Captures · 7d",
                value: all.filter(
                  (c) => new Date(c.at).getTime() > Date.now() - 7 * 86400000,
                ).length,
              },
              { label: "Entries by AI", value: saved.length },
              {
                label: "Corrected",
                value: `${saved.length ? Math.round((corrected.length / saved.length) * 100) : 0}%`,
              },
            ].map((x) => (
              <View key={x.label} style={{ flex: 1 }}>
                <Copy size={28} weight="display">
                  {x.value}
                </Copy>
                <Copy size={12} muted>
                  {x.label}
                </Copy>
              </View>
            ))}
          </Line>
        </Frame>
        <Line
          style={{
            height: 44,
            borderWidth: 1,
            borderColor: t.line,
            borderRadius: 12,
            backgroundColor: t.card,
            marginTop: 12,
            paddingHorizontal: 12,
            gap: 8,
          }}
        >
          <Search size={16} color={t.muted} />
          <TextInput
            accessibilityLabel="Search what you said"
            placeholder="Search what you said"
            placeholderTextColor={t.muted}
            value={q}
            onChangeText={setQ}
            style={{
              flex: 1,
              fontSize: 15,
              fontFamily: fonts.body,
              color: t.text,
            }}
          />
        </Line>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0, marginTop: 12 }}
          contentContainerStyle={{ gap: 6, paddingBottom: 4 }}
        >
          {[
            ["all", "All"],
            ["needs", "Needs answer"],
            ["failed", "Failed"],
            ["undone", "Undone"],
            ["voice", "Voice"],
            ["photo", "Photo"],
            ["quick_add", "Quick add"],
            ["connector", "Claude"],
          ].map(([v, label]) =>
            chip(v, label, filter === v, () => setFilter(v)),
          )}
        </ScrollView>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0, marginTop: 8 }}
          contentContainerStyle={{ gap: 6, paddingBottom: 4 }}
        >
          {(Object.keys(targets) as Target[]).map((k) =>
            chip(
              k,
              targets[k].label,
              mod === k,
              () => setMod(mod === k ? null : k),
              t[targets[k].color],
            ),
          )}
        </ScrollView>
        {days.map((d) => (
          <View key={d}>
            <SectionHeading>{dayLabel(d)}</SectionHeading>
            <Frame style={{ paddingHorizontal: 12 }}>
              {list
                .filter((c) => dayKey(new Date(c.at)) === d)
                .map((c) => (
                  <View
                    key={c.id}
                    style={{
                      borderBottomWidth: 1,
                      borderBottomColor: border(t.line, 0.4),
                    }}
                  >
                    <CaptureRow cap={c} />
                  </View>
                ))}
            </Frame>
          </View>
        ))}
        {!days.length && (
          <View style={{ padding: 32, alignItems: "center", gap: 12 }}>
            <Copy weight="semibold">
              {all.length ? "Nothing matches" : "No captures yet"}
            </Copy>
            <Copy size={14} muted>
              {all.length
                ? "Try another filter or search."
                : "Everything you type, say or snap shows up here with what it saved."}
            </Copy>
            <Button href="/capture">Start capturing</Button>
          </View>
        )}
      </View>
    </Screen>
  )
}
export function CaptureQueue() {
  const t = useTheme(),
    all = captureStore.use((s) => s.captures),
    sim = captureStore.use((s) => s.settings.simulateOffline),
    online = useOnline(),
    queued = all.filter((c) => c.status === "queued")
  return (
    <Screen title="Pending">
      <View>
        <Frame
          style={{
            padding: 16,
            borderColor: online ? t.line : border(t.warn, 0.4),
          }}
        >
          <Line style={{ gap: 12 }}>
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: border(online ? t.good : t.warn, 0.15),
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              {online ? (
                <Wifi size={20} color={t.good} />
              ) : (
                <WifiOff size={20} color={t.warn} />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Copy weight="semibold">{online ? "Online" : "Offline"}</Copy>
              <Copy size={12} muted>
                {queued.length
                  ? `${queued.length} capture${queued.length === 1 ? "" : "s"} waiting · they keep the time you captured them`
                  : "Nothing waiting to sync"}
              </Copy>
            </View>
          </Line>
        </Frame>
        <Frame style={{ padding: 16, marginTop: 8 }}>
          <Line style={{ gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Copy size={14} weight="medium">
                Simulate offline
              </Copy>
              <Copy size={12} muted>
                Prototype switch — captures queue instead of processing.
              </Copy>
            </View>
            <Switch
              compact
              accent="primary"
              label="Simulate offline"
              value={sim}
              onChange={(simulateOffline) =>
                A.updateAISettings({ simulateOffline })
              }
            />
          </Line>
        </Frame>
        <SectionHeading
          action={
            !!queued.length && (
              <Button
                small
                tone="quiet"
                disabled={!online}
                onPress={() => {
                  const n = A.processQueue()
                  toast(n ? `Processing ${n}…` : "Still offline")
                }}
              >
                Retry all
              </Button>
            )
          }
        >
          Queue
        </SectionHeading>
        {!queued.length ? (
          <View style={{ padding: 24, alignItems: "center", gap: 12 }}>
            <Copy weight="semibold">All caught up</Copy>
            <Copy size={14} muted>
              Anything you capture without signal waits here, then processes in
              order.
            </Copy>
            <Button href="/capture">Open Capture</Button>
          </View>
        ) : (
          <View style={{ gap: 8 }}>
            {queued.map((c) => (
              <Frame key={c.id} style={{ padding: 16 }}>
                <Line style={{ gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Copy size={14} lines={1}>
                      {c.text || c.fileName || "Photo"}
                    </Copy>
                    <Copy size={11} muted>
                      {sourceLabel[c.source]} · captured {time(c.at)}
                    </Copy>
                  </View>
                  <IconTap
                    size={44}
                    icon={RotateCw}
                    label="Retry now"
                    background={t.soft}
                    onPress={() => A.retryCapture(c.id)}
                  />
                  <IconTap
                    size={44}
                    icon={Trash2}
                    label="Delete queued capture"
                    background={t.soft}
                    color={t.bad}
                    onPress={() => A.deleteCapture(c.id)}
                  />
                </Line>
              </Frame>
            ))}
          </View>
        )}
        <Tap
          onPress={() => go("/capture")}
          style={{ marginTop: 16, paddingHorizontal: 4 }}
        >
          <Copy size={11} muted style={{ textDecorationLine: "underline" }}>
            Back to the thread
          </Copy>
        </Tap>
      </View>
    </Screen>
  )
}
export function CaptureDetail({ id }: { id: string }) {
  const t = useTheme(),
    cap = captureStore.use((s) => s.captures.find((c) => c.id === id)),
    [text, setText] = useState<string | null>(null)
  if (!cap)
    return (
      <Screen title="Capture">
        <Copy>Capture not found</Copy>
        <Copy muted>It may have been deleted or the thread was cleared.</Copy>
        <Button href="/capture/history">History</Button>
      </Screen>
    )
  const recs = recsOf(cap),
    rerun = () =>
      confirm(
        "Re-run the AI?",
        `Anything this capture saved is reverted, then the AI reads ${text !== null ? "your edited text" : "it"} again and proposes fresh cards.`,
        () => {
          A.rerunCapture(cap.id, text ?? undefined)
          setText(null)
        },
      )
  return (
    <Screen
      title="Capture"
      actions={
        <IconTap
          size={44}
          icon={Trash2}
          label="Delete capture"
          onPress={() => {
            A.deleteCapture(cap.id)
            toast("Capture deleted — its entries stay where they were saved")
            go("/capture/history")
          }}
        />
      }
    >
      <View>
        <Copy size={12} muted style={{ marginBottom: 4 }}>
          {sourceLabel[cap.source]} · {dayLabel(dayKey(new Date(cap.at)))}{" "}
          {time(cap.at)}
          {cap.status === "needs_input"
            ? " · Needs answer"
            : cap.status === "failed"
              ? " · Failed"
              : ""}
        </Copy>
        <Frame style={{ padding: 16 }}>
          {cap.photo && (
            <Image
              source={{ uri: cap.photo }}
              style={{ height: 240, borderRadius: 12, marginBottom: 12 }}
            />
          )}
          {cap.source === "photo" && !cap.photo && (
            <View
              style={{
                height: 128,
                borderRadius: 12,
                backgroundColor: t.soft,
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 12,
              }}
            >
              <Camera size={24} color={t.muted} />
            </View>
          )}
          {cap.source === "voice" && (
            <Line
              style={{
                padding: 10,
                borderRadius: 12,
                backgroundColor: border(t.soft, 0.6),
                marginBottom: 12,
              }}
            >
              <Mic size={16} color={t.primary} />
              <Line style={{ flex: 1, height: 24, gap: 2 }}>
                {Array.from({ length: 32 }, (_, i) => (
                  <View
                    key={i}
                    style={{
                      width: 3,
                      height: `${20 + ((i * 37) % 80)}%`,
                      borderRadius: 2,
                      backgroundColor: border(t.muted, 0.4),
                    }}
                  />
                ))}
              </Line>
              <Copy size={12} muted>
                {fmtDuration(cap.durationSec ?? 0)}
              </Copy>
            </Line>
          )}
          <Copy size={11} weight="medium" muted style={{ letterSpacing: 0.5 }}>
            {cap.source === "voice"
              ? "TRANSCRIPT"
              : cap.source === "photo"
                ? "CAPTION"
                : "YOU SAID"}
          </Copy>
          {text === null ? (
            <Copy size={15} style={{ marginTop: 4 }}>
              {cap.text || "—"}
            </Copy>
          ) : (
            <TextInput
              accessibilityLabel="Edit capture text"
              value={text}
              onChangeText={setText}
              multiline
              numberOfLines={3}
              style={{
                marginTop: 4,
                minHeight: 84,
                padding: 8,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: t.line,
                backgroundColor: t.bg,
                color: t.text,
                fontFamily: fonts.body,
                fontSize: 15,
              }}
            />
          )}
          <Line style={{ marginTop: 12, gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button
                tone="quiet"
                onPress={() => setText(text === null ? cap.text : null)}
              >
                {text === null
                  ? `Edit ${cap.source === "voice" ? "transcript" : "text"}`
                  : "Cancel"}
              </Button>
            </View>
            <View style={{ flex: 1 }}>
              <Button tone="quiet" onPress={rerun}>
                {text === null ? "Re-run AI" : "Save & re-run"}
              </Button>
            </View>
          </Line>
          {cap.status === "failed" && (
            <Button tone="quiet" onPress={() => A.retryCapture(cap.id)}>
              Retry
            </Button>
          )}
        </Frame>
        <SectionHeading>What it did</SectionHeading>
        {cap.status === "queued" ? (
          <Frame style={{ padding: 16 }}>
            <Copy size={14} muted>
              Queued on this device — it'll be processed when you're back
              online, using the time you captured it.
            </Copy>
          </Frame>
        ) : cap.reply ? (
          <View style={{ gap: 8 }}>
            {cap.reply.items.map((item) => (
              <Reply key={item.id} item={item} capture={cap} />
            ))}
          </View>
        ) : (
          <Frame style={{ padding: 16 }}>
            <Copy size={14} muted>
              Still thinking…
            </Copy>
          </Frame>
        )}
        {!!recs.length && (
          <>
            <SectionHeading>Write log</SectionHeading>
            <Frame style={{ padding: 16, gap: 12 }}>
              {recs.map((r) => (
                <View key={r.id}>
                  <Line style={{ gap: 8 }}>
                    <View
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: t[targets[r.target].color],
                      }}
                    />
                    <Copy size={14} weight="medium" style={{ flex: 1 }}>
                      {targets[r.target].label} › {kindLabel[r.kind]}
                    </Copy>
                    <Copy size={12} muted>
                      {r.tier === "auto" ? "Auto-save" : "Confirm"}
                    </Copy>
                  </Line>
                  <View
                    style={{
                      marginTop: 4,
                      marginLeft: 4,
                      paddingLeft: 12,
                      borderLeftWidth: 1,
                      borderLeftColor: t.line,
                      gap: 2,
                    }}
                  >
                    {r.log.map((l, i) => (
                      <Copy key={`${l.at}${i}`} size={12} muted>
                        <Copy size={12} style={{ textTransform: "capitalize" }}>
                          {l.action}
                        </Copy>{" "}
                        by {l.actor === "ai" ? "AI" : "you"} · {time(l.at)}
                      </Copy>
                    ))}
                  </View>
                </View>
              ))}
            </Frame>
          </>
        )}
      </View>
    </Screen>
  )
}
