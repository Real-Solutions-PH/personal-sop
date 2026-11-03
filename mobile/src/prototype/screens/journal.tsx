import * as A from "@domain/capture/actions"
import {
  AREAS,
  CHECK_IN,
  type JournalEntry,
  MOODS,
  type Mood,
} from "@domain/capture/data"
import { journalDraft } from "@domain/capture/parse"
import { captureStore, isOnline, useOnline } from "@domain/capture/store"
import { dayKey, dayOffset, weekday } from "@domain/lib/day"
import {
  Briefcase,
  Check,
  CloudOff,
  Compass,
  Flame,
  HeartPulse,
  Mic,
  Moon,
  PenLine,
  Plus,
  Search,
  Share2,
  Sprout,
  Trash2,
  Users,
  Wallet,
} from "lucide-react-native"
import { type ReactNode, useContext, useEffect, useRef, useState } from "react"
import {
  Keyboard,
  Platform,
  ScrollView,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native"
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import Svg, {
  Circle,
  G,
  Path,
  Line as SvgLine,
  Text as SvgText,
} from "react-native-svg"
import { toast } from "sonner-native"
import { CornerMotif } from "../brand/corner"
import { leaf } from "../brand/scribble"
import { feel, StreakChip } from "../motion"
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
import {
  Button,
  DateField,
  groupBy,
  MoreRows,
  PageScroll,
  Screen,
  usePaged,
} from "../ui"
import { CaptureVoice } from "./capture-voice"
import { MoodPicker, moodIcons } from "./mood-picker"

const areaIcons = {
  identity: Compass,
  career: Briefcase,
  health: HeartPulse,
  money: Wallet,
  relationships: Users,
  growth: Sprout,
}
const dayLabel = (day: string) =>
  day === dayKey()
    ? "Today"
    : day === dayOffset(-1)
      ? "Yesterday"
      : new Date(`${day}T12:00:00`).toLocaleDateString("en-PH", {
          weekday: "long",
          month: "short",
          day: "numeric",
        })
const timeLabel = (at: string) =>
  new Date(at).toLocaleTimeString("en-PH", {
    hour: "numeric",
    minute: "2-digit",
  })
export function AreaPicker({
  value,
  onChange,
}: {
  value?: string
  onChange: (v: string | undefined) => void
}) {
  const t = useTheme()
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {AREAS.map((a) => {
        const I = areaIcons[a.key],
          on = value === a.key
        return (
          <Tap
            key={a.key}
            onPress={() => onChange(on ? undefined : a.key)}
            style={{
              height: 44,
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingHorizontal: 14,
              borderRadius: 22,
              backgroundColor: on ? t.life : t.card,
              borderWidth: 1,
              borderColor: on ? t.life : t.line,
            }}
          >
            <I size={16} color={on ? t.bg : t.text} />
            <Copy
              size={14}
              weight="medium"
              style={{ color: on ? t.bg : t.text }}
            >
              {a.label}
            </Copy>
          </Tap>
        )
      })}
    </View>
  )
}
const journalAudio = () =>
  require("@/live/journal-audio") as typeof import("@/live/journal-audio")

/** Live: keep the recording as an entry now, its words come later. */
async function saveRecording(uri: string, seconds: number, online: boolean) {
  await journalAudio().saveVoiceEntry(uri, seconds)
  if (!online)
    toast.warning(
      "Journal entry saved. It'll be transcribed when you're back online.",
    )
  void journalAudio().transcribePending()
}

