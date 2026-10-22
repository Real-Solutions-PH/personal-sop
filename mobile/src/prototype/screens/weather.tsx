import { LinearGradient } from "expo-linear-gradient"
import {
  Check,
  ChevronDown,
  ChevronLeft,
  CircleCheck,
  CloudOff,
  Droplets,
  LocateFixed,
  type LucideIcon,
  MapPin,
  Navigation,
  RefreshCw,
  Search,
  Sun,
  Sunrise,
  Thermometer,
  TriangleAlert,
  Umbrella,
  Wind,
} from "lucide-react-native"
import { type ReactNode, useEffect, useState } from "react"
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native"
import Animated, { FadeInDown, useReducedMotion } from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { toast } from "sonner-native"
import { border, Copy, Frame, IconTap, Line, Tap } from "../native-kit"
import { back } from "../navigation"
import { fonts, useTheme } from "../theme"
import { Button, Field, Sheet } from "../ui"
import {
  ago,
  chooseCity,
  currentConditions,
  describeCode,
  describeIssue,
  type Forecast,
  fmtClock,
  fmtHour,
  fmtRange,
  fmtTemp,
  hourOf,
  localStamp,
  locateAndRefresh,
  outdoorAdvice,
  outdoorPlan,
  type Place,
  rainSoon,
  refreshWeather,
  type Scored,
  searchCities,
  skyGradient,
  type TempUnit,
  todayOf,
  upcoming,
  useMinuteTick,
  useWeatherRefresh,
  uvLevel,
  weatherStatus,
  weatherStore,
} from "../weather"
import { AdviceLine } from "../weather-card"

const white = "#ffffff",
  whiteSoft = "#ffffffd9"

function Enter({ index, children }: { index: number; children: ReactNode }) {
  const reduced = useReducedMotion()
  return (
    <Animated.View
      entering={
        // Web previews skip layout animations: reanimated hides the node until
        // its first animation frame, which never arrives in a hidden tab.
        reduced || Platform.OS === "web"
          ? undefined
          : FadeInDown.delay(index * 70).duration(360)
      }
    >
      {children}
    </Animated.View>
  )
}
function CardTitle({
  children,
  right,
}: {
  children: string
  right?: ReactNode
}) {
  return (
    <Line style={{ justifyContent: "space-between", marginBottom: 8 }}>
      <Copy
        size={12}
        weight="medium"
        muted
        style={{ letterSpacing: 0.6, textTransform: "uppercase" }}
      >
        {children}
      </Copy>
      {right}
    </Line>
  )
}
async function askLocation() {
  const r = await locateAndRefresh()
  if (!r.ok) {
    const city = weatherStore.get().city.name
    toast(
      r.reason === "denied"
        ? `Location access is off — showing ${city}. Search for your city instead.`
        : `Couldn't get your location — showing ${city}.`,
    )
  }
  return r
}

