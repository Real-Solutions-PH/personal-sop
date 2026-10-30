import { useLocalSearchParams } from "expo-router"
import { Camera, Images, MapPin, Sparkles, X } from "lucide-react-native"
import { useEffect, useRef, useState } from "react"
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native"
import Animated, { FadeIn, FadeOut, ZoomIn } from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { toast } from "sonner-native"
import { back, replace } from "../navigation"
import { fonts, useTheme } from "../theme"
import { confirm, Toggle } from "../ui"
import { Avatar, Bounce, haptic, ProgressCard, VideoMedia } from "./kit"
import { pickMedia } from "./media"
import { useProgressSources } from "./sources"
import {
  addStory,
  clearDrafts,
  createPost,
  ME,
  type Media,
  type Progress,
  socialStore,
} from "./store"

const TAGS = [
  "#progress",
  "#consistency",
  "#legday",
  "#mealprep",
  "#running",
  "#habits",
  "#savings",
]
const PLACES = [
  "Home gym",
  "Anytime Fitness BGC",
  "UP Diliman Oval",
  "Rizal Park",
  "BGC High Street",
]

export function ProgressPicker({
  value,
  onChange,
}: {
  value?: Progress
  onChange: (p?: Progress) => void
}) {
  const t = useTheme()
  const sources = useProgressSources()
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 10, paddingHorizontal: 16 }}
    >
      {sources.map((p) => {
        const on = value?.kind === p.kind && value.title === p.title
        return (
          <Pressable
            cssInterop={false}
            key={p.kind + p.title}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`Attach ${p.kind}: ${p.title}`}
            onPress={() => {
              haptic.tap()
              onChange(on ? undefined : p)
            }}
            style={({ pressed }) => ({
              borderRadius: 14,
              overflow: "hidden",
              borderWidth: 2,
              borderColor: on ? t.text : "transparent",
              transform: [{ scale: pressed ? 0.96 : 1 }],
            })}
          >
            <ProgressCard progress={p} width={120} height={150} compact />
          </Pressable>
        )
      })}
      {!sources.length && (
        <Text style={{ color: t.muted, fontFamily: fonts.body }}>
          Log a workout, habit or meal to share progress.
        </Text>
      )}
    </ScrollView>
  )
}