function JournalVoice({
  onClose,
  onDone,
  onRecording,
}: {
  onClose: () => void
  onDone: (text: string) => void
  /** Live: what to do with the recording (default: transcribe it now). */
  onRecording?: (uri: string, seconds: number) => void
}) {
  return (
    <CaptureVoice
      hint="journal"
      onClose={onClose}
      onDone={(text) => onDone(text)}
      // Live: what was said, transcribed on the server. Without this the
      // recorder fell back to its demo sentence and saved that instead.
      onRecording={
        onRecording ??
        ((uri, seconds) => {
          const live =
            require("@/live/dictate") as typeof import("@/live/dictate")
          if (!isOnline()) {
            onClose()
            void saveRecording(uri, seconds, false)
            return
          }
          const wait = toast.loading("Transcribing your entry…")
          live
            .dictate(uri, seconds)
            .then((text) => {
              toast.dismiss(wait)
              onDone(text)
            })
            .catch((e: unknown) => {
              toast.dismiss(wait)
              onClose()
              const code = e instanceof live.DictationError ? e.code : ""
              // The recording is never thrown away for want of a network:
              // it becomes its own entry, transcribed later.
              if (code === "network") void saveRecording(uri, seconds, false)
              else toast.error(live.dictationMessage(code))
            })
        })
      }
    />
  )
}

/** Under a voice entry still waiting for its words. */
function TranscriptionNote({ e }: { e: JournalEntry }) {
  const t = useTheme()
  if (e.transcription === "pending")
    return (
      <Copy size={14} muted>
        Voice entry · transcription pending
      </Copy>
    )
  if (e.transcription !== "failed") return null
  const { dictationMessage } =
    require("@/live/dictate") as typeof import("@/live/dictate")
  return (
    <Tap
      label="Transcribe again"
      onPress={() => void journalAudio().retryTranscription(e.id)}
    >
      <Copy size={14} muted>
        {dictationMessage(e.transcriptionError ?? "")}{" "}
        <Copy size={14} style={{ color: t.life }}>
          Transcribe again
        </Copy>
      </Copy>
    </Tap>
  )
}

function MoodTrend({ entries }: { entries: JournalEntry[] }) {
  const t = useTheme(),
    weeks = Array.from({ length: 8 }, (_, i) => {
      const w = 7 - i,
        from = dayOffset(-7 * w - 6),
        to = dayOffset(-7 * w),
        m = entries
          .filter((e) => e.mood && e.day >= from && e.day <= to)
          .map((e) => e.mood!)
      return {
        label: w === 0 ? "Now" : `${w}w`,
        avg: m.length ? m.reduce((a, b) => a + b, 0) / m.length : null,
      }
    }),
    counts = MOODS.map(
      (x) =>
        entries.filter((e) => e.mood === x.v && e.day >= dayOffset(-56)).length,
    ),
    total = counts.reduce((a, b) => a + b, 0),
    cur = weeks.at(-1)?.avg ?? null,
    prev = weeks.at(-2)?.avg ?? null,
    curMood = cur === null ? null : (Math.round(cur) as Mood),
    I = curMood ? moodIcons[curMood] : null,
    x = (i: number) => 26 + (246 * i) / 7,
    y = (v: number) => 92 - (v - 1) * 21,
    segs: string[] = []
  let seg = ""
  weeks.forEach((w, i) => {
    if (w.avg === null) {
      if (seg) segs.push(seg)
      seg = ""
    } else seg += `${seg ? "L" : "M"}${x(i)},${y(w.avg)} `
  })
  if (seg) segs.push(seg)
  return (
    <View style={{ marginTop: 12 }}>
      <Line style={{ justifyContent: "space-between", marginBottom: 4 }}>
        <Copy size={12} muted>
          Mood · 8 weeks
        </Copy>
        {I && cur !== null && (
          <Line style={{ gap: 6 }}>
            <I size={16} color={t.life} />
            <Copy size={14} weight="medium">
              {MOODS.find((m) => m.v === curMood)?.label}
            </Copy>
            <Copy size={12} muted>
              {cur.toFixed(1)}
            </Copy>
            {prev !== null && Math.abs(cur - prev) >= 0.05 && (
              <Copy size={12} style={{ color: cur > prev ? t.good : t.bad }}>
                {cur > prev ? "▲" : "▼"}
                {Math.abs(cur - prev).toFixed(1)}
              </Copy>
            )}
          </Line>
        )}
      </Line>
      <Svg width="100%" height={136} viewBox="0 0 280 110">
        {MOODS.map((m) => (
          <SvgLine
            key={m.v}
            x1={26}
            x2={272}
            y1={y(m.v)}
            y2={y(m.v)}
            stroke={t.line}
            strokeDasharray="2 4"
          />
        ))}
        {MOODS.map((m) => {
          const I = moodIcons[m.v]
          return (
            <G key={m.v} x={2} y={y(m.v) - 7}>
              <I size={14} color={t.muted} />
            </G>
          )
        })}
        {/* The brand's hand-drawn line (ADR-0032): the stroke, and a
            thinner echo just off it. */}
        {segs.map((d) => (
          <G key={d}>
            <Path
              d={d}
              fill="none"
              stroke={t.life}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <Path
              d={d}
              fill="none"
              stroke={t.life}
              strokeWidth={1.1}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.5}
              transform="translate(0.8 -1.2)"
            />
          </G>
        ))}
        {weeks.map((w, i) => (
          <Circle
            key={w.label}
            cx={x(i)}
            cy={y(w.avg ?? 3)}
            r={w.avg === null ? 3 : i === 7 ? 5 : 3.5}
            fill={w.avg === null ? "none" : t.life}
            stroke={w.avg === null ? border(t.muted, 0.4) : t.card}
          />
        ))}
        {weeks.map((w, i) => (
          <SvgText
            key={w.label}
            x={x(i)}
            y={108}
            fill={t.muted}
            fontSize={9}
            textAnchor="middle"
            fontFamily={fonts.body}
          >
            {w.label}
          </SvgText>
        ))}
      </Svg>
      <Line style={{ gap: 6, marginTop: 8 }}>
        {MOODS.map((m, i) => {
          const Icon = moodIcons[m.v]
          return (
            <View key={m.v} style={{ flex: 1, alignItems: "center", gap: 3 }}>
              <Icon
                size={16}
                color={counts[i] ? t.life : border(t.muted, 0.5)}
              />
              <Copy size={11} muted>
                {m.label}
              </Copy>
              <Copy size={11} weight="medium">
                {total ? Math.round((counts[i] / total) * 100) : 0}%
              </Copy>
            </View>
          )
        })}
      </Line>
    </View>
  )
}
export function Journal({
  id,
  creating = false,
}: {
  id?: string
  creating?: boolean
}) {
  return id || creating ? (
    <JournalEditor key={id ?? "new"} id={id} />
  ) : (
    <JournalList />
  )
}
/** Days in a row with an entry, up to today (or yesterday while today has
 * none yet: an open day does not break the streak). */
