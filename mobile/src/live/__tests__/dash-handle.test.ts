// A handle the server refused comes back as the server's own: the device
// takes it, says so once, and stops sending the refused one.

import { dashStore } from "@domain/dash/store"
import {
  profileFromServer,
  profileToServer,
  resetHandleRefusals,
} from "../mappers/dash"

const mockToasts: string[] = []
jest.mock("@domain/lib/platform", () => ({
  ...jest.requireActual("@domain/lib/platform"),
  toast: (m: string) => void mockToasts.push(m),
}))
jest.mock("../auth", () => ({ http: {} }))

type State = Parameters<typeof profileToServer>[0]
const state = (handle: string): State =>
  ({
    dash: {
      ...dashStore.get(),
      profile: { ...dashStore.get().profile, name: "Kai Noah", handle },
    },
    appearance: { mode: "system" },
    privacy: { hidden: false },
    currency: { code: "PHP" },
  }) as unknown as State

beforeEach(() => {
  mockToasts.length = 0
  resetHandleRefusals()
})

test("an applied row with another handle reverts mine and tells me once", () => {
  const mine = state("@taken.one")
  const sent = profileToServer(mine)
  expect(sent.handle).toBe("taken.one")
  const row = { ...sent, handle: "kai", name: "Kai Noah" }
  const merged = profileFromServer(row, mine)
  expect(merged.dash.profile.handle).toBe("@kai")
  expect(merged.dash.profile.name).toBe("Kai Noah")
  expect(mockToasts).toEqual([
    "@taken.one is taken, so your username was kept as @kai",
  ])
  // After the revert the refused handle is not sent again.
  expect(profileToServer(merged).handle).toBe("kai")
  // The same refusal is not reported twice.
  profileToServer(mine)
  profileFromServer(row, mine)
  expect(mockToasts).toHaveLength(1)
})

test("an accepted handle says nothing", () => {
  const mine = state("@kai.new")
  const row = { ...profileToServer(mine), handle: "kai.new" }
  profileFromServer(row, mine)
  expect(mockToasts).toEqual([])
})

test("a pull with nothing of mine in flight says nothing", () => {
  const mine = state("@kai")
  profileFromServer({ ...profileToServer(mine), handle: "kai" }, mine)
  // Another device changed it later.
  profileFromServer({ handle: "kai.other" }, mine)
  expect(mockToasts).toEqual([])
})
