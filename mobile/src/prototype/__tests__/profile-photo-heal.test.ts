// iOS moves the app's data folder to a new path on every install of an
// update. The profile photo was saved as an absolute file:// path inside the
// old folder, so after an update it pointed nowhere: the avatar drew an empty
// circle (no photo, no initials) until a new photo was picked.

import type { StorageAdapter } from "@domain/lib/store"

const OLD = "file:///var/mobile/Containers/Data/Application/OLD-1111/Documents/"
const NEW = "file:///var/mobile/Containers/Data/Application/NEW-2222/Documents/"
const PHOTO = "avatar/1730000000000.jpg"

type Heal = typeof import("../profile-photo-heal")
type Dash = typeof import("@domain/dash/store")
type Lib = typeof import("@domain/lib/store")

/** A cold start of the new build over what the old build persisted:
 * fresh store modules hydrate from ``saved``. */
function coldStart(saved: Record<string, string>) {
  const disk = new Map(Object.entries(saved))
  const storage: StorageAdapter = {
    getItem: (k) => disk.get(k) ?? null,
    setItem: (k, v) => void disk.set(k, v),
    removeItem: (k) => void disk.delete(k),
  }
  let heal!: Heal
  let dash!: Dash
  let lib!: Lib
  jest.isolateModules(() => {
    lib = require("@domain/lib/store")
    dash = require("@domain/dash/store")
    heal = require("../profile-photo-heal")
  })
  lib.configureStorage(storage)
  return { heal, dash, disk }
}
/** What the old build wrote: the dash store with its photo path. */
function persisted(photo: string | undefined, pendingUri?: string) {
  let dash!: Dash
  jest.isolateModules(() => {
    require("@domain/lib/store").configureStorage({
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    })
    dash = require("@domain/dash/store")
  })
  const s = dash.dashStore.get()
  return {
    "sop-proto:dash": JSON.stringify({
      ...s,
      profile: { ...s.profile, name: "Kairus Noah", photo },
      profilePhotoPending: pendingUri
        ? { uri: pendingUri, mediaId: "media-1" }
        : undefined,
    }),
  }
}
const files = (...present: string[]) => ({
  documentDir: NEW,
  exists: (uri: string) => present.includes(uri),
})

it("points a photo saved by the previous build at this build's folder", () => {
  const { heal, dash, disk } = coldStart(persisted(OLD + PHOTO))
  heal.healProfilePhoto(files(NEW + PHOTO))
  expect(dash.dashStore.get().profile.photo).toBe(NEW + PHOTO)
  expect(dash.dashStore.get().profile.name).toBe("Kairus Noah")
  // Written back, so the next launch starts from the right path.
  expect(JSON.parse(disk.get("sop-proto:dash") ?? "{}").profile.photo).toBe(
    NEW + PHOTO,
  )
})

it("drops a photo whose file is gone, so the server's photo shows", () => {
  const { heal, dash } = coldStart(persisted(OLD + PHOTO))
  heal.healProfilePhoto(files())
  expect(dash.dashStore.get().profile.photo).toBeUndefined()
})

it("leaves a photo that still loads, a web URL and no photo alone", () => {
  for (const photo of [NEW + PHOTO, "https://cdn/x.jpg", undefined]) {
    const { heal, dash } = coldStart(persisted(photo))
    const before = dash.dashStore.get()
    heal.healProfilePhoto(files(NEW + PHOTO))
    expect(dash.dashStore.get()).toBe(before)
  }
})

it("moves a photo still waiting to upload to the new folder too", () => {
  const { heal, dash } = coldStart(persisted(OLD + PHOTO, OLD + PHOTO))
  heal.healProfilePhoto(files(NEW + PHOTO))
  expect(dash.dashStore.get().profilePhotoPending).toEqual({
    uri: NEW + PHOTO,
    mediaId: "media-1",
  })
})

it("never throws when the file system cannot be read", () => {
  const { heal, dash } = coldStart(persisted(OLD + PHOTO))
  expect(() =>
    heal.healProfilePhoto({
      documentDir: NEW,
      exists: () => {
        throw new Error("no fs")
      },
    }),
  ).not.toThrow()
  expect(dash.dashStore.get().profile.photo).toBe(OLD + PHOTO)
})
