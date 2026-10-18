import { fmtClock, parseClock } from "../time-input"
import { fmtSpan } from "../units"

describe("fmtClock", () => {
  it("shows 24h values in the app's 12h format", () => {
    expect(fmtClock("17:46")).toBe("5:46 PM")
    expect(fmtClock("00:05")).toBe("12:05 AM")
    expect(fmtClock("12:00")).toBe("12:00 PM")
    expect(fmtClock("07:10")).toBe("7:10 AM")
  })
})

describe("parseClock", () => {
  it("accepts 12h and 24h input", () => {
    expect(parseClock("5:46 PM")).toBe("17:46")
    expect(parseClock("5:46pm")).toBe("17:46")
    expect(parseClock("12:15 am")).toBe("00:15")
    expect(parseClock("17:46")).toBe("17:46")
    expect(parseClock("7:05")).toBe("07:05")
  })
  it("rejects partial or out-of-range input", () => {
    expect(parseClock("5:4")).toBeNull()
    expect(parseClock("24:00")).toBeNull()
    expect(parseClock("13:00 pm")).toBeNull()
    expect(parseClock("")).toBeNull()
  })
})

describe("fmtSpan", () => {
  it("uses the same units for actual and planned", () => {
    expect(fmtSpan(354)).toBe("5m 54s")
    expect(fmtSpan(300)).toBe("5m")
    expect(fmtSpan(4236)).toBe("1h 10m")
    expect(fmtSpan(3600)).toBe("1h")
    expect(fmtSpan(40)).toBe("40s")
    expect(fmtSpan(-3)).toBe("0s")
  })
})
