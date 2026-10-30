import { Image } from "expo-image"
import { useEffect, useState } from "react"
import { View } from "react-native"
import { useTheme } from "../theme"

/** The parts of a photo this draws: the server's media id (the cache key),
 * the full image, and its preview and inline placeholder when the upload
 * made them. */
export type RemoteMedia = {
  id?: string
  uri: string
  previewUri?: string
  lqip?: string
}

/** A community photo, cached on disk by media id so a new presigned URL, a
 * refresh or a restart never downloads it again.
 *
 * - progressive: the blurred placeholder paints at once, the preview next,
 *   and the full image fades in on top once ``active`` has been true (the
 *   photo is on screen or next to it), then stays.
 * - preview: the preview only (grids).
 *
 * A photo uploaded before previews existed shows its full image. A local
 * file not uploaded yet (no id) is drawn uncached. */
export function RemoteImage({
  media,
  width,
  height,
  fit = "cover",
  variant = "progressive",
  active = true,
  accessibilityLabel,
  onLoad,
  onError,
}: {
  media: RemoteMedia
  width: number | `${number}%`
  height: number | `${number}%`
  fit?: "cover" | "contain"
  variant?: "progressive" | "preview"
  active?: boolean
  accessibilityLabel?: string
  /** The image the person sees first has rendered (the base layer). */
  onLoad?: () => void
  onError?: () => void
}) {
  const t = useTheme()
  const [wanted, setWanted] = useState(active)
  useEffect(() => {
    if (active) setWanted(true)
  }, [active])
  const { id, uri, previewUri, lqip } = media
  const base = previewUri ?? uri
  const baseKey = previewUri ? `${id}:p` : `${id}:f`
  const top = variant === "progressive" && !!previewUri && wanted
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityLabel ? "image" : undefined}
      style={{ width, height, backgroundColor: t.soft, overflow: "hidden" }}
    >
      <Image
        testID="remote-image-base"
        source={id ? { uri: base, cacheKey: baseKey } : { uri }}
        placeholder={lqip ? { uri: lqip } : undefined}
        placeholderContentFit={fit}
        contentFit={fit}
        cachePolicy="memory-disk"
        recyclingKey={id ?? uri}
        transition={150}
        onLoad={onLoad}
        onError={onError}
        style={{ width: "100%", height: "100%" }}
      />
      {top && (
        <Image
          testID="remote-image-full"
          source={{ uri, cacheKey: `${id}:f` }}
          contentFit={fit}
          cachePolicy="memory-disk"
          recyclingKey={`${id}:f`}
          transition={200}
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        />
      )}
    </View>
  )
}
