// Where the native splash draws the fiddlehead, so the animated boot screen
// starts on exactly the same pixels and the hand-over shows no jump.
// app.json's expo-splash-screen entry draws splash-icon.png 120 pt wide,
// centred; in that image the 24-unit mark box spans 86% of the width.
import { useColorScheme } from "react-native"
import { FERN_PATHS } from "@/prototype/companion/brand"

export const SPLASH_IMAGE = 120
export const MARK_BOX = SPLASH_IMAGE * 0.86
/** Points per mark unit. */
export const UNIT = MARK_BOX / 24

// The splash follows the phone's appearance, not the app's own setting
// (which is not read yet), and its colours are the app icon's.
export const SPLASH = {
  light: { ground: "#1f5a43", mark: "#ffffff" },
  dark: { ground: "#121513", mark: "#b7e08a" },
}
export function useSplashColors() {
  return useColorScheme() === "dark" ? SPLASH.dark : SPLASH.light
}

type Point = [number, number]
function cubicLength(p0: Point, p1: Point, p2: Point, p3: Point) {
  let length = 0
  let [px, py] = p0
  for (let i = 1; i <= 64; i++) {
    const t = i / 64
    const u = 1 - t
    const x =
      u * u * u * p0[0] +
      3 * u * u * t * p1[0] +
      3 * u * t * t * p2[0] +
      t * t * t * p3[0]
    const y =
      u * u * u * p0[1] +
      3 * u * u * t * p1[1] +
      3 * u * t * t * p2[1] +
      t * t * t * p3[1]
    length += Math.hypot(x - px, y - py)
    px = x
    py = y
  }
  return length
}
/** Length of a path made of one move and cubic curves, in mark units. */
export function pathLength(d: string) {
  const n = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number)
  let start: Point = [n[0], n[1]]
  let length = 0
  for (let i = 2; i + 5 < n.length; i += 6) {
    const end: Point = [n[i + 4], n[i + 5]]
    length += cubicLength(start, [n[i], n[i + 1]], [n[i + 2], n[i + 3]], end)
    start = end
  }
  return length
}

/** The stem-and-spiral stroke, then the lower and upper leaflets. */
export const [STEM, LOW_LEAF, HIGH_LEAF] = FERN_PATHS
export const STEM_LENGTH = pathLength(STEM)
export const LEAF_LENGTH = Math.max(pathLength(LOW_LEAF), pathLength(HIGH_LEAF))
/** The centre of the spiral and the foot of the stem, in mark units. */
export const COIL: Point = [15.3, 12.4]
export const FOOT: Point = [7.5, 21.5]