export function Weather() {
  const t = useTheme(),
    safe = useSafeAreaInsets()
  const s = weatherStore.use((x) => x),
    loading = weatherStatus((x) => x.loading),
    locating = weatherStatus((x) => x.locating),
    error = weatherStatus((x) => x.error),
    now = useMinuteTick()
  const [sheet, setSheet] = useState(false),
    [pulling, setPulling] = useState(false)
  useWeatherRefresh()
  useEffect(() => {
    // First visit: ask for location once; the saved city shows meanwhile.
    if (!weatherStore.get().asked) askLocation()
  }, [])
  const f = s.forecast
  const setUnit = (unit: TempUnit) => weatherStore.set((x) => ({ ...x, unit }))
  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: safe.top }}>
      <Line style={{ height: 56, paddingHorizontal: 8, gap: 4 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => back()}
          style={{
            minWidth: 44,
            minHeight: 44,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <ChevronLeft size={20} color={t.text} />
        </Pressable>
        <Text
          accessibilityRole="header"
          style={{
            flex: 1,
            fontFamily: fonts.displayMedium,
            fontSize: 20,
            lineHeight: 28,
            color: t.text,
          }}
        >
          Weather
        </Text>
        <Tap
          label={`Temperature unit ${s.unit === "c" ? "Celsius" : "Fahrenheit"}. Switch to ${s.unit === "c" ? "Fahrenheit" : "Celsius"}`}
          onPress={() => setUnit(s.unit === "c" ? "f" : "c")}
          style={{
            minWidth: 44,
            height: 44,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Copy weight="semibold">{s.unit === "c" ? "°C" : "°F"}</Copy>
        </Tap>
        {loading ? (
          <View
            style={{
              width: 44,
              height: 44,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <ActivityIndicator
              color={t.muted}
              accessibilityLabel="Refreshing"
            />
          </View>
        ) : (
          <IconTap
            size={44}
            icon={RefreshCw}
            label="Refresh weather"
            color={t.text}
            onPress={() => refreshWeather(true)}
          />
        )}
        <IconTap
          size={44}
          icon={Search}
          label="Search for a city"
          color={t.text}
          onPress={() => setSheet(true)}
        />
      </Line>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: safe.bottom + 64,
          gap: 12,
        }}
        refreshControl={
          <RefreshControl
            refreshing={pulling}
            tintColor={t.muted}
            onRefresh={() => {
              setPulling(true)
              refreshWeather(true).finally(() => setPulling(false))
            }}
          />
        }
      >
        {f && error && !loading && (
          <Frame
            style={{ padding: 12, backgroundColor: `${t.warn.slice(0, 7)}1a` }}
          >
            <Line style={{ gap: 10 }}>
              <CloudOff size={18} color={t.warn} />
              <Copy size={14} style={{ flex: 1 }}>
                Offline · showing weather from {ago(f.fetchedAt, now)}
              </Copy>
              <IconTap
                size={44}
                icon={RefreshCw}
                label="Retry"
                color={t.text}
                onPress={() => refreshWeather(true)}
              />
            </Line>
          </Frame>
        )}
        {f ? (
          <Loaded
            f={f}
            unit={s.unit}
            now={now}
            source={s.source}
            loading={loading}
            locating={locating}
            onPlace={() => setSheet(true)}
          />
        ) : loading || locating ? (
          <View style={{ gap: 12 }} accessibilityLabel="Loading weather">
            {[240, 120, 180, 300].map((h) => (
              <View
                key={h}
                style={{ height: h, borderRadius: 20, backgroundColor: t.soft }}
              />
            ))}
            <ActivityIndicator
              color={t.muted}
              style={{ position: "absolute", top: 100, alignSelf: "center" }}
            />
          </View>
        ) : (
          <Frame style={{ padding: 24, alignItems: "center", gap: 8 }}>
            <CloudOff size={32} color={t.muted} />
            <Copy weight="semibold" style={{ textAlign: "center" }}>
              Weather unavailable
            </Copy>
            <Copy size={14} muted style={{ textAlign: "center" }}>
              {error ?? "No forecast saved yet."} Pull down or retry once you're
              online.
            </Copy>
            <Line
              style={{
                marginTop: 8,
                gap: 8,
                flexWrap: "wrap",
                justifyContent: "center",
              }}
            >
              <Button icon={RefreshCw} onPress={() => refreshWeather(true)}>
                Retry
              </Button>
              <Button tone="quiet" icon={Search} onPress={() => setSheet(true)}>
                Choose city
              </Button>
            </Line>
          </Frame>
        )}
        <Copy size={12} muted style={{ textAlign: "center", marginTop: 4 }}>
          Weather data by Open-Meteo.com
        </Copy>
      </ScrollView>
      <PlaceSheet open={sheet} onClose={() => setSheet(false)} />
    </View>
  )
}

function Loaded({
  f,
  unit,
  now,
  source,
  loading,
  locating,
  onPlace,
}: {
  f: Forecast
  unit: TempUnit
  now: number
  source: "device" | "city"
  loading: boolean
  locating: boolean
  onPlace: () => void
}) {
  const t = useTheme()
  const cur = currentConditions(f, now),
    today = todayOf(f, now),
    info = describeCode(cur.code, cur.day),
    hours = upcoming(f, now, 24),
    plan = outdoorPlan(f, now),
    advice = outdoorAdvice(f, unit, now)
  const PlaceIcon = source === "device" ? Navigation : MapPin
  return (
    <>
      <Enter index={0}>
        <View style={{ borderRadius: 24, overflow: "hidden" }}>
          <LinearGradient
            colors={skyGradient(info.sky, cur.day)}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ padding: 20 }}
          >
            <Line style={{ gap: 8 }}>
              <Tap
                onPress={onPlace}
                label={`Location ${f.place.name}. Change location`}
                style={{ flex: 1, minHeight: 44, justifyContent: "center" }}
              >
                <Line style={{ gap: 6 }}>
                  <PlaceIcon size={14} color={white} />
                  <Copy
                    weight="semibold"
                    lines={1}
                    style={{ color: white, flexShrink: 1 }}
                  >
                    {f.place.name}
                  </Copy>
                  <ChevronDown size={16} color={white} />
                </Line>
                {f.place.detail ? (
                  <Copy size={12} lines={1} style={{ color: whiteSoft }}>
                    {f.place.detail}
                  </Copy>
                ) : null}
              </Tap>
              <Tap
                onPress={askLocation}
                label="Use current location"
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  backgroundColor: "#ffffff2e",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {locating ? (
                  <ActivityIndicator color={white} />
                ) : (
                  <LocateFixed size={20} color={white} />
                )}
              </Tap>
            </Line>
            <View
              accessible
              accessibilityLabel={`${fmtTemp(cur.temp, unit)}, ${info.label}, feels like ${fmtTemp(cur.feels, unit)}`}
              style={{ marginTop: 8 }}
            >
              <Line style={{ gap: 12, alignItems: "center" }}>
                <Text
                  style={{
                    fontFamily: fonts.display,
                    fontSize: 88,
                    lineHeight: 92,
                    color: white,
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {fmtTemp(cur.temp, unit)}
                </Text>
                <info.icon size={56} color={white} strokeWidth={1.5} />
              </Line>
              <Copy size={20} weight="semibold" style={{ color: white }}>
                {info.label}
              </Copy>
              <Copy size={14} style={{ color: whiteSoft }}>
                Feels {fmtTemp(cur.feels, unit)}
                {today
                  ? ` · H ${fmtTemp(today.max, unit)} L ${fmtTemp(today.min, unit)}`
                  : ""}
              </Copy>
            </View>
            <Line style={{ gap: 8, marginTop: 14, flexWrap: "wrap" }}>
              <HeroChip
                icon={Umbrella}
                text={`${Math.round(rainSoon(f, now))}% rain next 12h`}
              />
              <HeroChip icon={Wind} text={`${Math.round(cur.wind)} km/h`} />
              <HeroChip icon={Sun} text={`UV ${Math.round(cur.uv)} now`} />
            </Line>
            <Copy size={12} style={{ color: whiteSoft, marginTop: 10 }}>
              {loading ? "Updating…" : `Updated ${ago(f.fetchedAt, now)}`}
            </Copy>
          </LinearGradient>
        </View>
      </Enter>
      <Enter index={1}>
        <Frame style={{ paddingVertical: 14 }}>
          <View style={{ paddingHorizontal: 16 }}>
            <CardTitle>Next 24 hours</CardTitle>
          </View>
          {hours.length ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 8 }}
            >
              {hours.map((h, i) => {
                const d = describeCode(h.code, h.day)
                const label = i === 0 ? "Now" : fmtHour(hourOf(h.time))
                return (
                  <View
                    key={h.time}
                    accessible
                    accessibilityLabel={`${label}, ${fmtTemp(h.temp, unit)}, ${d.label}, ${Math.round(h.pop)}% chance of rain`}
                    style={{
                      width: 58,
                      alignItems: "center",
                      gap: 6,
                      paddingVertical: 6,
                      borderRadius: 14,
                      backgroundColor: i === 0 ? t.soft : undefined,
                    }}
                  >
                    <Copy size={12} weight="medium" muted={i !== 0}>
                      {label}
                    </Copy>
                    <d.icon size={22} color={h.day ? t.text : t.muted} />
                    <Copy weight="semibold">{fmtTemp(h.temp, unit)}</Copy>
                    <Copy
                      size={11}
                      weight="medium"
                      style={{ color: h.pop >= 20 ? t.tsk : "transparent" }}
                    >
                      {Math.round(h.pop)}%
                    </Copy>
                  </View>
                )
              })}
            </ScrollView>
          ) : (
            <Copy size={14} muted style={{ paddingHorizontal: 16 }}>
              Hourly forecast is out of date — pull down to refresh.
            </Copy>
          )}
        </Frame>
      </Enter>
      <Enter index={2}>
        <Planner
          plan={plan}
          unit={unit}
          advice={<AdviceLine advice={advice} />}
        />
      </Enter>
      <Enter index={3}>
        <Week f={f} unit={unit} now={now} current={cur.temp} />
      </Enter>
      <Enter index={4}>
        <Line style={{ flexWrap: "wrap", gap: 12, alignItems: "stretch" }}>
          <Tile
            icon={Sun}
            label="UV index"
            value={`${Math.round(cur.uv)}`}
            note={`${uvLevel(cur.uv)} now${today ? ` · peak ${Math.round(today.uv)} (${uvLevel(today.uv).toLowerCase()})` : ""}`}
          />
          <Tile
            icon={Wind}
            label="Wind"
            value={`${Math.round(cur.wind)} km/h`}
            note={
              today
                ? `Up to ${Math.round(today.wind)} km/h today`
                : "Current speed"
            }
          />
          <Tile
            icon={Droplets}
            label="Humidity"
            value={`${Math.round(cur.humidity)}%`}
            note={
              cur.humidity >= 70
                ? "Muggy — sweat evaporates slowly"
                : "Comfortable"
            }
          />
          <Tile
            icon={Thermometer}
            label="Feels like"
            value={fmtTemp(cur.feels, unit)}
            note={
              cur.feels - cur.temp >= 2
                ? "Humidity makes it feel warmer"
                : cur.temp - cur.feels >= 2
                  ? "Wind makes it feel cooler"
                  : "Close to the actual temperature"
            }
          />
          {today && (
            <Tile
              icon={Sunrise}
              label="Sunrise"
              value={fmtClock(today.sunrise)}
              note={`Sunset ${fmtClock(today.sunset)}`}
            />
          )}
          {today && (
            <Tile
              icon={Umbrella}
              label="Precipitation"
              value={`${today.precip.toFixed(1)} mm`}
              note={`Expected today · ${Math.round(today.pop)}% chance`}
            />
          )}
        </Line>
      </Enter>
    </>
  )
}

