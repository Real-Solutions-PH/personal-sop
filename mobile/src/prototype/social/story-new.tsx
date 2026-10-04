import { LinearGradient } from "expo-linear-gradient"
import {
  Camera,
  ChevronRight,
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
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native"
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { toast } from "sonner-native"
import { back, replace } from "../navigation"
import { fonts } from "../theme"
import { ProgressPicker } from "./compose"
import { Avatar, CLOSE, haptic, ProgressCard, VideoMedia } from "./kit"
import { pickMedia } from "./media"
import {
  addStory,
  clearDrafts,
  ME,
  type Media,
  type Progress,
  socialStore,
} from "./store"

const BACKGROUNDS: [string, string][] = [
  ["#d62976", "#4f5bd5"],
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
  const height = Math.min(h - safe.top - safe.bottom - 150, width * (16 / 9))
  const draft = socialStore.use((s) => s.drafts.story)
  const [mode, setMode] = useState<"text" | "media" | "progress">(
    draft?.progress ? "progress" : "text",
  )
  const [media, setMedia] = useState<Media | null>(null)
  const [progress, setProgress] = useState<Progress | undefined>(
    draft?.progress,
  )
  const [text, setText] = useState("")
  const [bg, setBg] = useState(0)
  const ready =
    (mode === "text" && text.trim()) ||
    (mode === "media" && media) ||
    (mode === "progress" && progress)
  const pick = async (camera: boolean) => {
    const [m] = await pickMedia({ camera, multiple: false })
    if (m) {
      setMedia(m)
      setMode("media")
    }
  }
  const close = () => {
    clearDrafts()
    back("/social")
  }
  const share = (audience: "everyone" | "close") => {
    if (!ready) return
    if (mode === "text")
      addStory({
        kind: "text",
        text: text.trim(),
        bg: BACKGROUNDS[bg],
        audience,
      })
    else if (mode === "media" && media)
      addStory({ kind: media.kind, uri: media.uri, audience })
    else if (progress) addStory({ kind: "progress", progress, audience })
    haptic.done()
    toast.success(
      audience === "close"
        ? "Shared with close friends"
        : "Added to your story",
    )
    replace("/social")
  }
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: "#000", paddingTop: safe.top }}
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
        {mode === "media" && media ? (
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
            style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
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
      <View
        style={{
          flexDirection: "row",
          justifyContent: "center",
          gap: 6,
          paddingVertical: 10,
        }}
      >
        {[
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
            label: "Progress",
            Icon: Sparkles,
            run: () => setMode("progress"),
          },
        ].map(({ key, label, Icon, run }) => {
          const on = key === mode || (key === "library" && mode === "media")
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
      </View>
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
          accessibilityLabel="Share to your story"
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
            Your story
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Share to close friends"
          disabled={!ready}
          onPress={() => share("close")}
        >
          <LinearGradient
            colors={CLOSE}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              minHeight: 48,
              paddingHorizontal: 14,
              borderRadius: 24,
            }}
          >
            <Star size={16} color="#fff" fill="#fff" />
            <Text style={{ color: "#fff", fontFamily: fonts.semibold }}>
              Close friends
            </Text>
            <ChevronRight size={16} color="#fff" />
          </LinearGradient>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  )
}
