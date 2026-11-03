import {
  CircleCheck,
  CloudLightning,
  CloudOff,
  type LucideIcon,
  RefreshCw,
  Sun,
  Thermometer,
  TriangleAlert,
  Umbrella,
  Wind,
} from "lucide-react-native"
import { type ReactNode, useEffect, useState } from "react"
import {
  ActivityIndicator,
  Image,
  type ImageSourcePropType,
  View,
} from "react-native"
import { toast } from "sonner-native"
import { CornerMotif } from "./brand/corner"
import { Copy, Frame, IconTap, Line, Tap } from "./native-kit"
import { go } from "./navigation"
import { fonts, useTheme } from "./theme"
import {
  type Advice,
  ago,
  askLocationOnce,
  currentConditions,
  describeCode,
  fmtTemp,
  locateAndRefresh,
  outdoorAdvice,
  rainSoon,
  refreshWeather,
  type SkyImage,
  skyImage,
  skyImageIsDark,
  staleLocation,
  todayOf,
  useMinuteTick,
  useWeatherRefresh,
  weatherStatus,
  weatherStore,
} from "./weather"

// Ask for the device location (the one-time ask when `once`), and say so
// when it falls back to the saved city.
export async function askLocation(once = false) {
  const pending = once ? askLocationOnce() : locateAndRefresh()
  if (!pending) return null
  const r = await pending
  if (!r.ok) {
    const city = weatherStore.get().city.name
    toast.warning(
      r.reason === "denied"
        ? `Location access is off — showing ${city}. Search for your city instead.`
        : `Couldn't get your location — showing ${city}.`,
    )
  }
  return r
}

export const adviceIcon: Record<Advice["kind"], LucideIcon> = {
  storm: CloudLightning,
  rain: Umbrella,
  heat: Thermometer,
  uv: Sun,
  wind: Wind,
  window: CircleCheck,
  fair: TriangleAlert,
  none: TriangleAlert,
}
export function useToneColor() {
  const t = useTheme()
  return (tone: Advice["tone"]) =>
    tone === "good" ? t.good : tone === "bad" ? t.bad : t.warn
}
export function AdviceLine({ advice }: { advice: Advice }) {
  const tone = useToneColor()(advice.tone)
  const Icon = adviceIcon[advice.kind]
  return (
    <Line
      style={{
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 12,
        backgroundColor: `${tone.slice(0, 7)}1f`,
        alignItems: "flex-start",
      }}
    >
      <Icon size={16} color={tone} style={{ marginTop: 2 }} />
      <Copy size={14} weight="medium" style={{ flex: 1 }}>
        {advice.text}
      </Copy>
    </Line>
  )
}

