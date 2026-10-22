import {
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSun,
  Moon,
  Sun,
} from "lucide-react-native"
import {
  currentConditions,
  describeCode,
  type Forecast,
  fmtRange,
  type Hour,
  MANILA,
  outdoorAdvice,
  outdoorPlan,
  parseForecast,
  rainSoon,
  staleLocation,
  weatherStore,
} from "../weather"

// Two days of hourly data at UTC+0; daylight 6 AM–6 PM.
function forecast(at: (hour: number, day: number) => Partial<Hour>): Forecast {
  const hourly: Hour[] = []
  for (const [day, date] of ["2026-10-04", "2026-10-05"].entries())
    for (let h = 0; h < 24; h++)
      hourly.push({
        time: `${date}T${String(h).padStart(2, "0")}:00`,
        temp: 26,
        feels: 27,
        code: 1,
        pop: 0,
        precip: 0,
        wind: 8,
        uv: 2,
        humidity: 60,
        day: h >= 6 && h < 18,
        ...at(h, day),
      })
  return {
    fetchedAt: Date.UTC(2026, 9, 4, 6),
    place: MANILA,
    offset: 0,
    current: hourly[6],
    hourly,
    daily: [],
  }
}
const morning = Date.UTC(2026, 9, 4, 6),
  night = Date.UTC(2026, 9, 4, 21)

test("maps WMO codes to labels and day/night icons", () => {
  expect(describeCode(0)).toMatchObject({ label: "Clear", icon: Sun })
  expect(describeCode(0, false).icon).toBe(Moon)
  expect(describeCode(2)).toMatchObject({
    label: "Partly cloudy",
    icon: CloudSun,
  })
  expect(describeCode(45)).toMatchObject({ label: "Fog", icon: CloudFog })
  expect(describeCode(63)).toMatchObject({
    label: "Rain",
    icon: CloudRain,
    sky: "rain",
  })
  expect(describeCode(95)).toMatchObject({
    label: "Thunderstorm",
    icon: CloudLightning,
  })
  expect(fmtRange(6, 10)).toBe("6–10 AM")
  expect(fmtRange(11, 15)).toBe("11 AM–3 PM")
})

test("outdoor advice picks the most important warning, else the best window", () => {
  const calm = forecast(() => ({}))
  expect(outdoorAdvice(calm, "c", morning)).toMatchObject({
    kind: "window",
    tone: "good",
    text: "Good window for outdoor work 6–10 AM",
  })
  const rain = forecast((h) =>
    h >= 14 ? { pop: 70, code: 61, precip: 1 } : {},
  )
  expect(outdoorAdvice(rain, "c", morning).text).toBe(
    "Rain likely after 2 PM — bring an umbrella",
  )
  const hot = forecast((h) => (h >= 11 && h <= 15 ? { feels: 39, uv: 4 } : {}))
  expect(outdoorAdvice(hot, "c", morning).text).toBe(
    "Feels like 39° — hydrate, best outside 6–10 AM",
  )
  expect(outdoorAdvice(hot, "f", morning).text).toContain("Feels like 102°")
  const plan = outdoorPlan(hot, morning)
  expect(plan.worst).toMatchObject({ start: 11, end: 14 })
  const uv = forecast((h) => (h >= 11 && h <= 14 ? { uv: 9 } : {}))
  expect(outdoorAdvice(uv, "c", morning).text).toBe(
    "UV very high 11 AM–3 PM, seek shade",
  )
  const storm = forecast((h) => (h === 16 ? { code: 95, pop: 80 } : {}))
  expect(outdoorAdvice(storm, "c", morning)).toMatchObject({
    kind: "storm",
    tone: "bad",
  })
})

test("after dark the planner looks at tomorrow's daylight", () => {
  const f = forecast((h, day) =>
    day === 1 && h >= 6 && h < 9 ? { pop: 80 } : {},
  )
  const plan = outdoorPlan(f, night)
  expect(plan.label).toBe("Tomorrow")
  expect(plan.hours[0].hour.time).toBe("2026-10-05T06:00")
  expect(outdoorAdvice(f, "c", night).text).toBe(
    "Tomorrow: Rain likely after 6 AM — bring an umbrella",
  )
})

// 20:06 local, the audit's case: heavy rain until 11 PM, a hot day tomorrow.
const evening = Date.UTC(2026, 9, 4, 20, 6)
const hotTomorrow = (h: number, day: number): Partial<Hour> =>
  day === 1 && h >= 11 && h <= 15 ? { feels: 39, uv: 4 } : {}

test("in the evening, rain happening now leads before tomorrow's advice", () => {
  const f = forecast((h, day) =>
    day === 0 && h >= 20 && h <= 22
      ? { code: 65, pop: 90, precip: 6 }
      : hotTomorrow(h, day),
  )
  expect(outdoorPlan(f, evening).label).toBe("Tomorrow")
  expect(outdoorAdvice(f, "c", evening)).toEqual({
    kind: "rain",
    tone: "warn",
    text: "Raining now until about 11 PM. Tomorrow: Feels like 39° — hydrate, best outside 6–10 AM",
  })
  // Rain that never lets up inside the look-ahead says so.
  const allNight = forecast((h, day) =>
    day === 0 && h >= 20
      ? { code: 63, pop: 80, precip: 2 }
      : day === 1 && h < 6
        ? { code: 63, pop: 80, precip: 2 }
        : {},
  )
  expect(outdoorAdvice(allNight, "c", evening).text).toMatch(
    /^Raining now — no break before 3 AM\. Tomorrow: /,
  )
})

