// Recordings and picked files start in the OS cache directory, which the
// system may purge at any time. Anything that waits for a connection is
// copied into the app's document directory first, and released once the
// server has it.

import { Platform } from "react-native"

const DIR = "pending-media"

/** A durable copy of ``uri`` (the original on web, or when copying fails:
 * the cache file is still better than nothing). */
export async function keepFile(uri: string): Promise<string> {
  if (Platform.OS === "web" || !uri.startsWith("file:")) return uri
  try {
    const { Directory, File, Paths } =
      require("expo-file-system") as typeof import("expo-file-system")
    const dir = new Directory(Paths.document, DIR)
    if (!dir.exists) dir.create()
    const name = uri.split("/").pop() || "recording"
    const out = new File(
      dir,
      `${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${name}`,
    )
    new File(uri).copy(out)
    return out.uri
  } catch {
    return uri
  }
}

/** Delete a copy made by ``keepFile`` (anything else is left alone). */
export function releaseFile(uri: string | undefined) {
  if (!uri || Platform.OS === "web" || !uri.includes(`/${DIR}/`)) return
  try {
    const { File } =
      require("expo-file-system") as typeof import("expo-file-system")
    const f = new File(uri)
    if (f.exists) f.delete()
  } catch {
    // a leftover file is harmless
  }
}
