import { LinearGradient } from "expo-linear-gradient"
import * as Sharing from "expo-sharing"
import {
  Copy as CopyIcon,
  Download,
  Ellipsis,
  Image as ImageIcon,
  ImagePlus,
  Palette,
  PlusCircle,
  Sticker,
} from "lucide-react-native"
import { type ReactNode, useEffect, useId, useRef, useState } from "react"
import {
  Image,
  Platform,
  ScrollView,
  Share,
  Text,
  useWindowDimensions,
  View,
} from "react-native"
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg"
import { captureRef } from "react-native-view-shot"
import { toast } from "sonner-native"
import { ColorPicker, luminance, shade } from "./color-picker"
import { copyText, pickPhoto } from "./media"
import { Copy, Line, Segmented, Tap } from "./native-kit"
import { go } from "./navigation"
import { keep } from "./social/media"
import { addStory, setPostDraft } from "./social/store"
import { type Accent, fonts, useTheme } from "./theme"

export type CardFormat = "9:16" | "4:5" | "1:1"
const BACKDROPS = [
  { key: "vivid", label: "Vivid" },
  { key: "night", label: "Night" },
  { key: "paper", label: "Paper" },
  { key: "custom", label: "Custom" },
  { key: "photo", label: "Photo" },
  { key: "sticker", label: "Sticker" },
] as const
export type CardBackdrop =
  | "vivid"
  | "night"
  | "paper"
  | "photo"
  | "custom"
  | "sticker"
