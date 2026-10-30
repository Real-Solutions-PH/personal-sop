import { useFocusEffect } from "expo-router"
import {
  Bell,
  ChevronLeft,
  CircleCheck,
  Image as ImageIcon,
  MessageSquareQuote,
  Plus,
  PlusSquare,
  Search,
  Send,
} from "lucide-react-native"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  FlatList,
  Image,
  type ListViewToken,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native"
import { Gesture, GestureDetector } from "react-native-gesture-handler"
import Animated, {
  FadeInDown,
  FadeOut,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { liveMode } from "@/live/config"
import { back, go } from "../navigation"
import { LockedPreview } from "../screens/locked-preview"
import { fonts, useTheme } from "../theme"
import { Sheet } from "../ui"
import {
  Avatar,
  areaOf,
  Bounce,
  FEED_AREAS,
  type FeedArea,
  haptic,
  NoteComposer,
  ProgressCard,
} from "./kit"
import { PostCard } from "./post-card"
import {
  loadMoreFeed,
  ME,
  type Post,
  postingStore,
  refreshSocial,
  socialStore,
  storyGroups,
  unread,
} from "./store"

export function Badge({ count }: { count: number }) {
  const t = useTheme()
  if (!count) return null
  return (
    <View
      style={{
        position: "absolute",
        top: -2,
        right: -4,
        minWidth: 18,
        height: 18,
        paddingHorizontal: 4,
        borderRadius: 9,
        backgroundColor: "#ff3040",
        borderWidth: 2,
        borderColor: t.bg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: "#fff", fontSize: 10, fontFamily: fonts.bold }}>
        {count > 9 ? "9+" : count}
      </Text>
    </View>
  )
}

function PostingBanner() {
  const t = useTheme()
  const posting = postingStore((s) => s)
  const [done, setDone] = useState(false)
  const fill = useSharedValue(0)
  useEffect(() => {
    if (!posting) return
    setDone(false)
    fill.value = 0
    fill.value = withTiming(1, { duration: 1400 })
    const a = setTimeout(() => {
      setDone(true)
      haptic.done()
    }, 1450)
    const b = setTimeout(() => postingStore.setState(null), 3200)
    return () => {
      clearTimeout(a)
      clearTimeout(b)
    }
  }, [posting, fill])
  const bar = useAnimatedStyle(() => ({ width: `${fill.value * 100}%` }))
  if (!posting) return null
  return (
    <Animated.View
      entering={FadeInDown}
      exiting={FadeOut}
      accessibilityLiveRegion="polite"
      style={{ borderBottomWidth: 1, borderColor: t.line }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          padding: 12,
        }}
      >
        <View
          style={{
            width: 36,
            height: 44,
            borderRadius: 4,
            overflow: "hidden",
            backgroundColor: t.soft,
          }}
        >
          {posting.thumb ? (
            <Image
              source={{ uri: posting.thumb }}
              style={{ width: 36, height: 44 }}
            />
          ) : posting.progress ? (
            <ProgressCard
              progress={posting.progress}
              width={36}
              height={44}
              compact
            />
          ) : null}
        </View>
        <Text style={{ flex: 1, color: t.text, fontFamily: fonts.medium }}>
          {done ? "Posted! Your friends can see it now." : "Posting…"}
        </Text>
        {done && <CircleCheck size={20} color={t.good} />}
      </View>
      <Animated.View style={[{ height: 2, backgroundColor: t.tsk }, bar]} />
    </Animated.View>
  )
}

/** The latest check-in day a person has up: "Day 41", or null. */
const latestDay = (items: { progress?: { day?: number } }[]) =>
  [...items].reverse().find((i) => i.progress?.day)?.progress?.day ?? null

/** Today's check-ins: you first (tap to play yours, + to add one), then
 * friends with something new, each labelled with the day they're on. */
