"use client"

import { Trophy } from "lucide-react"
import { useParams, useSearchParams } from "next/navigation"
import { useMemo, useState } from "react"
import { dayKey } from "../../lib/day"
import { Btn, Card, Empty, Screen, SectionTitle, Segmented } from "../../ui/kit"
import {
  BackdropPicker,
  CardFoot,
  CardTitle,
  CardTop,
  compact,
  Delta,
  FORMAT_LABEL,
  FORMAT_PX,
  type Format,
  Hero,
  Label,
  LayoutCarousel,
  Medal,
  ShareFrame,
  ShareTargets,
  StatGrid,
  Trend,
  useCardLook,
} from "../../ui/share"
import {
  allPrs,
  consistencyStreak,
  dayTotals,
  exerciseHistory,
  exStats,
  fmtMin,
  fmtVolume,
  kg,
  kgShort,
  latestBodyweight,
  prLabel,
  sessionsByWeek,
  weekStart,
  workoutTotals,
} from "../calc"
import { useFit } from "../store"
import { ErrorState, LoadingState, toast, useViewState } from "../ui"

// FIT-23 Share card composer — Strava-style 9:16, rendered as DOM (image export later).
// Bodyweight and macros are OFF by default; never ₱ (X-5).

type Tpl = "summary" | "pr" | "photo"

