// Weather for the prototype: Open-Meteo fetch + cache, WMO code mapping and
// outdoor-work advice. Keyless and free; no backend involved.
import { createStore } from "@domain/lib/store"
import * as Location from "expo-location"
import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudMoon,
  CloudMoonRain,
  CloudRain,
  CloudSnow,
  CloudSun,
  CloudSunRain,
  type LucideIcon,
  Moon,
  Snowflake,
  Sun,
} from "lucide-react-native"
import { useEffect, useState } from "react"
import { AppState, Platform } from "react-native"
import { create } from "zustand"

export type TempUnit = "c" | "f"
export interface Place {
  name: string
  detail?: string
  lat: number
  lon: number
}
export interface Hour {
  time: string // location-local ISO, e.g. 2026-10-04T14:00
  temp: number
  feels: number
  code: number
  pop: number
  precip: number
  wind: number
  uv: number
  humidity: number
  day: boolean
}
export interface Day {
  date: string
  code: number
  max: number
  min: number
  feelsMax: number
  pop: number
  precip: number
  uv: number
  wind: number
  sunrise: string
  sunset: string
}
export interface Forecast {
  fetchedAt: number
  place: Place
  offset: number // seconds east of UTC at the forecast location
  current: Hour
  hourly: Hour[]
  daily: Day[]
}

export const MANILA: Place = {
  name: "Manila",
  detail: "Metro Manila, Philippines",
  lat: 14.5995,
  lon: 120.9842,
}
export const STALE_MS = 15 * 60_000
export const weatherStore = createStore<{
  source: "device" | "city"
  city: Place
  device: Place | null
  asked: boolean
  unit: TempUnit
  forecast: Forecast | null
}>("weather", () => ({
  source: "city",
  city: MANILA,
  device: null,
  asked: false,
  unit: "c",
  forecast: null,
}))

// ---- WMO weather codes -----------------------------------------------------
export type Sky =
  | "clear"
  | "partly"
  | "cloudy"
  | "fog"
  | "drizzle"
  | "rain"
  | "snow"
  | "storm"
export function describeCode(
  code: number,
  day = true,
): { label: string; icon: LucideIcon; sky: Sky } {
  if (code === 0)
    return { label: "Clear", icon: day ? Sun : Moon, sky: "clear" }
  if (code === 1)
    return {
      label: day ? "Mostly sunny" : "Mostly clear",
      icon: day ? Sun : Moon,
      sky: "clear",
    }
  if (code === 2)
    return {
      label: "Partly cloudy",
      icon: day ? CloudSun : CloudMoon,
      sky: "partly",
    }
  if (code === 3) return { label: "Overcast", icon: Cloud, sky: "cloudy" }
  if (code === 45 || code === 48)
    return { label: "Fog", icon: CloudFog, sky: "fog" }
  if (code >= 51 && code <= 57)
    return {
      label: code >= 56 ? "Freezing drizzle" : "Drizzle",
      icon: CloudDrizzle,
      sky: "drizzle",
    }
  if (code >= 61 && code <= 67)
    return {
      label:
        code >= 66
          ? "Freezing rain"
          : code === 61
            ? "Light rain"
            : code === 65
              ? "Heavy rain"
              : "Rain",
      icon: CloudRain,
      sky: "rain",
    }
  if ((code >= 71 && code <= 77) || code === 85 || code === 86)
    return {
      label: code >= 85 ? "Snow showers" : "Snow",
      icon: code >= 85 ? CloudSnow : Snowflake,
      sky: "snow",
    }
  if (code >= 80 && code <= 82)
    return {
      label: code === 82 ? "Heavy showers" : "Rain showers",
      icon: day ? CloudSunRain : CloudMoonRain,
      sky: "rain",
    }
  if (code >= 95)
    return {
      label: code === 95 ? "Thunderstorm" : "Thunderstorm, hail",
      icon: CloudLightning,
      sky: "storm",
    }
  return { label: "Unknown", icon: Cloud, sky: "cloudy" }
}
// Fixed hero gradients (white text stays readable in both app themes).
export function skyGradient(sky: Sky, day: boolean): [string, string] {
  const table: Record<Sky, [[string, string], [string, string]]> = {
    clear: [
      ["#2f7fd6", "#5fb0ea"],
      ["#0b1a3a", "#25365f"],
    ],
    partly: [
      ["#3f7cb8", "#7aa9cf"],
      ["#121d33", "#2d3a52"],
    ],
    cloudy: [
      ["#4f6074", "#7a8a9c"],
      ["#1a212b", "#353f4c"],
    ],
    fog: [
      ["#56616b", "#7f8a93"],
      ["#1c2126", "#3a4148"],
    ],
    drizzle: [
      ["#3e5770", "#68829b"],
      ["#121b25", "#2c3a4a"],
    ],
    rain: [
      ["#33485e", "#5a7189"],
      ["#0e161f", "#263445"],
    ],
    snow: [
      ["#4f6d8a", "#7f9cb8"],
      ["#18222e", "#3a4a5c"],
    ],
    storm: [
      ["#2b2742", "#4c4668"],
      ["#120f1f", "#2b2640"],
    ],
  }
  return table[sky][day ? 0 : 1]
}

