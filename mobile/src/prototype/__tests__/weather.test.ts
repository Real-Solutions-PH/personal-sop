import {
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSun,
  Moon,
  Sun,
} from "lucide-react-native"
import {
  describeCode,
  type Forecast,
  fmtRange,
  type Hour,
  MANILA,
  outdoorAdvice,
  outdoorPlan,
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
    "Rain likely after 2 PM — bring a jacket",
  )
  const hot = forecast((h) => (h >= 11 && h <= 15 ? { feels: 39, uv: 4 } : {}))
  expect(outdoorAdvice(hot, "c", morning).text).toBe(
    "Heat index 39° — hydrate, best outside 6–10 AM",
  )
  expect(outdoorAdvice(hot, "f", morning).text).toContain("Heat index 102°")
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
  const f = forecast((h, day) => (day === 1 && h < 9 ? { pop: 80 } : {}))
  const plan = outdoorPlan(f, night)
  expect(plan.label).toBe("Tomorrow")
  expect(plan.hours[0].hour.time).toBe("2026-10-05T06:00")
  expect(outdoorAdvice(f, "c", night).text).toBe(
    "Tomorrow: Rain likely after 6 AM — bring a jacket",
  )
})