function CheckInTray() {
  const t = useTheme()
  const s = socialStore.use((s) => s)
  const groups = useMemo(() => storyGroups(s), [s])
  const mine = groups.find((g) => g.id === ME)
  const others = groups.filter((g) => g.id !== ME)
  const myDay = mine ? latestDay(mine.items) : null
  const caption = (top: string, day: number | null, strong: boolean) => (
    <View style={{ alignItems: "center", width: 76 }}>
      <Text
        numberOfLines={1}
        style={{
          fontSize: 12,
          color: strong ? t.text : t.muted,
          fontFamily: fonts.body,
        }}
      >
        {top}
      </Text>
      <Text
        numberOfLines={1}
        style={{
          fontSize: 11,
          lineHeight: 14,
          color: day ? t.life : "transparent",
          fontFamily: fonts.semibold,
        }}
      >
        {day ? `Day ${day}` : " "}
      </Text>
    </View>
  )
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{
        paddingHorizontal: 12,
        gap: 12,
        paddingVertical: 10,
      }}
      style={{ borderBottomWidth: 1, borderColor: t.line }}
    >
      <View style={{ alignItems: "center", width: 76, gap: 4 }}>
        <View>
          <Avatar
            id={ME}
            size={64}
            ring={!!mine}
            label={mine ? "Play your check-ins" : "Check in"}
            onPress={() =>
              go(mine ? `/social/stories/${ME}` : "/social/story-new")
            }
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add a check-in"
            onPress={() => go("/social/story-new")}
            hitSlop={4}
            style={{
              position: "absolute",
              right: -2,
              bottom: -2,
              width: 24,
              height: 24,
              borderRadius: 12,
              backgroundColor: t.primary,
              borderWidth: 2,
              borderColor: t.bg,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Plus size={14} color="#fff" strokeWidth={3} />
          </Pressable>
        </View>
        {caption(mine ? "You" : "Check in", myDay, true)}
      </View>
      {others.map((g) => (
        <View key={g.id} style={{ alignItems: "center", width: 76, gap: 4 }}>
          <Avatar
            id={g.id}
            size={64}
            onPress={() => go(`/social/stories/${g.id}`)}
          />
          {caption(
            s.people.find((p) => p.id === g.id)?.username ?? "",
            latestDay(g.items),
            g.unseen,
          )}
        </View>
      ))}
    </ScrollView>
  )
}

/** "Today", "Yesterday", or the weekday and date. */
function dayHeading(at: number, now = Date.now()) {
  const start = (x: number) => new Date(x).setHours(0, 0, 0, 0)
  const days = Math.round((start(now) - start(at)) / 86_400_000)
  if (days <= 0) return "Today"
  if (days === 1) return "Yesterday"
  return new Date(at).toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  })
}
const sameDay = (a: number, b: number) =>
  new Date(a).toDateString() === new Date(b).toDateString()

function DayDivider({ at, count }: { at: number; count: number }) {
  const t = useTheme()
  return (
    <View
      accessibilityRole="header"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 14,
        paddingTop: 8,
        paddingBottom: 4,
      }}
    >
      <Text style={{ color: t.text, fontFamily: fonts.semibold, fontSize: 14 }}>
        {dayHeading(at)}
      </Text>
      <View style={{ flex: 1, height: 1, backgroundColor: t.line }} />
      <Text style={{ color: t.muted, fontFamily: fonts.medium, fontSize: 12 }}>
        {count} {count === 1 ? "update" : "updates"}
      </Text>
    </View>
  )
}

/** A post card's frame, for the dimmed preview of an empty filter. */
function PostSkeleton({ width }: { width: number }) {
  const t = useTheme()
  const bar = (w: number | `${number}%`, h = 10) => (
    <View
      style={{
        width: w,
        height: h,
        borderRadius: h / 2,
        backgroundColor: t.soft,
      }}
    />
  )
  return (
    <View style={{ gap: 12, paddingBottom: 20 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingHorizontal: 12,
        }}
      >
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: t.soft,
          }}
        />
        <View style={{ gap: 6, flex: 1 }}>
          {bar("40%")}
          {bar("65%", 8)}
        </View>
      </View>
      <View style={{ width, height: width * 0.8, backgroundColor: t.soft }} />
      <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 12 }}>
        {[0, 1, 2].map((i) => (
          <View
            key={i}
            style={{
              flex: 1,
              height: 48,
              borderRadius: 14,
              backgroundColor: t.soft,
            }}
          />
        ))}
      </View>
    </View>
  )
}

