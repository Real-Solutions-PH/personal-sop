"use client"

import {
  Award,
  ChevronRight,
  Lock,
  Share2,
  Trophy as TrophyIcon,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import { Bar, Btn, Card, Empty, Screen, SectionTitle } from "../ui/kit"
import {
  TROPHY_LABEL,
  type Trophy,
  type TrophyType,
  useAchievements,
} from "./hooks"
import { dashStore, markTrophiesSeen } from "./store"
import {
  BottomSheet,
  ErrorCard,
  fmtDay,
  Loading,
  useQueryParam,
  useViewState,
} from "./ui"

// DSH-24 Trophy case · DSH-25 Achievement sheet. Five rule types only
// (OQ-DSH-12): PR, streak milestone, personal best, goal hit, first-time.
// Lists every achievement — locked ones show the rule and live progress.

const ORDER: TrophyType[] = ["pr", "streak", "best", "goal", "first"]
const TINT: Record<TrophyType, string> = {
  pr: "from-fit/25 text-fit",
  streak: "from-life/25 text-life",
  best: "from-hab/25 text-hab",
  goal: "from-fin/25 text-fin",
  first: "from-tsk/25 text-tsk",
}

export function TrophiesScreen() {
  const state = useViewState()
  const openParam = useQueryParam("open")
  const catalog = useAchievements()
  const trophies = useMemo(
    () => catalog.flatMap((a) => (a.trophy ? [a.trophy] : [])),
    [catalog],
  )
  // Freeze "new" badges for this visit (seen is marked right after mount).
  const [fresh] = useState(() => {
    const seen = dashStore.get().seenTrophies
    return new Set(
      trophies.filter((t) => !seen.includes(t.id)).map((t) => t.id),
    )
  })
  const [openId, setOpenId] = useState<string | null>(null)
  const open = trophies.find((t) => t.id === openId) ?? null
  useEffect(() => {
    const seenNow = dashStore.get().seenTrophies
    const unseen = trophies.filter((t) => !seenNow.includes(t.id))
    if (unseen.length) markTrophiesSeen(unseen.map((t) => t.id))
  }, [trophies])
  useEffect(() => {
    if (openParam) setOpenId(openParam)
  }, [openParam])

  // Earned first (newest first), then closest to earning.
  const byType = (type: TrophyType) =>
    catalog
      .filter((a) => a.type === type)
      .sort((a, b) =>
        a.trophy && b.trophy
          ? b.trophy.day.localeCompare(a.trophy.day)
          : a.trophy
            ? -1
            : b.trophy
              ? 1
              : b.progress.pct - a.progress.pct,
      )

  return (
    <Screen title="Trophy case" back>
      {state === "loading" ? (
        <Loading rows={3} />
      ) : state === "error" ? (
        <ErrorCard what="trophies" />
      ) : state === "empty" ? (
        <Empty
          icon={<TrophyIcon className="size-8" />}
          title="No trophies yet"
          body="They're earned by real stats: a PR, a 7-day streak, a goal hit. No points for opening the app."
          action={<Btn href="/today">Hit today's target</Btn>}
        />
      ) : (
        <>
          <div className="grid grid-cols-5 gap-1.5">
            {ORDER.map((t) => {
              const all = catalog.filter((x) => x.type === t)
              return (
                <div
                  key={t}
                  className="rounded-xl bg-muted/50 p-2 text-center"
                  role="img"
                  aria-label={`${TROPHY_LABEL[t]}: ${all.filter((x) => x.trophy).length} of ${all.length} earned`}
                >
                  <div className="num font-bold text-lg">
                    {all.filter((x) => x.trophy).length}
                    <span className="font-normal text-muted-foreground text-xs">
                      /{all.length}
                    </span>
                  </div>
                  <div className="truncate text-[9px] text-muted-foreground uppercase">
                    {TROPHY_LABEL[t].split(" ").at(-1)}
                  </div>
                </div>
              )
            })}
          </div>
          {ORDER.map((type) => {
            const items = byType(type)
            if (!items.length) return null
            const earned = items.filter((a) => a.trophy).length
            return (
              <section key={type} aria-label={TROPHY_LABEL[type]}>
                <SectionTitle>
                  {TROPHY_LABEL[type]} · {earned} / {items.length}
                </SectionTitle>
                <div className="grid grid-cols-2 gap-2">
                  {items.map((a) => {
                    const t = a.trophy
                    return t ? (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => setOpenId(t.id)}
                        className={cn(
                          "relative rounded-2xl border border-border/60 bg-gradient-to-b to-transparent p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98]",
                          TINT[type],
                        )}
                      >
                        {fresh.has(t.id) && (
                          <span className="font-display absolute top-2 right-2 rounded-full bg-bad px-1.5 py-0.5 font-bold text-[9px] text-background">
                            NEW
                          </span>
                        )}
                        <Award className="size-5" />
                        <div className="font-display num mt-1 font-black text-2xl text-foreground">
                          {t.value}
                        </div>
                        <div className="line-clamp-2 font-medium text-foreground text-xs">
                          {t.title}
                        </div>
                        <div className="mt-0.5 text-[10px] text-muted-foreground">
                          {fmtDay(t.day, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </div>
                      </button>
                    ) : (
                      <div
                        key={a.id}
                        className="rounded-2xl border border-border/60 border-dashed bg-card/40 p-3"
                      >
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <Lock className="size-4" aria-hidden />
                          <span className="sr-only">Locked:</span>
                          <span className="line-clamp-1 font-medium text-foreground/80 text-xs">
                            {a.title}
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground leading-snug">
                          {a.requirement}
                        </p>
                        <div className="mt-2">
                          <Bar value={a.progress.pct} accent="primary" />
                        </div>
                        <div className="num mt-1 text-[10px] text-muted-foreground">
                          {a.progress.text}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </>
      )}
      <AchievementSheet trophy={open} onClose={() => setOpenId(null)} />
    </Screen>
  )
}

export function AchievementSheet({
  trophy,
  onClose,
}: {
  trophy: Trophy | null
  onClose: () => void
}) {
  return (
    <BottomSheet open={!!trophy} onClose={onClose} title="Achievement unlocked">
      {trophy && (
        <div className="text-center">
          <div
            className={cn(
              "mx-auto grid size-24 place-items-center rounded-full bg-gradient-to-b to-transparent",
              TINT[trophy.type],
            )}
          >
            <TrophyIcon className="size-10" />
          </div>
          <div className="font-display num mt-3 font-black text-5xl tracking-tight">
            {trophy.value}
          </div>
          <div className="mt-1 font-semibold text-lg">{trophy.title}</div>
          <div className="text-muted-foreground text-sm">{trophy.detail}</div>
          <div className="mt-1 text-muted-foreground text-xs">
            {TROPHY_LABEL[trophy.type]} ·{" "}
            {fmtDay(trophy.day, {
              weekday: "short",
              month: "long",
              day: "numeric",
            })}
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <Btn href={trophy.href} variant="secondary">
              View metric <ChevronRight className="size-4" />
            </Btn>
            <Btn href={`/stats/share?t=${trophy.shareRef ?? "profile"}`}>
              <Share2 className="size-4" /> Share
            </Btn>
          </div>
          <Card className="mt-3 bg-muted/40 text-left text-muted-foreground text-xs">
            Trophies are created by rules from your real data. An edit that
            breaks the record revokes it quietly.
          </Card>
        </div>
      )}
    </BottomSheet>
  )
}
