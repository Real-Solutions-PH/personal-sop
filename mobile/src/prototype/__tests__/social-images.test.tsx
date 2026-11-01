import { render, screen } from "@testing-library/react-native"
import * as ImageManipulator from "expo-image-manipulator"
import { prepareImage } from "../social/media"
import { RemoteImage } from "../social/remote-image"

jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
}))
jest.mock("expo-image", () => {
  const { View } = require("react-native")
  return { Image: (props: object) => <View {...props} /> }
})
let mockSize = 1_000
jest.mock("expo-file-system", () => ({
  File: class {
    get size() {
      return mockSize
    }
    get exists() {
      return true
    }
    copy() {}
  },
  Directory: class {
    exists = true
    create() {}
  },
  Paths: { document: "/docs" },
}))
jest.mock("expo-image-manipulator", () => ({
  SaveFormat: { JPEG: "jpeg", PNG: "png" },
  manipulateAsync: jest.fn(),
}))

const manip = jest.mocked(ImageManipulator.manipulateAsync)
/** The manipulator answers like the real one: the input size for no
 * actions, the resized size otherwise; base64 only when asked. */
function source(width: number, height: number, lqip = "AAAA") {
  manip.mockImplementation(async (uri, actions = [], opts = {}) => {
    const r = (actions[0] as { resize?: { width?: number; height?: number } })
      ?.resize
    const k = r?.width ? r.width / width : r?.height ? r.height / height : 1
    return {
      uri: `${uri}#${Math.round(width * k)}`,
      width: Math.round(width * k),
      height: Math.round(height * k),
      base64: opts.base64 ? lqip : undefined,
    }
  })
}
const resizes = () =>
  manip.mock.calls
    .map(([, actions]) => (actions?.[0] as { resize?: object })?.resize)
    .filter(Boolean)

beforeEach(() => {
  manip.mockReset()
  mockSize = 1_000
})

test("a big photo becomes 2048, 640 and 16 px versions", async () => {
  source(4032, 3024)
  const p = await prepareImage("file:///pick.heic")
  expect(resizes()).toEqual([{ width: 2048 }, { width: 640 }, { width: 16 }])
  expect(p).toMatchObject({
    fullMime: "image/jpeg",
    width: 2048,
    height: 1536,
    lqip: "data:image/jpeg;base64,AAAA",
  })
  expect(p.preview).not.toBe(p.full)
})

test("a small photo is never upscaled", async () => {
  source(400, 600)
  const p = await prepareImage("file:///small.jpg")
  // Only the placeholder is resized; full and preview keep 400 x 600.
  expect(resizes()).toEqual([{ height: 16 }])
  expect(p).toMatchObject({ width: 400, height: 600 })
})

test("a placeholder over 2048 characters retries smaller, then is dropped", async () => {
  source(1000, 1000, "A".repeat(3000))
  const p = await prepareImage("file:///noisy.jpg")
  expect(resizes().slice(-2)).toEqual([{ width: 16 }, { width: 12 }])
  expect(p.lqip).toBeUndefined()
})

test("a share card PNG under the cap is uploaded as it is", async () => {
  source(1080, 1920)
  const p = await prepareImage("file:///card.png", { keepPng: true })
  expect(p).toMatchObject({
    full: "file:///card.png",
    fullMime: "image/png",
    width: 1080,
    height: 1920,
  })
  // No JPEG of the full image was made; only the preview and placeholder.
  expect(resizes()).toEqual([{ height: 640 }, { height: 16 }])
})

test("a share card PNG over 15 MB is re-encoded as a JPEG", async () => {
  mockSize = 16 * 1024 * 1024
  source(1080, 1920)
  const p = await prepareImage("file:///big.png", { keepPng: true })
  expect(p.fullMime).toBe("image/jpeg")
  expect(p.full).not.toBe("file:///big.png")
})

const media = {
  id: "m1",
  uri: "https://cdn/full",
  previewUri: "https://cdn/prev",
  lqip: "data:image/jpeg;base64,AAAA",
}

test("the base layer is the preview, cached by id, over the placeholder", () => {
  render(<RemoteImage media={media} width={300} height={300} active={false} />)
  const base = screen.getByTestId("remote-image-base")
  expect(base.props.source).toEqual({
    uri: "https://cdn/prev",
    cacheKey: "m1:p",
  })
  expect(base.props.placeholder).toEqual({ uri: media.lqip })
  expect(screen.queryByTestId("remote-image-full")).toBeNull()
})

test("the full layer is added once active and stays", () => {
  const view = render(
    <RemoteImage media={media} width={300} height={300} active={false} />,
  )
  view.rerender(<RemoteImage media={media} width={300} height={300} active />)
  expect(screen.getByTestId("remote-image-full").props.source).toEqual({
    uri: "https://cdn/full",
    cacheKey: "m1:f",
  })
  view.rerender(
    <RemoteImage media={media} width={300} height={300} active={false} />,
  )
  expect(screen.getByTestId("remote-image-full")).toBeTruthy()
})

test("an older photo with no preview shows its full image, cached by id", () => {
  render(
    <RemoteImage
      media={{ id: "m2", uri: "https://cdn/old" }}
      width={300}
      height={300}
    />,
  )
  expect(screen.getByTestId("remote-image-base").props.source).toEqual({
    uri: "https://cdn/old",
    cacheKey: "m2:f",
  })
  expect(screen.queryByTestId("remote-image-full")).toBeNull()
})

test("grids ask for the preview only", () => {
  render(
    <RemoteImage
      media={media}
      width={100}
      height={100}
      variant="preview"
      active
    />,
  )
  expect(screen.queryByTestId("remote-image-full")).toBeNull()
})
