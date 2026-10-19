// Weather: the Today card, the forecast screen with its hour plan and
// advice, city search, the location choice and the unit preference.
//
// How the app gets weather: the device fetches the forecast and the city
// search straight from Open-Meteo (mobile/src/prototype/weather.ts); only
// the preferences (source, saved city, unit, asked) sync to the server as
// the ``weather_pref`` row. The server's own forecast proxy and city search
// (/weather/forecast, /weather/cities) are not called by the app; the last
// test exercises them through the API so their reachability is on record.
//
// | Screen            | Action                                         | Test |
// |-------------------|------------------------------------------------|------|
// | Today             | weather card renders, opens the forecast       | weather · Today card and forecast screen |
// | Weather           | first visit asks for location once (denied)    | weather · Today card and forecast screen |
// | Weather           | hour plan (Outdoor work planner) and advice    | weather · Today card and forecast screen |
// | Weather           | Refresh weather                                | weather · Today card and forecast screen |
// | Weather sheet     | city search, choose a city                     | weather · city search and choose a city |
// | Weather sheet     | pick the saved city again                      | weather · city search and choose a city |
// | Weather           | temperature unit °C ↔ °F (Today card follows)  | weather · unit preference |
// | Weather sheet     | Use current location (browser geolocation stub) | weather · use current location |
// | (server)          | forecast proxy and city search via the API     | weather · server forecast proxy and city search |
import { rows, settled, signIn, trackSync } from "./tasks-helpers"

Cypress.config("responseTimeout", 90000)

const CEBU = { latitude: 10.3157, longitude: 123.8854 }

/**
 * Browser geolocation, as expo-location reads it on web: a permission state
 * and a position. Stubbed because a headless browser has neither.
 */
function stubGeolocation(state: "granted" | "denied") {
  cy.on("window:before:load", (win) => {
    Object.defineProperty(win.navigator, "permissions", {
      configurable: true,
      value: { query: () => Promise.resolve({ state }) },
    })
    Object.defineProperty(win.navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (
          ok: (p: unknown) => void,
          err?: (e: unknown) => void,
        ) =>
          state === "denied"
            ? err?.({ code: 1, PERMISSION_DENIED: 1 })
            : ok({
                coords: {
                  ...CEBU,
                  accuracy: 20,
                  altitude: null,
                  altitudeAccuracy: null,
                  heading: null,
                  speed: null,
                },
                timestamp: Date.now(),
              }),
        watchPosition: () => 0,
        clearWatch: () => undefined,
      },
    })
  })
}

const pref = (owner: string, where = "true", values: unknown[] = []) =>
  rows(`select * from weather_pref where owner_id = $1 and ${where}`, [
    owner,
    ...values,
  ])

// The forecast comes from Open-Meteo over the internet; allow for it.
const FORECAST = { timeout: 45000 }