export function journalStreak(days: Set<string>, today = dayKey()) {
  const noon = new Date(`${today}T12:00:00`)
  const back = (n: number) => dayOffset(n, noon)
  let n = 0
  const base = days.has(today) ? 0 : -1
  while (days.has(back(base - n))) n++
  return n
}
const streakOf = (journal: readonly { day: string; tags: string[] }[]) =>
  journalStreak(
    new Set(
      journal.filter((e) => !e.tags.includes(CHECK_IN)).map((e) => e.day),
    ),
  )

/** Pops its child when ``on`` goes up while on screen. */
function Bump({ on, children }: { on: number; children: ReactNode }) {
  const reduced = useReducedMotion()
  const scale = useSharedValue(1)
  const prev = useRef(on)
  useEffect(() => {
    if (on > prev.current && !reduced)
      scale.value = withSequence(
        withTiming(1.25, { duration: 120 }),
        withSpring(1, { damping: 8, stiffness: 260 }),
      )
    prev.current = on
  }, [on, reduced, scale])
  const pop = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }))
  return (
    <Animated.View style={[{ alignSelf: "flex-start" }, pop]}>
      {children}
    </Animated.View>
  )
}

function JournalList() {
  const t = useTheme(),
    all = captureStore.use((s) => s.journal),
    [q, setQ] = useState(""),
    [area, setArea] = useState<string>(),
    [talk, setTalk] = useState(false),
    // Mood check-ins count in the trend only, not as entries or streak days.
    entries = all
      .filter((e) => !e.tags.includes(CHECK_IN))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    shown = entries.filter(
      (e) =>
        (!area || e.area === area) &&
        (!q ||
          e.body.toLowerCase().includes(q.toLowerCase()) ||
          e.tags.some((tag) => tag.includes(q.toLowerCase()))),
    ),
    // One pass: each day's entries, newest day first.
    byDay = groupBy(shown, (e) => e.day),
    groups = [...byDay.keys()].sort((a, b) => b.localeCompare(a)),
    days = new Set(entries.map((e) => e.day)),
    lead = weekday(dayOffset(-27)),
    heat = [
      ...Array.from({ length: lead }, () => null),
      ...Array.from({ length: 28 }, (_, i) =>
        days.has(dayOffset(i - 27)) ? 1 : 0,
      ),
    ]
  const streak = journalStreak(days)
  const page = usePaged(groups, `${area}|${q}`)
  return (
    <Screen
      title="Journal"
      onEndReached={page.more}
      actions={
        <Line style={{ gap: 0 }}>
          <IconTap
            size={44}
            icon={Share2}
            label="Share your journal streak"
            color={t.text}
            onPress={() => go("/journal/share")}
          />
          <IconTap
            size={44}
            icon={Plus}
            label="New entry"
            color={t.text}
            onPress={() => go("/journal/new")}
          />
        </Line>
      }
    >
      <View>
        <Frame style={{ padding: 16 }}>
          <CornerMotif kind="vine" seed={7} />
          <Line style={{ gap: 8 }}>
            {[
              { label: "Streak", value: `${streak}d` },
              {
                label: "This week",
                value: entries.filter((e) => e.day >= dayOffset(-6)).length,
              },
              { label: "Entries", value: entries.length },
            ].map((x, i) => (
              <View
                key={x.label}
                style={{
                  flex: 1,
                  paddingLeft: i ? 12 : 0,
                  borderLeftWidth: i ? 1 : 0,
                  borderColor: t.line,
                }}
              >
                <Bump on={i === 0 ? streak : 0}>
                  <Copy
                    size={28}
                    weight="display"
                    style={{ color: i === 0 ? t.life : t.text }}
                  >
                    {x.value}
                  </Copy>
                </Bump>
                <Line style={{ gap: 4 }}>
                  {i === 0 && <Flame size={14} color={t.life} />}
                  <Copy size={12} muted>
                    {x.label}
                  </Copy>
                </Line>
              </View>
            ))}
          </Line>
          <Line style={{ alignItems: "flex-start", gap: 4, marginTop: 16 }}>
            <View style={{ gap: 4 }}>
              {["S", "M", "T", "W", "T", "F", "S"].map((label, i) => (
                <Copy
                  key={`${label}${i}`}
                  size={9}
                  muted
                  style={{ height: 14, lineHeight: 14, width: 10 }}
                >
                  {label}
                </Copy>
              ))}
            </View>
            {Array.from({ length: Math.ceil(heat.length / 7) }, (_, col) => (
              <View key={col} style={{ gap: 4 }}>
                {heat
                  .slice(col * 7, col * 7 + 7)
                  .map((v, i) =>
                    v === null ? (
                      <View key={i} style={{ width: 14, height: 14 }} />
                    ) : (
                      <DayLeaf
                        key={i}
                        on={v === 1}
                        seed={col * 7 + i}
                        color={t.life}
                        faint={t.muted}
                      />
                    ),
                  )}
              </View>
            ))}
          </Line>
          <Copy size={11} muted style={{ marginTop: 4 }}>
            Last 4 weeks
          </Copy>
          {all.filter((e) => e.mood).length >= 5 && <MoodTrend entries={all} />}
        </Frame>
        <Line style={{ gap: 8, marginTop: 12 }}>
          <View style={{ flex: 1 }}>
            <Button tone="quiet" icon={Mic} onPress={() => setTalk(true)}>
              Talk it out
            </Button>
          </View>
          <View style={{ flex: 1 }}>
            <Button icon={PenLine} href="/journal/new">
              Write
            </Button>
          </View>
        </Line>
        {!!entries.length && (
          <>
            <Line
              style={{
                height: 44,
                marginTop: 16,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: t.line,
                backgroundColor: t.card,
                paddingHorizontal: 12,
                gap: 8,
              }}
            >
              <Search size={16} color={t.muted} />
              <TextInput
                accessibilityLabel="Search journal"
                value={q}
                onChangeText={setQ}
                placeholder="Search entries and #tags"
                placeholderTextColor={t.muted}
                style={{
                  flex: 1,
                  height: 44,
                  fontFamily: fonts.body,
                  fontSize: 15,
                  color: t.text,
                }}
              />
            </Line>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ flexGrow: 0, marginTop: 8 }}
            >
              <AreaPicker value={area} onChange={setArea} />
            </ScrollView>
          </>
        )}
        {page.rows.map((day) => (
          <View key={day}>
            <SectionHeading>{dayLabel(day)}</SectionHeading>
            <View style={{ gap: 8 }}>
              {(byDay.get(day) ?? []).map((e) => {
                const S =
                    e.source === "voice"
                      ? Mic
                      : e.source === "wrapup"
                        ? Moon
                        : PenLine,
                  M = e.mood ? moodIcons[e.mood] : null
                return (
                  <Tap key={e.id} onPress={() => go(`/journal/${e.id}`)}>
                    <Frame style={{ padding: 14 }}>
                      <Line style={{ gap: 8, marginBottom: 6 }}>
                        <S size={14} color={t.muted} />
                        <Copy size={12} muted style={{ flex: 1 }}>
                          {timeLabel(e.createdAt)}
                        </Copy>
                        {M && (
                          <Line
                            style={{
                              gap: 4,
                              paddingHorizontal: 6,
                              paddingVertical: 2,
                              borderRadius: 6,
                              backgroundColor: t.soft,
                            }}
                          >
                            <M size={14} color={t.muted} />
                            <Copy size={12} muted>
                              {MOODS.find((m) => m.v === e.mood)?.label}
                            </Copy>
                          </Line>
                        )}
                        {!!e.area && (
                          <View
                            style={{
                              paddingHorizontal: 6,
                              paddingVertical: 2,
                              borderRadius: 6,
                              backgroundColor: t.soft,
                            }}
                          >
                            <Copy size={12} muted>
                              {AREAS.find((a) => a.key === e.area)?.label ??
                                e.area}
                            </Copy>
                          </View>
                        )}
                      </Line>
                      <Copy size={15} lines={3} style={{ lineHeight: 24.375 }}>
                        {e.body}
                      </Copy>
                      <TranscriptionNote e={e} />
                      {!!e.tags.length && (
                        <Copy size={12} muted style={{ marginTop: 6 }}>
                          {e.tags.map((tag) => `#${tag}`).join("  ")}
                        </Copy>
                      )}
                    </Frame>
                  </Tap>
                )
              })}
            </View>
          </View>
        ))}
        {page.hasMore && <MoreRows />}
        {!groups.length && (
          <View style={{ alignItems: "center", padding: 32, gap: 12 }}>
            <Copy weight="semibold">
              {entries.length ? "No entries match" : "Your journal is empty"}
            </Copy>
            <Copy size={14} muted>
              {entries.length
                ? "Try another word or area."
                : "Two lines a night is enough. Talk it out, or say “journal: …” in Capture — tonight’s wrap-up adds one too."}
            </Copy>
          </View>
        )}
      </View>
      {talk && (
        <JournalVoice
          onClose={() => setTalk(false)}
          onRecording={(uri, seconds) => {
            setTalk(false)
            void saveRecording(uri, seconds, isOnline())
          }}
          onDone={(text) => {
            const d = journalDraft(text, "voice")
            if (d.payload.kind !== "journal") return
            const e = A.addJournalEntry({
              body: d.payload.body,
              source: "voice",
              mood: d.payload.mood,
              area: d.payload.area,
              tags: d.payload.tags,
              transcript: text,
            })
            toast.success("Journal entry saved", {
              action: {
                label: "Undo",
                onClick: () => A.deleteJournalEntry(e.id),
              },
            })
            setTalk(false)
            go(`/journal/${e.id}`)
          }}
        />
      )}
    </Screen>
  )
}
/** How long typing pauses before the entry is written. */
export const AUTOSAVE_MS = 700
type SaveState =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "saved"; at: Date }
  | { kind: "blocked"; why: string }
