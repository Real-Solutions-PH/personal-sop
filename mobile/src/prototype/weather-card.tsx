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
import { useEffect } from "react"
import { ActivityIndicator, View } from "react-native"
import { toast } from "sonner-native"
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
    Icon = info.icon
  return (
    <Frame>
      <Tap
        onPress={() => go("/weather")}
        label={`Weather in ${f.place.name}${lastKnown ? ` (${lastKnown})` : ""}: ${fmtTemp(cur.temp, unit)}, ${info.label}, feels like ${fmtTemp(cur.feels, unit)}, ${rain}% chance of rain in the next 12 hours. ${advice.text}. Opens forecast.`}
        style={{ padding: 16, gap: 12 }}
      >
        <Line style={{ gap: 8 }}>
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              backgroundColor: `${t.tsk}1f`,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon size={22} color={t.tsk} />
          </View>
          <Copy
            style={{
              fontFamily: fonts.mono,
              fontSize: 36,
              lineHeight: 40,
            }}
          >
            {fmtTemp(cur.temp, unit)}
          </Copy>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Copy size={14} weight="semibold" lines={1}>
              {info.label}
            </Copy>
            <Copy size={12} muted lines={1}>
              {f.place.name} · feels {fmtTemp(cur.feels, unit)}
            </Copy>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            {today && (
              <Copy size={12} weight="medium">
                H {fmtTemp(today.max, unit)} L {fmtTemp(today.min, unit)}
              </Copy>
            )}
            {today && (
              <Line style={{ gap: 3 }}>
                <Umbrella size={12} color={t.tsk} />
                <Copy size={12} muted>
                  {rain}% next 12h
                </Copy>
              </Line>
            )}
          </View>
        </Line>
        <AdviceLine advice={advice} />
        <Copy size={12} muted>
          {lastKnown ? `${lastKnown} · ` : ""}
          {error && !loading
            ? `Offline · showing weather from ${ago(f.fetchedAt, now)}`
            : loading
              ? "Updating…"
              : `Updated ${ago(f.fetchedAt, now)}`}
        </Copy>
      </Tap>
    </Frame>
  )
}