function HeroChip({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <Line
      style={{
        gap: 6,
        paddingHorizontal: 10,
        height: 30,
        borderRadius: 15,
        backgroundColor: "#ffffff26",
      }}
    >
      <Icon size={14} color={white} />
      <Copy size={12} weight="medium" style={{ color: white }}>
        {text}
      </Copy>
    </Line>
  )
}

function Planner({
  plan,
  unit,
  advice,
}: {
  plan: ReturnType<typeof outdoorPlan>
  unit: TempUnit
  advice: ReactNode
}) {
  const t = useTheme()
  const color = (s: Scored) =>
    s.score >= 70 ? t.good : s.score >= 50 ? t.warn : t.bad
  const inWindow = (s: Scored, w: { hours: Scored[] } | null) =>
    !!w?.hours.includes(s)
  const issues = (w: { hours: Scored[] }) => {
    const seen = new Map<string, string>()
    for (const h of w.hours)
      for (const i of h.issues.slice(0, 2))
        if (!seen.has(i.kind)) seen.set(i.kind, describeIssue(i, unit))
    return [...seen.values()].slice(0, 3).join(", ")
  }
  const hours = plan.hours
  return (
    <Frame style={{ padding: 16 }}>
      <CardTitle
        right={
          <Copy size={12} weight="medium" muted>
            {plan.label} · daylight
          </Copy>
        }
      >
        Outdoor work planner
      </CardTitle>
      {advice}
      {hours.length > 0 && (
        <>
          <View
            accessible
            accessibilityLabel={`Hourly outdoor conditions for ${plan.label.toLowerCase()}: ${hours
              .map(
                (h) =>
                  `${fmtHour(hourOf(h.hour.time))} ${h.score >= 70 ? "good" : h.score >= 50 ? "fair" : "poor"}`,
              )
              .join(", ")}`}
            style={{ marginTop: 14 }}
          >
            <Line style={{ gap: 3 }}>
              {hours.map((h) => (
                <View
                  key={h.hour.time}
                  style={{
                    flex: 1,
                    height: 28,
                    borderRadius: 6,
                    backgroundColor: color(h),
                    opacity:
                      inWindow(h, plan.best) || inWindow(h, plan.worst)
                        ? 1
                        : 0.35,
                  }}
                />
              ))}
            </Line>
            <Line style={{ justifyContent: "space-between", marginTop: 4 }}>
              <Copy size={11} muted>
                {fmtHour(hourOf(hours[0].hour.time))}
              </Copy>
              {hours.length > 4 && (
                <Copy size={11} muted>
                  {fmtHour(
                    hourOf(hours[Math.floor(hours.length / 2)].hour.time),
                  )}
                </Copy>
              )}
              <Copy size={11} muted>
                {fmtHour(hourOf(hours[hours.length - 1].hour.time) + 1)}
              </Copy>
            </Line>
          </View>
          <View style={{ gap: 10, marginTop: 12 }}>
            <Line style={{ alignItems: "flex-start", gap: 10 }}>
              <CircleCheck size={18} color={t.good} style={{ marginTop: 2 }} />
              <View style={{ flex: 1 }}>
                <Copy weight="semibold">
                  {plan.best
                    ? `Best: ${fmtRange(plan.best.start, plan.best.end)}`
                    : "No great window"}
                </Copy>
                <Copy size={12} muted>
                  {plan.best
                    ? plan.best.hours.some((h) => h.issues.length)
                      ? `Manageable · ${issues(plan.best)}`
                      : "Dry, comfortable and low UV"
                    : "Keep outdoor work short and take breaks"}
                </Copy>
              </View>
            </Line>
            {plan.worst && (
              <Line style={{ alignItems: "flex-start", gap: 10 }}>
                <TriangleAlert
                  size={18}
                  color={t.bad}
                  style={{ marginTop: 2 }}
                />
                <View style={{ flex: 1 }}>
                  <Copy weight="semibold">
                    Avoid: {fmtRange(plan.worst.start, plan.worst.end)}
                  </Copy>
                  <Copy size={12} muted>
                    {issues(plan.worst) || "Poor conditions"}
                  </Copy>
                </View>
              </Line>
            )}
          </View>
        </>
      )}
    </Frame>
  )
}

