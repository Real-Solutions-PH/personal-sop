import * as A from "@domain/capture/actions"
import type { Capture } from "@domain/capture/data"
import { captureStore, useOnline } from "@domain/capture/store"
import { dayKey, dayOffset, fmtDuration } from "@domain/lib/day"
import { LinearGradient } from "expo-linear-gradient"
import { useLocalSearchParams } from "expo-router"
import {
  ArrowUp,
  BookOpen,
  CheckSquare,
  Clock,
  Dumbbell,
  Mic,
  Plus,
  Scale,
  Settings2,
  Square,
  Utensils,
  Wallet,
  WifiOff,
  X,
} from "lucide-react-native"
import { useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  Image,
  ScrollView,
  TextInput,
  View,
} from "react-native"
import { toast } from "sonner-native"
import { liveMode } from "@/live/config"
import { Orb } from "../companion/orb"
import { markVoiceTurn, thinking } from "../companion/store"
import { composeDictation, useLiveDictation } from "../live-dictation"
import { pickPhoto, pickPhotos } from "../media"
import { border, Copy, Frame, IconTap, Line, Tap } from "../native-kit"
import { go } from "../navigation"
import { fonts, useTheme } from "../theme"
import { Button, Screen } from "../ui"
import { wake } from "../wake-word"
import { Reply } from "./capture"
import { attachFiles, CapturePhoto } from "./capture-photo"
import { QuickAdd } from "./capture-quick"
import { CaptureVoice } from "./capture-voice"

