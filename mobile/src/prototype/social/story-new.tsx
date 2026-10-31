import { palette } from "@domain/design/tokens"
import { LinearGradient } from "expo-linear-gradient"
import {
  Camera,
  ChevronRight,
  CircleCheck,
  Images,
  Palette,
  Sparkles,
  Star,
  Type,
  X,
} from "lucide-react-native"
import { useState } from "react"
import {
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native"
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { toast } from "sonner-native"
import { back, replace } from "../navigation"
import { fonts, useTheme } from "../theme"
import { ProgressPicker } from "./compose"
import {
  Avatar,
  CheckInOverlay,
  CheckInSlide,
  dayLabel,
  haptic,
  ProgressCard,
  VideoMedia,
} from "./kit"
import { pickMedia } from "./media"
import { useCheckInSources } from "./sources"
import {
  addStory,
  checkIn,
  clearDrafts,
  ME,
  type Media,
  type Progress,
  socialStore,
} from "./store"

type Mode = "checkin" | "text" | "media" | "progress"

/** Check-in choices from my own streaks, goals and workout, plus one I
 * write myself. */
function CheckInPicker({
  value,
  onChange,
}: {
  value?: Progress
  onChange: (p: Progress) => void
}) {
  const t = useTheme()
  const sources = useCheckInSources()
  const own = checkIn("primary", "Showed up today")
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0, flexShrink: 0 }}
      contentContainerStyle={{ gap: 8, paddingHorizontal: 12 }}
    >
      {[...sources, own].map((p) => {
        const on = value?.title === p.title
        return (
          <Pressable
            cssInterop={false}
            key={p.title}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`Check in: ${p.title}${p.day ? `, day ${p.day}` : ""}`}
            onPress={() => {
              haptic.tap()
              onChange(p)
            }}
            style={({ pressed }) => ({
              width: 148,
              padding: 12,
              gap: 4,
              borderRadius: 16,
              borderWidth: 2,
              borderColor: on ? "#fff" : "transparent",
              backgroundColor: "#ffffff1f",
              transform: [{ scale: pressed ? 0.96 : 1 }],
            })}
          >
            <Text
              style={{
                color: t[p.accent],
                fontFamily: fonts.semibold,
                fontSize: 12,
              }}
            >
              {dayLabel(p) ?? p.subtitle ?? "Today"}
            </Text>
            <Text
              numberOfLines={2}
              style={{ color: "#fff", fontFamily: fonts.medium, fontSize: 14 }}
            >
              {p.title}
            </Text>
          </Pressable>
        )
      })}
    </ScrollView>
  )
}

const BACKGROUNDS: [string, string][] = [
  // Fern first: the same ground as a Fern share card (ADR-0028).
  [palette.dark.background, palette.light.moss],
  ["#7246cf", "#06070a"],
  ["#007567", "#0e1624"],
  ["#bd4d00", "#2b1401"],
  ["#fab72a", "#e48e26"],
  ["#111111", "#333333"],
]