function Week({
  f,
  unit,
  now,
  current,
}: {
  f: Forecast
  unit: TempUnit
  now: number
  current: number
}) {
  const t = useTheme()
  const date = localStamp(f.offset, now).slice(0, 10)
  const days = f.daily.filter((d) => d.date >= date).slice(0, 7)
  if (!days.length) return null
  const lo = Math.min(...days.map((d) => d.min)),
    hi = Math.max(...days.map((d) => d.max)),
    span = Math.max(1, hi - lo)
  return (
    <Frame style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 }}>
      <CardTitle>7-day forecast</CardTitle>
      {days.map((d, i) => {
        const info = describeCode(d.code, true)
        const name =
          d.date === date
            ? "Today"
            : new Date(`${d.date}T12:00:00Z`).toLocaleDateString("en-US", {
                weekday: "short",
                timeZone: "UTC",
              })
        const left = (d.min - lo) / span,
          width = (d.max - d.min) / span
        return (
          <View
            key={d.date}
            accessible
            accessibilityLabel={`${name}: ${info.label}, low ${fmtTemp(d.min, unit)}, high ${fmtTemp(d.max, unit)}, ${Math.round(d.pop)}% chance of rain`}
            style={{
              minHeight: 48,
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              borderTopWidth: i ? 1 : 0,
              borderColor: border(t.line, 0.5),
            }}
          >
            <Copy weight="medium" style={{ width: 46 }} lines={1}>
              {name}
            </Copy>
            <View style={{ width: 36, alignItems: "center" }}>
              <info.icon size={20} color={t.text} />
              {d.pop >= 20 && (
                <Copy
                  size={11}
                  weight="medium"
                  style={{ color: t.tsk, lineHeight: 14 }}
                >
                  {Math.round(d.pop)}%
                </Copy>
              )}
            </View>
            <Copy muted style={{ width: 32, textAlign: "right" }}>
              {fmtTemp(d.min, unit)}
            </Copy>
            <View
              style={{
                flex: 1,
                height: 6,
                borderRadius: 3,
                backgroundColor: t.soft,
              }}
            >
              <LinearGradient
                colors={[t.tsk, t.fit]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{
                  position: "absolute",
                  left: `${left * 100}%`,
                  width: `${Math.max(width, 0.04) * 100}%`,
                  height: 6,
                  borderRadius: 3,
                }}
              />
              {d.date === date && (
                <View
                  style={{
                    position: "absolute",
                    left: `${Math.max(0, Math.min(1, (current - lo) / span)) * 100}%`,
                    top: -2,
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    marginLeft: -5,
                    backgroundColor: t.text,
                    borderWidth: 2,
                    borderColor: t.card,
                  }}
                />
              )}
            </View>
            <Copy weight="semibold" style={{ width: 32, textAlign: "right" }}>
              {fmtTemp(d.max, unit)}
            </Copy>
          </View>
        )
      })}
    </Frame>
  )
}

