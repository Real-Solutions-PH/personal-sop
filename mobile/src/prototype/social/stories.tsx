import { LinearGradient } from "expo-linear-gradient"
import { Eye, Plus, Send, Trash2, X } from "lucide-react-native"
import { useEffect, useMemo, useRef, useState } from "react"
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
import { Gesture, GestureDetector } from "react-native-gesture-handler"
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { toast } from "sonner-native"
import { liveMode } from "@/live/config"
import { back, go, replace } from "../navigation"
import { fonts } from "../theme"
import { confirm } from "../ui"
import {
  Avatar,
  CheckInOverlay,
  CheckInSlide,
  haptic,
  isCheckIn,
  LikeHeart,
  ProgressCard,
  VideoMedia,
} from "./kit"
import {
  deleteStory,
  directChat,
  liveStories,
  loadStoriesLive,
  ME,
  markSeen,
  type StoryItem,
  sendMessage,
  simulateReply,
  socialStore,
  storyGroups,
  timeAgo,
  toggleStoryLike,
  usePerson,
} from "./store"

const DURATION = { image: 5000, text: 6000, progress: 7000, video: 10000 }

function Bar({
  state,
  progress,
}: {
  state: -1 | 0 | 1
  progress: SharedValue<number>
}) {
  const style = useAnimatedStyle(() => ({
    width: `${(state === 0 ? progress.value : state < 0 ? 1 : 0) * 100}%`,
  }))
  return (
    <View
      style={{
        flex: 1,
        height: 2.5,
        borderRadius: 2,
        backgroundColor: "#ffffff55",
        overflow: "hidden",
      }}
    >
      <Animated.View
        style={[{ height: "100%", backgroundColor: "#fff" }, style]}
      />
    </View>
  )
}

/** A story slide, with its check-in (day N, what was done) laid over it. */
function Slide(props: {
  item: StoryItem
  width: number
  height: number
  playing: boolean
}) {
  const { item } = props
  const over = item.progress && item.kind !== "progress"
  return (
    <View>
      <SlideBody {...props} />
      {over && item.progress && (
        <View style={{ position: "absolute", left: 16, right: 16, bottom: 24 }}>
          <CheckInOverlay progress={item.progress} />
        </View>
      )}
    </View>
  )
}