const hints = [
  { v: "meal", label: "Meal", icon: Utensils },
  { v: "expense", label: "Expense", icon: Wallet },
  { v: "task", label: "Task", icon: CheckSquare },
  { v: "journal", label: "Journal", icon: BookOpen },
  { v: "weigh-in", label: "Weigh-in", icon: Scale },
  { v: "workout", label: "Workout", icon: Dumbbell },
]
const placeholders: Record<string, string> = {
  meal: "What did you eat? e.g. adobo, 1 cup rice",
  expense: "e.g. 180 lunch gcash",
  task: "e.g. call the dentist fri 10am",
  journal: "Write it out, or tap 🎤 and talk…",
  "weigh-in": "e.g. 78.4",
  workout: "e.g. bench 60x5x3 · ran 5k 30 min",
}
export function AiAvatar({ size = 24 }: { size?: number }) {
  const on = thinking((s) => s.on)
  return <Orb size={size} active={on} />
}
/** The composer box: one line, up to about six. */
const INPUT_MIN = 44
const INPUT_MAX = 140
export function ThreadComposer({
  onSent,
  initialHint,
  initialText = "",
  initialMode,
  onText,
  hints: showHints = true,
  placeholder,
  wakeTarget = false,
}: {
  /** Route typed messages here (the companion) instead of capture, with
   * any photos attached in the composer. */
  onText?: (text: string, hint?: string, photos?: string[]) => void
  hints?: boolean
  placeholder?: string
  /** "Hey Fern" starts dictating in this composer (the one on screen). */
  wakeTarget?: boolean
  onSent?: (id: string) => void
  initialHint?: string
  initialText?: string
  initialMode?: string
  onNavigate?: () => void
}) {
  const t = useTheme(),
    [hint, setHint] = useState(initialHint),
    [text, setText] = useState(initialText),
    [mode, setMode] = useState<string | undefined>(initialMode),
    [quick, setQuick] = useState(false),
    [transcribing, setTranscribing] = useState(false),
    [photos, setPhotos] = useState<string[]>([]),
    // This message was dictated: Fern's reply to it is read aloud.
    [spoken, setSpoken] = useState(false),
    // iOS keeps a multiline input at its grown height after its text is
    // cleared on send, so it sat tall and empty while Fern answered. A box
    // that grew is rebuilt at one line once it is empty (setting its height
    // from onContentSizeChange instead fed back into itself and grew to the
    // cap). It keeps the keyboard if it had it.
    [inputKey, setInputKey] = useState(0),
    grown = useRef(false),
    focused = useRef(false),
    refocus = useRef(false),
    input = useRef<TextInput>(null),
    online = useOnline()
  useEffect(() => {
    if (text || !grown.current) return
    grown.current = false
    // Read before the old box goes, since unmounting it reports a blur.
    refocus.current = focused.current
    setInputKey((k) => k + 1)
  }, [text])
  useEffect(() => {
    if (inputKey && refocus.current) input.current?.focus()
  }, [inputKey])
  const MAX_PHOTOS = 10
  const addPhotos = (more: string[]) =>
    setPhotos((cur) => [...cur, ...more].slice(0, MAX_PHOTOS))
  const canSend = Boolean(text.trim()) || (Boolean(onText) && photos.length > 0)
  // Fern's composer dictates: what was said lands in the box to review and
  // send (ADR-0015). The capture screen's composer keeps voice captures.
  const dictation = Boolean(onText)
  const insert = (said: string) =>
    setText((cur) => (cur.trim() ? `${cur.trimEnd()} ${said}` : said))
  const live = useLiveDictation(setText, () =>
    toast.error("Dictation stopped. Try again, or type your message."),
  )
  async function dictate(said = "") {
    // Live words in the box when the phone can recognise speech
    // (ADR-0016); otherwise record and transcribe on the server.
    setSpoken(true)
    const before = composeDictation(text, said, "")
    if (said) setText(before)
    if (!(await live.start(before))) setMode("voice")
  }
  // "Hey Fern" heard: start dictating here, with anything said after the
  // name already in the box. A wake older than a few seconds is stale.
  const woke = wake((s) => s.pending)
  // biome-ignore lint/correctness/useExhaustiveDependencies: on a new wake only
  useEffect(() => {
    if (!woke || !wakeTarget || !dictation) return
    wake.setState({ pending: null })
    if (Date.now() - woke.at > 5_000 || live.listening) return
    void dictate(woke.rest)
  }, [woke, wakeTarget])
  function transcribe(audio: string, durationSec: number) {
    const live = require("@/live/dictate") as typeof import("@/live/dictate")
    setSpoken(true)
    setTranscribing(true)
    live
      .dictate(audio, durationSec)
      .then(insert)
      .catch((e: unknown) =>
        toast.error(
          live.dictationMessage(e instanceof live.DictationError ? e.code : ""),
        ),
      )
      .finally(() => setTranscribing(false))
  }
  return (
    <View
      style={{
        borderTopWidth: 1,
        borderColor: border(t.line, 0.6),
        backgroundColor: t.bg,
        paddingHorizontal: 12,
        paddingTop: 8,
        paddingBottom: 12,
      }}
    >
      {showHints && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 6, paddingBottom: 8 }}
          style={{ flexGrow: 0 }}
        >
          {hints.map((h) => (
            <Tap
              key={h.v}
              onPress={() => setHint(hint === h.v ? undefined : h.v)}
              style={{
                height: 44,
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                borderRadius: 22,
                borderWidth: 1,
                borderColor: hint === h.v ? "transparent" : t.line,
                backgroundColor: hint === h.v ? t.primary : t.card,
                paddingHorizontal: 14,
              }}
            >
              <h.icon size={16} color={hint === h.v ? t.onPrimary : t.muted} />
              <Copy
                size={14}
                weight="medium"
                style={{ color: hint === h.v ? t.onPrimary : t.muted }}
              >
                {h.label}
              </Copy>
            </Tap>
          ))}
        </ScrollView>
      )}
      {photos.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingBottom: 8 }}
          style={{ flexGrow: 0 }}
        >
          {photos.map((uri, i) => (
            <View
              key={`${i}-${uri.length}`}
              style={{
                width: 64,
                height: 64,
                borderRadius: 12,
                overflow: "hidden",
                backgroundColor: t.soft,
              }}
            >
              <Image
                source={{ uri }}
                accessibilityLabel={`Attached photo ${i + 1}`}
                style={{ width: "100%", height: "100%" }}
              />
              <View style={{ position: "absolute", top: 2, right: 2 }}>
                <IconTap
                  size={28}
                  icon={X}
                  label={`Remove photo ${i + 1}`}
                  background="#0009"
                  color="#fff"
                  onPress={() =>
                    setPhotos((cur) => cur.filter((_, j) => j !== i))
                  }
                />
              </View>
            </View>
          ))}
        </ScrollView>
      )}
      {!online && (
        <Copy size={12} style={{ color: t.warn, marginBottom: 8 }}>
          Offline — I'll queue it and process when you're back.
        </Copy>
      )}
      <Line style={{ gap: 6, alignItems: "flex-end" }}>
        <IconTap
          size={44}
          icon={Plus}
          label="Add"
          background={t.soft}
          onPress={() => setQuick(true)}
        />
        <View
          style={{
            flex: 1,
            minHeight: 44,
            flexDirection: "row",
            alignItems: "flex-end",
            borderRadius: 24,
            borderWidth: 1,
            borderColor: t.line,
            backgroundColor: t.card,
            paddingLeft: 14,
            paddingRight: 4,
          }}
        >
          <TextInput
            key={inputKey}
            ref={input}
            onFocus={() => {
              focused.current = true
            }}
            onBlur={() => {
              focused.current = false
            }}
            accessibilityLabel="Capture message"
            value={text}
            onChangeText={setText}
            multiline
            placeholder={
              live.listening
                ? "Listening…"
                : transcribing
                  ? "Transcribing…"
                  : (placeholders[hint ?? ""] ??
                    placeholder ??
                    "Log or ask anything…")
            }
            placeholderTextColor={border(t.muted, 0.7)}
            onContentSizeChange={(e) => {
              if (e.nativeEvent.contentSize.height > INPUT_MIN + 4)
                grown.current = true
            }}
            style={{
              minHeight: INPUT_MIN,
              maxHeight: INPUT_MAX,
              flex: 1,
              paddingVertical: 12,
              fontFamily: fonts.body,
              fontSize: 15,
              lineHeight: 20,
              color: t.text,
            }}
          />
        </View>
        {/* Dictation always has its own button, so a paused dictation
            can start again with words already in the box; Send shows
            once there is something to send. */}
        {live.listening ? (
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: `${t.primary}${Math.round(
                0x26 + live.level * 0x60,
              )
                .toString(16)
                .padStart(2, "0")}`,
            }}
          >
            <IconTap
              size={44}
              icon={Square}
              label="Stop dictation"
              color={t.primary}
              onPress={live.stop}
            />
          </View>
        ) : transcribing ? (
          <View
            accessibilityLabel="Transcribing"
            style={{
              width: 44,
              height: 44,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <ActivityIndicator color={t.primary} />
          </View>
        ) : canSend ? (
          <IconTap
            size={44}
            icon={Mic}
            label={dictation ? "Dictate" : "Record voice"}
            background={t.soft}
            onPress={() => (dictation ? void dictate() : setMode("voice"))}
          />
        ) : (
          <LinearGradient
            colors={[t.primary, t.hab]}
            style={{ borderRadius: 22 }}
          >
            <IconTap
              size={44}
              icon={Mic}
              label={dictation ? "Dictate" : "Record voice"}
              color="#fff"
              onPress={() => (dictation ? void dictate() : setMode("voice"))}
            />
          </LinearGradient>
        )}
        {canSend && !live.listening && (
          <IconTap
            size={44}
            icon={ArrowUp}
            label="Send"
            color={t.onPrimary}
            background={t.primary}
            onPress={() => {
              if (onText) {
                if (spoken) markVoiceTurn()
                onText(text.trim(), hint, photos.length ? photos : undefined)
                setText("")
                setPhotos([])
                setSpoken(false)
                return
              }
              const id = A.sendCapture({
                text: text.trim(),
                source: "text",
                hint,
              })
              setText("")
              onSent?.(id)
            }}
          />
        )}
      </Line>
      {mode === "photo" && (
        <CapturePhoto
          initialHint={hint}
          onClose={() => setMode(undefined)}
          onSent={onSent}
        />
      )}
      {mode === "voice" && (
        <CaptureVoice
          hint={hint}
          onClose={() => setMode(undefined)}
          onDone={(text, durationSec) => {
            setMode(undefined)
            if (dictation) return insert(text)
            const id = A.sendCapture({
              source: "voice",
              hint,
              text,
              durationSec,
            })
            onSent?.(id)
          }}
          onRecording={(audio, durationSec) => {
            setMode(undefined)
            if (dictation && liveMode) return transcribe(audio, durationSec)
            const id = A.sendCapture({
              source: "voice",
              hint,
              text: "",
              durationSec,
              audio,
            })
            onSent?.(id)
          }}
        />
      )}
      {quick && (
        <QuickAdd
          onClose={() => setQuick(false)}
          attach={{
            camera: () =>
              onText
                ? void pickPhoto(true).then((v) => v && addPhotos([v]))
                : setMode("photo"),
            photos: () =>
              onText
                ? void pickPhotos(MAX_PHOTOS - photos.length).then(addPhotos)
                : setMode("photo"),
            files: () => void attachFiles(onSent),
          }}
        />
      )}
    </View>
  )
}
export function Exchange({ cap }: { cap: Capture }) {
  const t = useTheme(),
    proposed =
      cap.reply?.items.filter(
        (i) => i.t === "record" && i.state === "proposed",
      ) ?? []
  return (
    <View style={{ gap: 8 }}>
      <View style={{ alignItems: "flex-end" }}>
        <Tap
          onPress={() => go(`/capture/history/${cap.id}`)}
          style={{
            maxWidth: "85%",
            backgroundColor: t.primary,
            borderRadius: 16,
            borderBottomRightRadius: 6,
            overflow: "hidden",
          }}
        >
          {cap.photo && (
            <BubblePhotos uris={[cap.photo, ...(cap.photos ?? [])]} />
          )}
          <View style={{ paddingHorizontal: 14, paddingVertical: 8 }}>
            {cap.source === "voice" && (
              <Copy size={11} style={{ color: t.onPrimary, opacity: 0.8 }}>
                Voice · {fmtDuration(cap.durationSec ?? 0)}
              </Copy>
            )}
            {cap.source === "file" && (
              <Copy size={11} style={{ color: t.onPrimary, opacity: 0.8 }}>
                {cap.fileName}
              </Copy>
            )}
            <Copy size={15} style={{ lineHeight: 20.625, color: t.onPrimary }}>
              {cap.text || (cap.source === "photo" ? cap.hint || "Photo" : "—")}
            </Copy>
          </View>
        </Tap>
        <Copy size={11} muted style={{ marginTop: 4, paddingRight: 4 }}>
          {cap.status === "queued"
            ? "Queued · will process when online"
            : new Date(cap.at).toLocaleTimeString("en-PH", {
                hour: "numeric",
                minute: "2-digit",
              })}
        </Copy>
      </View>
      {(cap.status === "processing" || cap.reply) && (
        <Line style={{ gap: 8, alignItems: "flex-start" }}>
          <View style={{ marginTop: 2 }}>
            <AiAvatar />
          </View>
          <View style={{ flex: 1, gap: 8 }}>
            {cap.status === "processing" ? (
              <Copy size={15} muted>
                Thinking…
              </Copy>
            ) : (
              cap.reply && (
                <>
                  <Copy size={15} style={{ paddingTop: 4 }}>
                    {cap.reply.text}
                  </Copy>
                  {cap.reply.items.map((item) => (
                    <Reply key={item.id} item={item} capture={cap} />
                  ))}
                  {proposed.length >= 2 && (
                    <Button
                      tone="quiet"
                      onPress={() => A.confirmAll(cap.id)}
                    >{`Confirm all ${proposed.length}`}</Button>
                  )}
                </>
              )
            )}
          </View>
        </Line>
      )}
    </View>
  )
}
export function CaptureChat() {
  const t = useTheme(),
    captures = captureStore.use((s) => s.captures),
    online = useOnline(),
    params = useLocalSearchParams<{
      hint?: string
      q?: string
      state?: string
    }>(),
    shown = params.state === "empty" ? [] : captures,
    days = [...new Set(shown.map((c) => dayKey(new Date(c.at))))],
    waiting = captures.filter((c) => c.status === "needs_input").length,
    queued = captures.filter((c) => c.status === "queued").length,
    [prefill, setPrefill] = useState(params.q ?? ""),
    [exampleMode, setExampleMode] = useState<string>()
  return (
    <Screen
      title="Capture"
      scrollToEnd={!!shown.length}
      titleContent={
        <Line style={{ gap: 6 }}>
          <AiAvatar size={32} />
          <View style={{ paddingLeft: 4 }}>
            <Copy size={20} weight="displayMedium" style={{ lineHeight: 25 }}>
              Capture
            </Copy>
            <Copy size={12} muted>
              Log or ask anything
            </Copy>
          </View>
        </Line>
      }
      actions={
        <Line style={{ gap: 0 }}>
          {(!online || queued > 0) && (
            <Tap
              onPress={() => go("/capture/queue")}
              style={{
                height: 44,
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                paddingHorizontal: 12,
                borderRadius: 22,
                backgroundColor: border(t.warn, 0.15),
              }}
            >
              <WifiOff size={14} color={t.warn} />
              <Copy size={14} style={{ color: t.warn }}>
                {queued}
              </Copy>
            </Tap>
          )}
          <View>
            <IconTap
              size={44}
              icon={Clock}
              label="History"
              color={t.text}
              onPress={() => go("/capture/history")}
            />
            {waiting > 0 && (
              <View
                pointerEvents="none"
                style={{
                  position: "absolute",
                  top: 6,
                  right: 6,
                  width: 16,
                  height: 16,
                  borderRadius: 8,
                  backgroundColor: t.warn,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Copy size={9} style={{ color: "#000" }}>
                  {waiting}
                </Copy>
              </View>
            )}
          </View>
          <IconTap
            size={44}
            icon={Settings2}
            label="AI settings"
            color={t.text}
            onPress={() => go("/capture/settings")}
          />
        </Line>
      }
      footer={
        <ThreadComposer
          key={`${prefill}:${exampleMode}`}
          initialText={prefill}
          initialMode={exampleMode}
          initialHint={params.hint}
        />
      }
    >
      <View style={{ gap: 24, paddingVertical: 16 }}>
        {days.map((d) => (
          <View key={d} style={{ gap: 20 }}>
            <Line style={{ gap: 12 }}>
              <View
                style={{
                  height: 1,
                  flex: 1,
                  backgroundColor: border(t.line, 0.6),
                }}
              />
              <Copy size={11} muted>
                {d === dayKey()
                  ? "Today"
                  : d === dayOffset(-1)
                    ? "Yesterday"
                    : new Date(`${d}T12:00:00`).toLocaleDateString("en-PH", {
                        month: "short",
                        day: "numeric",
                      })}
              </Copy>
              <View
                style={{
                  height: 1,
                  flex: 1,
                  backgroundColor: border(t.line, 0.6),
                }}
              />
            </Line>
            {shown
              .filter((c) => dayKey(new Date(c.at)) === d)
              .map((cap) => (
                <Exchange key={cap.id} cap={cap} />
              ))}
          </View>
        ))}
        {!shown.length && (
          <View style={{ alignItems: "center", paddingVertical: 40 }}>
            <AiAvatar size={56} />
            <Copy
              size={30}
              weight="displayMedium"
              style={{ marginTop: 16, letterSpacing: -0.75 }}
            >
              What happened today?
            </Copy>
            <Copy
              size={14}
              muted
              style={{ maxWidth: 288, textAlign: "center", marginTop: 4 }}
            >
              Say it the way you'd text a friend. Several things at once is fine
              — I'll sort them into the right places.
            </Copy>
            <View style={{ width: "100%", gap: 8, marginTop: 20 }}>
              {[
                "ran 5k 32 min, spent 250 on grab, remind me to pay rent on the 30th",
                "did my meditation",
                "how much did I spend on food this month?",
                "weighed 78.4",
                "Snap your lunch",
              ].map((e) => (
                <Tap
                  key={e}
                  onPress={() => {
                    if (e === "Snap your lunch") setExampleMode("photo")
                    else {
                      setExampleMode(undefined)
                      setPrefill(e)
                    }
                  }}
                >
                  <Frame
                    style={{
                      minHeight: 48,
                      paddingHorizontal: 16,
                      paddingVertical: 12,
                    }}
                  >
                    <Copy size={14}>{e}</Copy>
                  </Frame>
                </Tap>
              ))}
            </View>
            <Copy
              size={11}
              muted
              style={{ marginTop: 24, textAlign: "center" }}
            >
              Only what a message needs is sent to the AI. Your journal stays
              out of Q&A.
            </Copy>
          </View>
        )}
      </View>
    </Screen>
  )
}

/** Every photo of a capture in its bubble: one fills it, two sit side by
 * side, more wrap in a grid (a capture holds a few at most). */
function BubblePhotos({ uris }: { uris: string[] }) {
  if (uris.length === 1)
    return (
      <Image
        accessibilityLabel="Photo"
        source={{ uri: uris[0] }}
        style={{ width: 220, height: 192 }}
      />
    )
  const size = uris.length === 2 ? 109 : 72
  return (
    <View
      accessibilityLabel={`${uris.length} photos`}
      style={{ width: 220, flexDirection: "row", flexWrap: "wrap", gap: 2 }}
    >
      {uris.map((uri, i) => (
        <Image
          key={`${uri}-${i}`}
          source={{ uri }}
          style={{ width: size, height: uris.length === 2 ? 160 : size }}
        />
      ))}
    </View>
  )
}
