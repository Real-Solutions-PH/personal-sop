// Onboarding's "Tell me one thing from today" and what Fern made of it, on
// the same screen. The account already exists (account first, docs/27 K8),
// so the words go straight through the ordinary capture path: online Fern
// answers live, offline the capture queues and Fern answers on reconnect.
// See first-capture.ts for the send.
import type { Capture, RecordCard } from "@domain/capture/data"
import { captureStore } from "@domain/capture/store"
import { Check, Mic, Square } from "lucide-react-native"
import { type ReactNode, useRef, useState } from "react"
import { TextInput, View } from "react-native"
import { FernCelebrates } from "../companion/fern-celebrates"
import { FernSprite } from "../companion/fern-sprite"
import { firstCaptureStore, type HeldCapture } from "../first-capture"
import { canDictateLive, useLiveDictation } from "../live-dictation"
import { border, Copy, Frame, IconTap, Line, Tap } from "../native-kit"
import { fonts, useTheme } from "../theme"

const EXAMPLES = [
  "ran 5k this morning",
  "spent 250 on lunch",
  "call mum friday",
]

/** The step: type or dictate, send, and Fern's answer shows here. */
export function FirstCaptureStep({
  onSend,
  onNext,
  button,
}: {
  onSend: (c: HeldCapture) => void
  onNext: () => void
  /** Onboarding's own button, so the step looks like the rest. */
  button: (
    label: string,
    press: () => void,
    quiet?: boolean,
    disabled?: boolean,
  ) => ReactNode
}) {
  const t = useTheme(),
    sent = firstCaptureStore.use((s) => s.sentId),
    [text, setText] = useState(""),
    [spoke, setSpoke] = useState(false),
    [micError, setMicError] = useState(""),
    // Set when the person types while dictation is on: the recogniser stops
    // and nothing it still sends overwrites their correction.
    typed = useRef(false),
    dictation = useLiveDictation(
      (v) => {
        if (!typed.current) setText(v)
      },
      () => setMicError("Couldn't hear that. Try again or type it."),
      "en-US",
      null,
    ),
    canTalk = canDictateLive()
  if (sent)
    return (
      <View style={{ gap: 16 }}>
        <FirstCaptureResult />
        {button("Next", onNext)}
      </View>
    )
  const send = () => {
    if (dictation.listening) dictation.stop()
    onSend({ text: text.trim(), source: spoke ? "voice" : "text" })
  }
  return (
    <View style={{ gap: 16 }}>
      <Frame style={{ padding: 12, gap: 8 }}>
        <Line style={{ gap: 8, alignItems: "flex-start" }}>
          <TextInput
            accessibilityLabel="One thing from today"
            placeholder={`e.g. “${EXAMPLES[0]}”`}
            placeholderTextColor={t.muted}
            value={text}
            onChangeText={(v) => {
              // A correction while listening: stop, so the next phrase the
              // recogniser hears doesn't type over it.
              if (dictation.listening) {
                typed.current = true
                dictation.stop()
              }
              setText(v)
            }}
            multiline
            maxLength={500}
            style={{
              flex: 1,
              minHeight: 72,
              fontFamily: fonts.body,
              fontSize: 16,
              color: t.text,
              textAlignVertical: "top",
            }}
          />
          {canTalk && (
            <IconTap
              size={44}
              icon={dictation.listening ? Square : Mic}
              label={dictation.listening ? "Stop dictating" : "Dictate"}
              color={dictation.listening ? t.onPrimary : t.primary}
              background={
                dictation.listening ? t.primary : border(t.primary, 0.12)
              }
              onPress={() => {
                setMicError("")
                if (dictation.listening) return dictation.stop()
                typed.current = false
                void dictation.start(text).then((ok) => {
                  if (ok) setSpoke(true)
                  else
                    setMicError(
                      "Dictation needs microphone and speech access. You can type it instead.",
                    )
                })
              }}
            />
          )}
        </Line>
        {!!micError && (
          <Copy size={12} style={{ color: t.bad }}>
            {micError}
          </Copy>
        )}
      </Frame>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {EXAMPLES.map((x) => (
          <Tap
            key={x}
            label={`Use “${x}”`}
            onPress={() => {
              typed.current = true
              if (dictation.listening) dictation.stop()
              setText(x)
            }}
            style={{
              paddingHorizontal: 12,
              minHeight: 36,
              justifyContent: "center",
              borderRadius: 18,
              borderWidth: 1,
              borderColor: t.line,
              backgroundColor: t.card,
            }}
          >
            <Copy size={14}>{x}</Copy>
          </Tap>
        ))}
      </View>
      {button(
        text.trim() ? "Log it" : "Say one thing first",
        send,
        false,
        !text.trim(),
      )}
    </View>
  )
}

const TARGET_LABEL: Record<RecordCard["target"], string> = {
  habits: "Habits",
  tasks: "Tasks",
  fitness: "Fitness",
  finance: "Finance",
  journal: "Journal",
}
const KIND_LABEL: Partial<Record<RecordCard["kind"], string>> = {
  expense: "an expense",
  income: "income",
  transfer: "a transfer",
  planned: "a bill",
  task: "a task",
  taskComplete: "a finished task",
  habitLog: "a check-in",
  habitCreate: "a new habit",
  workout: "a workout",
  weighIn: "a weigh-in",
  meal: "a meal",
  journal: "a journal entry",
}

const recordsOf = (c: Capture | undefined) =>
  (c?.reply?.items ?? []).filter((i): i is RecordCard => i.t === "record")

/** What became of the first capture, live. Nothing when there was none. */
export function FirstCaptureResult() {
  const t = useTheme(),
    id = firstCaptureStore.use((s) => s.sentId),
    cap = captureStore.use((s) =>
      id ? s.captures.find((c) => c.id === id) : undefined,
    )
  if (!id || !cap) return null
  const recs = recordsOf(cap),
    saved = recs.filter((r) => r.state === "saved"),
    waiting = cap.status === "processing" || cap.status === "queued",
    failed = cap.status === "failed"
  return (
    <Frame style={{ padding: 16, gap: 12 }}>
      <Line style={{ gap: 12 }}>
        {saved.length ? (
          <FernCelebrates
            size={48}
            badge={<Check size={20} color="#fff" strokeWidth={3} />}
          />
        ) : (
          <FernSprite
            size={48}
            state={waiting ? "thinking" : failed ? "consoling" : "idle"}
            decorative
          />
        )}
        <View style={{ flex: 1 }}>
          <Copy weight="semibold">
            {saved.length
              ? "Fern logged your first win"
              : waiting
                ? cap.status === "queued"
                  ? "Fern logs it when you're back online"
                  : "Fern is logging it…"
                : failed
                  ? "Fern kept your words but couldn't log them"
                  : recs.length
                    ? "Fern needs your OK in Capture"
                    : "Fern heard you"}
          </Copy>
          <Copy size={12} muted>
            “{cap.text}”
          </Copy>
        </View>
      </Line>
      {saved.map((r) => (
        <Line key={r.id} style={{ gap: 8 }}>
          <View
            style={{
              width: 20,
              height: 20,
              borderRadius: 10,
              backgroundColor: t.good,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Check size={12} color="#fff" strokeWidth={3} />
          </View>
          <Copy size={14} style={{ flex: 1 }}>
            Saved {KIND_LABEL[r.kind] ?? "an entry"} in {TARGET_LABEL[r.target]}
          </Copy>
        </Line>
      ))}
    </Frame>
  )
}
