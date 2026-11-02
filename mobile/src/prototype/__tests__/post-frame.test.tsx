// Framing a photo or a share card for a post: the picture always covers the
// frame (no empty band at any zoom or offset), the crop is always inside the
// picture and of the frame's ratio, and the share page's Post opens the
// card in the frame editor.

import { configureStorage, resetAll } from "@domain/lib/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import * as ImageManipulator from "expo-image-manipulator"
import { ShareComposer } from "../share-kit"
import {
  CENTRED,
  clampFraming,
  coverScale,
  cropRect,
  type Framing,
  frameRatio,
  MAX_ZOOM,
  maxOffset,
  pinchAt,
  pixelCrop,
  type Size,
} from "../social/crop"
import { framePhoto } from "../social/media"
import { socialStore } from "../social/store"

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
  usePathname: () => "/",
}))
jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  ...require("./reanimated-extras").extras,
  default: require("react-native").Animated,
  useSharedValue: (value: unknown) =>
    require("react").useRef({ value }).current,
  useAnimatedStyle: (get: () => unknown) => get(),
  withSpring: (value: unknown) => value,
  withTiming: (value: unknown) => value,
  runOnJS: (fn: unknown) => fn,
  useReducedMotion: () => true,
}))
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}))
jest.mock("react-native-view-shot", () => ({ captureRef: jest.fn() }))
jest.mock("expo-sharing", () => ({
  isAvailableAsync: jest.fn(),
  shareAsync: jest.fn(),
}))
jest.mock("../media", () => ({ copyText: jest.fn(), pickPhoto: jest.fn() }))
jest.mock("expo-image-manipulator", () => ({
  SaveFormat: { JPEG: "jpeg", PNG: "png" },
  manipulateAsync: jest.fn(),
}))

const manip = jest.mocked(ImageManipulator.manipulateAsync)
/** Answers like the real manipulator, starting from a picture of this
 * size: each output file remembers its own size, a crop gives the crop's
 * size and a resize the resized size. */
function picture(width: number, height: number) {
  const sizes = new Map<string, { w: number; h: number }>()
  manip.mockImplementation(async (uri, actions = []) => {
    const a = actions[0] as {
      crop?: { width: number; height: number }
      resize?: { width?: number; height?: number }
    }
    const from = sizes.get(uri) ?? { w: width, h: height }
    const w = a?.crop ? a.crop.width : from.w
    const h = a?.crop ? a.crop.height : from.h
    const k = a?.resize?.width
      ? a.resize.width / w
      : a?.resize?.height
        ? a.resize.height / h
        : 1
    const out = {
      uri: `${uri}#${Math.round(w * k)}x${Math.round(h * k)}`,
      width: Math.round(w * k),
      height: Math.round(h * k),
    }
    sizes.set(out.uri, { w: out.width, h: out.height })
    return out
  })
}

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  manip.mockReset()
})

const EPS = 1e-6
const IMAGES: Size[] = [
  { width: 3000, height: 4000 }, // portrait photo
  { width: 4032, height: 3024 }, // landscape photo
  { width: 1080, height: 1920 }, // 9:16 share card
  { width: 1080, height: 1080 }, // square
  { width: 50, height: 2000 }, // a sliver
]
const FRAMES: Size[] = [
  { width: 1, height: 1.25 },
  { width: 1, height: 1 },
  { width: 343, height: 428.75 },
]
const ZOOMS = [0, 0.2, 0.999, 1, 1.7, MAX_ZOOM, 9]
const SHIFTS = [-5, -0.3, 0, 0.3, 5]

/** Every image × frame × framing, offsets in frame widths. */
function* grid() {
  for (const image of IMAGES)
    for (const frame of FRAMES)
      for (const zoom of ZOOMS)
        for (const sx of SHIFTS)
          for (const sy of SHIFTS)
            yield {
              image,
              frame,
              framing: { zoom, x: sx * frame.width, y: sy * frame.width },
            }
}