const parseTags = (tags: string) =>
  tags
    .split(/[,\s]+/)
    .map((s) => s.replace(/^#/, "").trim().toLowerCase())
    .filter(Boolean)
/** Notes-style: a page-high writing surface that saves itself while you
 * type (to this phone first; sync sends it on). No Save button: leaving
 * keeps what is written, and a new entry left empty is never kept. */
/** The entry's text. It grows with what is written, so the page is the one
 * scroller and the entry reads from its first line to its last; while the
 * caret is at the end, the page follows it, above the keyboard too. */
function EntryText({
  value,
  onChangeText,
  autoFocus,
  minHeight,
  keyboard,
  pageTop,
}: {
  value: string
  onChangeText: (v: string) => void
  autoFocus: boolean
  minHeight: number
  keyboard: number
  pageTop: { current: number }
}) {
  const t = useTheme(),
    reveal = useContext(PageScroll),
    top = useRef(0),
    atEnd = useRef(autoFocus),
    caretBottom = useRef(0),
    text = useRef(value)
  text.current = value
  // The keyboard rising shrinks the page: once it has settled, bring the
  // caret back above it.
  useEffect(() => {
    if (!keyboard || !atEnd.current) return
    const timer = setTimeout(() => reveal(caretBottom.current), 300)
    return () => clearTimeout(timer)
  }, [keyboard, reveal])
  return (
    <TextInput
      accessibilityLabel="Entry"
      value={value}
      onChangeText={onChangeText}
      autoFocus={autoFocus}
      multiline
      scrollEnabled={false}
      onLayout={(e) => {
        top.current = e.nativeEvent.layout.y
      }}
      onSelectionChange={(e) => {
        atEnd.current = e.nativeEvent.selection.end >= text.current.length
      }}
      onContentSizeChange={(e) => {
        caretBottom.current =
          pageTop.current + top.current + e.nativeEvent.contentSize.height + 20
        if (atEnd.current) reveal(caretBottom.current)
      }}
      placeholder="What happened today? What did you notice? Who are you becoming?"
      placeholderTextColor={t.muted}
      style={{
        minHeight,
        paddingTop: 4,
        paddingBottom: 16,
        fontSize: 18,
        lineHeight: 28,
        fontFamily: fonts.body,
        color: t.text,
        textAlignVertical: "top",
      }}
    />
  )
}
function JournalEditor({ id }: { id?: string }) {
  const t = useTheme(),
    safe = useSafeAreaInsets(),
    { height } = useWindowDimensions(),
    online = useOnline(),
    existing = captureStore.use((s) => s.journal.find((j) => j.id === id)),
    streak = captureStore.use((s) => streakOf(s.journal)),
    [body, setBody] = useState(existing?.body ?? ""),
    [day, setDay] = useState(existing?.day ?? dayKey()),
    [mood, setMood] = useState(existing?.mood),
    [area, setArea] = useState(existing?.area),
    [tags, setTags] = useState(existing?.tags.join(", ") ?? ""),
    [priv, setPriv] = useState(existing?.private ?? true),
    [transcript, setTranscript] = useState(existing?.transcript),
    [dictate, setDictate] = useState(false),
    [showTranscript, setShowTranscript] = useState(false),
    [save, setSave] = useState<SaveState>({ kind: "idle" }),
    [keyboard, setKeyboard] = useState(0),
    // The entry this page writes to: the opened one, or the one it created.
    entryId = useRef(existing?.id),
    createdHere = useRef(false),
    edited = useRef(false),
    emptyNow = useRef(!existing?.body.trim()),
    latest = useRef<() => void>(() => {}),
    // Where the details block (the entry's parent) starts in the page.
    pageTop = useRef(0)
  // A voice entry's words arrive while it is open: show them unless the
  // person has started writing.
  const words = existing?.transcription ? undefined : existing?.body
  useEffect(() => {
    if (words) setBody((old) => old || words)
  }, [words])
  useEffect(() => {
    const show = Keyboard.addListener(
        Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
        (e) => setKeyboard(e.endCoordinates.height),
      ),
      hide = Keyboard.addListener(
        Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
        () => setKeyboard(0),
      )
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])
  // Write what is on screen now. Empty or future-dated text is not saved.
  emptyNow.current = !body.trim()
  latest.current = () => {
    if (!edited.current) return
    const text = body.trim()
    if (!text) {
      setSave({ kind: "blocked", why: "Not saved while empty" })
      return
    }
    if (day > dayKey()) {
      setSave({ kind: "blocked", why: "Pick today or an earlier day" })
      return
    }
    const input = {
      body: text,
      day,
      mood,
      area,
      tags: parseTags(tags),
      private: priv,
      transcript,
    }
    if (entryId.current) A.updateJournalEntry(entryId.current, input)
    else {
      entryId.current = A.addJournalEntry({
        ...input,
        source: transcript ? "voice" : "text",
      }).id
      createdHere.current = true
    }
    edited.current = false
    setSave({ kind: "saved", at: new Date() })
  }
  // The save that starts today's entry grows the streak: the chip by the
  // save line bumps and the phone taps once.
  const lastStreak = useRef(streak)
  useEffect(() => {
    if (streak > lastStreak.current) feel.success()
    lastStreak.current = streak
  }, [streak])
  // Debounced autosave: every change restarts the wait.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the fields are the trigger; latest.current reads them
  useEffect(() => {
    if (!edited.current) return
    setSave({ kind: "pending" })
    const timer = setTimeout(() => latest.current(), AUTOSAVE_MS)
    return () => clearTimeout(timer)
  }, [body, day, mood, area, tags, priv, transcript])
  // Leaving writes anything still waiting; a new entry emptied is dropped.
  useEffect(
    () => () => {
      latest.current()
      const e = entryId.current
      if (e && createdHere.current && emptyNow.current) A.deleteJournalEntry(e)
    },
    [],
  )
  const edit =
    <V,>(set: (v: V) => void) =>
    (v: V) => {
      edited.current = true
      set(v)
    }
  if (id && !existing && !entryId.current)
    return (
      <Screen title="Entry">
        <Copy>Entry not found</Copy>
        <Copy muted>It may have been deleted.</Copy>
        <Button href="/journal">Journal</Button>
      </Screen>
    )
  // The writing surface fills at least what the header, the save line and
  // the keyboard (or the bottom bar) leave, and grows with its text: the
  // page is the one scroller, so the entry reads from its first line to its
  // last, and the details sit below it.
  const surface = Math.max(
    220,
    height - safe.top - 56 - 52 - (keyboard ? keyboard : safe.bottom + 64) - 24,
  )
  const status =
    save.kind === "pending"
      ? { text: "Saving…", color: t.muted, icon: null }
      : save.kind === "blocked"
        ? { text: save.why, color: t.warn, icon: null }
        : save.kind === "saved" || entryId.current
          ? {
              text: `${online ? "Saved" : "Saved on this phone · syncs when online"}${
                save.kind === "saved"
                  ? ` · ${timeLabel(save.at.toISOString())}`
                  : ""
              }`,
              color: t.muted,
              icon: online ? Check : CloudOff,
            }
          : { text: "Saves as you type", color: t.muted, icon: null }
  return (
    <Screen
      title={entryId.current ? dayLabel(day) : "New entry"}
      actions={
        <Line style={{ gap: 0 }}>
          <IconTap
            size={44}
            icon={Mic}
            label="Dictate"
            color={t.life}
            onPress={() => setDictate(true)}
          />
          {entryId.current && (
            <IconTap
              size={44}
              icon={Trash2}
              label="Delete entry"
              onPress={() => {
                const gone = entryId.current
                  ? A.deleteJournalEntry(entryId.current)
                  : undefined
                edited.current = false
                createdHere.current = false
                go("/journal")
                if (gone)
                  toast("Entry deleted", {
                    action: {
                      label: "Undo",
                      onClick: () => A.restoreJournalEntry(gone),
                    },
                  })
              }}
            />
          )}
        </Line>
      }
      pinned={
        <Line style={{ gap: 8, minHeight: 44 }}>
          <View style={{ minWidth: 140 }}>
            <DateField
              hideLabel
              label="Entry date"
              maximumDate={dayKey()}
              value={day}
              onChangeText={edit(setDay)}
            />
          </View>
          <View
            accessibilityLiveRegion="polite"
            style={{
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: 4,
            }}
          >
            {status.icon && <status.icon size={14} color={status.color} />}
            <Copy size={12} style={{ color: status.color, flexShrink: 1 }}>
              {status.text}
            </Copy>
            {entryId.current && day === dayKey() && (
              <StreakChip streak={streak} />
            )}
          </View>
        </Line>
      }
    >
      <View
        onLayout={(e) => {
          pageTop.current = e.nativeEvent.layout.y
        }}
      >
        {existing && <TranscriptionNote e={existing} />}
        <EntryText
          value={body}
          onChangeText={edit(setBody)}
          autoFocus={!existing}
          minHeight={surface}
          keyboard={keyboard}
          pageTop={pageTop}
        />
        <SectionHeading>Mood</SectionHeading>
        <MoodPicker value={mood} onChange={edit(setMood)} />
        <SectionHeading>Area</SectionHeading>
        <AreaPicker value={area} onChange={edit(setArea)} />
        <SectionHeading>Tags</SectionHeading>
        <TextInput
          accessibilityLabel="Tags"
          value={tags}
          onChangeText={edit(setTags)}
          placeholder="sleep, gratitude, win"
          placeholderTextColor={t.muted}
          style={{
            height: 44,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: t.line,
            backgroundColor: t.card,
            paddingHorizontal: 12,
            fontFamily: fonts.body,
            fontSize: 15,
            color: t.text,
          }}
        />
        <Frame style={{ padding: 12, marginTop: 16 }}>
          <Line style={{ gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Copy size={14} weight="medium">
                Private
              </Copy>
              <Copy size={12} muted>
                Kept out of AI answers and share cards
              </Copy>
            </View>
            <Switch
              compact
              accent="life"
              label="Private"
              value={priv}
              onChange={edit(setPriv)}
            />
          </Line>
        </Frame>
        {!!transcript && (
          <Tap
            onPress={() => setShowTranscript((v) => !v)}
            style={{
              padding: 12,
              borderRadius: 12,
              backgroundColor: border(t.soft, 0.5),
              marginTop: 12,
            }}
          >
            <Copy
              size={14}
              weight="medium"
              muted
              style={{ paddingVertical: 8 }}
            >
              Original transcript {showTranscript ? "⌃" : "⌄"}
            </Copy>
            {showTranscript && (
              <Copy size={14} muted>
                {transcript}
              </Copy>
            )}
          </Tap>
        )}
      </View>
      {dictate && (
        <JournalVoice
          onClose={() => setDictate(false)}
          onDone={(text) => {
            const d = journalDraft(text, "voice")
            if (d.payload.kind !== "journal") return
            const content = d.payload.body
            edited.current = true
            setBody((old) => (old ? `${old}\n\n${content}` : content))
            setTranscript(text)
            if (!mood) setMood(d.payload.mood)
            if (!area) setArea(d.payload.area)
            setDictate(false)
          }}
        />
      )}
    </Screen>
  )
}

/** One day of the Journal heatmap as a leaf: filled when written, a faint
 * outline when not (card library, Journal). Leaves lean a little each way so
 * the grid reads hand-drawn. */
function DayLeaf({
  on,
  seed,
  color,
  faint,
}: {
  on: boolean
  seed: number
  color: string
  faint: string
}) {
  const ang = -Math.PI * (0.62 + ((seed * 37) % 7) * 0.02)
  return (
    <Svg width={14} height={14} viewBox="0 0 14 14">
      <Path
        d={leaf(4, 12, 11, ang, 0.42)}
        fill={on ? color : "none"}
        stroke={on ? color : faint}
        strokeWidth={on ? 0.8 : 0.9}
        opacity={on ? 1 : 0.45}
      />
    </Svg>
  )
}
