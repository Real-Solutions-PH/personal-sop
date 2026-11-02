/** The geometry of framing a photo for a post: the photo always covers the
 * frame, so a post never shows an empty band. Every function is a worklet so
 * the editor's gestures run it on the UI thread; jest runs it as plain JS. */

export type Size = { width: number; height: number }

/** Where the photo sits in the frame: `zoom` is relative to the smallest
 * scale that covers the frame (1 = just covering), `x`/`y` move the photo's
 * centre from the frame's centre, in frame points. */
export type Framing = { zoom: number; x: number; y: number }

/** A post's frame, width over height: 4:5 portrait (the default) or 1:1. */
export const POST_RATIOS = [4 / 5, 1] as const
export type PostRatio = (typeof POST_RATIOS)[number]
export const DEFAULT_RATIO: PostRatio = 4 / 5
export const MAX_ZOOM = 5

export const CENTRED: Framing = { zoom: 1, x: 0, y: 0 }

/** The post frame a stored photo ratio belongs to: a photo cropped here is
 * exactly 4:5 or 1:1, anything older snaps to the nearer frame. */
export function frameRatio(ratio: number | undefined): PostRatio {
  "worklet"
  if (!ratio || !Number.isFinite(ratio)) return DEFAULT_RATIO
  return ratio >= 0.9 ? 1 : DEFAULT_RATIO
}

/** A ratio a photo cut here has exactly: one of the post frames. */
export function cutToFrame(ratio: number): boolean {
  "worklet"
  return POST_RATIOS.some((r) => Math.abs(r - ratio) < 0.01)
}

/** The scale at which the photo just covers the frame. */
export function coverScale(image: Size, frame: Size): number {
  "worklet"
  return Math.max(frame.width / image.width, frame.height / image.height)
}

export function clampZoom(zoom: number): number {
  "worklet"
  return Math.min(MAX_ZOOM, Math.max(1, zoom))
}

/** How far the photo's centre can move along each axis before an edge of
 * the photo would come inside the frame. */
export function maxOffset(image: Size, frame: Size, zoom: number): Size {
  "worklet"
  const s = coverScale(image, frame) * clampZoom(zoom)
  return {
    width: Math.max(0, (image.width * s - frame.width) / 2),
    height: Math.max(0, (image.height * s - frame.height) / 2),
  }
}

/** The framing moved back inside its limits: zoom no lower than covering,
 * no edge of the photo inside the frame. */
export function clampFraming(
  image: Size,
  frame: Size,
  framing: Framing,
): Framing {
  "worklet"
  const zoom = clampZoom(framing.zoom)
  const m = maxOffset(image, frame, zoom)
  return {
    zoom,
    x: Math.min(m.width, Math.max(-m.width, framing.x)),
    y: Math.min(m.height, Math.max(-m.height, framing.y)),
  }
}

/** The part of the photo the frame shows, in the photo's own pixels, ready
 * for the image manipulator's crop. Always inside the photo, and always the
 * frame's ratio. */
export function cropRect(
  image: Size,
  frame: Size,
  framing: Framing,
): { originX: number; originY: number; width: number; height: number } {
  "worklet"
  const f = clampFraming(image, frame, framing)
  const s = coverScale(image, frame) * f.zoom
  const width = Math.min(image.width, frame.width / s)
  const height = Math.min(image.height, frame.height / s)
  const cx = image.width / 2 - f.x / s
  const cy = image.height / 2 - f.y / s
  const originX = Math.min(image.width - width, Math.max(0, cx - width / 2))
  const originY = Math.min(image.height - height, Math.max(0, cy - height / 2))
  return { originX, originY, width, height }
}

/** The same crop rounded to whole pixels, kept inside the photo. */
export function pixelCrop(image: Size, frame: Size, framing: Framing) {
  const r = cropRect(image, frame, framing)
  const width = Math.max(1, Math.min(image.width, Math.round(r.width)))
  const height = Math.max(1, Math.min(image.height, Math.round(r.height)))
  return {
    originX: Math.min(image.width - width, Math.max(0, Math.round(r.originX))),
    originY: Math.min(
      image.height - height,
      Math.max(0, Math.round(r.originY)),
    ),
    width,
    height,
  }
}

/** A framing carried to a frame of another size or ratio: the same zoom,
 * the offset scaled with the frame, then clamped. */
export function reframe(
  image: Size,
  from: Size,
  to: Size,
  framing: Framing,
): Framing {
  const k = from.width ? to.width / from.width : 1
  return clampFraming(image, to, {
    zoom: framing.zoom,
    x: framing.x * k,
    y: framing.y * k,
  })
}

/** A pinch's new framing: the point under the fingers' focal point stays
 * under it while the photo scales. `focal` is relative to the frame's
 * centre. */
export function pinchAt(
  image: Size,
  frame: Size,
  start: Framing,
  scale: number,
  focal: { x: number; y: number },
): Framing {
  "worklet"
  const zoom = clampZoom(start.zoom * scale)
  const k = zoom / start.zoom
  return clampFraming(image, frame, {
    zoom,
    x: focal.x - (focal.x - start.x) * k,
    y: focal.y - (focal.y - start.y) * k,
  })
}
