import * as ImagePicker from "expo-image-picker"
import { Platform } from "react-native"
import { toast } from "sonner-native"
import type { Media } from "./store"

/** Copy a picked/captured file into app storage so it survives cache purges. */
export async function keep(uri: string, ext: string) {
  // ponytail: web keeps the picker's object URL, which dies on reload; fine
  // for a browser preview, native is the target.
  if (Platform.OS === "web") return uri
  try {
    const { Directory, File, Paths } = await import("expo-file-system")
    const dir = new Directory(Paths.document, "social")
    if (!dir.exists) dir.create()
    const out = new File(
      dir,
      `${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`,
    )
    new File(uri).copy(out)
    return out.uri
  } catch {
    return uri
  }
}

export async function pickMedia({
  camera = false,
  multiple = true,
  video = true,
}: {
  camera?: boolean
  multiple?: boolean
  video?: boolean
} = {}): Promise<Media[]> {
  try {
    const types: ImagePicker.MediaType[] = video
      ? ["images", "videos"]
      : ["images"]
    if (camera) {
      const permission = await ImagePicker.requestCameraPermissionsAsync()
      if (!permission.granted) {
        toast.error("Camera access is off. Choose from your library instead.")
        return []
      }
    }
    const result = camera
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: types,
          quality: 0.85,
          videoMaxDuration: 60,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: types,
          quality: 0.85,
          allowsMultipleSelection: multiple,
          selectionLimit: 10,
          orderedSelection: true,
          videoMaxDuration: 60,
        })
    if (result.canceled) return []
    return Promise.all(
      result.assets.map(async (a) => {
        const isVideo = a.type === "video"
        return {
          kind: isVideo ? ("video" as const) : ("image" as const),
          uri: await keep(a.uri, isVideo ? "mp4" : "jpg"),
          ratio: a.width && a.height ? a.width / a.height : undefined,
        }
      }),
    )
  } catch {
    toast.error("Couldn't open your photos. Please try again.")
    return []
  }
}
