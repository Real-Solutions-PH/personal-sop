import { renderHook } from "@testing-library/react-native"
import * as Location from "expo-location"
import { weatherPrefMapper } from "@/live/mappers/reference"
import {
  askLocationOnce,
  MANILA,
  parseForecast,
  REFRESH_CAP_MS,
  refreshWeather,
  STALE_MS,
  useWeatherRefresh,
  weatherStatus,
  weatherStore,
} from "../weather"

jest.mock("expo-location", () => ({
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  reverseGeocodeAsync: jest.fn(),
}))
const loc = jest.mocked(Location)
const never = () => new Promise<never>(() => {})

const QC = { name: "Quezon City", lat: 14.676, lon: 121.0437 }
function payload() {
  const time = ["2026-10-22T20:00", "2026-10-22T21:00"]
  const two = (v: number) => [v, v]
  return {
    utc_offset_seconds: 28800,
    current: { time: time[0], temperature_2m: 27, is_day: 0 },
    hourly: {
      time,
      temperature_2m: two(27),
      apparent_temperature: two(30),
      precipitation_probability: two(0),
      precipitation: two(0),
      weather_code: two(3),
      wind_speed_10m: two(5),
      uv_index: two(0),
      relative_humidity_2m: two(80),
      is_day: two(0),
    },
    daily: { time: [] },
  }
}

beforeEach(() => {
  jest.useFakeTimers()
  jest.resetAllMocks()
  weatherStore.reset()
  weatherStatus.setState({
    loading: false,
    locating: false,
    error: null,
    fixFailed: false,
  })
})
afterEach(() => jest.useRealTimers())

test("a hanging permission check times out and keeps the last known location", async () => {
  weatherStore.set((x) => ({
    ...x,
    source: "device",
    device: QC,
    deviceAt: 1,
  }))
  loc.getForegroundPermissionsAsync.mockImplementation(never)
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => payload(),
  })) as never
  const done = refreshWeather(true)
  expect(weatherStatus.getState().loading).toBe(true)
  await jest.advanceTimersByTimeAsync(5_000)
  await done
  expect(weatherStatus.getState()).toMatchObject({
    loading: false,
    error: null,
    fixFailed: true,
  })
  expect(weatherStore.get().source).toBe("device")
  expect(weatherStore.get().forecast?.place).toEqual(QC)
})

test("the whole refresh is capped, so Updating… cannot hang", async () => {
  loc.getForegroundPermissionsAsync.mockResolvedValue({
    granted: true,
  } as never)
  // A transport that never answers and ignores the abort signal.
  global.fetch = jest.fn(never) as never
  const done = refreshWeather(true)
  await jest.advanceTimersByTimeAsync(REFRESH_CAP_MS)
  await done
  expect(weatherStatus.getState().loading).toBe(false)
  expect(weatherStatus.getState().error).toMatch(/Couldn't reach/)
})

test("the one-time location ask runs once however many surfaces call it", async () => {
  loc.requestForegroundPermissionsAsync.mockResolvedValue({
    granted: false,
  } as never)
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => payload(),
  })) as never
  const a = askLocationOnce(),
    b = askLocationOnce()
  expect(a).toBe(b)
  await a
  expect(loc.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1)
  expect(weatherStore.get()).toMatchObject({ asked: true, source: "city" })
  expect(askLocationOnce()).toBeNull()
})

test("a pull keeps this device's location source and ask; the city syncs", () => {
  const m = weatherPrefMapper("u1")
  weatherStore.set((x) => ({
    ...x,
    source: "device",
    device: QC,
    asked: true,
  }))
  const row = m.fromServer(
    {
      source: "city",
      asked: false,
      city_name: "Cebu City",
      city_detail: null,
      city_lat: 10.3,
      city_lon: 123.9,
      unit: "f",
    },
    weatherStore.get(),
  )
  expect(row?.value).toMatchObject({
    source: "device",
    asked: true,
    device: QC,
    city: { name: "Cebu City", lat: 10.3, lon: 123.9 },
    unit: "f",
  })
  expect(weatherStore.get().city).toEqual(MANILA)
})

test("an open screen refreshes on its own once the forecast goes stale", async () => {
  // Clear of the retry back-off the capped-refresh test leaves behind.
  jest.setSystemTime(Date.now() + 3_600_000)
  weatherStore.set((x) => ({
    ...x,
    forecast: parseForecast(payload() as never, MANILA, Date.now()),
  }))
  const fetch = jest.fn(async () => ({ ok: true, json: async () => payload() }))
  global.fetch = fetch as never
  const view = renderHook(() => useWeatherRefresh())
  await jest.advanceTimersByTimeAsync(STALE_MS - 60_000)
  expect(fetch).not.toHaveBeenCalled()
  await jest.advanceTimersByTimeAsync(2 * 60_000)
  expect(fetch).toHaveBeenCalledTimes(1)
  view.unmount()
})
