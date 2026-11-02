// Every screen renders for a brand-new account: the stores emptied exactly as
// a live sign-up empties them (live/blank.ts), and every record route opened
// with an id that matches nothing. A screen that indexes into an empty list,
// takes the min of no values or charts no points fails here by name.
import { readdirSync } from "node:fs"
import { join, relative } from "node:path"
import { captureStore } from "@domain/capture/store"
import { dashStore } from "@domain/dash/store"
import { finStore } from "@domain/finance/store"
import { fitStore } from "@domain/fitness/store"
import { focusStore } from "@domain/focus/store"
import { habitsStore } from "@domain/habits/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { screenStore } from "@domain/screen/store"
import { tasksStore } from "@domain/tasks/store"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render } from "@testing-library/react-native"
import type { ComponentType, ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { clearToBlank } from "@/live/blank"

let mockParams: Record<string, string> = {}
jest.mock("expo-router", () => {
  const { View } = require("react-native")
  const Stub = ({ children }: { children?: ReactNode }) => (
    <View>{children}</View>
  )
  return {
    router: {
      push: jest.fn(),
      replace: jest.fn(),
      back: jest.fn(),
      navigate: jest.fn(),
      dismiss: jest.fn(),
      setParams: jest.fn(),
      canGoBack: () => false,
    },
    useRouter: () => ({
      push: jest.fn(),
      replace: jest.fn(),
      back: jest.fn(),
      canGoBack: () => false,
    }),
    useLocalSearchParams: () => mockParams,
    useGlobalSearchParams: () => mockParams,
    usePathname: () => "/",
    useSegments: () => [],
    useFocusEffect: () => {},
    useNavigation: () => ({ addListener: () => () => {}, setOptions() {} }),
    Redirect: () => null,
    Link: Stub,
    Stack: Object.assign(Stub, { Screen: () => null }),
    Tabs: Object.assign(Stub, { Screen: () => null }),
  }
})
jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  ...require("./reanimated-extras").extras,
  default: Object.assign(require("react-native").Animated, {
    createAnimatedComponent: (c: unknown) => c,
  }),
  createAnimatedComponent: (c: unknown) => c,
  useSharedValue: (value: unknown) =>
    require("react").useRef({ value }).current,
  useAnimatedStyle: (get: () => unknown) => get(),
  useDerivedValue: (get: () => unknown) => ({ value: get() }),
  useAnimatedReaction: () => {},
  useAnimatedScrollHandler: () => () => {},
  useScrollViewOffset: () => ({ value: 0 }),
  useAnimatedRef: () => require("react").useRef(null),
  withSpring: (value: unknown) => value,
  withTiming: (value: unknown) => value,
  useReducedMotion: () => true,
}))
jest.mock("react-native-gesture-handler", () => {
  const chain: object = new Proxy({}, { get: () => () => chain })
  return {
    Gesture: new Proxy({}, { get: () => () => chain }),
    GestureDetector: ({ children }: { children: ReactNode }) => children,
    GestureHandlerRootView: ({ children }: { children: ReactNode }) => children,
    ScrollView: require("react-native").ScrollView,
    FlatList: require("react-native").FlatList,
  }
})
jest.mock("react-native-gesture-handler/ReanimatedSwipeable", () => {
  const { View } = require("react-native")
  return ({ children }: { children: ReactNode }) => <View>{children}</View>
})
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
    dismiss: jest.fn(),
  }),
}))
jest.mock("expo-audio", () => ({}))
jest.mock("expo-video", () => ({
  VideoView: require("react-native").View,
  useVideoPlayer: () => ({
    play() {},
    pause() {},
    addListener: () => ({ remove() {} }),
  }),
}))
jest.mock("../media", () => ({ exportCsv: jest.fn(), pickPhoto: jest.fn() }))

const root = join(__dirname, "../../app/(sop)")
function pages(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...pages(path))
    else if (entry.name.endsWith(".tsx") && entry.name !== "_layout.tsx")
      found.push(relative(root, path))
  }
  return found.sort()
}
// Screens that need a live device service rather than data (a camera, a
// run's GPS, a timer already running) are not data screens; they are named
// here so the list below stays every other route.
const SKIP = new Set([
  "nutrition/scan/index.tsx",
  "fitness/run/index.tsx",
  "onboarding/index.tsx",
])
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
  >
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 44, left: 0, right: 0, bottom: 34 },
      }}
    >
      {children}
    </SafeAreaProvider>
  </QueryClientProvider>
)
beforeAll(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
})
beforeEach(() => resetAll())
const routes = pages(root).filter((p) => !SKIP.has(p))
test("the sweep covers the app's routes", () => {
  expect(routes.length).toBeGreaterThan(100)
  expect(routes).toContain("fitness/body/index.tsx")
})
// The demo's records cut to the first of each list: one weigh-in, one
// workout, one transaction. Lists of one are where "the one before" and
// "the change since" go missing, and where a record can point at a parent
// (a category, an account, an exercise) the cut left behind.
function oneOfEach() {
  const stores = [
    habitsStore,
    tasksStore,
    focusStore,
    screenStore,
    fitStore,
    finStore,
    captureStore,
    dashStore,
  ] as { set: (f: (s: object) => object) => void }[]
  for (const store of stores)
    store.set((s) =>
      Object.fromEntries(
        Object.entries(s).map(([k, v]) => [
          k,
          Array.isArray(v) && k !== "schedule" ? v.slice(0, 1) : v,
        ]),
      ),
    )
}
const renderRoute = (file: string) => {
  // A record route gets an id that matches nothing, as after a delete.
  mockParams = Object.fromEntries(
    [...file.matchAll(/\[(\w+)\]/g)].map((m) => [m[1], "missing"]),
  )
  if (file.includes("[day]")) mockParams.day = "2026-01-05"
  const Page = (
    require(`../../app/(sop)/${file}`) as { default: ComponentType }
  ).default
  const view = render(<Page />, { wrapper })
  view.unmount()
}
test.each(routes)("%s renders for a new account", (file) => {
  clearToBlank()
  renderRoute(file)
})
test.each(routes)("%s renders with one record of each kind", (file) => {
  oneOfEach()
  renderRoute(file)
})