// ---- Units & formatting ----------------------------------------------------
export const toUnit = (c: number, unit: TempUnit) =>
  unit === "f" ? (c * 9) / 5 + 32 : c
export const fmtTemp = (c: number, unit: TempUnit) =>
  `${Math.round(toUnit(c, unit))}°`
export function fmtHour(hour: number) {
  const h = ((hour % 24) + 24) % 24
  return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`
}
export function fmtRange(start: number, end: number) {
  const a = fmtHour(start).split(" "),
    b = fmtHour(end).split(" ")
  return a[1] === b[1]
    ? `${a[0]}–${b[0]} ${b[1]}`
    : `${a.join(" ")}–${b.join(" ")}`
}
export const hourOf = (time: string) => Number(time.slice(11, 13))
export function fmtClock(time: string) {
  const h = hourOf(time),
    m = time.slice(14, 16)
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? "AM" : "PM"}`
}
export function uvLevel(uv: number) {
  return uv < 3
    ? "Low"
    : uv < 6
      ? "Moderate"
      : uv < 8
        ? "High"
        : uv < 11
          ? "Very high"
          : "Extreme"
}
export function ago(ts: number, now = Date.now()) {
  const m = Math.max(0, Math.round((now - ts) / 60_000))
  if (m < 1) return "just now"
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`
}
export const coordLabel = (lat: number, lon: number) =>
  `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}`

// ---- Location-local time -----------------------------------------------------
export const localStamp = (offset: number, now = Date.now()) =>
  new Date(now + offset * 1000).toISOString().slice(0, 16)
export function currentConditions(f: Forecast, now = Date.now()): Hour {
  if (now - f.fetchedAt < 45 * 60_000) return f.current
  const key = localStamp(f.offset, now).slice(0, 13)
  return f.hourly.find((h) => h.time.slice(0, 13) === key) ?? f.current
}
export function upcoming(f: Forecast, now = Date.now(), count = 24) {
  const key = localStamp(f.offset, now).slice(0, 13)
  const i = f.hourly.findIndex((h) => h.time.slice(0, 13) === key)
  return i < 0 ? [] : f.hourly.slice(i, i + count)
}
// Highest rain chance over the next 12 hours (what matters when heading out).
export function rainSoon(f: Forecast, now = Date.now()) {
  const next = upcoming(f, now, 12)
  return next.length
    ? Math.max(...next.map((h) => h.pop))
    : (todayOf(f, now)?.pop ?? 0)
}
export function todayOf(f: Forecast, now = Date.now()) {
  const date = localStamp(f.offset, now).slice(0, 10)
  return f.daily.find((d) => d.date === date) ?? null
}

// ---- Outdoor scoring -------------------------------------------------------
export type IssueKind = "rain" | "storm" | "heat" | "cold" | "uv" | "wind"
export interface Issue {
  kind: IssueKind
  penalty: number
  value: number
}
export interface Scored {
  hour: Hour
  score: number
  issues: Issue[]
}
const isStorm = (code: number) => code >= 95
const isWet = (code: number) =>
  (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95
export function scoreHour(h: Hour): Scored {
  const issues: Issue[] = []
  if (h.pop >= 30 || h.precip >= 0.3)
    issues.push({
      kind: "rain",
      penalty: h.pop * 0.7 + Math.min(h.precip, 5) * 8,
      value: h.pop,
    })
  if (isStorm(h.code)) issues.push({ kind: "storm", penalty: 60, value: 0 })
  if (h.feels >= 31)
    issues.push({ kind: "heat", penalty: (h.feels - 30) * 6, value: h.feels })
  if (h.feels <= 8)
    issues.push({ kind: "cold", penalty: (9 - h.feels) * 4, value: h.feels })
  if (h.uv >= 6)
    issues.push({ kind: "uv", penalty: (h.uv - 5) * 7, value: h.uv })
  if (h.wind >= 30)
    issues.push({ kind: "wind", penalty: (h.wind - 29) * 1.5, value: h.wind })
  issues.sort((a, b) => b.penalty - a.penalty)
  const total = issues.reduce((sum, i) => sum + i.penalty, 0)
  return {
    hour: h,
    score: Math.round(Math.max(0, Math.min(100, 100 - total))),
    issues,
  }
}
export function describeIssue(issue: Issue, unit: TempUnit) {
  switch (issue.kind) {
    case "rain":
      return `rain ${Math.round(issue.value)}%`
    case "storm":
      return "storms"
    case "heat":
      return `feels ${fmtTemp(issue.value, unit)}`
    case "cold":
      return `feels ${fmtTemp(issue.value, unit)}`
    case "uv":
      return `UV ${Math.round(issue.value)}`
    case "wind":
      return `wind ${Math.round(issue.value)} km/h`
  }
}
export interface HourWindow {
  start: number
  end: number // exclusive hour
  hours: Scored[]
  avg: number
}
function pick(
  hours: Scored[],
  lengths: number[],
  ok: (s: Scored) => boolean,
  better: (a: number, b: number) => boolean,
): HourWindow | null {
  for (const len of lengths) {
    let found: HourWindow | null = null
    for (let i = 0; i + len <= hours.length; i++) {
      const run = hours.slice(i, i + len)
      // Contiguous clock hours only.
      if (hourOf(run[len - 1].hour.time) - hourOf(run[0].hour.time) !== len - 1)
        continue
      if (!run.every(ok)) continue
      const avg = run.reduce((s, h) => s + h.score, 0) / len
      if (!found || better(avg, found.avg))
        found = {
          start: hourOf(run[0].hour.time),
          end: hourOf(run[len - 1].hour.time) + 1,
          hours: run,
          avg,
        }
    }
    if (found) return found
  }
  return null
}
export interface Plan {
  label: "Today" | "Tomorrow"
  hours: Scored[]
  best: HourWindow | null
  worst: HourWindow | null
}
// Daylight hours left today (or tomorrow's, once today's daylight is over).
export function outdoorPlan(f: Forecast, now = Date.now()): Plan {
  const stamp = localStamp(f.offset, now),
    date = stamp.slice(0, 10),
    hourKey = stamp.slice(0, 13)
  let label: Plan["label"] = "Today"
  let hours = f.hourly.filter(
    (h) =>
      h.time.slice(0, 10) === date && h.time.slice(0, 13) >= hourKey && h.day,
  )
  if (hours.length === 0) {
    label = "Tomorrow"
    const next = f.hourly
      .find((h) => h.time.slice(0, 10) > date)
      ?.time.slice(0, 10)
    hours = f.hourly.filter((h) => h.time.slice(0, 10) === next && h.day)
  }
  const scored = hours.map(scoreHour)
  return {
    label,
    hours: scored,
    best: pick(
      scored,
      [4, 3, 2, 1],
      (s) => s.score >= 70,
      (a, b) => a > b,
    ),
    worst: pick(
      scored,
      [3, 2, 1],
      (s) => s.score < 50,
      (a, b) => a < b,
    ),
  }
}
export interface Advice {
  kind: "storm" | "rain" | "heat" | "uv" | "wind" | "window" | "fair" | "none"
  tone: "good" | "warn" | "bad"
  text: string
}
export function outdoorAdvice(
  f: Forecast,
  unit: TempUnit,
  now = Date.now(),
): Advice {
  const plan = outdoorPlan(f, now)
  const hours = plan.hours.map((s) => s.hour)
  if (hours.length === 0)
    return {
      kind: "none",
      tone: "warn",
      text: "Forecast is out of date — pull to refresh",
    }
  const pre = plan.label === "Tomorrow" ? "Tomorrow: " : ""
  const first = hourOf(hours[0].time)
  const when = (h: Hour) =>
    plan.label === "Today" &&
    hourOf(h.time) === first &&
    first === hourOf(localStamp(f.offset, now))
      ? "now"
      : `after ${fmtHour(hourOf(h.time))}`
  const bestText = plan.best ? fmtRange(plan.best.start, plan.best.end) : null
  const storm = hours.find((h) => isStorm(h.code) && h.pop >= 40)
  if (storm)
    return {
      kind: "storm",
      tone: "bad",
      text: `${pre}Thunderstorms likely ${when(storm)} — avoid open ground`,
    }
  const rain = hours.find(
    (h) => h.pop >= 50 || (isWet(h.code) && h.precip >= 0.5),
  )
  if (rain) {
    const w = when(rain)
    return {
      kind: "rain",
      tone: "warn",
      text:
        w === "now"
          ? `${pre}Raining now — bring a jacket`
          : `${pre}Rain likely ${w} — bring a jacket`,
    }
  }
  const hottest = hours.reduce((a, b) => (b.feels > a.feels ? b : a))
  if (hottest.feels >= 35)
    return {
      kind: "heat",
      tone: hottest.feels >= 41 ? "bad" : "warn",
      text: `${pre}Heat index ${fmtTemp(hottest.feels, unit)} — hydrate${bestText ? `, best outside ${bestText}` : " and take shade breaks"}`,
    }
  const uv = hours.filter((h) => h.uv >= 8)
  if (uv.length) {
    const peak = Math.max(...uv.map((h) => h.uv))
    return {
      kind: "uv",
      tone: "warn",
      text: `${pre}UV ${peak >= 11 ? "extreme" : "very high"} ${fmtRange(hourOf(uv[0].time), hourOf(uv[uv.length - 1].time) + 1)}, seek shade`,
    }
  }
  const windy = hours.find((h) => h.wind >= 40)
  if (windy)
    return {
      kind: "wind",
      tone: "warn",
      text: `${pre}Strong wind near ${Math.round(windy.wind)} km/h — secure loose items`,
    }
  if (bestText)
    return {
      kind: "window",
      tone: "good",
      text: `${pre}Good window for outdoor work ${bestText}`,
    }
  return {
    kind: "fair",
    tone: "warn",
    text: `${pre}Fair conditions — pace yourself outdoors`,
  }
}

// ---- Open-Meteo ------------------------------------------------------------
const VARS =
  "temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m,uv_index,relative_humidity_2m,is_day"
export function forecastUrl(p: Pick<Place, "lat" | "lon">) {
  return `https://api.open-meteo.com/v1/forecast?latitude=${p.lat.toFixed(4)}&longitude=${p.lon.toFixed(4)}&current=${VARS.replace("precipitation_probability,", "")}&hourly=${VARS}&daily=weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,precipitation_probability_max,precipitation_sum,uv_index_max,wind_speed_10m_max,sunrise,sunset&timezone=auto&forecast_days=7&wind_speed_unit=kmh`
}
type Columns = Record<string, Array<number | string | null>>
interface ForecastJson {
  utc_offset_seconds: number
  current: Record<string, number | string>
  hourly: Columns
  daily: Columns
}
const num = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? v : 0
export function parseForecast(
  json: ForecastJson,
  place: Place,
  now = Date.now(),
): Forecast {
  const h = json.hourly,
    d = json.daily
  const hourly: Hour[] = (h.time as string[]).slice(0, 72).map((time, i) => ({
    time,
    temp: num(h.temperature_2m[i]),
    feels: num(h.apparent_temperature[i]),
    code: num(h.weather_code[i]),
    pop: num(h.precipitation_probability[i]),
    precip: num(h.precipitation[i]),
    wind: num(h.wind_speed_10m[i]),
    uv: num(h.uv_index[i]),
    humidity: num(h.relative_humidity_2m[i]),
    day: num(h.is_day[i]) === 1,
  }))
  const c = json.current,
    time = String(c.time)
  const match = hourly.find((x) => x.time.slice(0, 13) === time.slice(0, 13))
  return {
    fetchedAt: now,
    place,
    offset: num(json.utc_offset_seconds),
    current: {
      time,
      temp: num(c.temperature_2m),
      feels: num(c.apparent_temperature),
      code: num(c.weather_code),
      pop: match?.pop ?? 0,
      precip: num(c.precipitation),
      wind: num(c.wind_speed_10m),
      uv: num(c.uv_index ?? match?.uv),
      humidity: num(c.relative_humidity_2m),
      day: num(c.is_day) === 1,
    },
    hourly,
    daily: (d.time as string[]).map((date, i) => ({
      date,
      code: num(d.weather_code[i]),
      max: num(d.temperature_2m_max[i]),
      min: num(d.temperature_2m_min[i]),
      feelsMax: num(d.apparent_temperature_max[i]),
      pop: num(d.precipitation_probability_max[i]),
      precip: num(d.precipitation_sum[i]),
      uv: num(d.uv_index_max[i]),
      wind: num(d.wind_speed_10m_max[i]),
      sunrise: String(d.sunrise[i] ?? ""),
      sunset: String(d.sunset[i] ?? ""),
    })),
  }
}
async function getJson<T>(url: string, ms = 12_000): Promise<T> {
  const ctl = new AbortController()
  const id = setTimeout(() => ctl.abort(), ms)
  try {
    const res = await fetch(url, { signal: ctl.signal })
    if (!res.ok) throw new Error(`Weather service returned ${res.status}`)
    return (await res.json()) as T
  } finally {
    clearTimeout(id)
  }
}
export async function searchCities(query: string): Promise<Place[]> {
  const q = query.trim()
  if (q.length < 2) return []
  const json = await getJson<{
    results?: Array<{
      name: string
      latitude: number
      longitude: number
      admin1?: string
      country?: string
    }>
  }>(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&language=en&format=json`,
  )
  return (json.results ?? []).map((r) => ({
    name: r.name,
    detail: [r.admin1, r.country].filter(Boolean).join(", "),
    lat: r.latitude,
    lon: r.longitude,
  }))
}

// ---- Device location -------------------------------------------------------
export type Located =
  | { ok: true; place: Place }
  | { ok: false; reason: "denied" | "unavailable" }
function within<T>(promise: Promise<T>, ms: number) {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), ms),
    ),
  ])
}
export async function locateDevice(prompt: boolean): Promise<Located> {
  try {
    const perm = prompt
      ? await within(Location.requestForegroundPermissionsAsync(), 20_000)
      : await Location.getForegroundPermissionsAsync()
    if (!perm.granted) return { ok: false, reason: "denied" }
    const last = await Location.getLastKnownPositionAsync({
      maxAge: STALE_MS,
    }).catch(() => null)
    const pos =
      last ??
      (await within(
        Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        }),
        15_000,
      ))
    const { latitude: lat, longitude: lon } = pos.coords
    let place: Place = {
      name: coordLabel(lat, lon),
      detail: "Your location",
      lat,
      lon,
    }
    if (Platform.OS !== "web") {
      try {
        const [a] = await within(
          Location.reverseGeocodeAsync({ latitude: lat, longitude: lon }),
          8_000,
        )
        const name = a?.city ?? a?.subregion ?? a?.district ?? a?.region
        if (name)
          place = {
            ...place,
            name,
            detail: [a?.region, a?.country].filter(Boolean).join(", "),
          }
      } catch {
        // Keep the coordinates label.
      }
    }
    return { ok: true, place }
  } catch {
    return { ok: false, reason: "unavailable" }
  }
}

// ---- Refresh orchestration -------------------------------------------------
export const weatherStatus = create<{
  loading: boolean
  locating: boolean
  error: string | null
}>(() => ({ loading: false, locating: false, error: null }))
export const activePlace = (s: ReturnType<typeof weatherStore.get>) =>
  s.source === "device" && s.device ? s.device : s.city
const samePlace = (a: Place, b: Place) =>
  Math.abs(a.lat - b.lat) < 0.05 && Math.abs(a.lon - b.lon) < 0.05
let inflight: Promise<void> | null = null
export function refreshWeather(force = false): Promise<void> {
  const s = weatherStore.get(),
    f = s.forecast
  if (
    !force &&
    f &&
    samePlace(f.place, activePlace(s)) &&
    Date.now() - f.fetchedAt < STALE_MS
  )
    return Promise.resolve()
  // A forced refresh (new place, pull-to-refresh) runs after any in-flight one.
  if (inflight)
    return force ? inflight.then(() => refreshWeather(true)) : inflight
  weatherStatus.setState({ loading: true, error: null })
  inflight = (async () => {
    try {
      if (weatherStore.get().source === "device") {
        const r = await locateDevice(false)
        if (r.ok) weatherStore.set((x) => ({ ...x, device: r.place }))
        else if (r.reason === "denied")
          weatherStore.set((x) => ({ ...x, source: "city" }))
      }
      const place = activePlace(weatherStore.get())
      const json = await getJson<ForecastJson>(forecastUrl(place))
      const forecast = parseForecast(json, place)
      weatherStore.set((x) => ({ ...x, forecast }))
      weatherStatus.setState({ error: null })
    } catch {
      weatherStatus.setState({
        error: "Couldn't reach the weather service. Check your connection.",
      })
    } finally {
      weatherStatus.setState({ loading: false })
      inflight = null
    }
  })()
  return inflight
}
export async function locateAndRefresh(): Promise<Located> {
  weatherStatus.setState({ locating: true })
  const r = await locateDevice(true)
  weatherStore.set((x) =>
    r.ok
      ? { ...x, asked: true, source: "device", device: r.place }
      : { ...x, asked: true, source: "city" },
  )
  weatherStatus.setState({ locating: false })
  await refreshWeather(true)
  return r
}
export function chooseCity(place: Place) {
  weatherStore.set((x) => ({ ...x, source: "city", city: place }))
  return refreshWeather(true)
}
// Refresh when stale on mount and whenever the app returns to the foreground.
export function useWeatherRefresh() {
  useEffect(() => {
    refreshWeather()
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") refreshWeather()
    })
    return () => sub.remove()
  }, [])
}
export function useMinuteTick() {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])
  return now
}