export function StoryNew() {
  const safe = useSafeAreaInsets()
  const { width: w, height: h } = useWindowDimensions()
  const width = Math.min(w, 520)
  const draft = socialStore.use((s) => s.drafts.story)
  const sources = useCheckInSources()
  const [mode, setMode] = useState<Mode>(
    draft?.progress ? "progress" : "checkin",
  )
  // Room under the preview for the picker row, the mode chips and Share.
  const chrome = mode === "checkin" ? 270 : mode === "progress" ? 330 : 150
  const height = Math.min(h - safe.top - safe.bottom - chrome, width * (16 / 9))
  const [media, setMedia] = useState<Media | null>(null)
  const [progress, setProgress] = useState<Progress | undefined>(
    draft?.progress,
  )
  const [picked, setPicked] = useState<Progress | undefined>()
  const check = picked ?? sources[0] ?? checkIn("primary", "Showed up today")
  const [text, setText] = useState("")
  const [bg, setBg] = useState(0)
  const ready =
    mode === "checkin" ||
    (mode === "text" && text.trim()) ||
    (mode === "media" && media) ||
    (mode === "progress" && progress)
  // A photo taken in check-in mode becomes the check-in's background.
  const pick = async (camera: boolean) => {
    const [m] = await pickMedia({ camera, multiple: false })
    if (m) {
      setMedia(m)
      if (mode !== "checkin") setMode("media")
    }
  }
  const close = () => {
    clearDrafts()
    back("/social")
  }
  const share = (audience: "everyone" | "close") => {
    if (!ready) return
    if (mode === "checkin")
      addStory(
        media
          ? {
              kind: media.kind,
              uri: media.uri,
              previewUri: media.previewUri,
              lqip: media.lqip,
              progress: check,
              audience,
            }
          : { kind: "progress", progress: check, audience },
      )
    else if (mode === "text")
      addStory({
        kind: "text",
        text: text.trim(),
        bg: BACKGROUNDS[bg],
        audience,
      })
    else if (mode === "media" && media)
      addStory({
        kind: media.kind,
        uri: media.uri,
        previewUri: media.previewUri,
        lqip: media.lqip,
        audience,
      })
    else if (progress) addStory({ kind: "progress", progress, audience })
    haptic.done()
    toast.success(
      mode === "checkin"
        ? audience === "close"
          ? "Checked in with close friends"
          : "Checked in"
        : audience === "close"
          ? "Shared with close friends"
          : "Added to your check-ins",
    )
    replace("/social")
  }
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: "#000", paddingTop: safe.top }}
    >
      {/* A tap anywhere outside the text closes the keyboard; the buttons
          inside still take their own taps. */}
      <Pressable
        accessible={false}
        onPress={Keyboard.dismiss}
        style={{ flex: 1 }}
      >
        <View
          style={{
            width,
            height,
            alignSelf: "center",
            borderRadius: 14,
            overflow: "hidden",
            backgroundColor: "#111",
          }}
        >
          {mode === "checkin" ? (
            media ? (
              <View style={{ width, height }}>
                {media.kind === "video" ? (
                  <VideoMedia
                    uri={media.uri}
                    active
                    style={{ width, height }}
                  />
                ) : (
                  <Image
                    source={{ uri: media.uri }}
                    resizeMode="cover"
                    style={{ width, height }}
                    accessibilityLabel="Check-in photo"
                  />
                )}
                <View
                  style={{
                    position: "absolute",
                    left: 16,
                    right: 16,
                    bottom: 20,
                  }}
                >
                  <CheckInOverlay progress={check} />
                </View>
              </View>
            ) : (
              <CheckInSlide progress={check} width={width} height={height} />
            )
          ) : mode === "media" && media ? (
            media.kind === "video" ? (
              <VideoMedia uri={media.uri} active style={{ width, height }} />
            ) : (
              <Image
                source={{ uri: media.uri }}
                resizeMode="cover"
                style={{ width, height }}
                accessibilityLabel="Story photo"
              />
            )
          ) : mode === "progress" ? (
            <LinearGradient
              colors={["#1b1b1b", "#000"]}
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {progress ? (
                <Animated.View
                  key={progress.title}
                  entering={FadeIn}
                  style={{ borderRadius: 24, overflow: "hidden" }}
                >
                  <ProgressCard
                    progress={progress}
                    width={width * 0.78}
                    height={width * 0.78 * 1.3}
                  />
                </Animated.View>
              ) : (
                <Text style={{ color: "#fff", fontFamily: fonts.medium }}>
                  Choose progress to share below
                </Text>
              )}
            </LinearGradient>
          ) : (
            <LinearGradient
              colors={BACKGROUNDS[bg]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ flex: 1, justifyContent: "center", padding: 28 }}
            >
              <TextInput
                value={text}
                onChangeText={(v) => setText(v.slice(0, 160))}
                autoFocus={Platform.OS !== "web"}
                multiline
                // Return closes the keyboard: a story is a line or two.
                returnKeyType="done"
                submitBehavior="blurAndSubmit"
                placeholder="Tap to type"
                placeholderTextColor="#ffffff99"
                accessibilityLabel="Story text"
                style={{
                  color: "#fff",
                  fontFamily: fonts.display,
                  fontSize: text.length > 80 ? 28 : 36,
                  textAlign: "center",
                }}
              />
            </LinearGradient>
          )}
          <View
            style={{
              position: "absolute",
              top: 10,
              left: 10,
              right: 10,
              flexDirection: "row",
              justifyContent: "space-between",
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={close}
              style={{
                width: 44,
                height: 44,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 22,
                backgroundColor: "#0006",
              }}
            >
              <X size={24} color="#fff" />
            </Pressable>
            {mode === "text" && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Change background"
                onPress={() => {
                  haptic.tap()
                  setBg((b) => (b + 1) % BACKGROUNDS.length)
                }}
                style={{
                  width: 44,
                  height: 44,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 22,
                  backgroundColor: "#0006",
                }}
              >
                <Palette size={22} color="#fff" />
              </Pressable>
            )}
          </View>
        </View>
        {mode === "progress" && (
          <Animated.View entering={FadeInDown} style={{ paddingTop: 10 }}>
            <ProgressPicker value={progress} onChange={setProgress} />
          </Animated.View>
        )}
        {mode === "checkin" && (
          <Animated.View entering={FadeInDown} style={{ paddingTop: 10 }}>
            <CheckInPicker value={check} onChange={setPicked} />
          </Animated.View>
        )}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0, flexShrink: 0 }}
          contentContainerStyle={{
            gap: 6,
            paddingVertical: 10,
            paddingHorizontal: 12,
          }}
        >
          {[
            {
              key: "checkin",
              label: "Check-in",
              Icon: CircleCheck,
              run: () => setMode("checkin"),
            },
            {
              key: "text",
              label: "Text",
              Icon: Type,
              run: () => setMode("text"),
            },
            {
              key: "library",
              label: "Library",
              Icon: Images,
              run: () => void pick(false),
            },
            {
              key: "camera",
              label: "Camera",
              Icon: Camera,
              run: () => void pick(true),
            },
            {
              key: "progress",
              label: "Stat card",
              Icon: Sparkles,
              run: () => setMode("progress"),
            },
          ].map(({ key, label, Icon, run }) => {
            const on =
              key === mode ||
              (key === "library" && mode === "media") ||
              (key === "library" && mode === "checkin" && !!media)
            return (
              <Pressable
                key={key}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={run}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  paddingHorizontal: 12,
                  minHeight: 36,
                  borderRadius: 18,
                  backgroundColor: on ? "#fff" : "#ffffff1f",
                }}
              >
                <Icon size={14} color={on ? "#000" : "#fff"} />
                <Text
                  style={{
                    color: on ? "#000" : "#fff",
                    fontFamily: fonts.semibold,
                    fontSize: 13,
                  }}
                >
                  {label}
                </Text>
              </Pressable>
            )
          })}
        </ScrollView>
        <View
          style={{
            flexDirection: "row",
            gap: 8,
            paddingHorizontal: 12,
            paddingBottom: Math.max(safe.bottom, 10),
            opacity: ready ? 1 : 0.5,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              mode === "checkin" ? "Check in" : "Share to your check-ins"
            }
            disabled={!ready}
            onPress={() => share("everyone")}
            style={{
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              minHeight: 48,
              paddingHorizontal: 10,
              borderRadius: 24,
              backgroundColor: "#ffffff26",
            }}
          >
            <Avatar id={ME} size={28} ring={false} />
            <Text style={{ color: "#fff", fontFamily: fonts.semibold }}>
              {mode === "checkin" ? "Check in" : "Your check-ins"}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Share to close friends"
            disabled={!ready}
            onPress={() => share("close")}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                minHeight: 48,
                paddingHorizontal: 14,
                borderRadius: 24,
                borderWidth: 1,
                borderColor: t.life,
                backgroundColor: "#ffffff1a",
              }}
            >
              <Star size={16} color={t.life} />
              <Text style={{ color: "#fff", fontFamily: fonts.semibold }}>
                Close friends
              </Text>
              <ChevronRight size={16} color="#fff" />
            </View>
          </Pressable>
        </View>
      </Pressable>
    </KeyboardAvoidingView>
  )
}
