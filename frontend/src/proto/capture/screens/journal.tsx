"use client"

import {
  AlertTriangle,
  BookOpen,
  Flame,
  Mic,
  Moon,
  PenLine,
  Plus,
  Search,
  Trash2,
} from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { dayKey, dayOffset, weekday } from "../../lib/day"
import {
  Btn,
  Card,
  Chip,
  Empty,
  Heatmap,
  Screen,
  SectionTitle,
  Stat,
} from "../../ui/kit"
import {
  addJournalEntry,
  deleteJournalEntry,
  restoreJournalEntry,
  updateJournalEntry,
} from "../actions"
import { AREAS, type JournalEntry, MOODS, type Mood } from "../data"
import { AreaPicker, MoodPicker } from "../edit"
import { MoodTrend } from "../mood-trend"
import { journalDraft } from "../parse"
import { captureStore } from "../store"
import { toast } from "../toast"
import {
  AREA_ICON,
  dayLabel,
  FOCUS,
  MOOD_ICON,
  Toggle,
  timeLabel,
  tint,
} from "../ui"
import { VoiceSheet } from "../voice"

// CAP-15 Journal list (= DSH-26, X-3) and CAP-16 Journal editor / detail.

/** Consecutive days with ≥1 entry, ending today (or yesterday if none yet today). */
export function journalStreak(entries: JournalEntry[]): number {
  const days = new Set(entries.map((e) => e.day))
  let n = 0
  let i = days.has(dayKey()) ? 0 : -1
  while (days.has(dayOffset(i))) {
    n++
    i--
  }
  return n
}

function SourceIcon({ s }: { s: JournalEntry["source"] }) {
  const I = s === "voice" ? Mic : s === "wrapup" ? Moon : PenLine
  return (
    <I
      className="size-3.5"
      aria-label={s === "wrapup" ? "Evening wrap-up" : s}
    />
  )
}

function MoodBadge({ v }: { v?: Mood }) {
  if (!v) return null
  const I = MOOD_ICON[v]
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs">
      <I className="size-3.5" /> {MOODS.find((m) => m.v === v)?.label}
    </span>
  )
}

function AreaBadge({ a }: { a?: string }) {
  if (!a) return null
  const I = AREA_ICON[a]
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs",
        tint.life.bg,
        tint.life.text,
      )}
    >
      {I && <I className="size-3.5" />}
      {AREAS.find((x) => x.key === a)?.label ?? a}
    </span>
  )
}

