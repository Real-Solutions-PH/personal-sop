// A run's or walk's route. On an iPhone build it is Apple Maps (expo-maps)
// with the route drawn on it; where that native view is missing (web, Expo
// Go, Android without a Maps key, tests) the route is drawn as a trace on
// the card, so the shape of the session still shows.

import type { RunPoint } from "@domain/fitness/data"
import { type ComponentType, useMemo } from "react"
import { Platform, View, type ViewStyle } from "react-native"
import Svg, { Circle, Polyline } from "react-native-svg"
import { useTheme } from "./theme"

type Coordinates = { latitude: number; longitude: number }
interface AppleMapProps {
  style?: ViewStyle
  cameraPosition?: { coordinates?: Coordinates; zoom?: number }
  polylines?: {
    id?: string
    coordinates: Coordinates[]
    color?: string
    width?: number
  }[]
  circles?: {
    id?: string
    center: Coordinates
    radius: number
    color?: string
    lineColor?: string
    lineWidth?: number
  }[]
  uiSettings?: Record<string, boolean>
  properties?: Record<string, unknown>
}

let apple: ComponentType<AppleMapProps> | null | undefined
function appleMaps(): ComponentType<AppleMapProps> | null {
  if (apple !== undefined) return apple
  apple = null
  if (Platform.OS !== "ios") return apple
  try {
    const { requireOptionalNativeModule } =
      require("expo") as typeof import("expo")
    // Builds made before expo-maps was added have no native view.
    if (!requireOptionalNativeModule("ExpoAppleMaps")) return apple
    const m = require("expo-maps") as {
      AppleMaps: { View: ComponentType<AppleMapProps> }
    }
    apple = m.AppleMaps.View
  } catch {
    apple = null
  }
  return apple
}

/** Centre and zoom that fit every point, with a margin. */
export function frame(points: RunPoint[]) {
  if (!points.length) return null
  let n = -90,
    s = 90,
    e = -180,
    w = 180
  for (const p of points) {
    n = Math.max(n, p[0])
    s = Math.min(s, p[0])
    e = Math.max(e, p[1])
    w = Math.min(w, p[1])
  }
  const lat = (n + s) / 2,
    lng = (e + w) / 2
  const span = Math.max((e - w) * Math.cos((lat * Math.PI) / 180), n - s, 0.002)
  // A world 256 points wide at zoom 0; keep the route in about 60% of a
  // phone-wide map.
  const zoom = Math.min(18, Math.max(3, Math.log2((360 * 0.6) / span) - 0.3))
  return { lat, lng, n, s, e, w, zoom }
}

export function RouteMap({
  points,
  height = 220,
  live = false,
  style,
}: {
  points: RunPoint[]
  height?: number
  /** Follows the person: shows where they are, centred on the last fix. */
  live?: boolean
  style?: ViewStyle
}) {
  const t = useTheme()
  const MapView = appleMaps()
  const f = useMemo(() => frame(points), [points])
  const coords = useMemo(
    () => points.map((p) => ({ latitude: p[0], longitude: p[1] })),
    [points],
  )
  const box: ViewStyle = {
    height,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: t.soft,
    ...style,
  }
  if (MapView) {
    const last = coords.at(-1)
    return (
      <View
        style={box}
        accessible
        accessibilityLabel={points.length ? "Map of the route" : "Map"}
      >
        <MapView
          style={{ flex: 1 }}
          cameraPosition={
            live && last
              ? { coordinates: last, zoom: 16 }
              : f
                ? {
                    coordinates: { latitude: f.lat, longitude: f.lng },
                    zoom: f.zoom,
                  }
                : undefined
          }
          polylines={
            coords.length > 1
              ? [{ id: "route", coordinates: coords, color: t.fit, width: 5 }]
              : []
          }
          circles={
            coords[0]
              ? [
                  {
                    id: "start",
                    center: coords[0],
                    radius: 6,
                    color: t.good,
                    lineColor: "#ffffff",
                    lineWidth: 2,
                  },
                ]
              : []
          }
          uiSettings={{ compassEnabled: false, scaleBarEnabled: false }}
          properties={{ isMyLocationEnabled: live, selectionEnabled: false }}
        />
      </View>
    )
  }
  return (
    <View style={box} accessible accessibilityLabel="Route trace">
      <Trace points={points} height={height} live={live} />
    </View>
  )
}

/** The route drawn to fit its box: a line with a start dot and, while it
 * records, a dot for where the person is now. */
export function Trace({
  points,
  height,
  live = false,
  stroke = 4,
  aspect,
}: {
  points: RunPoint[]
  height: number
  live?: boolean
  stroke?: number
  /** Width over height of the box; a phone-wide card by default. */
  aspect?: number
}) {
  const t = useTheme()
  const f = frame(points)
  // Drawn in a fixed 1000-wide space and scaled by the Svg viewBox.
  const W = 1000,
    H = Math.round(W / (aspect ?? 340 / height)),
    pad = 60
  if (!f || points.length < 2)
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        {points.length === 1 && (
          <View
            style={{
              width: 14,
              height: 14,
              borderRadius: 7,
              backgroundColor: t.fit,
              borderWidth: 3,
              borderColor: t.card,
            }}
          />
        )}
      </View>
    )
  const k = Math.cos((f.lat * Math.PI) / 180)
  const spanX = Math.max((f.e - f.w) * k, 1e-6),
    spanY = Math.max(f.n - f.s, 1e-6)
  const scale = Math.min((W - pad * 2) / spanX, (H - pad * 2) / spanY)
  const ox = (W - spanX * scale) / 2,
    oy = (H - spanY * scale) / 2
  const xy = (p: RunPoint) =>
    [ox + (p[1] - f.w) * k * scale, oy + (f.n - p[0]) * scale] as const
  const line = points.map((p) => xy(p).join(",")).join(" ")
  const [sx, sy] = xy(points[0])
  const [ex, ey] = xy(points.at(-1) as RunPoint)
  return (
    <Svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
    >
      <Polyline
        points={line}
        fill="none"
        stroke={t.fit}
        strokeWidth={stroke * (W / 340)}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <Circle
        cx={sx}
        cy={sy}
        r={7 * (W / 340)}
        fill={t.good}
        stroke={t.card}
        strokeWidth={2.5 * (W / 340)}
      />
      <Circle
        cx={ex}
        cy={ey}
        r={7 * (W / 340)}
        fill={live ? t.fit : t.text}
        stroke={t.card}
        strokeWidth={2.5 * (W / 340)}
      />
    </Svg>
  )
}