export function CreateSheet({
  open,
  onClose,
  onNote,
}: {
  open: boolean
  onClose: () => void
  /** Note opens its sheet over this screen once this one is gone; without
   * it, Note is not offered. */
  onNote?: () => void
}) {
  const t = useTheme()
  // Opened once the Create sheet has fully closed: iOS will not present a
  // second sheet while the first is still dismissing.
  const pending = useRef<"note" | null>(null)
  const rows: {
    label: string
    detail: string
    Icon: typeof CircleCheck
    href?: string
    action?: () => void
  }[] = [
    {
      label: "Check in",
      detail: "Day 12 of 30, done today. Gone in 24 hours",
      Icon: CircleCheck,
      href: "/social/story-new",
    },
    {
      label: "Post",
      detail: "Photos, videos or the progress you logged",
      Icon: ImageIcon,
      href: "/social/compose",
    },
    {
      label: "Note",
      detail: "A short thought above your avatar",
      Icon: MessageSquareQuote,
      action: onNote
        ? () => {
            pending.current = "note"
          }
        : undefined,
    },
  ].filter((r) => r.href || r.action)
  return (
    <Sheet
      title="Create"
      open={open}
      onClose={onClose}
      onClosed={() => {
        const next = pending.current
        pending.current = null
        if (next === "note") onNote?.()
      }}
    >
      {rows.map(({ label, detail, Icon, href, action }) => (
        <Pressable
          cssInterop={false}
          key={label}
          accessibilityRole="button"
          accessibilityLabel={`${label}. ${detail}`}
          onPress={() => {
            action?.()
            onClose()
            if (href) go(href)
          }}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 14,
            paddingVertical: 12,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: 14,
              backgroundColor: t.soft,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon size={20} color={t.text} />
          </View>
          <View style={{ flex: 1 }}>
            <Text
              style={{
                color: t.text,
                fontFamily: fonts.semibold,
                fontSize: 16,
              }}
            >
              {label}
            </Text>
            <Text
              style={{ color: t.muted, fontFamily: fonts.body, fontSize: 13 }}
            >
              {detail}
            </Text>
          </View>
        </Pressable>
      ))}
    </Sheet>
  )
}

type Tab = "following" | "foryou"

