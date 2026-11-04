// A trophy earned in the last two days that this person has not seen yet
// lands as a brief card at the top of the screen, over everything (it draws
// in the overlay layer): the medal pops in, says what was earned, and leaves
// on its own. It never blocks: the rest of the screen keeps taking touches,
// and a tap on the card opens that trophy in the Trophy case. Trophies are
// derived on read, so a new one is noticed by diffing the achievements the
// device refetches after every sync against the ones already marked.
import {
  type Trophy,
  type TrophyType,
  trophyFrom,
  useTrophies,
} from "@domain/dash/hooks"
import {
  type ServerAchievements,
  statKey,
  useServerStat,
} from "@domain/dash/server-stats"
import { dashStore, markTrophiesSeen } from "@domain/dash/store"
import { captureUi } from "@domain/lib/capture"
import { dayOffset } from "@domain/lib/day"
import { createStore } from "@domain/lib/store"
import { usePathname } from "expo-router"
import { useEffect, useMemo, useState } from "react"
import { AppState } from "react-native"
import { TrophyBadge } from "./brand/badge"
import { prototypeMode } from "./mode"
import { MomentCard, momentSlot } from "./moment"
import { border, Copy } from "./native-kit"
import { go } from "./navigation"
import { useTheme } from "./theme"

/** At most this many cards in a row; the last then counts the rest. */
const SHOWN = 3
/** How long a card stays: long enough to read its title and detail. */
export const TROPHY_MS = 3200
const GAP = 300
const COLORS: Record<TrophyType, "fit" | "life" | "hab" | "fin" | "tsk"> = {
  pr: "fit",
  streak: "life",
  best: "hab",
  goal: "fin",
  first: "tsk",
}

/** Before the first change event the state can still be unknown; only a
 * backgrounded or inactive app holds a trophy back. */
const foreground = (s: string | null | undefined) =>
  s !== "background" && s !== "inactive"

/** The trophies this phone has presented, newest last. The synced seen list
 * can briefly come back older from a pull that raced the mark; this record
 * is the device's own, so a trophy never presents twice here. */
export const presentedStore = createStore("trophies-presented", () => ({
  ids: [] as string[],
}))
const KEEP = 300
function markPresented(ids: string[]) {
  presentedStore.set((s) => ({
    ids: [...s.ids.filter((x) => !ids.includes(x)), ...ids].slice(-KEEP),
  }))
}
/** For tests: forget what this phone presented. */
export const resetPresented = () => presentedStore.set({ ids: [] })

/** Trophies to present now, oldest first: unseen, never presented on this
 * phone, and dated today or yesterday (records are dated the day before). */
export function newTrophies(trophies: Trophy[], seen: string[]): Trophy[] {
  const from = dayOffset(-1)
  const known = new Set([...seen, ...presentedStore.get().ids])
  return trophies
    .filter((x) => !known.has(x.id) && x.day >= from)
    .sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id))
}

/** Mounted once at the shell. The live variant reads the server's
 * achievements (a watched stat, so it refetches after each sync); the
 * prototype one computes them on the device. Chosen once, so the costly
 * local computation never runs at the shell in live mode. */
export function TrophyWatcher({ hidden = false }: { hidden?: boolean }) {
  return prototypeMode ? (
    <LocalWatcher hidden={hidden} />
  ) : (
    <ServerWatcher hidden={hidden} />
  )
}
function ServerWatcher({ hidden }: { hidden: boolean }) {
  const stat = useServerStat<ServerAchievements>(statKey.achievements())
  const trophies = useMemo(
    () => stat.data?.trophies.map(trophyFrom),
    [stat.data],
  )
  return <TrophyQueue trophies={trophies} hidden={hidden} />
}
function LocalWatcher({ hidden }: { hidden: boolean }) {
  const trophies = useTrophies()
  // Signed in to a server, only its answer counts: the device's own
  // estimate can date (and so name) a trophy differently, and would
  // present it a second time when the server's version arrives.
  const server = useServerStat<ServerAchievements>(statKey.achievements())
  const settled = server.status === "off" || server.source === "server"
  return (
    <TrophyQueue trophies={settled ? trophies : undefined} hidden={hidden} />
  )
}

