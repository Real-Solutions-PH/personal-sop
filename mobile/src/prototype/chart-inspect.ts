// Where a finger on FinanceLineChart lands: which data point it means and
// where that point sits on screen. The chart draws in a fixed viewBox
// (VIEW_W wide) that the Svg scales to fit its box and centres, and plots
// its points evenly from PLOT_LEFT across PLOT_W.

export const VIEW_W = 340
export const PLOT_LEFT = 40
export const PLOT_W = 292

/** The Svg's fit of the viewBox into a box of width × height: its scale
 * and the left offset of the centred drawing. */
export function viewFit(width: number, height: number, viewH: number) {
  const scale = Math.min(width / VIEW_W, height / viewH)
  return { scale, left: (width - VIEW_W * scale) / 2 }
}

/** The data point nearest a touch at `touchX` (px from the box's left
 * edge), out of `n` points. Touches past either end of the plot hold the
 * first or last point. */
export function pointAt(
  touchX: number,
  width: number,
  height: number,
  viewH: number,
  n: number,
): number {
  if (n <= 1 || width <= 0) return 0
  const { scale, left } = viewFit(width, height, viewH)
  const vx = (touchX - left) / scale
  const i = Math.round(((vx - PLOT_LEFT) / PLOT_W) * (n - 1))
  return Math.min(n - 1, Math.max(0, i))
}

/** Point `i` of `n`, in px from the box's left edge (inverse of pointAt). */
export function pointX(
  i: number,
  width: number,
  height: number,
  viewH: number,
  n: number,
): number {
  const { scale, left } = viewFit(width, height, viewH)
  const vx = PLOT_LEFT + (n <= 1 ? 0 : (i / (n - 1)) * PLOT_W)
  return left + vx * scale
}

/** Where a readout `w` px wide goes beside a marker at `x`: on the side
 * with more room, `gap` px off it, so the marker and its dots stay in
 * view; kept inside a box `width` wide. */
export function readoutLeft(
  x: number,
  w: number,
  width: number,
  gap = 10,
): number {
  const left = x < width / 2 ? x + gap : x - gap - w
  return Math.min(Math.max(0, width - w), Math.max(0, left))
}
