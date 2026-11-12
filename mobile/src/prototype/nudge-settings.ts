// "Nudges from Fern" in Settings (docs/26-retention-algorithms.md §3.5, §6):
// daily, weekly or off, and the time the nudge comes, shown as the usual
// time the server found ("when you usually log") with a control that pins
// another. Mode and pinned time sync with the profile; the usual time is
// asked from GET /retention/nudge in live mode.
import { createStore } from "@domain/lib/store"
import { liveMode } from "@/live/config"

export type NudgeMode = "daily" | "weekly" | "off"
export const NUDGE_MODES: { value: NudgeMode; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "off", label: "Off" },
]
/** A nudge never goes out before 07:00 or after 21:30 (§6). */
export const NUDGE_FIRST = "07:00"
export const NUDGE_LAST = "21:30"

const HM = /^([01]\d|2[0-3]):[0-5]\d$/
const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3))
const toHm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`

/** A picked time kept inside the hours a nudge may go out. */
export function clampNudgeTime(hm: string): string {
  if (!HM.test(hm)) return NUDGE_FIRST
  const m = Math.min(toMin(NUDGE_LAST), Math.max(toMin(NUDGE_FIRST), toMin(hm)))
  return toHm(m)
}

/** Before the server has a usual time (demo mode, or a new account): the
 * same cold start it uses, the evening push time less 10 minutes. */
export function fallbackUsual(evening: string): string | null {
  if (!HM.test(evening)) return null
  const m = toMin(evening) - 10
  if (m < toMin(NUDGE_FIRST) || m > toMin(NUDGE_LAST)) return null
  return toHm(m)
}

export const nudgeStore = createStore("nudge", () => ({
  /** The usual time the server found (HH:MM), or null. */
  usual: null as string | null,
}))

type Fetcher = () => Promise<Record<string, unknown>>
let fetcher: Fetcher | null = null
/** Tests set how the server is asked; live mode GETs /retention/nudge. */
export function setNudgeFetcher(f: Fetcher | null) {
  fetcher = f
}
function ask(): Fetcher | null {
  if (fetcher) return fetcher
  if (!liveMode) return null
  try {
    const http = (
      require("@/live/auth") as Partial<typeof import("@/live/auth")>
    ).http
    return http
      ? async () =>
          (await http.request("GET", "/retention/nudge")) as Record<
            string,
            unknown
          >
      : null
  } catch {
    return null
  }
}

/** Asks the server for the usual nudge time; a failed ask keeps the last. */
export async function refreshNudge(): Promise<void> {
  const get = ask()
  if (!get) return
  try {
    const r = await get()
    const usual =
      typeof r.usual === "string" && HM.test(r.usual) ? r.usual : null
    nudgeStore.set({ usual })
  } catch {
    // Offline: the last answer stands.
  }
}
