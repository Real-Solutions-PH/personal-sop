import { STORY_BAND, storyFit } from "../social/story-fit"

// Story frames the viewer draws: iPhone SE, 17e, 17 Pro Max, and the 520
// cap on a tablet (width × the height left under the safe area and bars).
const FRAMES: [number, number][] = [
  [375, 583],
  [393, 695],
  [440, 790],
  [520, 924],
]

test.each(
  FRAMES,
)("a 4:5 share card fits whole and centred in a %d×%d frame, clear of the header", (width, height) => {
  const f = storyFit(4 / 5, width, height)
  expect(f.fit).toBe("contain")
  // Whole: never wider or taller than the frame, at the card's own shape.
  expect(f.width).toBeLessThanOrEqual(width)
  expect(f.height).toBeLessThanOrEqual(height)
  expect(f.width / f.height).toBeCloseTo(4 / 5)
  // Centred both ways.
  expect(f.left).toBeCloseTo((width - f.width) / 2)
  expect(f.top).toBeCloseTo((height - f.height) / 2)
  // The progress bars, avatar, name, time and × sit in the top band.
  expect(f.top).toBeGreaterThanOrEqual(STORY_BAND)
  expect(f.top + f.height).toBeLessThanOrEqual(height - STORY_BAND)
})

test.each(
  FRAMES,
)("a square card fits whole in a %d×%d frame", (width, height) => {
  const f = storyFit(1, width, height)
  expect(f.fit).toBe("contain")
  expect(f.width).toBeCloseTo(f.height)
  expect(f.width).toBeLessThanOrEqual(width)
  expect(f.top).toBeGreaterThanOrEqual(STORY_BAND)
})

test.each(
  FRAMES,
)("a story-shaped image still fills a %d×%d frame", (width, height) => {
  expect(storyFit(9 / 16, width, height)).toEqual({
    fit: "cover",
    width,
    height,
    left: 0,
    top: 0,
  })
})

test("a 3:4 camera photo is too wide to fill: it fits whole", () => {
  expect(storyFit(3 / 4, 393, 695).fit).toBe("contain")
})

test("a very tall image is bounded by the height, centred sideways", () => {
  const f = storyFit(1 / 3, 393, 695)
  expect(f.fit).toBe("contain")
  expect(f.height).toBeCloseTo(695 - 2 * STORY_BAND)
  expect(f.left).toBeCloseTo((393 - f.width) / 2)
})

test("an image of unknown shape fits whole inside the bands", () => {
  for (const ratio of [undefined, 0, Number.NaN]) {
    expect(storyFit(ratio, 393, 695)).toEqual({
      fit: "contain",
      width: 393,
      height: 695 - 2 * STORY_BAND,
      left: 0,
      top: STORY_BAND,
    })
  }
})