describe("weather (live)", () => {
  beforeEach(trackSync)

  it("Today card and forecast screen: location asked once, hour plan and advice", () => {
    stubGeolocation("denied")
    cy.newLiveUser("weather").then((user) => {
      signIn(user)
      pref(user.id, "not asked and source = 'city' and city_name = 'Manila'")
      cy.findByRole("button", {
        name: /^Weather in Manila: /,
        ...FORECAST,
      }).click()
      cy.location("pathname").should("eq", "/weather")

      // First visit asks for location; denied keeps the saved city.
      pref(user.id, "asked and source = 'city'")
      cy.findByRole("button", {
        name: /^Location Manila\. Change location/,
        ...FORECAST,
      }).should("exist")
      cy.findByText("Outdoor work planner").should("exist")
      cy.findByLabelText(/^Hourly outdoor conditions for /).should("exist")
      cy.findByRole("button", { name: "Refresh weather" }).click()
      cy.findByText(
        "Couldn't reach the weather service. Check your connection.",
      ).should("not.exist")
    })
  })

  it("city search and choose a city: the saved city syncs", () => {
    stubGeolocation("denied")
    cy.newLiveUser("weather").then((user) => {
      signIn(user)
      cy.visit("/weather")
      pref(user.id, "asked")
      settled()
      cy.findByRole("button", { name: "Search for a city" }).click()
      cy.findByText("Weather location").should("exist")
      cy.findByRole("textbox", { name: "Search for a city" }).type("Cebu")
      cy.findAllByRole("button", { name: /^Cebu City, /, ...FORECAST })
        .first()
        .click()
      pref(user.id, "source = 'city' and city_name = 'Cebu City'").then(
        ([p]) => {
          expect(Number(p.city_lat)).to.be.closeTo(10.3, 0.1)
          expect(Number(p.city_lon)).to.be.closeTo(123.9, 0.1)
          expect(String(p.city_detail)).to.match(/Philippines/)
        },
      )
      cy.liveApi<{ city_name: string }>(user, "GET", "/weather/prefs")
        .its("city_name")
        .should("eq", "Cebu City")
      cy.findByRole("button", {
        name: /^Location Cebu City\. Change location/,
        ...FORECAST,
      }).should("exist")

      // The sheet lists the saved city; picking it keeps the choice.
      settled()
      cy.findByRole("button", { name: "Search for a city" }).click()
      cy.findByRole("button", {
        name: /^Cebu City, Saved city.*selected$/,
      }).click()
      pref(user.id, "source = 'city' and city_name = 'Cebu City'")
    })
  })

  it("unit preference: °C ↔ °F syncs and the Today card follows", () => {
    stubGeolocation("denied")
    cy.newLiveUser("weather").then((user) => {
      signIn(user)
      cy.visit("/weather")
      settled()
      cy.findByRole("button", { name: /^Temperature unit Celsius/ }).click()
      pref(user.id, "unit = 'f'")
      settled()
      cy.findByRole("button", { name: /^Temperature unit Fahrenheit/ }).should(
        "exist",
      )
      cy.visit("/today")
      cy.findByRole("button", { name: /^Weather in .*°F/, ...FORECAST }).should(
        "exist",
      )
      cy.visit("/weather")
      settled()
      cy.findByRole("button", { name: /^Temperature unit Fahrenheit/ }).click()
      pref(user.id, "unit = 'c'")
    })
  })

  it("use current location: the device source syncs", () => {
    stubGeolocation("granted")
    cy.newLiveUser("weather").then((user) => {
      signIn(user)
      cy.visit("/weather")
      // Granted on the first-visit ask: the device location is used.
      pref(user.id, "asked and source = 'device'")
      cy.findByRole("button", {
        name: /^Location 10\.3\d°N, 123\.8\d°E\. Change location/,
        ...FORECAST,
      }).should("exist")

      // Switch to a city, then back to the device from the sheet.
      settled()
      cy.findByRole("button", { name: "Search for a city" }).click()
      settled()
      cy.findByRole("button", { name: /^Manila, Saved city/ }).click()
      pref(user.id, "source = 'city'")
      settled()
      cy.findByRole("button", { name: "Search for a city" }).click()
      settled()
      cy.findByRole("button", { name: /^Use current location/ }).click()
      pref(user.id, "source = 'device'")
      cy.liveApi<{ source: string }>(user, "GET", "/weather/prefs")
        .its("source")
        .should("eq", "device")
    })
  })

  it("server forecast proxy and city search answer through the API", () => {
    cy.newLiveUser("weather").then((user) => {
      cy.liveApi<{ name: string; lat: number }[]>(
        user,
        "GET",
        "/weather/cities?q=Cebu",
      ).then((places) => {
        expect(places.length).to.be.greaterThan(0)
        expect(places[0].name).to.match(/Cebu/)
      })
      cy.liveApi<{
        place: { name: string }
        current: Record<string, unknown>
        plan: Record<string, unknown>
        advice: { text: string }
      }>(user, "GET", "/weather/forecast").then((v) => {
        expect(v.place.name).to.eq("Manila")
        expect(v.current).to.have.property("temp")
        expect(v.advice.text).to.be.a("string").and.not.be.empty
      })
      rows("select cell, fetched_at from weather_cache where cell = $1", [
        "14.60,120.98",
      ])
    })
  })
})