export function Compose() {
  const t = useTheme()
  const safe = useSafeAreaInsets()
  const params = useLocalSearchParams<{ progress?: string }>()
  const width = Math.min(useWindowDimensions().width, 600)
  const draft = socialStore.use((s) => s.drafts.post)
  const [media, setMedia] = useState<Media[]>(draft?.media ?? [])
  const [progress, setProgress] = useState<Progress | undefined>(
    draft?.progress,
  )
  const [caption, setCaption] = useState(draft?.caption ?? "")
  const [location, setLocation] = useState("")
  const [toStory, setToStory] = useState(false)
  const [showProgress, setShowProgress] = useState(
    !!params.progress || !!draft?.progress,
  )
  const [page, setPage] = useState(0)
  // Live mode: the server's draft can arrive after the screen opens; take it
  // until the person starts editing.
  const touched = useRef(false)
  useEffect(() => {
    if (draft?.progress) setProgress(draft.progress)
    if (!draft || touched.current) return
    if (draft.caption) setCaption(draft.caption)
    if (draft.media?.length) setMedia(draft.media)
  }, [draft])
  const dirty = media.length > 0 || !!progress || caption.trim().length > 0
  const canShare = media.length > 0 || !!progress
  const add = async (camera: boolean) => {
    const picked = await pickMedia({ camera })
    if (picked.length) {
      haptic.tap()
      touched.current = true
      setMedia((m) => [...m, ...picked].slice(0, 10))
    }
  }
  const leave = () => {
    clearDrafts()
    back("/social")
  }
  const close = () =>
    dirty
      ? confirm(
          "Discard post?",
          "If you go back now, you'll lose this post.",
          leave,
        )
      : leave()
  const share = () => {
    if (!canShare) return
    createPost({
      caption: caption.trim(),
      media,
      progress,
      location: location.trim() || undefined,
    })
    if (toStory)
      addStory(
        progress
          ? { kind: "progress", progress }
          : {
              kind: media[0].kind === "video" ? "video" : "image",
              uri: media[0].uri,
            },
      )
    haptic.done()
    // The feed's Posting… banner confirms the post; only note the story.
    if (toStory) toast.success("Also added to your story")
    replace("/social")
  }
  const previewW = width - 32
  const pages = media.length + (progress ? 1 : 0)
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: t.bg, paddingTop: safe.top }}
    >
      <View
        style={{
          height: 52,
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 4,
          borderBottomWidth: 1,
          borderColor: t.line,
        }}
      >
        <Bounce label="Close" onPress={close} style={{ width: 44 }}>
          <X size={26} color={t.text} />
        </Bounce>
        <Text
          accessibilityRole="header"
          style={{
            flex: 1,
            fontFamily: fonts.semibold,
            fontSize: 17,
            color: t.text,
          }}
        >
          New post
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !canShare }}
          disabled={!canShare}
          onPress={share}
          style={{
            paddingHorizontal: 14,
            minHeight: 44,
            justifyContent: "center",
          }}
        >
          <Text
            style={{
              color: canShare ? t.tsk : t.muted,
              fontFamily: fonts.bold,
              fontSize: 16,
            }}
          >
            Share
          </Text>
        </Pressable>
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: safe.bottom + 32, gap: 16 }}
      >
        {pages > 0 ? (
          <View style={{ paddingTop: 16 }}>
            <ScrollView
              horizontal
              pagingEnabled
              snapToInterval={previewW + 8}
              decelerationRate="fast"
              showsHorizontalScrollIndicator={false}
              onScroll={(e) =>
                setPage(
                  Math.round(e.nativeEvent.contentOffset.x / (previewW + 8)),
                )
              }
              scrollEventThrottle={32}
              contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
            >
              {media.map((m, i) => (
                <Animated.View
                  key={m.uri + i}
                  entering={ZoomIn.springify()}
                  exiting={FadeOut}
                  style={{
                    width: previewW,
                    height: previewW * 1.25,
                    borderRadius: 16,
                    overflow: "hidden",
                    backgroundColor: t.soft,
                  }}
                >
                  {m.kind === "video" ? (
                    <VideoMedia
                      uri={m.uri}
                      active={page === i}
                      style={{ width: "100%", height: "100%" }}
                    />
                  ) : (
                    <Image
                      source={{ uri: m.uri }}
                      resizeMode={
                        m.ratio && m.ratio < 0.75 ? "contain" : "cover"
                      }
                      style={{
                        width: "100%",
                        height: "100%",
                        backgroundColor:
                          m.ratio && m.ratio < 0.75 ? "#000" : undefined,
                      }}
                      accessibilityLabel={`Selected photo ${i + 1}`}
                    />
                  )}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove item ${i + 1}`}
                    onPress={() => {
                      touched.current = true
                      setMedia((x) => x.filter((_, j) => j !== i))
                    }}
                    style={{
                      position: "absolute",
                      top: 10,
                      right: 10,
                      width: 32,
                      height: 32,
                      borderRadius: 16,
                      backgroundColor: "#000a",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <X size={16} color="#fff" />
                  </Pressable>
                </Animated.View>
              ))}
              {progress && (
                <Animated.View
                  entering={ZoomIn.springify()}
                  style={{ borderRadius: 16, overflow: "hidden" }}
                >
                  <ProgressCard
                    progress={progress}
                    width={previewW}
                    height={previewW * 1.25}
                  />
                </Animated.View>
              )}
            </ScrollView>
            {pages > 1 && (
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "center",
                  gap: 4,
                  marginTop: 10,
                }}
              >
                {Array.from({ length: pages }, (_, i) => (
                  <View
                    key={i}
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: i === page ? t.tsk : t.line,
                    }}
                  />
                ))}
              </View>
            )}
          </View>
        ) : (
          <Animated.View entering={FadeIn} style={{ margin: 16 }}>
            <Pressable
              cssInterop={false}
              accessibilityRole="button"
              accessibilityLabel="Add photos or videos from your library"
              onPress={() => void add(false)}
              style={({ pressed }) => ({
                height: 220,
                borderRadius: 20,
                borderWidth: 1.5,
                borderStyle: "dashed",
                borderColor: t.line,
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Images size={36} color={t.muted} />
              <Text
                style={{
                  color: t.text,
                  fontFamily: fonts.semibold,
                  fontSize: 16,
                }}
              >
                Add photos, videos or progress
              </Text>
              <Text
                style={{ color: t.muted, fontFamily: fonts.body, fontSize: 13 }}
              >
                Tap to add up to 10 photos or videos.
              </Text>
            </Pressable>
          </Animated.View>
        )}
        <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 16 }}>
          {[
            { label: "Library", Icon: Images, run: () => void add(false) },
            { label: "Camera", Icon: Camera, run: () => void add(true) },
            {
              label: "Progress",
              Icon: Sparkles,
              run: () => setShowProgress((v) => !v),
              on: showProgress,
            },
          ].map(({ label, Icon, run, on }) => (
            <Pressable
              cssInterop={false}
              key={label}
              accessibilityRole="button"
              accessibilityState={{
                expanded: label === "Progress" ? !!on : undefined,
              }}
              onPress={run}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: 44,
                borderRadius: 12,
                flexDirection: "row",
                gap: 6,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: on ? t.text : t.soft,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Icon size={16} color={on ? t.bg : t.text} />
              <Text
                style={{
                  color: on ? t.bg : t.text,
                  fontFamily: fonts.semibold,
                  fontSize: 14,
                }}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
        {showProgress && (
          <Animated.View entering={FadeIn} style={{ gap: 8 }}>
            <Text
              style={{
                color: t.muted,
                fontFamily: fonts.medium,
                fontSize: 12,
                paddingHorizontal: 16,
                letterSpacing: 0.6,
              }}
            >
              ATTACH YOUR PROGRESS
            </Text>
            <ProgressPicker value={progress} onChange={setProgress} />
          </Animated.View>
        )}
        <View
          style={{
            flexDirection: "row",
            gap: 12,
            paddingHorizontal: 16,
            alignItems: "flex-start",
          }}
        >
          <Avatar id={ME} size={36} ring={false} />
          <TextInput
            value={caption}
            onChangeText={(v) => {
              touched.current = true
              setCaption(v.slice(0, 2200))
            }}
            placeholder="Write a caption…"
            placeholderTextColor={t.muted}
            accessibilityLabel="Caption"
            multiline
            style={{
              flex: 1,
              minHeight: 80,
              color: t.text,
              fontFamily: fonts.body,
              fontSize: 16,
              textAlignVertical: "top",
              paddingTop: 6,
            }}
          />
        </View>
        <Text
          style={{
            color: t.muted,
            fontSize: 11,
            alignSelf: "flex-end",
            paddingHorizontal: 16,
            fontFamily: fonts.body,
          }}
        >
          {caption.length}/2,200
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 6, paddingHorizontal: 16 }}
        >
          {TAGS.map((tag) => (
            <Pressable
              key={tag}
              accessibilityRole="button"
              accessibilityLabel={`Add ${tag}`}
              onPress={() => {
                touched.current = true
                setCaption((c) =>
                  c.includes(tag)
                    ? c
                    : `${c}${c && !c.endsWith(" ") ? " " : ""}${tag} `,
                )
              }}
              style={{
                paddingHorizontal: 12,
                minHeight: 32,
                borderRadius: 16,
                justifyContent: "center",
                backgroundColor: t.soft,
              }}
            >
              <Text
                style={{ color: t.tsk, fontFamily: fonts.medium, fontSize: 13 }}
              >
                {tag}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        <View
          style={{
            borderTopWidth: 1,
            borderColor: t.line,
            marginHorizontal: 16,
            paddingTop: 12,
            gap: 10,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <MapPin size={18} color={t.text} />
            <TextInput
              value={location}
              onChangeText={setLocation}
              placeholder="Add location"
              placeholderTextColor={t.muted}
              accessibilityLabel="Location"
              style={{
                flex: 1,
                minHeight: 40,
                color: t.text,
                fontFamily: fonts.body,
                fontSize: 15,
              }}
            />
          </View>
          {!location && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 6 }}
            >
              {PLACES.map((p) => (
                <Pressable
                  key={p}
                  accessibilityRole="button"
                  onPress={() => setLocation(p)}
                  style={{
                    paddingHorizontal: 12,
                    minHeight: 32,
                    borderRadius: 16,
                    justifyContent: "center",
                    borderWidth: 1,
                    borderColor: t.line,
                  }}
                >
                  <Text
                    style={{
                      color: t.text,
                      fontFamily: fonts.body,
                      fontSize: 13,
                    }}
                  >
                    {p}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
          <Toggle
            label="Also share to your story"
            value={toStory}
            onChange={setToStory}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