// Compact, glanceable weather for the Today screen. Tap opens /weather.
export function WeatherCard() {
  useWeatherRefresh()
  useEffect(() => {
    // First launch: the one-time location ask, so Today isn't stuck on the
    // default city until the Weather screen is opened.
    askLocation(true)
  }, [])
  const t = useTheme()
  const s = weatherStore.use((x) => x),
    f = s.forecast,
    unit = s.unit,
    loading = weatherStatus((x) => x.loading),
    error = weatherStatus((x) => x.error),
    fixFailed = weatherStatus((x) => x.fixFailed),
    now = useMinuteTick()
  const cur = f ? currentConditions(f, now) : null
  if (!f || !cur)
    return (
      <Frame style={{ padding: 16 }}>
        <CornerMotif kind="sprig" seed={5} />
        <Line>
          <Tap
            onPress={() => go("/weather")}
            label="Weather. Opens forecast."
            style={{ flex: 1, minHeight: 44, justifyContent: "center" }}
          >
            <Line style={{ gap: 10 }}>
              {loading ? (
                <ActivityIndicator color={t.muted} />
              ) : (
                <CloudOff size={20} color={t.muted} />
              )}
              <View style={{ flex: 1 }}>
                <Copy weight="semibold">
                  {loading
                    ? "Checking the weather…"
                    : f
                      ? "Forecast out of date"
                      : "Weather unavailable"}
                </Copy>
                {!loading && (error || f) && (
                  <Copy size={12} muted>
                    {error ??
                      `Last updated ${ago(f?.fetchedAt ?? now, now)} — refresh for now.`}
                  </Copy>
                )}
              </View>
            </Line>
          </Tap>
          {!loading && (
            <IconTap
              size={44}
              icon={RefreshCw}
              label="Retry weather"
              onPress={() => refreshWeather(true)}
            />
          )}
        </Line>
      </Frame>
    )
  const today = todayOf(f, now),
    rain = Math.round(rainSoon(f, now)),
    lastKnown = staleLocation(s, fixFailed, now),
    info = describeCode(cur.code, cur.day),
    advice = outdoorAdvice(f, unit, now),
    AdviceIcon = adviceIcon[advice.kind]
  return (
    <SkyCard sky={skyImage(info.sky, cur.day)}>
      {(ink) => (
        <Tap
          onPress={() => go("/weather")}
          label={`Weather in ${f.place.name}${lastKnown ? ` (${lastKnown})` : ""}: ${fmtTemp(cur.temp, unit)}, ${info.label}, feels like ${fmtTemp(cur.feels, unit)}, ${rain}% chance of rain in the next 12 hours. ${advice.text}. Opens forecast.`}
          style={{ padding: 16, gap: 10, minHeight: 150 }}
        >
          <Line style={{ gap: 8, alignItems: "flex-start", maxWidth: "64%" }}>
            <Copy
              style={{
                fontFamily: fonts.mono,
                fontSize: 40,
                lineHeight: 44,
                color: ink.text,
              }}
            >
              {fmtTemp(cur.temp, unit)}
            </Copy>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Copy
                size={14}
                weight="semibold"
                lines={1}
                style={{ color: ink.text }}
              >
                {info.label}
              </Copy>
              <Copy size={12} lines={1} style={{ color: ink.muted }}>
                {f.place.name} · feels {fmtTemp(cur.feels, unit)}
              </Copy>
              {today && (
                <Copy size={12} weight="medium" style={{ color: ink.text }}>
                  H {fmtTemp(today.max, unit)} L {fmtTemp(today.min, unit)}
                </Copy>
              )}
              {today && (
                <Line style={{ gap: 3 }}>
                  <Umbrella size={12} color={ink.muted} />
                  <Copy size={12} style={{ color: ink.muted }}>
                    {rain}% next 12h
                  </Copy>
                </Line>
              )}
            </View>
          </Line>
          <Line style={{ gap: 6, alignItems: "flex-start", maxWidth: "60%" }}>
            <AdviceIcon size={14} color={ink.text} style={{ marginTop: 2 }} />
            <Copy size={14} style={{ flex: 1, color: ink.text }}>
              {advice.text}
            </Copy>
          </Line>
          <Copy size={12} style={{ color: ink.muted, maxWidth: "64%" }}>
            {lastKnown ? `${lastKnown} · ` : ""}
            {error && !loading
              ? `Offline · showing weather from ${ago(f.fetchedAt, now)}`
              : loading
                ? "Updating…"
                : `Updated ${ago(f.fetchedAt, now)}`}
          </Copy>
        </Tap>
      )}
    </SkyCard>
  )
}

/** The agy drawings, one per sky (assets/weather). The art sits on the
 * right; the text keeps to the quiet left side. */
const SKY_ART: Record<SkyImage, ImageSourcePropType> = {
  "clear-day": require("../../assets/weather/wx-clear-day.jpg"),
  "clear-night": require("../../assets/weather/wx-clear-night.jpg"),
  "partly-day": require("../../assets/weather/wx-partly-day.jpg"),
  "partly-night": require("../../assets/weather/wx-partly-night.jpg"),
  cloudy: require("../../assets/weather/wx-cloudy.jpg"),
  fog: require("../../assets/weather/wx-fog.jpg"),
  drizzle: require("../../assets/weather/wx-drizzle.jpg"),
  rain: require("../../assets/weather/wx-rain.jpg"),
  snow: require("../../assets/weather/wx-snow.jpg"),
  storm: require("../../assets/weather/wx-storm.jpg"),
}
/** The drawings' own grounds and inks: fixed, since the art does not follow
 * the app theme. Day art takes ink text, night art light text. */
const SKY_INK = {
  day: { ground: "#f6f5f1", text: "#1b1f1c", muted: "#4d544e" },
  night: { ground: "#131714", text: "#ecebe6", muted: "#b5bab4" },
} as const
export type SkyInk = (typeof SKY_INK)[keyof typeof SKY_INK]

/** A card on a sky drawing, fitted to the card's height and anchored right,
 * so the art never sits under the text on the left. */
export function SkyCard({
  sky,
  children,
}: {
  sky: SkyImage
  children: (ink: SkyInk) => ReactNode
}) {
  const ink = SKY_INK[skyImageIsDark(sky) ? "night" : "day"],
    [h, setH] = useState(0)
  return (
    <View
      testID={`sky-card-${sky}`}
      onLayout={(e) => setH(Math.round(e.nativeEvent.layout.height))}
      style={{
        borderRadius: 16,
        borderWidth: 1,
        borderColor: `${ink.text}17`,
        backgroundColor: ink.ground,
        overflow: "hidden",
      }}
    >
      {h > 0 && (
        <Image
          testID="sky-art"
          source={SKY_ART[sky]}
          accessibilityIgnoresInvertColors
          resizeMode="cover"
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            height: h,
            width: h * 1.5,
          }}
        />
      )}
      {children(ink)}
    </View>
  )
}