function Tile({
  icon: Icon,
  label,
  value,
  note,
}: {
  icon: LucideIcon
  label: string
  value: string
  note: string
}) {
  const t = useTheme()
  return (
    <Frame style={{ flexGrow: 1, flexBasis: "40%", padding: 14, gap: 4 }}>
      <Line style={{ gap: 6 }}>
        <Icon size={14} color={t.muted} />
        <Copy
          size={11}
          weight="medium"
          muted
          style={{ letterSpacing: 0.6, textTransform: "uppercase" }}
        >
          {label}
        </Copy>
      </Line>
      <Copy weight="display" size={24} style={{ lineHeight: 30 }}>
        {value}
      </Copy>
      <Copy size={12} muted>
        {note}
      </Copy>
    </Frame>
  )
}

function PlaceSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTheme()
  const s = weatherStore.use((x) => x),
    locating = weatherStatus((x) => x.locating)
  const [query, setQuery] = useState(""),
    [results, setResults] = useState<Place[]>([]),
    [state, setState] = useState<"idle" | "searching" | "error">("idle")
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([])
      setState("idle")
      return
    }
    let live = true
    setState("searching")
    const id = setTimeout(() => {
      searchCities(query)
        .then((r) => {
          if (!live) return
          setResults(r)
          setState("idle")
        })
        .catch(() => live && setState("error"))
    }, 350)
    return () => {
      live = false
      clearTimeout(id)
    }
  }, [query])
  const pick = (p: Place) => {
    chooseCity(p)
    setQuery("")
    onClose()
  }
  return (
    <Sheet title="Weather location" open={open} onClose={onClose}>
      <PlaceRow
        icon={LocateFixed}
        title="Use current location"
        detail={
          s.device ? `Last: ${s.device.name}` : "Asks for location permission"
        }
        selected={s.source === "device"}
        busy={locating}
        onPress={async () => {
          const r = await askLocation()
          if (r.ok) onClose()
        }}
      />
      <PlaceRow
        icon={MapPin}
        title={s.city.name}
        detail={`Saved city${s.city.detail ? ` · ${s.city.detail}` : ""}`}
        selected={s.source === "city"}
        onPress={() => pick(s.city)}
      />
      <Field
        label="Search for a city"
        placeholder="e.g. Cebu, Davao, Singapore"
        value={query}
        onChangeText={setQuery}
        autoCorrect={false}
        returnKeyType="search"
      />
      {state === "searching" && (
        <ActivityIndicator color={t.muted} style={{ marginVertical: 12 }} />
      )}
      {state === "error" && (
        <Copy size={14} style={{ color: t.bad, marginVertical: 8 }}>
          City search needs a connection. Try again when you're online.
        </Copy>
      )}
      {state === "idle" && query.trim().length >= 2 && !results.length && (
        <Copy size={14} muted style={{ marginVertical: 8 }}>
          No places match “{query.trim()}”.
        </Copy>
      )}
      {results.map((p, i) => (
        <PlaceRow
          key={`${i}:${p.lat},${p.lon}`}
          icon={MapPin}
          title={p.name}
          detail={p.detail}
          onPress={() => pick(p)}
        />
      ))}
    </Sheet>
  )
}

function PlaceRow({
  icon: Icon,
  title,
  detail,
  selected,
  onPress,
  busy,
}: {
  icon: LucideIcon
  title: string
  detail?: string
  selected?: boolean
  onPress: () => void
  busy?: boolean
}) {
  const t = useTheme()
  return (
    <Tap
      onPress={onPress}
      label={`${title}${detail ? `, ${detail}` : ""}${selected ? ", selected" : ""}`}
      style={{ minHeight: 52, paddingVertical: 8, justifyContent: "center" }}
    >
      <Line>
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 12,
            backgroundColor: t.soft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {busy ? (
            <ActivityIndicator color={t.muted} />
          ) : (
            <Icon size={16} color={t.text} />
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Copy weight="medium" lines={1}>
            {title}
          </Copy>
          {detail ? (
            <Copy size={12} muted lines={1}>
              {detail}
            </Copy>
          ) : null}
        </View>
        {selected && <Check size={18} color={t.primary} />}
      </Line>
    </Tap>
  )
}
