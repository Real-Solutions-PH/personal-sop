import { LinearGradient } from "expo-linear-gradient"
import * as Sharing from "expo-sharing"
import {
  Copy as CopyIcon,
  Download,
  Ellipsis,
  ImagePlus,
  PlusCircle,
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
import { copyText, pickPhoto } from "./media"
import { Copy, Line, Segmented, Tap } from "./native-kit"
import { go } from "./navigation"
import { keep } from "./social/media"
import { addStory, setPostDraft } from "./social/store"
import { type Accent, fonts, useTheme } from "./theme"

export type CardFormat = "9:16" | "4:5" | "1:1"
export type CardBackdrop = "vivid" | "night" | "paper" | "photo" | "sticker"
export type CardLook = {
  format: CardFormat
  backdrop: CardBackdrop
  photo: string | null
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
    paper = look.backdrop === "paper",
    partner: Accent = {
      primary: "hab",
      hab: "tsk",
      tsk: "hab",
      fit: "hab",
      nut: "life",
      fin: "tsk",
      life: "hab",
    }[accent] as Accent
  const colors: readonly [string, string, string] = paper
    ? [t["share-paper"], t["share-paper"], t["share-paper"]]
    : look.backdrop === "night"
      ? [t["share-night"], t["share-night"], t["share-night"]]
      : look.backdrop === "sticker"
        ? ["#414148", "#38383f", "#414148"]
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
      {look.backdrop !== "photo" && look.backdrop !== "sticker" && (
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
    [photo, setPhoto] = useState<string | null>(null)
  const t = useTheme(),
    windowWidth = Math.min(useWindowDimensions().width, 480),
    padding = (windowWidth - 32) * 0.18,
    width = Math.min(
      (windowWidth - 2 * padding) *
        (format === "9:16" ? 0.64 : format === "4:5" ? 0.76 : 0.8),
      format === "9:16" ? 300 : format === "4:5" ? 340 : 360,
    )
  const look = { format, backdrop, photo },
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
    onLookChange?.({ format, backdrop, photo })
  }, [format, backdrop, photo, onLookChange])
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
      <Line style={{ justifyContent: "space-around", gap: 8 }}>
        {(["vivid", "night", "paper", "photo", "sticker"] as const).map((b) => (
          <Tap
            key={b}
            label={b}
            onPress={() => setBackdrop(b)}
            style={{ alignItems: "center", gap: 6 }}
          >
            <LinearGradient
              colors={
                b === "vivid"
                  ? [t[accent], t["share-vivid-to"]]
                  : b === "paper"
                    ? ["#eee8df", "#eee8df"]
                    : b === "night"
                      ? ["#08090d", "#08090d"]
                      : b === "photo"
                        ? ["#8a817c", "#474341"]
                        : ["#555", "#888"]
              }
              style={{
                width: 48,
                height: 48,
                borderRadius: 24,
                borderWidth: backdrop === b ? 2 : 0,
                borderColor: t[accent],
              }}
            />
            <Copy size={12}>{b[0].toUpperCase() + b.slice(1)}</Copy>
          </Tap>
        ))}
      </Line>
      {backdrop === "photo" && (
        <Tap onPress={() => void pickPhoto().then(setPhoto)}>
          <Copy size={14}>Choose a photo</Copy>
        </Tap>
      )}
      {children}
    </View>
  )
}