describe("crop math", () => {
  it("never lets the picture leave a gap in the frame", () => {
    let n = 0
    for (const { image, frame, framing } of grid()) {
      const f = clampFraming(image, frame, framing)
      const s = coverScale(image, frame) * f.zoom
      const w = image.width * s
      const h = image.height * s
      // Each edge of the drawn picture sits on or outside the frame's.
      expect(f.x - w / 2).toBeLessThanOrEqual(-frame.width / 2 + EPS)
      expect(f.x + w / 2).toBeGreaterThanOrEqual(frame.width / 2 - EPS)
      expect(f.y - h / 2).toBeLessThanOrEqual(-frame.height / 2 + EPS)
      expect(f.y + h / 2).toBeGreaterThanOrEqual(frame.height / 2 - EPS)
      n++
    }
    expect(n).toBe(IMAGES.length * FRAMES.length * ZOOMS.length * 25)
  })

  it("cannot zoom out past filling the frame, or in past the limit", () => {
    const image = IMAGES[0]
    const frame = FRAMES[0]
    expect(clampFraming(image, frame, { zoom: 0.4, x: 0, y: 0 }).zoom).toBe(1)
    expect(clampFraming(image, frame, { zoom: 0, x: 0, y: 0 }).zoom).toBe(1)
    expect(clampFraming(image, frame, { zoom: 40, x: 0, y: 0 }).zoom).toBe(
      MAX_ZOOM,
    )
  })

  it("crops inside the picture, at the frame's ratio", () => {
    for (const { image, frame, framing } of grid()) {
      const r = cropRect(image, frame, framing)
      expect(r.originX).toBeGreaterThanOrEqual(-EPS)
      expect(r.originY).toBeGreaterThanOrEqual(-EPS)
      expect(r.originX + r.width).toBeLessThanOrEqual(image.width + EPS)
      expect(r.originY + r.height).toBeLessThanOrEqual(image.height + EPS)
      expect(r.width / r.height).toBeCloseTo(frame.width / frame.height, 6)
      const p = pixelCrop(image, frame, framing)
      expect(p.originX + p.width).toBeLessThanOrEqual(image.width)
      expect(p.originY + p.height).toBeLessThanOrEqual(image.height)
      expect(Number.isInteger(p.originX + p.originY + p.width + p.height)).toBe(
        true,
      )
    }
  })

  it("clamping is stable: a clamped framing clamps to itself", () => {
    for (const { image, frame, framing } of grid()) {
      const once = clampFraming(image, frame, framing)
      expect(clampFraming(image, frame, once)).toEqual(once)
    }
  })

  // Expected values worked by hand: 3000 / (4/5) = 3750 tall, centred in
  // 4000 leaves 125 above; 3024 * (4/5) = 2419.2 wide, centred in 4032
  // leaves 806.4 at the left.
  it("centres a portrait and a landscape photo in 4:5", () => {
    const frame = { width: 1, height: 1.25 }
    expect(cropRect(IMAGES[0], frame, CENTRED)).toEqual({
      originX: 0,
      originY: 125,
      width: 3000,
      height: 3750,
    })
    const land = cropRect(IMAGES[1], frame, CENTRED)
    expect(land.height).toBeCloseTo(3024)
    expect(land.width).toBeCloseTo(2419.2)
    expect(land.originX).toBeCloseTo(806.4)
    expect(land.originY).toBe(0)
  })

  it("dragging to an edge shows the picture's own edge", () => {
    const frame = { width: 1, height: 1.25 }
    // Landscape at zoom 1: room to move sideways only.
    const m = maxOffset(IMAGES[1], frame, 1)
    expect(m.height).toBeCloseTo(0)
    const left = cropRect(IMAGES[1], frame, { zoom: 1, x: 99, y: 0 })
    expect(left.originX).toBeCloseTo(0)
    const right = cropRect(IMAGES[1], frame, { zoom: 1, x: -99, y: 0 })
    expect(right.originX + right.width).toBeCloseTo(4032)
  })

  it("zooming doubles in on the centre", () => {
    const r = cropRect(
      IMAGES[0],
      { width: 1, height: 1.25 },
      {
        zoom: 2,
        x: 0,
        y: 0,
      },
    )
    expect(r).toEqual({
      originX: 750,
      originY: 1062.5,
      width: 1500,
      height: 1875,
    })
  })

  it("a pinch keeps the point under the fingers in place", () => {
    const image = IMAGES[0]
    const frame = FRAMES[2]
    const start: Framing = { zoom: 2, x: 0, y: 0 }
    const focal = { x: 40, y: -30 }
    const end = pinchAt(image, frame, start, 1.5, focal)
    // The picture point under the focal point, before and after.
    const at = (f: Framing) => {
      const s = coverScale(image, frame) * f.zoom
      return { x: (focal.x - f.x) / s, y: (focal.y - f.y) / s }
    }
    expect(at(end).x).toBeCloseTo(at(start).x)
    expect(at(end).y).toBeCloseTo(at(start).y)
    // And a pinch out past covering stops at covering, centred-safe.
    const out = pinchAt(image, frame, start, 0.1, focal)
    expect(out.zoom).toBe(1)
    expect(clampFraming(image, frame, out)).toEqual(out)
  })

  it("snaps a stored ratio to its post frame", () => {
    expect(frameRatio(0.8)).toBe(0.8)
    expect(frameRatio(1)).toBe(1)
    expect(frameRatio(9 / 16)).toBe(0.8)
    expect(frameRatio(4 / 3)).toBe(1)
    expect(frameRatio(undefined)).toBe(0.8)
    expect(frameRatio(Number.NaN)).toBe(0.8)
  })
})

