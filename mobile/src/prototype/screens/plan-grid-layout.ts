// Where every block on the Plan tab's hour grid sits. Pure, so it is tested
// on its own.
//
// The design: blocks grow with their titles (titles are never truncated), so
// a grid that places blocks only by time lets a tall block run into the next
// one. Here the time axis stretches instead. An hour is 64 pt until something
// in it needs more room; then the hour grows, and everything after it moves
// down. So:
//   - a block always starts on its own time's line (never above it, never
//     beside a block that started earlier);
//   - items that start at the same minute share a row, side by side, but no
//     column is narrower than MIN_COL, so titles wrap by words. More items
//     than columns wrap into further rows of the same group, and a row with
//     fewer items gives each one more width. Nothing is hidden behind a
//     "+N more": every item stays on the grid where it can be ticked;
//   - an hour line is drawn below every block that started before that hour,
//     so a line never runs through a card;
//   - blocks never overlap.

/** Points per minute when nothing stretches the hour: an hour row is 64 pt. */
export const PX = 64 / 60
/** The shortest a block reads as: half an hour. */
export const SPAN_MIN = 30
export const BLOCK_MIN_H = SPAN_MIN * PX - 2
/** Space between blocks, and between a block and the next hour line. */
export const GAP = 4
/** The narrowest column a block gets: room for a title to wrap by words
 * beside its tick. */
export const MIN_COL = 120

/** Minute → y, as matching ascending lists: y between two marks is
 * interpolated, and beyond either end runs at PX. */
export interface Axis {
  min: number[]
  y: number[]
}

export function yAt(axis: Axis, m: number): number {
  "worklet"
  const { min, y } = axis
  const n = min.length
  if (!n) return 0
  if (m <= min[0]) return y[0] - (min[0] - m) * PX
  if (m >= min[n - 1]) return y[n - 1] + (m - min[n - 1]) * PX
  let k = 1
  while (min[k] < m) k++
  const a = min[k - 1],
    b = min[k]
  return y[k - 1] + ((m - a) / (b - a)) * (y[k] - y[k - 1])
}

/** The inverse of yAt: the minute at a point down the grid. */
export function minuteAt(axis: Axis, at: number): number {
  "worklet"
  const { min, y } = axis
  const n = min.length
  if (!n) return 0
  if (at <= y[0]) return min[0] - (y[0] - at) / PX
  if (at >= y[n - 1]) return min[n - 1] + (at - y[n - 1]) / PX
  let k = 1
  while (y[k] < at) k++
  const a = y[k - 1],
    b = y[k]
  // Two marks at one y cannot happen (each mark sits at least PX per minute
  // below the last), but never divide by zero.
  if (b === a) return min[k]
  return min[k - 1] + ((at - a) / (b - a)) * (min[k] - min[k - 1])
}

/** How many columns side by side fit in ``width`` points. */
export function columnsFor(width: number, gap = GAP): number {
  return Math.max(1, Math.floor((width + gap) / (MIN_COL + gap)))
}

export interface Slot<T> {
  item: T
  min: number
  /** Its place in its row, and how many share that row. */
  col: number
  cols: number
  top: number
  height: number
}

export interface GridLayout<T> {
  placed: Slot<T>[]
  axis: Axis
  /** Top of each hour line, from ``from`` to ``to`` inclusive. */
  hours: { min: number; y: number }[]
  height: number
}

/**
 * Lays the timed items out over the business day ``from``..``to`` (minutes).
 * ``heightOf`` is each block's measured height (or undefined before it has
 * been measured); a block is never shorter than BLOCK_MIN_H.
 */
export function layoutGrid<T>(
  items: readonly T[],
  opts: {
    from: number
    to: number
    /** Columns side by side, from columnsFor(the lane's width). */
    cols: number
    minuteOf: (item: T) => number | null
    heightOf: (item: T) => number | undefined
  },
): GridLayout<T> {
  const { from, to, minuteOf, heightOf } = opts
  const cols = Math.max(1, Math.floor(opts.cols))
  // Stable: items at one minute keep the order they came in.
  const groups = new Map<number, T[]>()
  for (const item of items) {
    const m = minuteOf(item)
    if (m === null) continue
    const g = groups.get(m)
    if (g) g.push(item)
    else groups.set(m, [item])
  }
  const marks = new Set<number>(groups.keys())
  for (let h = from; h <= to; h += 60) marks.add(h)
  const order = [...marks].sort((a, b) => a - b)

  const axis: Axis = { min: [], y: [] }
  const hours: { min: number; y: number }[] = []
  const placed: Slot<T>[] = []
  // The lowest edge of every block placed so far.
  let bottom = Number.NEGATIVE_INFINITY
  let prevMin = order[0] ?? from,
    prevY = (prevMin - from) * PX
  for (const m of order) {
    const natural = prevY + (m - prevMin) * PX
    const y = Math.max(natural, bottom + GAP)
    axis.min.push(m)
    axis.y.push(y)
    prevMin = m
    prevY = y
    if (m >= from && m <= to && (m - from) % 60 === 0) hours.push({ min: m, y })
    const group = groups.get(m)
    if (!group) continue
    let rowTop = y
    for (let r = 0; r * cols < group.length; r++) {
      const row = group.slice(r * cols, r * cols + cols)
      let rowH = 0
      row.forEach((item, col) => {
        const height = Math.max(BLOCK_MIN_H, heightOf(item) ?? 0)
        rowH = Math.max(rowH, height)
        placed.push({
          item,
          min: m,
          col,
          cols: row.length,
          top: rowTop,
          height,
        })
      })
      bottom = Math.max(bottom, rowTop + rowH)
      rowTop += rowH + GAP
    }
  }
  const end = Math.max(yAt(axis, to), Number.isFinite(bottom) ? bottom : 0)
  return { placed, axis, hours, height: end + 8 }
}