export function ShareScreen() {
  const { id } = useParams<{ id: string }>()
  const qs = useSearchParams()
  const s = useFit()
  const view = useViewState()
  const w = s.workouts.find((x) => x.id === id)
  const [tpl, setTpl] = useState<Tpl>((qs.get("template") as Tpl) ?? "summary")
  const [f, setF] = useState({
    exercises: true,
    prs: true,
    week: true,
    bodyweight: false,
    macros: false,
  })
  const look = useCardLook({ backdrop: tpl === "photo" ? "photo" : "vivid" })

  const d = useMemo(() => {
    if (!w) return null
    const t = workoutTotals(s, w)
    const prs = allPrs(s).filter((p) => p.workoutId === w.id)
    const bw = latestBodyweight(s) ?? 0
    const lines = w.exercises.map((we) => {
      const ex = s.exercises.find((e) => e.id === we.exerciseId)
      const st = exStats(we, ex, bw)
      return {
        name: ex?.name ?? "",
        top: st.top,
        e1rm: st.bestE1rm,
        id: we.exerciseId,
      }
    })
    const focusId =
      qs.get("exercise") ??
      prs.find((p) => p.kind === "e1rm")?.exerciseId ??
      [...lines].sort((a, b) => b.e1rm - a.e1rm)[0]?.id
    const focusPr =
      prs.find((p) => p.exerciseId === focusId && p.kind === "e1rm") ??
      prs.find((p) => p.exerciseId === focusId)
    const focusHist = focusId
      ? exerciseHistory(s, focusId).filter(
          (h) => h.workout.startedAt <= w.startedAt,
        )
      : []
    const ws = weekStart(dayKey(new Date(w.startedAt)))
    const week = sessionsByWeek(s, 20).find((x) => x.start === ws)?.count ?? 1
    return {
      t,
      prs,
      lines,
      focus: lines.find((l) => l.id === focusId),
      focusPr,
      focusSeries: focusHist.map((h) => h.stats.bestE1rm),
      week,
      streak: consistencyStreak(s),
      macros: dayTotals(s, dayKey(new Date(w.startedAt))).totals,
      bw,
    }
  }, [s, w, qs])

  if (view === "loading")
    return (
      <Screen back title="Share">
        <LoadingState rows={2} />
      </Screen>
    )
  if (view === "error")
    return (
      <Screen back title="Share">
        <ErrorState title="Couldn’t render the card" />
      </Screen>
    )
  if (!w || !d)
    return (
      <Screen back title="Share">
        <Empty
          title="Nothing to share yet"
          body="Finish a workout to make a card."
          action={
            <Btn variant="secondary" href="/fitness">
              Fitness
            </Btn>
          }
        />
      </Screen>
    )

  const date = new Date(w.startedAt).toLocaleDateString("en-PH", {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
  const shareText = `${w.name} · ${fmtMin(d.t.durationSec)} · ${fmtVolume(d.t.volume)}${d.prs.length ? ` · ${d.prs.length} PR` : ""}`

  const tall = look.format === "9:16"
  const vol =
    d.t.volume >= 10000
      ? { v: (d.t.volume / 1000).toFixed(1), u: "t" }
      : { v: compact(Math.round(d.t.volume)), u: "kg" }
  const mins = Math.round(d.t.durationSec / 60)
  const time =
    mins >= 60
      ? {
          v: `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, "0")}`,
          u: "h",
        }
      : { v: String(mins), u: "min" }
  const statItems = [
    { label: "Time", value: time.v, unit: time.u },
    { label: "Volume", value: vol.v, unit: vol.u },
    { label: "Sets", value: String(d.t.done) },
  ]
  const target = s.settings.weeklyTarget
  const weekBlock = f.week && (
    <div>
      <div className="flex items-baseline justify-between">
        <Label>This week</Label>
        <span className="font-display num font-extrabold text-[4.4cqw]">
          {d.week}/{target}
        </span>
      </div>
      <div className="mt-[1.2cqw] flex gap-[1.2cqw]">
        {Array.from({ length: Math.max(target, d.week) }, (_, i) => (
          <span
            key={i}
            className="h-[1.8cqw] flex-1 rounded-full"
            style={{ background: i < d.week ? "var(--hi)" : "var(--track)" }}
          />
        ))}
      </div>
    </div>
  )
  const extras = (
    <>
      {f.bodyweight && d.bw > 0 && <div>Bodyweight {kg(d.bw)}</div>}
      {f.macros && (
        <div>
          {Math.round(d.macros.kcal)} kcal · P{Math.round(d.macros.protein)}g
          today
        </div>
      )}
    </>
  )
  const prMedals = f.prs && d.prs.length > 0 && (
    <div className="flex flex-wrap gap-[1.6cqw]">
      {d.prs.slice(0, 3).map((p) => (
        <Medal key={`${p.exerciseId}-${p.kind}`} tone="gold" icon={<Trophy />}>
          {
            s.exercises
              .find((e) => e.id === p.exerciseId)
              ?.name.split(" ")
              .slice(-1)[0]
          }{" "}
          {p.kind === "volume" ? "volume" : kg(Math.round(p.value * 10) / 10)}
        </Medal>
      ))}
    </div>
  )

  const body = (t: Tpl) => {
    if (t === "pr") {
      const pr = d.focusPr
      const val = Math.round((pr?.value ?? d.focus?.e1rm ?? 0) * 10) / 10
      return (
        <div className="flex flex-1 flex-col justify-center gap-[4cqw]">
          <div>
            <Medal tone="gold" icon={<Trophy />}>
              {pr ? `${prLabel[pr.kind]} PR` : "Top lift"}
            </Medal>
            <CardTitle className="mt-[2.5cqw]">
              {d.focus?.name ?? w.name}
            </CardTitle>
          </div>
          <div>
            <Label>Est. 1-rep max</Label>
            <Hero value={kgShort(val)} unit="kg" max={34} accent />
            {pr && pr.value > pr.prev && (
              <Delta
                value={Math.round((pr.value - pr.prev) * 10) / 10}
                unit=" kg"
                suffix="vs previous best"
                className="mt-[2cqw]"
              />
            )}
          </div>
          {d.focusSeries.length > 1 && (
            <div>
              <Trend data={d.focusSeries} height={tall ? 26 : 16} />
              <Label className="mt-[1.5cqw]">
                Last {d.focusSeries.length} sessions
              </Label>
            </div>
          )}
          {tall && <StatGrid items={statItems} size={10} />}
        </div>
      )
    }
    if (t === "photo")
      return (
        <div className="flex flex-1 flex-col justify-end gap-[4cqw]">
          {look.backdrop === "photo" && !look.photo && (
            <div className="m-auto text-[3.6cqw] opacity-70">
              Add your gym photo
            </div>
          )}
          <CardTitle>{w.name}</CardTitle>
          <StatGrid items={statItems} size={11} />
          {prMedals}
        </div>
      )
    return (
      <div className="flex flex-1 flex-col justify-center gap-[4.5cqw]">
        <div>
          <CardTitle>{w.name}</CardTitle>
          {d.prs.length > 0 && (
            <Medal tone="gold" icon={<Trophy />} className="mt-[2cqw]">
              {d.prs.length} personal record{d.prs.length > 1 ? "s" : ""}
            </Medal>
          )}
        </div>
        <StatGrid items={statItems} size={12} />
        {f.exercises && (
          <div className="space-y-[1.8cqw] border-current/15 border-t pt-[3cqw]">
            {d.lines.slice(0, tall ? 5 : 3).map((l) => (
              <div
                key={l.id}
                className="flex items-baseline gap-[3cqw] text-[3.8cqw]"
              >
                <span className="min-w-0 flex-1 truncate">{l.name}</span>
                <span className="font-display num shrink-0 font-bold text-[4.4cqw]">
                  {l.top ? `${kgShort(l.top.weight)} × ${l.top.reps}` : ""}
                </span>
              </div>
            ))}
            {d.lines.length > (tall ? 5 : 3) && (
              <div className="text-[3.2cqw] opacity-60">
                +{d.lines.length - (tall ? 5 : 3)} more
              </div>
            )}
          </div>
        )}
        {tall && prMedals}
        {weekBlock}
      </div>
    )
  }
  const render = (t: Tpl) => (
    <ShareFrame
      format={look.format}
      backdrop={look.backdrop}
      accent="fit"
      photo={look.photo}
    >
      <CardTop kicker="Workout" right={date} />
      {body(t)}
      <CardFoot>
        {d.streak > 0 && <div>{d.streak}-week streak</div>}
        {extras}
      </CardFoot>
    </ShareFrame>
  )
  const share = async () => {
    try {
      if (navigator.share)
        await navigator.share({ title: w.name, text: shareText })
      else {
        await navigator.clipboard.writeText(shareText)
        toast("Copied — image sharing comes later")
      }
    } catch {
      /* user cancelled */
    }
  }

  return (
    <Screen back title="Share workout">
      <LayoutCarousel<Tpl>
        value={tpl}
        onChange={(t) => {
          setTpl(t)
          if (t === "photo" && look.backdrop !== "sticker")
            look.setBackdrop("photo")
        }}
        format={look.format}
        items={[
          { key: "summary", label: "Summary", render: () => render("summary") },
          { key: "pr", label: "PR highlight", render: () => render("pr") },
          { key: "photo", label: "Overlay", render: () => render("photo") },
        ]}
      />
      <div className="mt-5">
        <ShareTargets
          onStory={share}
          onSave={() => toast(`Would save a ${FORMAT_PX[look.format]} PNG`)}
          onCopy={async () => {
            await navigator.clipboard.writeText(shareText)
            toast("Caption copied")
          }}
          onMore={share}
        />
      </div>
      <SectionTitle>Size</SectionTitle>
      <Segmented<Format>
        value={look.format}
        onChange={look.setFormat}
        options={(["9:16", "4:5", "1:1"] as const).map((x) => ({
          value: x,
          label: FORMAT_LABEL[x],
        }))}
      />
      <SectionTitle>Background</SectionTitle>
      <BackdropPicker
        accent="fit"
        value={look.backdrop}
        onChange={look.setBackdrop}
        photo={look.photo}
        onPhoto={look.setPhoto}
      />
      <SectionTitle>Show on card</SectionTitle>
      <Card className="divide-y divide-border/60 py-0">
        {(
          [
            ["exercises", "Exercise list"],
            ["prs", "PR badges"],
            ["week", "Week tally & streak"],
            ["bodyweight", "Bodyweight"],
            ["macros", "Today’s macros"],
          ] as const
        ).map(([k, label]) => (
          <label
            key={k}
            className="flex min-h-11 items-center justify-between py-2 text-sm"
          >
            {label}
            <input
              type="checkbox"
              checked={f[k]}
              onChange={(e) => setF({ ...f, [k]: e.target.checked })}
              className="size-5 accent-[var(--fit)]"
            />
          </label>
        ))}
      </Card>
      <div className="mt-2 mb-2 px-1 text-muted-foreground text-xs">
        Money never appears on share cards.
      </div>
    </Screen>
  )
}