export type CardLook = {
  format: CardFormat
  backdrop: CardBackdrop
  photo: string | null
  /** The Custom background's colour (``#rrggbb``). */
  color?: string
}
export function CardFrame({
  width,
  look,
  accent,
  kicker,
  children,
  date,
  foot,
  mark = true,
}: {
  mark?: boolean
  date?: string
  foot?: ReactNode
  width: number
  look: CardLook
  accent: Accent
  kicker: string
  children: ReactNode
}) {
  const gradientId = useId().replaceAll(":", ""),
    t = useTheme(),
    q = width / 100,
    custom = look.backdrop === "custom" ? (look.color ?? "#3E63DD") : null,
    paper = look.backdrop === "paper" || (!!custom && luminance(custom) > 0.55),
    partner: Accent = {
      primary: "hab",
      hab: "tsk",
      tsk: "hab",
      fit: "hab",
      nut: "life",
      fin: "tsk",
      life: "hab",
    }[accent] as Accent
  const colors: readonly [string, string, string] = custom
    ? [custom, shade(custom, 0.18), shade(custom, 0.38)]
    : paper
      ? [t["share-paper"], t["share-paper"], t["share-paper"]]
      : look.backdrop === "night"
        ? [t["share-night"], t["share-night"], t["share-night"]]
        : look.backdrop === "sticker"
          ? // A see-through panel: the saved PNG keeps the transparency, so
            // the card sits on top of whatever photo it is pasted onto.
            ["#0b0b10b8", "#0b0b10a6", "#0b0b10b8"]
          : [t["share-vivid-from"], t["share-vivid-to"], t["share-vivid-to"]]
  const ink = paper ? t["share-paper-ink"] : "#fff"
  return (
    <LinearGradient
      colors={colors}
      start={{ x: 1, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={{
        width,
        aspectRatio:
          look.format === "9:16" ? 9 / 16 : look.format === "4:5" ? 4 / 5 : 1,
        padding: 6.5 * q,
        borderRadius: 5 * q,
        overflow: "hidden",
      }}
    >
      {look.backdrop !== "photo" &&
        look.backdrop !== "sticker" &&
        look.backdrop !== "custom" && (
          <Svg
            width="100%"
            height="100%"
            style={{ position: "absolute", inset: 0 }}
          >
            <Defs>
              <RadialGradient
                id={`${gradientId}top`}
                cx={look.backdrop === "night" ? "50%" : "100%"}
                cy="0%"
                rx="120%"
                ry="70%"
              >
                <Stop
                  offset="0"
                  stopColor={t[accent]}
                  stopOpacity={paper || look.backdrop === "night" ? 0.22 : 0.75}
                />
                <Stop offset=".6" stopColor={t[accent]} stopOpacity={0} />
              </RadialGradient>
              <RadialGradient
                id={`${gradientId}bottom`}
                cx="0%"
                cy="100%"
                rx="90%"
                ry="60%"
              >
                <Stop offset="0" stopColor={t[partner]} stopOpacity={0.55} />
                <Stop offset=".65" stopColor={t[partner]} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Rect width="100%" height="100%" fill={`url(#${gradientId}top)`} />
            {look.backdrop === "vivid" && (
              <Rect
                width="100%"
                height="100%"
                fill={`url(#${gradientId}bottom)`}
              />
            )}
          </Svg>
        )}
      {look.backdrop === "photo" && look.photo && (
        <Image
          source={{ uri: look.photo }}
          style={{ position: "absolute", inset: 0, opacity: 0.55 }}
        />
      )}
      <Line style={{ gap: 2 * q, justifyContent: "space-between" }}>
        <Line style={{ gap: 2 * q }}>
          <Text
            style={{
              fontFamily: fonts.display,
              fontSize: 4 * q,
              color: ink,
              backgroundColor: "#ffffff22",
              width: 5.5 * q,
              height: 5.5 * q,
              textAlign: "center",
              borderRadius: 1.4 * q,
            }}
          >
            S
          </Text>
          <Text
            style={{
              fontFamily: fonts.semibold,
              fontSize: 3.4 * q,
              letterSpacing: 0.48 * q,
              color: ink,
            }}
          >
            {kicker.toUpperCase()}
          </Text>
        </Line>
        <Text
          style={{
            fontFamily: fonts.body,
            fontSize: 3.4 * q,
            color: ink,
            opacity: 0.65,
          }}
        >
          {date ??
            new Date().toLocaleDateString("en-PH", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
        </Text>
      </Line>
      {children}
      <View
        style={{
          paddingTop: 4 * q,
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: 3 * q,
        }}
      >
        <View style={{ flex: 1 }}>
          {typeof foot === "string" ? (
            <Text
              style={{
                fontFamily: fonts.body,
                fontSize: 2.5 * q,
                color: ink,
                opacity: 0.5,
              }}
            >
              {foot}
            </Text>
          ) : (
            foot
          )}
        </View>
        {mark && (
          <Text
            style={{
              fontFamily: fonts.display,
              fontSize: 4 * q,
              color: ink,
              fontStyle: "italic",
              letterSpacing: 0.2 * q,
            }}
          >
            PERSONAL<Text style={{ color: t[accent] }}> SOP</Text>
          </Text>
        )}
      </View>
    </LinearGradient>
  )
}
export function ShareComposer<K extends string>({
  value,
  onChange,
  items,
  accent,
  caption,
  children,
  formats = ["9:16", "4:5", "1:1"],
  beforeShare,
  onLookChange,
  shareRef,
}: {
  value: K
  onChange: (key: K) => void
  items: {
    key: K
    label: string
    render: (width: number, look: CardLook) => ReactNode
  }[]
  accent: Accent
  caption: string
  children: ReactNode
  formats?: CardFormat[]
  beforeShare?: (proceed: () => Promise<void>) => void
  onLookChange?: (look: CardLook) => void
  shareRef?: { current: (() => Promise<void>) | null }
}) {
  const [format, setFormat] = useState<CardFormat>("9:16"),
    [backdrop, setBackdrop] = useState<CardBackdrop>("vivid"),
    [photo, setPhoto] = useState<string | null>(null),
    [color, setColor] = useState("#3E63DD")
  const t = useTheme(),
    windowWidth = Math.min(useWindowDimensions().width, 480),
    padding = (windowWidth - 32) * 0.18,
    width = Math.min(
      (windowWidth - 2 * padding) *
        (format === "9:16" ? 0.64 : format === "4:5" ? 0.76 : 0.8),
      format === "9:16" ? 300 : format === "4:5" ? 340 : 360,
    )
  const look = { format, backdrop, photo, color },
    refs = useRef<Record<string, View | null>>({}),
    scroll = useRef<ScrollView>(null)
  useEffect(() => {
    if (!formats.includes(format)) setFormat(formats[0])
  }, [formats, format])
  useEffect(() => {
    scroll.current?.scrollTo({
      x: Math.max(0, items.findIndex((i) => i.key === value) * (width + 12)),
      animated: false,
    })
  }, [value, width, items.findIndex])
  const doShare = async () => {
    try {
      if (Platform.OS !== "web" && refs.current[value]) {
        const uri = await captureRef(refs.current[value]!, {
          format: "png",
          quality: 1,
          width: 1080,
          height: Math.round(
            1080 * (format === "9:16" ? 16 / 9 : format === "4:5" ? 5 / 4 : 1),
          ),
        })
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, { mimeType: "image/png" })
          return
        }
      }
      await Share.share({ message: caption })
    } catch {
      toast.error("Could not share this image. You can still copy its caption.")
    }
  }
  // Render the selected card to a PNG for the in-app feed/story.
  const capture = async () => {
    const node = refs.current[value]
    if (!node) return null
    try {
      const ratio = format === "9:16" ? 16 / 9 : format === "4:5" ? 5 / 4 : 1
      if (Platform.OS === "web")
        return await captureRef(node, { format: "png", result: "data-uri" })
      const uri = await captureRef(node, {
        format: "png",
        quality: 1,
        width: 1080,
        height: Math.round(1080 * ratio),
      })
      return await keep(uri, "png")
    } catch {
      return null
    }
  }
  const toFeed = async () => {
    const uri = await capture()
    setPostDraft({
      caption,
      media: uri
        ? [
            {
              kind: "image",
              uri,
              ratio: format === "9:16" ? 9 / 16 : format === "4:5" ? 4 / 5 : 1,
            },
          ]
        : [],
    })
    go(uri ? "/social/compose" : "/social/compose?progress=1")
  }
  const toStory = async () => {
    const uri = await capture()
    if (!uri) {
      toast.error("Couldn't render this card. Try Post instead.")
      return
    }
    addStory({ kind: "image", uri })
    toast.success("Added to your story", {
      action: { label: "View", onClick: () => go("/social/stories/me") },
    })
  }
  if (shareRef) shareRef.current = doShare
  useEffect(() => {
    onLookChange?.({ format, backdrop, photo, color })
  }, [format, backdrop, photo, color, onLookChange])
  const share = () => (beforeShare ? beforeShare(doShare) : doShare())
  return (
    <View style={{ gap: 12, paddingTop: 4 }}>
      <View>
        <ScrollView
          ref={scroll}
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={width + 12}
          decelerationRate="fast"
          style={{ marginHorizontal: -16 }}
          contentContainerStyle={{
            paddingHorizontal: padding,
            paddingVertical: 8,
            gap: 12,
          }}
          onMomentumScrollEnd={(e) => {
            const i = Math.max(
              0,
              Math.min(
                items.length - 1,
                Math.round(e.nativeEvent.contentOffset.x / (width + 12)),
              ),
            )
            onChange(items[i].key)
          }}
        >
          {items.map((item) => (
            <Tap
              key={item.key}
              label={item.label}
              onPress={() => {
                onChange(item.key)
                scroll.current?.scrollTo({
                  x: Math.max(
                    0,
                    items.indexOf(item) * (width + 12) +
                      padding +
                      width / 2 -
                      windowWidth / 2,
                  ),
                  animated: true,
                })
              }}
              style={{
                opacity: item.key === value ? 1 : 0.45,
                transform: [{ scale: item.key === value ? 1 : 0.94 }],
              }}
            >
              <View
                ref={(v) => {
                  refs.current[item.key] = v
                }}
                collapsable={false}
              >
                {item.render(width, look)}
              </View>
            </Tap>
          ))}
        </ScrollView>
        <Line style={{ justifyContent: "center", gap: 8, marginTop: 8 }}>
          <Copy size={14} weight="semibold">
            {items.find((x) => x.key === value)?.label}
          </Copy>
          <Line style={{ gap: 4 }}>
            {items.map((item) => (
              <View
                key={item.key}
                style={{
                  width: item.key === value ? 16 : 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: item.key === value ? t.text : t.soft,
                }}
              />
            ))}
          </Line>
        </Line>
      </View>
      <Line style={{ paddingTop: 8, justifyContent: "space-around" }}>
        {[
          { label: "Post", Icon: ImagePlus, action: toFeed },
          { label: "Story", Icon: PlusCircle, action: toStory },
          { label: "Save", Icon: Download, action: share },
          { label: "Caption", Icon: CopyIcon, action: () => copyText(caption) },
          { label: "More", Icon: Ellipsis, action: share },
        ].map(({ label, Icon, action }) => (
          <Tap
            key={label}
            label={label}
            onPress={() => void action()}
            style={{ flex: 1, alignItems: "center", gap: 6 }}
          >
            {label === "Story" ? (
              <LinearGradient
                colors={["#f77737", "#d62976", "#962fbf"]}
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 24,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon size={20} color="#fff" />
              </LinearGradient>
            ) : (
              <View
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 24,
                  backgroundColor: t.soft,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon size={20} color={t.text} />
              </View>
            )}
            <Copy size={12}>{label}</Copy>
          </Tap>
        ))}
      </Line>
      <Copy
        size={12}
        muted
        style={{
          marginTop: 12,
          marginBottom: -8,
          paddingHorizontal: 4,
          letterSpacing: 0.6,
        }}
      >
        SIZE
      </Copy>
      <Segmented
        value={format}
        onChange={setFormat}
        options={formats.map((value) => ({
          value,
          label: { "9:16": "Story", "4:5": "Post 4:5", "1:1": "Square" }[value],
        }))}
      />
      <Copy
        size={12}
        muted
        style={{
          marginTop: 12,
          marginBottom: -8,
          paddingHorizontal: 4,
          letterSpacing: 0.6,
        }}
      >
        BACKGROUND
      </Copy>
      {/* All six fit one row: no swatch hides off the edge. */}
      <Line style={{ justifyContent: "space-between", gap: 4 }}>
        {BACKDROPS.map((b) => (
          <Tap
            key={b.key}
            label={`${b.label} background`}
            onPress={() => {
              setBackdrop(b.key)
              // Picking Photo with none chosen yet opens the library.
              if (b.key === "photo" && !photo)
                void pickPhoto().then((v) => v && setPhoto(v))
            }}
            style={{ alignItems: "center", gap: 6, width: 52 }}
          >
            <LinearGradient
              colors={
                b.key === "vivid"
                  ? [t[accent], t["share-vivid-to"]]
                  : b.key === "paper"
                    ? ["#eee8df", "#eee8df"]
                    : b.key === "night"
                      ? ["#08090d", "#08090d"]
                      : b.key === "custom"
                        ? [color, shade(color, 0.38)]
                        : b.key === "photo"
                          ? ["#8a817c", "#474341"]
                          : ["#ffffff00", "#ffffff00"]
              }
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                alignItems: "center",
                justifyContent: "center",
                // Night and Sticker vanish on a dark screen without an edge.
                borderWidth:
                  backdrop === b.key
                    ? 2
                    : b.key === "sticker" || b.key === "night"
                      ? 1
                      : 0,
                borderStyle:
                  b.key === "sticker" && backdrop !== b.key
                    ? "dashed"
                    : "solid",
                borderColor: backdrop === b.key ? t[accent] : t.muted,
              }}
            >
              {b.key === "photo" && <ImageIcon size={20} color="#fff" />}
              {b.key === "custom" && <Palette size={20} color="#fff" />}
              {b.key === "sticker" && <Sticker size={20} color={t.text} />}
            </LinearGradient>
            <Copy size={12}>{b.label}</Copy>
          </Tap>
        ))}
      </Line>
      {backdrop === "photo" && (
        <Tap
          label={photo ? "Change photo" : "Choose a photo"}
          onPress={() => void pickPhoto().then((v) => v && setPhoto(v))}
          style={{
            minHeight: 64,
            borderRadius: 16,
            borderWidth: 1,
            borderStyle: photo ? "solid" : "dashed",
            borderColor: photo ? t.line : t[accent],
            backgroundColor: t.soft,
            padding: 10,
          }}
        >
          <Line style={{ gap: 12 }}>
            {photo ? (
              <Image
                source={{ uri: photo }}
                style={{ width: 44, height: 44, borderRadius: 10 }}
              />
            ) : (
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  backgroundColor: `${t[accent]}26`,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <ImagePlus size={22} color={t[accent]} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Copy size={14} weight="semibold">
                {photo ? "Change photo" : "Choose a photo"}
              </Copy>
              <Copy size={12} muted>
                {photo
                  ? "Your photo sits behind the card, dimmed so text stays readable."
                  : "From your library. It sits behind the card, dimmed."}
              </Copy>
            </View>
            {photo && (
              <Tap label="Remove photo" onPress={() => setPhoto(null)}>
                <Copy size={13} style={{ color: t.bad }}>
                  Remove
                </Copy>
              </Tap>
            )}
          </Line>
        </Tap>
      )}
      {backdrop === "custom" && (
        <ColorPicker value={color} onChange={setColor} />
      )}
      {backdrop === "sticker" && (
        <Line
          style={{
            gap: 10,
            alignItems: "flex-start",
            padding: 12,
            borderRadius: 14,
            backgroundColor: t.soft,
          }}
        >
          <Sticker size={18} color={t[accent]} />
          <Copy size={13} muted style={{ flex: 1 }}>
            A see-through card to paste on top of your own photo or story. Save
            it, then add it as a sticker in Instagram (or any app that takes
            images).
          </Copy>
        </Line>
      )}
      {children}
    </View>
  )
}
