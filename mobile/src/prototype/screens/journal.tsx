import * as A from "@domain/capture/actions"
import {
  AREAS,
  type JournalEntry,
  MOODS,
  type Mood,
} from "@domain/capture/data"
import { journalDraft } from "@domain/capture/parse"
import { captureStore } from "@domain/capture/store"
import { dayKey, dayOffset, weekday } from "@domain/lib/day"
import {
  Annoyed,
  Briefcase,
  Compass,
  Flame,
  Frown,
  HeartPulse,
  Laugh,
  Meh,
  Mic,
  Moon,
  PenLine,
  Plus,
  Search,
  Smile,
  Sprout,
  Trash2,
  Users,
  Wallet,
} from "lucide-react-native"
import { useState } from "react"
import { ScrollView, TextInput, View } from "react-native"
import Svg, {
  Circle,
  G,
  Path,
  Line as SvgLine,
  Text as SvgText,
} from "react-native-svg"
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
import { Button, DateField, Screen } from "../ui"
import { CaptureVoice } from "./capture-voice"

const moodIcons = { 1: Frown, 2: Annoyed, 3: Meh, 4: Smile, 5: Laugh }
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
export function MoodPicker({
  value,
  onChange,
}: {
  value?: Mood
  onChange: (v: Mood | undefined) => void
}) {
  const t = useTheme()
  return (
    <Line style={{ gap: 6 }}>
      {MOODS.map((m) => {
        const I = moodIcons[m.v],
          on = value === m.v
        return (
          <Tap
            key={m.v}
            label={m.label}
            onPress={() => onChange(on ? undefined : m.v)}
            style={{
              height: 56,
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
              borderRadius: 12,
              backgroundColor: on ? border(t.life, 0.2) : t.soft,
              borderWidth: on ? 2 : 0,
              borderColor: t.life,
            }}
          >
            <I size={20} color={on ? t.life : t.muted} />
            <Copy size={10} style={{ color: on ? t.life : t.muted }}>
              {m.label}
            </Copy>
          </Tap>
        )
      })}
    </Line>
  )
}
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
function JournalVoice({
  onClose,
  onDone,
}: {
  onClose: () => void
  onDone: (text: string) => void
}) {
  return (
    <CaptureVoice
      hint="journal"
      maxSec={600}
      onClose={onClose}
      onDone={(text) => onDone(text)}
    />
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
        {segs.map((d) => (
          <Path
            key={d}
            d={d}
            fill="none"
            stroke={t.life}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
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
function JournalList() {
  const t = useTheme(),
    all = captureStore.use((s) => s.journal),
    [q, setQ] = useState(""),
    [area, setArea] = useState<string>(),
    [talk, setTalk] = useState(false),
    entries = [...all].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    shown = entries.filter(
      (e) =>
        (!area || e.area === area) &&
        (!q ||
          e.body.toLowerCase().includes(q.toLowerCase()) ||
          e.tags.some((tag) => tag.includes(q.toLowerCase()))),
    ),
    groups = [...new Set(shown.map((e) => e.day))].sort((a, b) =>
      b.localeCompare(a),
    ),
    days = new Set(entries.map((e) => e.day)),
    lead = weekday(dayOffset(-27)),
    heat = [
      ...Array.from({ length: lead }, () => null),
      ...Array.from({ length: 28 }, (_, i) =>
        days.has(dayOffset(i - 27)) ? 1 : 0,
      ),
    ]
  let streak = 0,
    base = days.has(dayKey()) ? 0 : -1
  while (days.has(dayOffset(base - streak))) streak++
  return (
    <Screen
      title="Journal"
      actions={
        <IconTap
          size={44}
          icon={Plus}
          label="New entry"
          color={t.text}
          onPress={() => go("/journal/new")}
        />
      }
    >
      <View>
        <Frame style={{ padding: 16 }}>
          <Line style={{ gap: 8 }}>
            {[
              { label: "Streak", value: `${streak}d` },
              {
                label: "This week",
                value: entries.filter((e) => e.day >= dayOffset(-6)).length,
              },
              { label: "Entries", value: entries.length },
            ].map((x, i) => (
              <View key={x.label} style={{ flex: 1 }}>
                <Copy
                  size={28}
                  weight="display"
                  style={{ color: i === 0 ? t.life : t.text }}
                >
                  {x.value}
                </Copy>
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
                {heat.slice(col * 7, col * 7 + 7).map((v, i) => (
                  <View
                    key={i}
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: 3,
                      backgroundColor:
                        v === null ? "transparent" : v ? t.life : t.soft,
                    }}
                  />
                ))}
              </View>
            ))}
          </Line>
          <Copy size={11} muted style={{ marginTop: 4 }}>
            Last 4 weeks
          </Copy>
          {entries.filter((e) => e.mood).length >= 5 && (
            <MoodTrend entries={entries} />
          )}
        </Frame>
        <Line style={{ gap: 8, marginTop: 12 }}>
          <View style={{ flex: 1 }}>
            <Button icon={Mic} onPress={() => setTalk(true)}>
              Talk it out
            </Button>
          </View>
          <View style={{ flex: 1 }}>
            <Button tone="quiet" icon={PenLine} href="/journal/new">
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
        {groups.map((day) => (
          <View key={day}>
            <SectionHeading>{dayLabel(day)}</SectionHeading>
            <View style={{ gap: 8 }}>
              {shown
                .filter((e) => e.day === day)
                .map((e) => {
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
                                backgroundColor: border(t.life, 0.15),
                              }}
                            >
                              <Copy size={12} style={{ color: t.life }}>
                                {AREAS.find((a) => a.key === e.area)?.label ??
                                  e.area}
                              </Copy>
                            </View>
                          )}
                        </Line>
                        <Copy
                          size={15}
                          lines={3}
                          style={{ lineHeight: 24.375 }}
                        >
                          {e.body}
                        </Copy>
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
function JournalEditor({ id }: { id?: string }) {
  const t = useTheme(),
    existing = captureStore.use((s) => s.journal.find((j) => j.id === id)),
    [body, setBody] = useState(existing?.body ?? ""),
    [day, setDay] = useState(existing?.day ?? dayKey()),
    [mood, setMood] = useState(existing?.mood),
    [area, setArea] = useState(existing?.area),
    [tags, setTags] = useState(existing?.tags.join(", ") ?? ""),
    [priv, setPriv] = useState(existing?.private ?? true),
    [transcript, setTranscript] = useState(existing?.transcript),
    [dictate, setDictate] = useState(false),
    [showTranscript, setShowTranscript] = useState(false)
  if (id && !existing)
    return (
      <Screen title="Entry">
        <Copy>Entry not found</Copy>
        <Copy muted>It may have been deleted.</Copy>
        <Button href="/journal">Journal</Button>
      </Screen>
    )
  return (
    <Screen
      footer={
        <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
          <Button
            disabled={!body.trim() || day > dayKey()}
            onPress={() => {
              const input = {
                body: body.trim(),
                day,
                mood,
                area,
                tags: tags
                  .split(/[,\s]+/)
                  .map((s) => s.replace(/^#/, "").trim().toLowerCase())
                  .filter(Boolean),
                private: priv,
                transcript,
              }
              if (existing) {
                A.updateJournalEntry(existing.id, input)
                toast.success("Entry updated")
              } else {
                const e = A.addJournalEntry({
                  ...input,
                  source: transcript ? "voice" : "text",
                })
                toast.success("Journal entry saved", {
                  action: {
                    label: "Undo",
                    onClick: () => A.deleteJournalEntry(e.id),
                  },
                })
              }
              go("/journal")
            }}
          >
            {existing ? "Save changes" : "Save entry"}
          </Button>
        </View>
      }
      title={existing ? dayLabel(existing.day) : "New entry"}
      actions={
        existing && (
          <IconTap
            size={44}
            icon={Trash2}
            label="Delete entry"
            onPress={() => {
              const gone = A.deleteJournalEntry(existing.id)
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
        )
      }
    >
      <View>
        <Line style={{ gap: 8 }}>
          <View style={{ width: 140 }}>
            <DateField
              hideLabel
              label="Entry date"
              value={day}
              onChangeText={setDay}
            />
          </View>
          {existing && (
            <Copy size={12} muted>
              {timeLabel(existing.createdAt)}
            </Copy>
          )}
          <Tap
            onPress={() => setDictate(true)}
            style={{
              marginLeft: "auto",
              height: 44,
              paddingHorizontal: 16,
              borderRadius: 22,
              backgroundColor: border(t.life, 0.15),
              flexDirection: "row",
              gap: 6,
              alignItems: "center",
            }}
          >
            <Mic size={16} color={t.life} />
            <Copy size={14} weight="medium" style={{ color: t.life }}>
              Dictate
            </Copy>
          </Tap>
        </Line>
        <TextInput
          accessibilityLabel="Entry"
          value={body}
          onChangeText={setBody}
          multiline
          numberOfLines={10}
          placeholder="What happened? What did you notice? Who are you becoming?"
          placeholderTextColor={t.muted}
          style={{
            height: 292,
            marginTop: 12,
            padding: 16,
            borderWidth: 1,
            borderColor: border(t.line, 0.6),
            borderRadius: 16,
            backgroundColor: t.card,
            fontSize: 16,
            lineHeight: 26,
            fontFamily: fonts.body,
            color: t.text,
            textAlignVertical: "top",
          }}
        />
        <SectionHeading>Mood</SectionHeading>
        <MoodPicker value={mood} onChange={setMood} />
        <SectionHeading>Area</SectionHeading>
        <AreaPicker value={area} onChange={setArea} />
        <SectionHeading>Tags</SectionHeading>
        <TextInput
          accessibilityLabel="Tags"
          value={tags}
          onChangeText={setTags}
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
              onChange={setPriv}
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
