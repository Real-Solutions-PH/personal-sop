import * as ImageManipulator from "expo-image-manipulator"
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

/** Long edges of a photo's renditions: the full image (covers a 3x phone at
 * full width with room to zoom), the preview grids and the feed show first,
 * and the inline placeholder painted before anything loads. */
export const FULL_EDGE = 2048
export const PREVIEW_EDGE = 640
const LQIP_EDGES = [16, 12]
export const LQIP_MAX = 2048
/** The server's image size cap (MEDIA_MAX_IMAGE_MB). */
export const IMAGE_CAP_BYTES = 15 * 1024 * 1024

export type Prepared = {
  full: string
  fullMime: "image/jpeg" | "image/png"
  preview: string
  lqip?: string
  width: number
  height: number
}

/** Byte size of a local file, or undefined when it cannot be read. */
function sizeOf(uri: string): number | undefined {
  try {
    const { File } =
      require("expo-file-system") as typeof import("expo-file-system")
    return new File(uri).size ?? undefined
  } catch {
    return undefined
  }
}

/** The three versions of a photo uploaded together: a full image with a
 * 2048 px long edge, a 640 px preview and a tiny inline placeholder. Never
 * upscales. With ``keepPng`` (a share card) a PNG under the size cap is the
 * full image as it is, so its gradients are not re-encoded. */
export async function prepareImage(
  uri: string,
  opts: { keepPng?: boolean } = {},
): Promise<Prepared> {
  const M = ImageManipulator
  const info = await M.manipulateAsync(uri, [])
  const long = Math.max(info.width, info.height)
  const wide = info.width >= info.height
  const bound = (edge: number) =>
    long > edge ? [{ resize: wide ? { width: edge } : { height: edge } }] : []
  const scaled = (edge: number) => {
    const k = long > edge ? edge / long : 1
    return {
      width: Math.round(info.width * k),
      height: Math.round(info.height * k),
    }
  }
  const png =
    opts.keepPng &&
    (/^data:image\/png/.test(uri) || /\.png(?:[?#]|$)/i.test(uri)) &&
    (sizeOf(uri) ?? Number.POSITIVE_INFINITY) <= IMAGE_CAP_BYTES
  let full = uri
  let size = { width: info.width, height: info.height }
  if (!png) {
    const out = await M.manipulateAsync(uri, bound(FULL_EDGE), {
      compress: 0.88,
      format: M.SaveFormat.JPEG,
    })
    full = await keep(out.uri, "jpg")
    size = scaled(FULL_EDGE)
  }
  const small = await M.manipulateAsync(uri, bound(PREVIEW_EDGE), {
    compress: 0.7,
    format: M.SaveFormat.JPEG,
  })
  const preview = await keep(small.uri, "jpg")
  let lqip: string | undefined
  for (const edge of LQIP_EDGES) {
    const tiny = await M.manipulateAsync(uri, bound(edge), {
      compress: 0.5,
      format: M.SaveFormat.JPEG,
      base64: true,
    })
    const data = tiny.base64 ? `data:image/jpeg;base64,${tiny.base64}` : ""
    if (data && data.length <= LQIP_MAX) {
      lqip = data
      break
    }
  }
  return {
    full,
    fullMime: png ? "image/png" : "image/jpeg",
    preview,
    lqip,
    ...size,
  }
}

/** A picked photo with its renditions; a photo the manipulator cannot read
 * is kept as it is (full only). */
async function withRenditions(uri: string, ratio?: number): Promise<Media> {
  try {
    const p = await prepareImage(uri)
    return {
      kind: "image",
      uri: p.full,
      mime: p.fullMime,
      previewUri: p.preview,
      lqip: p.lqip,
      width: p.width,
      height: p.height,
      ratio: p.width / p.height || ratio,
    }
  } catch {
    return { kind: "image", uri: await keep(uri, "jpg"), ratio }
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
      result.assets.map(async (a): Promise<Media> => {
        const ratio = a.width && a.height ? a.width / a.height : undefined
        if (a.type !== "video") return withRenditions(a.uri, ratio)
        return { kind: "video", uri: await keep(a.uri, "mp4"), ratio }
      }),
    )
  } catch {
    toast.error("Couldn't open your photos. Please try again.")
    return []
  }
}