function SlideBody({
  item,
  width,
  height,
  playing,
}: {
  item: StoryItem
  width: number
  height: number
  playing: boolean
}) {
  if (item.kind === "progress" && isCheckIn(item.progress) && item.progress)
    return (
      <CheckInSlide progress={item.progress} width={width} height={height} />
    )
  if (item.kind === "image" && item.uri)
    return (
      <Image
        source={{ uri: item.uri }}
        resizeMode="cover"
        style={{ width, height }}
        accessibilityLabel="Story photo"
      />
    )
  if (item.kind === "video" && item.uri)
    return (
      <VideoMedia
        uri={item.uri}
        active={playing}
        style={{ width, height }}
        showMute={false}
        loop={false}
      />
    )
  if (item.kind === "progress" && item.progress)
    return (
      <LinearGradient
        colors={["#111", "#000"]}
        style={{
          width,
          height,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <View style={{ borderRadius: 24, overflow: "hidden" }}>
          <ProgressCard
            progress={item.progress}
            width={width * 0.82}
            height={width * 0.82 * 1.3}
          />
        </View>
      </LinearGradient>
    )
  return (
    <LinearGradient
      colors={item.bg ?? ["#d62976", "#4f5bd5"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{
        width,
        height,
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
      }}
    >
      <Text
        style={{
          color: "#fff",
          fontFamily: fonts.display,
          fontSize: (item.text?.length ?? 0) > 80 ? 28 : 36,
          lineHeight: (item.text?.length ?? 0) > 80 ? 34 : 42,
          textAlign: "center",
        }}
      >
        {item.text}
      </Text>
    </LinearGradient>
  )
}

export function StoryViewer({ id }: { id: string }) {
  const safe = useSafeAreaInsets()
  const reduced = useReducedMotion()
  const { width: w, height: h } = useWindowDimensions()
  const width = Math.min(w, 520)
  const height = Math.min(h - safe.top - safe.bottom - 64, width * (16 / 9))
  // Freeze the group order when the viewer opens so marking stories seen
  // doesn't reshuffle the queue mid-viewing.
  const [groups, setGroups] = useState(() =>
    storyGroups(socialStore.get()).filter((g) => g.items.length),
  )
  const stories = socialStore.use((s) => s.stories)
  const seen = socialStore.use((s) => s.seen)
  const [gi, setGi] = useState(() =>
    Math.max(
      0,
      groups.findIndex((g) => g.id === id),
    ),
  )
  // Opened cold (a link or a reload in live mode): the tray loads after
  // mount, so take the first snapshot that has stories.
  useEffect(() => {
    if (groups.length || !stories.length) return
    const next = storyGroups(socialStore.get()).filter((g) => g.items.length)
    setGroups(next)
    setGi(
      Math.max(
        0,
        next.findIndex((g) => g.id === id),
      ),
    )
  }, [groups.length, stories.length, id])
  // My own check-ins: reload so "Seen by" counts who opened them since.
  useEffect(() => {
    if (id === ME) void loadStoriesLive()
  }, [id])
  const group = groups[gi]
  const items = useMemo(
    () =>
      group
        ? liveStories(stories)
            .filter((s) => s.by === group.id)
            .sort((a, b) => a.at - b.at)
        : [],
    [stories, group],
  )
  const [ii, setIi] = useState(() => {
    const first = items.findIndex((x) => !seen.includes(x.id))
    return first < 0 ? 0 : first
  })
  const item = items[Math.min(ii, items.length - 1)]
  const person = usePerson(group?.id ?? "")
  const [paused, setPaused] = useState(false)
  const [typing, setTyping] = useState(false)
  const [reply, setReply] = useState("")
  const progress = useSharedValue(0)
  const dx = useSharedValue(0)
  const dy = useSharedValue(0)
  const input = useRef<TextInput>(null)
  const close = () => back("/social")
  // Live mode shows the server's count; the prototype has no viewers to
  // count, so it shows a stand-in.
  const viewers = liveMode
    ? (item?.views ?? 0)
    : 3 + ((item?.id.charCodeAt(0) ?? 0) % 20)

  const nextGroup = () => {
    if (gi + 1 >= groups.length) return close()
    setGi(gi + 1)
    setIi(0)
  }
  const prevGroup = () => {
    if (gi === 0) return
    setGi(gi - 1)
    setIi(0)
  }
  const next = () => (ii + 1 < items.length ? setIi(ii + 1) : nextGroup())
  const prev = () => (ii > 0 ? setIi(ii - 1) : prevGroup())

  // Start/resume the progress timer for the current slide.
  const holding = paused || typing
  useEffect(() => {
    if (!item) return
    markSeen(item.id)
  }, [item])
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset per slide
  useEffect(() => {
    progress.value = 0
  }, [item?.id])
  // Keyed on the slide and pause state only; `next` is recreated each render
  // and would restart the timer.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    if (!item) return
    if (holding) {
      cancelAnimation(progress)
      return
    }
    const total = DURATION[item.kind]
    progress.value = withTiming(
      1,
      { duration: total * (1 - progress.value), easing: Easing.linear },
      (done) => {
        if (done) runOnJS(next)()
      },
    )
    return () => cancelAnimation(progress)
  }, [item?.id, holding])

  const sheet = useAnimatedStyle(() => ({
    transform: [
      { translateX: dx.value },
      { translateY: dy.value },
      { scale: 1 - Math.min(dy.value, 300) / 1500 },
      { perspective: 800 },
      { rotateY: reduced ? "0deg" : `${(dx.value / width) * -25}deg` },
    ],
    borderRadius: dy.value > 0 ? 16 : 12,
  }))
  if (!group || !item) {
    return <View style={{ flex: 1, backgroundColor: "#000" }} />
  }
  const mine = group.id === ME
  const tap = Gesture.Tap()
    .maxDuration(250)
    .onEnd((e) => {
      if (e.x < width * 0.3) runOnJS(prev)()
      else runOnJS(next)()
    })
  const hold = Gesture.LongPress()
    .minDuration(180)
    .onStart(() => runOnJS(setPaused)(true))
    .onFinalize(() => runOnJS(setPaused)(false))
  const pan = Gesture.Pan()
    .onStart(() => runOnJS(setPaused)(true))
    .onUpdate((e) => {
      if (Math.abs(e.translationX) > Math.abs(e.translationY))
        dx.value = e.translationX
      else dy.value = Math.max(0, e.translationY)
    })
    .onEnd((e) => {
      if (dy.value > 120 || e.velocityY > 900) {
        runOnJS(close)()
        return
      }
      if (e.translationY < -80 && !mine) runOnJS(setTyping)(true)
      if (dx.value < -width * 0.25) {
        dx.value = withTiming(-width, { duration: 160 }, () => {
          runOnJS(nextGroup)()
          dx.value = width * 0.3
          dx.value = withSpring(0)
        })
      } else if (dx.value > width * 0.25 && gi > 0) {
        dx.value = withTiming(width, { duration: 160 }, () => {
          runOnJS(prevGroup)()
          dx.value = -width * 0.3
          dx.value = withSpring(0)
        })
      } else dx.value = withSpring(0)
      dy.value = withSpring(0)
    })
    .onFinalize(() => runOnJS(setPaused)(false))
  const gesture = Gesture.Race(pan, Gesture.Exclusive(hold, tap))
  const sendReply = (text: string) => {
    const v = text.trim()
    if (!v) return
    const chat = directChat(group.id)
    sendMessage(chat, { text: v, storyReply: item.id })
    simulateReply(chat, 3000)
    haptic.done()
    toast.success(`Sent to ${person?.username}`)
    setReply("")
    setTyping(false)
    input.current?.blur()
  }
  return (
    <View style={{ flex: 1, backgroundColor: "#000", paddingTop: safe.top }}>
      <GestureDetector gesture={gesture}>
        <Animated.View
          style={[
            {
              width,
              height,
              alignSelf: "center",
              overflow: "hidden",
              backgroundColor: "#111",
            },
            sheet,
          ]}
        >
          <Slide item={item} width={width} height={height} playing={!holding} />
          <LinearGradient
            colors={["#0009", "#0000"]}
            pointerEvents="none"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 0,
              height: 120,
            }}
          />
          <View
            style={{
              position: "absolute",
              left: 8,
              right: 8,
              top: 8,
              gap: 10,
              opacity: paused ? 0 : 1,
            }}
          >
            <View style={{ flexDirection: "row", gap: 3 }}>
              {items.map((x, i) => (
                <Bar
                  key={x.id}
                  state={i < ii ? -1 : i === ii ? 0 : 1}
                  progress={progress}
                />
              ))}
            </View>
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
            >
              <Avatar
                id={group.id}
                size={32}
                ring={false}
                onPress={() => {
                  close()
                  go(`/social/u/${group.id}`)
                }}
              />
              <Text
                style={{
                  color: "#fff",
                  fontFamily: fonts.semibold,
                  fontSize: 14,
                }}
              >
                {mine ? "Your check-ins" : person?.username}
              </Text>
              <Text
                style={{
                  color: "#ffffffb3",
                  fontFamily: fonts.body,
                  fontSize: 13,
                }}
              >
                {timeAgo(item.at)}
              </Text>
              {item.audience === "close" && (
                <View
                  style={{
                    backgroundColor: "#1aa34a",
                    borderRadius: 8,
                    paddingHorizontal: 6,
                    paddingVertical: 1,
                  }}
                >
                  <Text
                    style={{
                      color: "#fff",
                      fontSize: 10,
                      fontFamily: fonts.bold,
                    }}
                  >
                    CLOSE FRIENDS
                  </Text>
                </View>
              )}
              <View style={{ flex: 1 }} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close stories"
                onPress={close}
                hitSlop={10}
                style={{ padding: 6 }}
              >
                <X size={26} color="#fff" />
              </Pressable>
            </View>
          </View>
        </Animated.View>
      </GestureDetector>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            paddingHorizontal: 12,
            paddingTop: 10,
            paddingBottom: Math.max(safe.bottom, 10),
            backgroundColor: "#000",
          }}
        >
          {mine ? (
            <>
              <Eye size={20} color="#fff" />
              <Text
                style={{ color: "#fff", flex: 1, fontFamily: fonts.medium }}
              >
                Seen by {viewers}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add a check-in"
                onPress={() => replace("/social/story-new")}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  minHeight: 40,
                  paddingHorizontal: 14,
                  borderRadius: 20,
                  backgroundColor: "#ffffff26",
                }}
              >
                <Plus size={18} color="#fff" />
                <Text style={{ color: "#fff", fontFamily: fonts.semibold }}>
                  Add check-in
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Delete check-in"
                onPress={() => {
                  setPaused(true)
                  confirm(
                    "Delete check-in?",
                    "It will be removed from your check-ins.",
                    () => {
                      deleteStory(item.id)
                      if (items.length <= 1) close()
                      else setIi(Math.max(0, ii - 1))
                    },
                  )
                }}
                style={{ padding: 8 }}
              >
                <Trash2 size={22} color="#fff" />
              </Pressable>
            </>
          ) : (
            <>
              <TextInput
                ref={input}
                value={reply}
                onChangeText={setReply}
                onFocus={() => setTyping(true)}
                onBlur={() => setTyping(false)}
                placeholder={`Reply to ${person?.username ?? ""}…`}
                placeholderTextColor="#ffffffb3"
                accessibilityLabel="Reply to story"
                returnKeyType="send"
                onSubmitEditing={() => sendReply(reply)}
                style={{
                  flex: 1,
                  minHeight: 44,
                  borderWidth: 1,
                  borderColor: "#ffffff80",
                  borderRadius: 22,
                  paddingHorizontal: 16,
                  color: "#fff",
                  fontFamily: fonts.body,
                }}
              />
              {typing ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Send reply"
                  onPress={() => sendReply(reply)}
                  style={{ padding: 8 }}
                >
                  <Send size={24} color="#fff" />
                </Pressable>
              ) : (
                <>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      item.liked ? "Unlike story" : "Like story"
                    }
                    onPress={() => {
                      haptic.pop()
                      toggleStoryLike(item.id)
                    }}
                    style={{ padding: 8 }}
                  >
                    <LikeHeart liked={!!item.liked} size={26} color="#fff" />
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Quick reaction"
                    onPress={() => sendReply("🔥")}
                    style={{ padding: 8 }}
                  >
                    <Text style={{ fontSize: 22 }}>🔥</Text>
                  </Pressable>
                </>
              )}
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </View>
  )
}
