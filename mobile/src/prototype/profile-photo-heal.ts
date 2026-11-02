// iOS moves the app's data folder to a new path on every install of an
// update, files included. The profile photo is saved as an absolute file://
// path inside that folder, so after an update the saved path points at the
// old folder and the avatar draws an empty circle. Run once at launch, after
// the stores can read storage: the photo follows its file to the new folder,
// or, when the file is gone, is dropped so the server's copy shows.

import { dashStore } from "@domain/dash/store"
import { Platform } from "react-native"

export interface PhotoFiles {
  /** This build's document folder, ending in "/". */
  documentDir: string
  exists(uri: string): boolean
}

const MARK = "/Documents/"

function deviceFiles(): PhotoFiles | null {
  if (Platform.OS === "web") return null
  const { File, Paths } =
    require("expo-file-system") as typeof import("expo-file-system")
  const dir = Paths.document.uri
  return {
    documentDir: dir.endsWith("/") ? dir : `${dir}/`,
    exists: (uri) => new File(uri).exists,
  }
}

/** ``uri`` as it loads on this build; undefined when its file is gone;
 * ``uri`` itself when it is not a file of this app or already loads. */
function heal(uri: string, fs: PhotoFiles): string | undefined {
  if (!uri.startsWith("file:") || fs.exists(uri)) return uri
  const at = uri.indexOf(MARK)
  if (at >= 0) {
    const moved = fs.documentDir + uri.slice(at + MARK.length)
    if (fs.exists(moved)) return moved
  }
  return undefined
}

export function healProfilePhoto(files?: PhotoFiles) {
  try {
    const fs = files ?? deviceFiles()
    if (!fs) return
    const s = dashStore.get()
    const photo = s.profile.photo && heal(s.profile.photo, fs)
    const wait = s.profilePhotoPending?.uri
    // A pending upload whose file is gone keeps its path: the media id it
    // may hold still finishes the change.
    const waitAt = wait ? (heal(wait, fs) ?? wait) : wait
    if (photo === s.profile.photo && waitAt === wait) return
    dashStore.set((cur) => ({
      ...cur,
      profile: { ...cur.profile, photo },
      profilePhotoPending: cur.profilePhotoPending && {
        ...cur.profilePhotoPending,
        uri: waitAt ?? null,
      },
    }))
  } catch {
    // The saved path stays; the avatar falls back to initials at worst.
  }
}