/** Picks what to present and presents it one card at a time. */
export function TrophyQueue({
  trophies,
  hidden = false,
}: {
  /** Undefined until a successful load: nothing presents meanwhile. */
  trophies: Trophy[] | undefined
  hidden?: boolean
}) {
  const seen = dashStore.use((s) => s.seenTrophies)
  const path = usePathname()
  const drawer = captureUi.use((s) => s.open)
  const other = momentSlot.use(
    (s) => s.holder !== null && s.holder !== "trophy",
  )
  const [active, setActive] = useState(foreground(AppState.currentState))
  // One check's worth: up to three cards, every id that qualified.
  const [run, setRun] = useState<{ items: Trophy[]; ids: string[] } | null>(
    null,
  )
  const [index, setIndex] = useState(0)
  const [showing, setShowing] = useState(true)
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) =>
      setActive(foreground(s)),
    )
    return () => sub.remove()
  }, [])
  // The Trophy case shows and marks them itself; the rest wait their turn.
  const suppressed =
    hidden || drawer || other || !active || path.startsWith("/stats/trophies")
  useEffect(() => {
    if (run || suppressed || !trophies) return
    const due = newTrophies(trophies, seen)
    if (!due.length) return
    // Marked as they start, so a relaunch, a crash or a second refetch
    // never replays them.
    const ids = due.map((x) => x.id)
    markPresented(ids)
    markTrophiesSeen(ids)
    setRun({ items: due.slice(0, SHOWN), ids })
    setIndex(0)
    setShowing(true)
  }, [run, suppressed, trophies, seen])
  // Each card leaves on its own; the clock stops while something hides it.
  useEffect(() => {
    if (!run || suppressed) return
    if (!showing) {
      const id = setTimeout(() => {
        if (index + 1 >= run.items.length) setRun(null)
        else {
          setIndex(index + 1)
          setShowing(true)
        }
      }, GAP)
      return () => clearTimeout(id)
    }
    const id = setTimeout(() => setShowing(false), TROPHY_MS)
    return () => clearTimeout(id)
  }, [run, suppressed, showing, index])
  if (!run || suppressed || !showing) return null
  const current = run.items[index]
  const last = index === run.items.length - 1
  const rest = run.ids.length - run.items.length
  return (
    <TrophyMoment
      key={current.id}
      trophy={current}
      more={last && rest > 0 ? rest : 0}
      onClose={() => setShowing(false)}
      onOpen={() => {
        setRun(null)
        go(
          last && rest > 0
            ? "/stats/trophies"
            : `/stats/trophies?open=${current.id}`,
        )
      }}
    />
  )
}

/** One earned trophy, as a card at the top of the screen. */
export function TrophyMoment({
  trophy,
  more = 0,
  onOpen,
  onClose,
}: {
  trophy: Trophy
  /** Trophies earned with this one that get no card of their own. */
  more?: number
  onOpen: () => void
  onClose?: () => void
}) {
  const t = useTheme()
  const tint = t[COLORS[trophy.type]]
  return (
    <MomentCard
      kind="trophy"
      testID="trophy-overlay"
      label={more ? `Trophy earned · ${more} more` : "Trophy earned"}
      title={trophy.title}
      detail={
        <Copy size={13} muted lines={2}>
          {trophy.detail}
        </Copy>
      }
      badge={<TrophyBadge type={trophy.type} size={42} color={tint} />}
      tint={t.good}
      discColor={border(t.good, 0.14)}
      say={`Trophy earned: ${trophy.title}. ${trophy.detail}`}
      hint={more ? "Opens the Trophy case" : "Opens this trophy"}
      onOpen={onOpen}
      onClose={onClose}
    />
  )
}
