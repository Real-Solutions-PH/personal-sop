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
import { ActivityIndicator, View } from "react-native"
import { Copy, Frame, IconTap, Line, Tap } from "./native-kit"
import { go } from "./navigation"
import { fonts, useTheme } from "./theme"
import {
  type Advice,
  ago,
  currentConditions,
  describeCode,
  fmtTemp,
  outdoorAdvice,
  rainSoon,
  refreshWeather,
  todayOf,
  useMinuteTick,
  useWeatherRefresh,
  weatherStatus,
  weatherStore,
} from "./weather"

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
  const t = useTheme()
  const f = weatherStore.use((s) => s.forecast),
    unit = weatherStore.use((s) => s.unit),
    loading = weatherStatus((s) => s.loading),
    error = weatherStatus((s) => s.error),
    now = useMinuteTick()
  if (!f)
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
                  {loading ? "Checking the weather…" : "Weather unavailable"}
                </Copy>
                {!loading && error && (
                  <Copy size={12} muted>
                    {error}
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
  const cur = currentConditions(f, now),
    today = todayOf(f, now),
    info = describeCode(cur.code, cur.day),
    advice = outdoorAdvice(f, unit, now),
    Icon = info.icon
  return (
    <Frame>
      <Tap
        onPress={() => go("/weather")}
        label={`Weather in ${f.place.name}: ${fmtTemp(cur.temp, unit)}, ${info.label}, feels like ${fmtTemp(cur.feels, unit)}. ${advice.text}. Opens forecast.`}
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
              fontFamily: fonts.display,
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
                  {Math.round(rainSoon(f, now))}%
                </Copy>
              </Line>
            )}
          </View>
        </Line>
        <AdviceLine advice={advice} />
        <Copy size={12} muted>
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