test("current precipitation counts as raining now even when the hour looks dry", () => {
  const f = forecast(hotTomorrow)
  const fresh: Forecast = {
    ...f,
    fetchedAt: evening - 5 * 60_000,
    current: { ...f.hourly[20], code: 61, precip: 0.4 },
  }
  expect(outdoorAdvice(fresh, "c", evening).text).toBe(
    "Raining now until about 9 PM. Tomorrow: Feels like 39° — hydrate, best outside 6–10 AM",
  )
  // Same forecast with nothing falling now: tomorrow's advice alone.
  expect(outdoorAdvice(f, "c", evening).text).toBe(
    "Tomorrow: Feels like 39° — hydrate, best outside 6–10 AM",
  )
})

test("at night, rain or storms starting within 3 hours lead too", () => {
  const rain = forecast((h, day) =>
    day === 0 && h === 22 ? { code: 61, pop: 70, precip: 1 } : {},
  )
  expect(outdoorAdvice(rain, "c", evening)).toMatchObject({
    kind: "rain",
    text: "Rain likely after 10 PM. Tomorrow: Good window for outdoor work 6–10 AM",
  })
  const storm = forecast((h, day) =>
    day === 0 && h === 21 ? { code: 95, pop: 60 } : {},
  )
  expect(outdoorAdvice(storm, "c", evening)).toMatchObject({
    kind: "storm",
    tone: "bad",
    text: "Thunderstorms likely after 9 PM. Tomorrow: Good window for outdoor work 6–10 AM",
  })
  // Four hours out is beyond the lead's look-ahead.
  const later = forecast((h, day) =>
    day === 1 && h === 0 ? { code: 61, pop: 70, precip: 1 } : {},
  )
  expect(outdoorAdvice(later, "c", evening).text).toBe(
    "Tomorrow: Good window for outdoor work 6–10 AM",
  )
})

test("in daylight, rain now says when it eases", () => {
  const f = forecast((h) =>
    h >= 6 && h <= 7 ? { code: 95, pop: 80, precip: 3 } : {},
  )
  expect(outdoorAdvice(f, "c", morning)).toEqual({
    kind: "storm",
    tone: "bad",
    text: "Thunderstorms now until about 8 AM — avoid open ground",
  })
})

test("WMO 51–55 read as light rain and showers, not drizzle", () => {
  expect(describeCode(51).label).toBe("Light rain")
  expect(describeCode(53).label).toBe("Light rain")
  expect(describeCode(55).label).toBe("Showers")
  expect(describeCode(56).label).toBe("Freezing drizzle")
})

test("current conditions disappear once the saved hours no longer cover now", () => {
  const f = forecast(() => ({}))
  expect(currentConditions(f, f.fetchedAt + 10 * 60_000)).toBe(f.current)
  expect(currentConditions(f, Date.UTC(2026, 9, 5, 9, 30))?.time).toBe(
    "2026-10-05T09:00",
  )
  // 72h+ offline: the last saved hour is long gone.
  expect(currentConditions(f, Date.UTC(2026, 9, 8, 12))).toBeNull()
})

test("rain chance is the next 12 hours, not the whole day", () => {
  const f = forecast((h, day) => (day === 0 && h === 17 ? { pop: 59 } : {}))
  expect(rainSoon(f, morning)).toBe(59)
  expect(rainSoon(f, Date.UTC(2026, 9, 4, 18))).toBe(0)
})

test("hourly rain is shifted onto the hour it falls in", () => {
  const time = ["2026-10-04T13:00", "2026-10-04T14:00", "2026-10-04T15:00"]
  const col = (v: number[]) => v
  const f = parseForecast(
    {
      utc_offset_seconds: 28800,
      current: { time: "2026-10-04T13:00", precipitation: 0, is_day: 1 },
      hourly: {
        time,
        temperature_2m: col([30, 30, 30]),
        apparent_temperature: col([34, 34, 34]),
        // Open-Meteo: the 15:00 value is rain between 14:00 and 15:00.
        precipitation_probability: col([0, 10, 80]),
        precipitation: col([0, 0, 4]),
        weather_code: col([3, 3, 63]),
        wind_speed_10m: col([5, 5, 5]),
        uv_index: col([5, 5, 5]),
        relative_humidity_2m: col([70, 70, 70]),
        is_day: col([1, 1, 1]),
      },
      daily: {
        time: [],
        weather_code: [],
        temperature_2m_max: [],
        temperature_2m_min: [],
        apparent_temperature_max: [],
        precipitation_probability_max: [],
        precipitation_sum: [],
        uv_index_max: [],
        wind_speed_10m_max: [],
        sunrise: [],
        sunset: [],
      },
    },
    MANILA,
    0,
  )
  expect(f.hourly.map((h) => [h.time.slice(11), h.pop, h.precip])).toEqual([
    ["13:00", 10, 0],
    ["14:00", 80, 4],
    ["15:00", 80, 4], // nothing after it: keeps its own
  ])
  expect(f.current.pop).toBe(10)
})

test("a failed device fix is labelled as the last known location", () => {
  const s = {
    ...weatherStore.get(),
    source: "device" as const,
    device: { name: "Quezon City", lat: 14.6, lon: 121 },
    deviceAt: morning - 3 * 3600_000,
  }
  expect(staleLocation(s, true, morning)).toBe("Last known location · 3h ago")
  expect(staleLocation(s, false, morning)).toBeNull()
  expect(staleLocation({ ...s, source: "city" }, true, morning)).toBeNull()
})