export function JournalListScreen() {
  const router = useRouter()
  const sp = useSearchParams()
  const state = sp.get("state")
  const all = captureStore.use((s) => s.journal)
  const [q, setQ] = useState("")
  const [area, setArea] = useState<string | null>(null)
  const [talk, setTalk] = useState(false)

  const entries = useMemo(
    () =>
      state === "empty"
        ? []
        : [...all].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [all, state],
  )
  const shown = useMemo(
    () =>
      entries.filter(
        (e) =>
          (!area || e.area === area) &&
          (!q ||
            e.body.toLowerCase().includes(q.toLowerCase()) ||
            e.tags.some((t) => t.includes(q.toLowerCase()))),
      ),
    [entries, q, area],
  )
  const groups = useMemo(() => {
    const out: { day: string; items: JournalEntry[] }[] = []
    for (const e of shown) {
      const g = out.find((x) => x.day === e.day)
      if (g) g.items.push(e)
      else out.push({ day: e.day, items: [e] })
    }
    return out.sort((a, b) => b.day.localeCompare(a.day))
  }, [shown])

  const stats = useMemo(() => {
    const days = new Set(entries.map((e) => e.day))
    // 4 weeks, padded to start on Sunday so each column is one week
    const lead = weekday(dayOffset(-27))
    const heat = [
      ...Array.from({ length: lead }, () => null),
      ...Array.from({ length: 28 }, (_, i) =>
        days.has(dayOffset(i - 27)) ? 1 : 0,
      ),
    ]
    const week = entries.filter((e) => e.day >= dayOffset(-6)).length
    const withMood = entries.filter((e) => e.mood).length
    return { streak: journalStreak(entries), heat, week, withMood }
  }, [entries])

  const today = dayKey()
  return (
    <Screen
      title="Journal"
      back
      className={FOCUS}
      actions={
        <Link
          href="/journal/new"
          aria-label="New entry"
          className="grid size-11 place-items-center rounded-full hover:bg-muted"
        >
          <Plus className="size-5" />
        </Link>
      }
    >
      {state === "error" ? (
        <Empty
          icon={<AlertTriangle className="size-8 text-bad" />}
          title="Couldn't open your journal"
          body="Entries are stored on this device and weren't changed. Try again."
          action={<Btn href="/journal">Retry</Btn>}
        />
      ) : (
        <>
          <Card>
            <div className="grid grid-cols-3 gap-2">
              <Stat
                label={
                  <span className="inline-flex items-center gap-1">
                    <Flame className="size-3.5 text-life" /> Streak
                  </span>
                }
                value={`${stats.streak}d`}
                accent="life"
              />
              <Stat label="This week" value={stats.week} />
              <Stat label="Entries" value={entries.length} />
            </div>
            <div className="mt-4">
              <Heatmap
                values={stats.heat}
                accent="life"
                flow="column"
                rowLabels={["S", "M", "T", "W", "T", "F", "S"]}
              />
              <div className="mt-1 text-[11px] text-muted-foreground">
                Last 4 weeks
              </div>
            </div>
            {stats.withMood >= 5 && <MoodTrend entries={entries} />}
          </Card>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <Btn onClick={() => setTalk(true)} accent="life">
              <Mic className="size-4" /> Talk it out
            </Btn>
            <Btn href="/journal/new" variant="secondary">
              <PenLine className="size-4" /> Write
            </Btn>
          </div>

          {entries.length > 0 && (
            <>
              <div className="relative mt-4">
                <Search className="-translate-y-1/2 absolute top-1/2 left-3 size-4 text-muted-foreground" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search entries and #tags"
                  aria-label="Search journal"
                  className="h-11 w-full rounded-xl border border-border bg-card pr-3 pl-9 text-[15px] outline-none focus:border-primary"
                />
              </div>
              <div className="-mx-4 mt-2 flex gap-1.5 overflow-x-auto px-4 pb-1">
                {AREAS.map((a) => {
                  const I = AREA_ICON[a.key]
                  return (
                    <Chip
                      key={a.key}
                      accent="life"
                      active={area === a.key}
                      onClick={() => setArea(area === a.key ? null : a.key)}
                      className="h-11"
                    >
                      <I className="size-4" aria-hidden /> {a.label}
                    </Chip>
                  )
                })}
              </div>
            </>
          )}

          {groups.length === 0 ? (
            <Empty
              icon={<BookOpen className="size-8" />}
              title={
                entries.length ? "No entries match" : "Your journal is empty"
              }
              body={
                entries.length
                  ? "Try another word or area."
                  : "Two lines a night is enough. Talk it out, or say “journal: …” in Capture — tonight's wrap-up adds one too."
              }
              action={
                !entries.length && (
                  <Btn onClick={() => setTalk(true)}>Start with your voice</Btn>
                )
              }
            />
          ) : (
            groups.map((g) => (
              <div key={g.day}>
                <SectionTitle>{dayLabel(g.day, today)}</SectionTitle>
                <div className="space-y-2">
                  {g.items.map((e) => (
                    <Card
                      key={e.id}
                      href={`/journal/${e.id}`}
                      className="p-3.5"
                    >
                      <div className="mb-1.5 flex items-center gap-2 text-muted-foreground text-xs">
                        <SourceIcon s={e.source} />
                        {timeLabel(e.createdAt)}
                        <span className="ml-auto flex items-center gap-1.5">
                          <MoodBadge v={e.mood} />
                          <AreaBadge a={e.area} />
                        </span>
                      </div>
                      <p className="line-clamp-3 text-[15px] leading-relaxed">
                        {e.body}
                      </p>
                      {e.tags.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-2 text-muted-foreground text-xs">
                          {e.tags.map((t) => (
                            <span key={t}>#{t}</span>
                          ))}
                        </div>
                      )}
                    </Card>
                  ))}
                </div>
              </div>
            ))
          )}
        </>
      )}
      <VoiceSheet
        open={talk}
        onOpenChange={setTalk}
        hint="journal"
        maxSec={600}
        title="Talk it out…"
        onDone={(t) => {
          const d = journalDraft(t, "voice")
          if (d.payload.kind !== "journal") return
          const e = addJournalEntry({
            body: d.payload.body,
            source: "voice",
            mood: d.payload.mood,
            area: d.payload.area,
            tags: d.payload.tags,
            transcript: t,
          })
          toast.success("Journal entry saved", {
            action: { label: "Undo", onClick: () => deleteJournalEntry(e.id) },
          })
          router.push(`/journal/${e.id}`)
        }}
      />
    </Screen>
  )
}

// ---------------------------------------------------------------- CAP-16

