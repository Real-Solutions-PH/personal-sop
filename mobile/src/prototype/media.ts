import * as Clipboard from "expo-clipboard"
import * as ImageManipulator from "expo-image-manipulator"
import * as ImagePicker from "expo-image-picker"
import * as Sharing from "expo-sharing"
import { Platform, Share } from "react-native"
import { toast } from "sonner-native"

export async function pickPhoto(camera = false): Promise<string | null> {
  try {
    if (camera) {
      const permission = await ImagePicker.requestCameraPermissionsAsync()
      if (!permission.granted) {
        toast.error("Camera access is denied. Choose a photo instead.")
        return null
      }
    }
    const result = camera
      ? await ImagePicker.launchCameraAsync({ quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          quality: 0.8,
        })
    if (result.canceled) return null
    return await shrink(result.assets[0].uri)
  } catch {
    toast.error("Could not open this image. Try another photo.")
    return null
  }
}
/** Long edge of a picked photo. Label digits and a kitchen scale's display
 * must stay legible for the photo reader: at 512 px wide they were not. */
export const PHOTO_EDGE = 1600

/** Shrinks a picked image to what the AI needs and returns it as data. */
async function shrink(uri: string): Promise<string | null> {
  const size = await ImageManipulator.manipulateAsync(uri, [])
  const wide = size.width >= size.height
  const long = Math.max(size.width, size.height)
  const resized = await ImageManipulator.manipulateAsync(
    uri,
    long > PHOTO_EDGE
      ? [{ resize: wide ? { width: PHOTO_EDGE } : { height: PHOTO_EDGE } }]
      : [],
    { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true },
  )
  return resized.base64 ? `data:image/jpeg;base64,${resized.base64}` : null
}
/** Several photos from the library at once (up to ``limit``). */
export async function pickPhotos(limit = 10): Promise<string[]> {
  try {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      allowsMultipleSelection: true,
      selectionLimit: limit,
      orderedSelection: true,
    })
    if (result.canceled) return []
    const out: string[] = []
    for (const a of result.assets.slice(0, limit)) {
      const data = await shrink(a.uri)
      if (data) out.push(data)
    }
    return out
  } catch {
    toast.error("Could not open these images. Try other photos.")
    return []
  }
}
export async function copyText(text: string) {
  try {
    await Clipboard.setStringAsync(text)
    toast.success("Copied")
  } catch {
    toast.error("Could not copy")
  }
}
export function encodeCsv(rows: string[][]) {
  return rows
    .map((row) =>
      row
        .map(
          (value) =>
            `"${(/^[=+@\-\t\r]/.test(value) ? "'" : "") + value.replaceAll('"', '""')}"`,
        )
        .join(","),
    )
    .join("\r\n")
}
export async function exportCsv(name: string, rows: string[][]) {
  try {
    const content = encodeCsv(rows)
    if (Platform.OS === "web") {
      await Share.share({ message: content })
      return
    }
    const { File, Paths } = await import("expo-file-system")
    const file = new File(Paths.cache, name)
    file.write(content)
    if (await Sharing.isAvailableAsync())
      await Sharing.shareAsync(file.uri, {
        mimeType: "text/csv",
        dialogTitle: "Export records",
      })
    else await Share.share({ message: content })
  } catch {
    toast.error("Export failed. Please try again.")
  }
}
/** Hands a JSON document to the share sheet as a file (web: as text).
 * Resolves false when it could not be shared. */
export async function exportJson(name: string, value: unknown) {
  try {
    const content = JSON.stringify(value, null, 2)
    if (Platform.OS === "web") {
      await Share.share({ message: content })
      return true
    }
    const { File, Paths } = await import("expo-file-system")
    const file = new File(Paths.cache, name)
    if (file.exists) file.delete()
    file.write(content)
    if (await Sharing.isAvailableAsync())
      await Sharing.shareAsync(file.uri, {
        mimeType: "application/json",
        dialogTitle: "Export my data",
      })
    else await Share.share({ message: content })
    return true
  } catch {
    return false
  }
}
