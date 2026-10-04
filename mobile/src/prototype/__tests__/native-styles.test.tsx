import { fireEvent, render } from "@testing-library/react-native"
import { isValidElement } from "react"
import { Pressable, Text } from "react-native"
import { createInteropElement, cssInterop } from "react-native-css-interop"
import { Tap } from "../native-kit"

jest.mock("expo-router", () => ({ router: { push: jest.fn() } }))

// Jest normally skips NativeWind's JSX transform. Exercise its native adapter
// explicitly so a passing web render cannot hide lost native pressable styles.
cssInterop(Pressable, { className: "style" })
function nativeElement(...args: Parameters<typeof createInteropElement>) {
  const element = createInteropElement(...args)
  if (!isValidElement(element)) throw new Error("Expected a native element")
  return element
}

test("native styling preserves touch target dimensions, spacing and color", () => {
  const onPress = jest.fn()
  const element = Tap({
    label: "Score details",
    onPress,
    style: {
      width: 148,
      height: 148,
      padding: 16,
      backgroundColor: "#a584ff",
      alignItems: "center",
    },
    children: <Text>81</Text>,
  })
  const view = render(nativeElement(element.type, { ...element.props }))
  const button = view.getByRole("button", { name: "Score details" })
  expect(button).toHaveStyle({
    width: 148,
    height: 148,
    padding: 16,
    backgroundColor: "#a584ff",
    alignItems: "center",
  })
  fireEvent.press(button)
  expect(onPress).toHaveBeenCalledTimes(1)
  view.rerender(
    nativeElement(element.type, {
      ...element.props,
      testOnly_pressed: true,
    }),
  )
  expect(button).toHaveStyle({ opacity: 0.65, width: 148 })
  view.rerender(
    nativeElement(element.type, {
      ...element.props,
      testOnly_pressed: false,
    }),
  )
  expect(button).toHaveStyle({ opacity: 1, width: 148 })
})

jest.mock("sonner-native", () => ({ toast: jest.fn() }))
jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  default: require("react-native").Animated,
  useSharedValue: (value: unknown) =>
    require("react").useRef({ value }).current,
  useAnimatedStyle: (get: () => unknown) => get(),
  withSpring: (value: unknown) => value,
  useReducedMotion: () => true,
}))
jest.mock("react-native-gesture-handler/ReanimatedSwipeable", () => "Swipeable")

test.each([
  "light",
  "dark",
] as const)("native controls retain their %s theme and hit areas", (mode) => {
  const { SmallButton } = require("../native-kit")
  const { Button } = require("../ui")
  const { IconButton } = require("../visual")
  const { appearanceStore } = require("../theme")
  const { palette } = require("@domain/design/tokens")
  appearanceStore.set({ mode })
  const theme = palette[mode]
  for (const [control, style] of [
    [
      <SmallButton key="small" accent="hab" onPress={() => {}}>
        Start
      </SmallButton>,
      { height: 36, paddingHorizontal: 12, backgroundColor: theme.hab },
    ],
    [
      <Button key="button" onPress={() => {}}>
        Save
      </Button>,
      { minHeight: 44, paddingHorizontal: 18, backgroundColor: theme.primary },
    ],
    [
      <IconButton
        key="icon"
        icon="add"
        label="Add"
        filled
        onPress={() => {}}
      />,
      { minWidth: 44, minHeight: 44, backgroundColor: theme.primary },
    ],
  ] as const) {
    const source = render(control)
    let node = source.getByRole("button")
    while (typeof node.props.style !== "function" && node.parent)
      node = node.parent
    expect(typeof node.props.style).toBe("function")
    const props = { ...node.props }
    source.unmount()
    const native = render(nativeElement(Pressable, props))
    expect(native.getByRole("button")).toHaveStyle(style)
    native.unmount()
  }
  appearanceStore.set({ mode: "system" })
})
