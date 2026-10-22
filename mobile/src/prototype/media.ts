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
    const resized = await ImageManipulator.manipulateAsync(
      result.assets[0].uri,
      [{ resize: { width: 512 } }],
      { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true },
    )
    return resized.base64 ? `data:image/jpeg;base64,${resized.base64}` : null
  } catch {
    toast.error("Could not open this image. Try another photo.")
    return null
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