export function JournalEditorScreen({ id }: { id?: string }) {
  const router = useRouter()
  const existing = captureStore.use((s) =>
    id ? s.journal.find((j) => j.id === id) : undefined,
  )
  const [body, setBody] = useState(existing?.body ?? "")
  const [day, setDay] = useState(existing?.day ?? dayKey())
  const [mood, setMood] = useState<Mood | undefined>(existing?.mood)
  const [area, setArea] = useState<string | undefined>(existing?.area)
  const [tags, setTags] = useState((existing?.tags ?? []).join(", "))
  const [priv, setPriv] = useState(existing?.private ?? true)
  const [transcript, setTranscript] = useState(existing?.transcript)
  const [dictate, setDictate] = useState(false)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: focus once for a new entry
  useEffect(() => {
    if (!id) bodyRef.current?.focus()
  }, [])

  if (id && !existing)
    return (
      <Screen title="Entry" back>
        <Empty
          title="Entry not found"
          body="It may have been deleted."
          action={<Btn href="/journal">Journal</Btn>}
        />
      </Screen>
    )

  const tagList = tags
    .split(/[,\s]+/)
    .map((t) => t.replace(/^#/, "").trim().toLowerCase())
    .filter(Boolean)

  const save = () => {
    if (!body.trim()) return
    if (existing) {
      updateJournalEntry(existing.id, {
        body: body.trim(),
        day,
        mood,
        area,
        tags: tagList,
        private: priv,
        transcript,
      })
      toast.success("Entry updated")
      router.push("/journal")
    } else {
      const e = addJournalEntry({
        body,
        day,
        mood,
        area,
        tags: tagList,
        private: priv,
        transcript,
        source: transcript ? "voice" : "text",
      })
      toast.success("Journal entry saved", {
        action: { label: "Undo", onClick: () => deleteJournalEntry(e.id) },
      })
      router.push("/journal")
    }
  }

  return (
    <Screen
      title={existing ? dayLabel(existing.day, dayKey()) : "New entry"}
      back
      className={FOCUS}
      actions={
        existing && (
          <button
            type="button"
            aria-label="Delete entry"
            onClick={() => {
              const gone = deleteJournalEntry(existing.id)
              router.push("/journal")
              if (gone)
                toast("Entry deleted", {
                  action: {
                    label: "Undo",
                    onClick: () => restoreJournalEntry(gone),
                  },
                })
            }}
            className="grid size-11 place-items-center rounded-full text-muted-foreground hover:bg-muted"
          >
            <Trash2 className="size-5" />
          </button>
        )
      }
    >
      <div className="flex items-center gap-2">
        <input
          type="date"
          aria-label="Entry date"
          value={day}
          max={dayKey()}
          onChange={(e) => setDay(e.target.value || dayKey())}
          className="h-11 rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-primary"
        />
        {existing && (
          <span className="flex items-center gap-1 text-muted-foreground text-xs">
            <SourceIcon s={existing.source} /> {timeLabel(existing.createdAt)}
          </span>
        )}
        <button
          type="button"
          onClick={() => setDictate(true)}
          className="ml-auto inline-flex h-11 items-center gap-1.5 rounded-full bg-life/15 px-4 font-medium text-life text-sm"
        >
          <Mic className="size-4" /> Dictate
        </button>
      </div>
      <textarea
        ref={bodyRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        aria-label="Entry"
        placeholder="What happened? What did you notice? Who are you becoming?"
        rows={10}
        className="mt-3 w-full resize-none rounded-2xl border border-border/60 bg-card p-4 text-[16px] leading-relaxed outline-none focus:border-life/60"
      />
      <SectionTitle>Mood</SectionTitle>
      <MoodPicker value={mood} onChange={setMood} />
      <SectionTitle>Area</SectionTitle>
      <AreaPicker value={area} onChange={setArea} />
      <SectionTitle>Tags</SectionTitle>
      <input
        value={tags}
        onChange={(e) => setTags(e.target.value)}
        placeholder="sleep, gratitude, win"
        className="h-11 w-full rounded-xl border border-border bg-card px-3 text-[15px] outline-none focus:border-primary"
      />
      <Card className="mt-4 flex items-center gap-3 p-3">
        <div className="flex-1">
          <div className="font-medium text-sm">Private</div>
          <div className="text-muted-foreground text-xs">
            Kept out of AI answers and share cards
          </div>
        </div>
        <Toggle label="Private" on={priv} onChange={setPriv} />
      </Card>
      {transcript && (
        <details className="mt-3 rounded-xl bg-muted/50 p-3 text-sm">
          <summary className="min-h-11 cursor-pointer py-2 font-medium text-muted-foreground">
            Original transcript
          </summary>
          <p className="mt-1 whitespace-pre-line text-muted-foreground">
            {transcript}
          </p>
        </details>
      )}
      <div className="sticky bottom-3 z-20 mt-6">
        <Btn
          className="w-full shadow-lg"
          accent="life"
          disabled={!body.trim()}
          onClick={save}
        >
          {existing ? "Save changes" : "Save entry"}
        </Btn>
      </div>
      <VoiceSheet
        open={dictate}
        onOpenChange={setDictate}
        hint="journal"
        maxSec={600}
        title="Dictating…"
        onDone={(t) => {
          const d = journalDraft(t, "voice")
          if (d.payload.kind !== "journal") return
          const cleaned = d.payload.body
          setBody((b) => (b.trim() ? `${b.trim()}\n\n${cleaned}` : cleaned))
          setTranscript((x) => (x ? `${x}\n\n${t}` : t))
          if (!mood && d.payload.mood) setMood(d.payload.mood)
          if (!area && d.payload.area) setArea(d.payload.area)
        }}
      />
    </Screen>
  )
}
