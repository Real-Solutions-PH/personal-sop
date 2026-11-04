/** The strip at the top of a story frame that holds the progress bars, the
 * avatar, name, time and close button (and, mirrored, a strip of the same
 * height at the bottom so a fitted image stays centred). */
export const STORY_BAND = 64

/** How much of an image filling the frame may be cut off (as a share of its
 * width or height) before it is shown whole instead. A 9:16 story fills
 * every phone; a 4:5 or square card, or a 3:4 camera photo, does not. */
const MAX_CROP = 0.15

export type StoryFit = {
  fit: "cover" | "contain"
  width: number
  height: number
  left: number
  top: number
}

/** Where an image of ``ratio`` (width / height) goes in a story frame.
 *
 * Close to the frame's own shape it fills the frame, losing at most a thin
 * edge. Anything else (a share card posted at 4:5, a square, a landscape
 * photo) is drawn whole at its own shape, centred, between the header and
 * bottom bands, so nothing is clipped and nothing sits under the close
 * button. An unknown shape fits whole inside the same box. */
export function storyFit(
  ratio: number | undefined,
  width: number,
  height: number,
): StoryFit {
  const frame = width / height
  if (ratio && ratio > 0) {
    const kept = Math.min(ratio / frame, frame / ratio)
    if (1 - kept <= MAX_CROP)
      return { fit: "cover", width, height, left: 0, top: 0 }
  }
  const boxH = Math.max(0, height - 2 * STORY_BAND)
  if (!ratio || !(ratio > 0))
    return { fit: "contain", width, height: boxH, left: 0, top: STORY_BAND }
  const w = Math.min(width, boxH * ratio)
  const h = w / ratio
  return {
    fit: "contain",
    width: w,
    height: h,
    left: (width - w) / 2,
    top: (height - h) / 2,
  }
}