describe("framePhoto", () => {
  it("cuts a landscape photo to 4:5 and keeps the original to re-crop", async () => {
    picture(4032, 3024)
    const m = await framePhoto({ uri: "file:///land.jpg" })
    const crop = (manip.mock.calls[1][1] as { crop?: object }[])[0].crop
    expect(crop).toEqual({
      originX: 806,
      originY: 0,
      width: 2419,
      height: 3024,
    })
    expect(m.ratio).toBe(0.8)
    expect(m.edit).toMatchObject({
      uri: "file:///land.jpg",
      width: 4032,
      height: 3024,
      framing: CENTRED,
    })
    // The full image is the cut, bounded to a 2048 px long edge.
    expect(m.height).toBe(2048)
  })

  it("cuts a portrait photo to 1:1 where it was placed", async () => {
    picture(3000, 4000)
    // Half a frame width down: the picture moves down, the crop moves up.
    const m = await framePhoto({ uri: "file:///tall.jpg" }, 1, {
      zoom: 1,
      x: 0,
      y: 0.1,
    })
    const crop = (manip.mock.calls[1][1] as { crop?: object }[])[0].crop
    expect(crop).toEqual({
      originX: 0,
      originY: 200,
      width: 3000,
      height: 3000,
    })
    expect(m.ratio).toBe(1)
  })
})

describe("share page Post", () => {
  it("frames the card 4:5 and opens it in the frame editor", async () => {
    const { captureRef } = require("react-native-view-shot")
    captureRef.mockReset()
    captureRef.mockResolvedValue("file:///card.png")
    picture(1080, 1920)
    const { router } = require("expo-router")
    router.push.mockClear()
    render(
      <ShareComposer
        value="card"
        onChange={() => {}}
        caption="Push A"
        items={[
          {
            key: "card",
            label: "Card",
            render: () => null,
          },
        ]}
      >
        {null}
      </ShareComposer>,
    )
    await act(async () => {
      fireEvent.press(screen.getByText("Post"))
    })
    const draft = socialStore.get().drafts.post
    expect(draft?.caption).toBe("Push A")
    expect(draft?.media?.[0]).toMatchObject({
      ratio: 0.8,
      edit: { width: 1080, height: 1920, png: true },
    })
    // A 9:16 card in 4:5 loses the same amount at the top and the bottom.
    const crop = (manip.mock.calls[1][1] as { crop?: object }[])[0].crop
    expect(crop).toEqual({
      originX: 0,
      originY: 285,
      width: 1080,
      height: 1350,
    })
    expect(router.push).toHaveBeenCalledWith("/social/compose?adjust=1")
  })
})