export function SocialFeed() {
  const t = useTheme()
  const safe = useSafeAreaInsets()
  const reduced = useReducedMotion()
  const width = Math.min(useWindowDimensions().width, 600)
  const posts = socialStore.use((s) => s.posts)
  const chats = socialStore.use((s) => s.chats)
  const activity = socialStore.use((s) => s.activity)
  const readAt = socialStore.use((s) => s.activityReadAt)
  const [tab, setTab] = useState<Tab>("following")
  const [area, setArea] = useState<FeedArea | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [create, setCreate] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  const [visible, setVisible] = useState<string | null>(null)
  const [focused, setFocused] = useState(true)
  const list = useRef<FlatList<Post>>(null)
  useFocusEffect(
    useCallback(() => {
      setFocused(true)
      return () => setFocused(false)
    }, []),
  )
  const people = socialStore.use((s) => s.people)
  // Newest first on both tabs: cheers never lift a post above newer
  // progress, so nothing is ranked for reach.
  const data = useMemo(() => {
    const following = new Set(
      people.filter((p) => p.isFollowing).map((p) => p.id),
    )
    return [...posts]
      .sort((a, b) => b.at - a.at)
      .filter((p) => tab === "foryou" || p.by === ME || following.has(p.by))
      .filter((p) => !area || areaOf(p.progress) === area)
  }, [posts, people, tab, area])
  const perDay = useMemo(() => {
    const n = new Map<string, number>()
    for (const p of data) {
      const k = new Date(p.at).toDateString()
      n.set(k, (n.get(k) ?? 0) + 1)
    }
    return n
  }, [data])
  const dmCount = chats.filter((c) => !c.muted && unread(c) > 0).length
  const newActivity = activity.filter((a) => a.at > readAt).length
  const onViewable = useRef(
    ({ viewableItems }: { viewableItems: ListViewToken[] }) => {
      setVisible((viewableItems[0]?.item as Post | undefined)?.id ?? null)
    },
  ).current
  const refresh = () => {
    setRefreshing(true)
    haptic.tap()
    if (liveMode) void refreshSocial().finally(() => setRefreshing(false))
    else setTimeout(() => setRefreshing(false), 900)
  }
  // Swipe in from the right edge to open messages. Edge-only so swiping
  // through a photo carousel never navigates away.
  const swipe = Gesture.Pan()
    .hitSlop({ right: 0, width: 28 })
    .activeOffsetX(-24)
    .failOffsetY([-14, 14])
    .onEnd((e) => {
      if (e.translationX < -90 || e.velocityX < -700)
        runOnJS(go)("/social/inbox")
    })
  const chip = (
    key: string,
    label: string,
    on: boolean,
    onPress: () => void,
    role: "tab" | "button" = "button",
    tint?: string,
  ) => (
    <Pressable
      key={key}
      accessibilityRole={role}
      accessibilityState={{ selected: on }}
      onPress={() => {
        haptic.tap()
        onPress()
      }}
      style={{
        paddingHorizontal: 14,
        minHeight: 34,
        justifyContent: "center",
        borderRadius: 17,
        backgroundColor: on ? (tint ?? t.text) : t.soft,
      }}
    >
      <Text
        style={{
          color: on ? (tint ? "#fff" : t.bg) : t.text,
          fontFamily: fonts.semibold,
          fontSize: 13,
        }}
      >
        {label}
      </Text>
    </Pressable>
  )
  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: safe.top }}>
      <View
        style={{
          height: 56,
          flexDirection: "row",
          alignItems: "center",
          gap: 2,
          paddingLeft: 2,
          paddingRight: 6,
        }}
      >
        <Bounce
          label="Back"
          onPress={() => back("/today")}
          style={{ minWidth: 32 }}
        >
          <ChevronLeft size={26} color={t.text} />
        </Bounce>
        <Bounce label="Your profile" onPress={() => go(`/social/u/${ME}`)}>
          <Avatar id={ME} size={32} ring={false} />
        </Bounce>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Scroll to top"
          onPress={() =>
            list.current?.scrollToOffset({ offset: 0, animated: true })
          }
          style={{ flex: 1, paddingLeft: 6 }}
        >
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            style={{
              fontFamily: fonts.display,
              fontSize: 24,
              color: t.text,
              fontStyle: "italic",
              letterSpacing: -0.5,
            }}
          >
            Community
          </Text>
        </Pressable>
        <Bounce label="Create" onPress={() => setCreate(true)}>
          <PlusSquare size={23} color={t.text} />
        </Bounce>
        <Bounce label="Find people" onPress={() => go("/social/explore")}>
          <Search size={22} color={t.text} />
        </Bounce>
        <Bounce
          label={`Activity${newActivity ? `, ${newActivity} new` : ""}`}
          onPress={() => go("/social/activity")}
        >
          <Bell size={22} color={t.text} />
          {newActivity > 0 && (
            <View
              style={{
                position: "absolute",
                top: 0,
                right: 0,
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: "#ff3040",
              }}
            />
          )}
        </Bounce>
        <Bounce
          label={`Messages${dmCount ? `, ${dmCount} unread` : ""}`}
          onPress={() => go("/social/inbox")}
        >
          <Send size={22} color={t.text} />
          <Badge count={dmCount} />
        </Bounce>
      </View>
      <GestureDetector gesture={swipe}>
        <FlatList
          ref={list}
          data={data}
          keyExtractor={(p) => p.id}
          onViewableItemsChanged={onViewable}
          onEndReached={() => void loadMoreFeed(tab)}
          viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor={t.muted}
            />
          }
          ListHeaderComponent={
            <View>
              <PostingBanner />
              <CheckInTray />
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{
                  gap: 8,
                  paddingHorizontal: 12,
                  paddingVertical: 12,
                  alignItems: "center",
                }}
              >
                {chip(
                  "following",
                  "Friends",
                  tab === "following",
                  () => setTab("following"),
                  "tab",
                )}
                {chip(
                  "foryou",
                  "Everyone",
                  tab === "foryou",
                  () => setTab("foryou"),
                  "tab",
                )}
                <View
                  style={{
                    width: 1,
                    height: 20,
                    marginHorizontal: 4,
                    backgroundColor: t.line,
                  }}
                />
                {FEED_AREAS.map((a) =>
                  chip(
                    a.key,
                    a.label,
                    area === a.key,
                    () => setArea(area === a.key ? null : a.key),
                    "button",
                    t[a.accent],
                  ),
                )}
              </ScrollView>
            </View>
          }
          renderItem={({ item, index }) => (
            <Animated.View
              entering={
                reduced || index > 3
                  ? undefined
                  : FadeInDown.delay(index * 60).springify()
              }
            >
              {(index === 0 || !sameDay(data[index - 1].at, item.at)) && (
                <DayDivider
                  at={item.at}
                  count={perDay.get(new Date(item.at).toDateString()) ?? 0}
                />
              )}
              <PostCard
                post={item}
                width={width}
                active={focused && visible === item.id}
              />
            </Animated.View>
          )}
          ListEmptyComponent={
            <View style={{ paddingHorizontal: 12 }}>
              <LockedPreview
                locked
                title={
                  area
                    ? `No ${FEED_AREAS.find((a) => a.key === area)?.label.toLowerCase()} progress here yet`
                    : "No progress from friends yet"
                }
                detail={
                  tab === "following"
                    ? "Share yours, or look at what everyone is working on."
                    : "Share yours and it shows up here first."
                }
                action={{
                  label: "Share progress",
                  href: "/social/compose?progress=1",
                }}
              >
                <View style={{ marginHorizontal: -12 }}>
                  <PostSkeleton width={width} />
                </View>
              </LockedPreview>
            </View>
          }
          ListFooterComponent={
            data.length ? (
              <View
                style={{
                  alignItems: "center",
                  gap: 8,
                  paddingVertical: 32,
                  paddingHorizontal: 24,
                }}
              >
                <CircleCheck size={40} color={t.good} />
                <Text
                  style={{
                    color: t.text,
                    fontFamily: fonts.semibold,
                    fontSize: 16,
                  }}
                >
                  You're caught up
                </Text>
                <Text
                  style={{
                    color: t.muted,
                    fontFamily: fonts.body,
                    textAlign: "center",
                  }}
                >
                  That's everyone's progress for now. Your turn.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => go("/social/story-new")}
                  style={{
                    marginTop: 8,
                    minHeight: 40,
                    paddingHorizontal: 18,
                    borderRadius: 20,
                    justifyContent: "center",
                    backgroundColor: t.primary,
                  }}
                >
                  <Text style={{ color: "#fff", fontFamily: fonts.semibold }}>
                    Check in for today
                  </Text>
                </Pressable>
              </View>
            ) : undefined
          }
          contentContainerStyle={{ paddingBottom: safe.bottom + 64 }}
        />
      </GestureDetector>
      <CreateSheet
        open={create}
        onClose={() => setCreate(false)}
        onNote={() => setNoteOpen(true)}
      />
      <NoteComposer open={noteOpen} onClose={() => setNoteOpen(false)} />
    </View>
  )
}
