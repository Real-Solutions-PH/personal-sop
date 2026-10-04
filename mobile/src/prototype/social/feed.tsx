import { useFocusEffect } from "expo-router"
import {
  Camera,
  CircleCheck,
  Heart,
  Image as ImageIcon,
  MessageSquareQuote,
  PlusSquare,
  Search,
  Send,
  Sparkles,
} from "lucide-react-native"
import { useCallback, useMemo, useRef, useState } from "react"
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
  type ViewToken,
} from "react-native"
import { Gesture, GestureDetector } from "react-native-gesture-handler"
import Animated, {
  FadeInDown,
  LinearTransition,
  runOnJS,
  useReducedMotion,
} from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { go } from "../navigation"
import { fonts, useTheme } from "../theme"
import { Sheet } from "../ui"
import { Avatar, Bounce, haptic } from "./kit"
import { PostCard } from "./post-card"
import { ME, type Post, socialStore, storyGroups, unread, useMe } from "./store"

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

function StoryTray() {
  const t = useTheme()
  const s = socialStore.use((s) => s)
  const me = useMe()
  const groups = useMemo(() => storyGroups(s), [s])
  const mine = groups.find((g) => g.id === ME)
  const others = groups.filter((g) => g.id !== ME)
  const label = (id: string) =>
    id === ME
      ? "Your story"
      : (s.people.find((p) => p.id === id)?.username ?? "")
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{
        paddingHorizontal: 10,
        gap: 12,
        paddingVertical: 8,
      }}
      style={{ borderBottomWidth: 1, borderColor: t.line }}
    >
      <View style={{ alignItems: "center", width: 76, gap: 4 }}>
        <View>
          <Avatar
            id={ME}
            size={64}
            ring={!!mine}
            onPress={() =>
              go(mine ? `/social/stories/${ME}` : "/social/story-new")
            }
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add to your story"
            onPress={() => go("/social/story-new")}
            hitSlop={8}
            style={{
              position: "absolute",
              right: 0,
              bottom: 0,
              width: 24,
              height: 24,
              borderRadius: 12,
              backgroundColor: t.tsk,
              borderWidth: 2,
              borderColor: t.bg,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text
              style={{
                color: "#fff",
                fontSize: 16,
                lineHeight: 18,
                fontFamily: fonts.bold,
              }}
            >
              +
            </Text>
          </Pressable>
        </View>
        <Text
          numberOfLines={1}
          style={{ fontSize: 12, color: t.muted, fontFamily: fonts.body }}
        >
          {mine ? me.username : "Your story"}
        </Text>
      </View>
      {others.map((g) => (
        <View key={g.id} style={{ alignItems: "center", width: 76, gap: 4 }}>
          <Avatar
            id={g.id}
            size={64}
            onPress={() => go(`/social/stories/${g.id}`)}
          />
          <Text
            numberOfLines={1}
            style={{
              fontSize: 12,
              color: g.unseen ? t.text : t.muted,
              fontFamily: fonts.body,
            }}
          >
            {label(g.id)}
          </Text>
        </View>
      ))}
    </ScrollView>
  )
}

export function CreateSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const t = useTheme()
  const rows = [
    {
      label: "Post",
      detail: "Photos, videos and progress",
      Icon: ImageIcon,
      href: "/social/compose",
    },
    {
      label: "Story",
      detail: "Disappears after 24 hours",
      Icon: Camera,
      href: "/social/story-new",
    },
    {
      label: "Share progress",
      detail: "Workout, streaks, scores, savings",
      Icon: Sparkles,
      href: "/social/compose?progress=1",
    },
    {
      label: "Note",
      detail: "A short thought above your avatar",
      Icon: MessageSquareQuote,
      href: "/social/inbox?note=1",
    },
  ]
  return (
    <Sheet title="Create" open={open} onClose={onClose}>
      {rows.map(({ label, detail, Icon, href }) => (
        <Pressable
          key={label}
          accessibilityRole="button"
          accessibilityLabel={`${label}. ${detail}`}
          onPress={() => {
            onClose()
            go(href)
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

export function SocialFeed() {
  const t = useTheme()
  const safe = useSafeAreaInsets()
  const reduced = useReducedMotion()
  const width = Math.min(useWindowDimensions().width, 600)
  const posts = socialStore.use((s) => s.posts)
  const chats = socialStore.use((s) => s.chats)
  const activity = socialStore.use((s) => s.activity)
  const readAt = socialStore.use((s) => s.activityReadAt)
  const [tab, setTab] = useState<"following" | "foryou">("following")
  const [refreshing, setRefreshing] = useState(false)
  const [create, setCreate] = useState(false)
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
  const data = useMemo(() => {
    const following = new Set(
      people.filter((p) => p.isFollowing).map((p) => p.id),
    )
    const sorted = [...posts].sort((a, b) => b.at - a.at)
    return tab === "following"
      ? sorted.filter((p) => p.by === ME || following.has(p.by))
      : [...sorted].sort((a, b) => b.likes - a.likes)
  }, [posts, people, tab])
  const dmCount = chats.filter((c) => !c.muted && unread(c) > 0).length
  const newActivity = activity.filter((a) => a.at > readAt).length
  const onViewable = useRef(
    ({ viewableItems }: { viewableItems: ViewToken<Post>[] }) => {
      setVisible(viewableItems[0]?.item?.id ?? null)
    },
  ).current
  const refresh = () => {
    setRefreshing(true)
    haptic.tap()
    setTimeout(() => setRefreshing(false), 900)
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
  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: safe.top }}>
      <View
        style={{
          height: 52,
          flexDirection: "row",
          alignItems: "center",
          paddingLeft: 16,
          paddingRight: 6,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Scroll to top"
          onPress={() =>
            list.current?.scrollToOffset({ offset: 0, animated: true })
          }
          style={{ flex: 1 }}
        >
          <Text
            accessibilityRole="header"
            style={{
              fontFamily: fonts.display,
              fontSize: 28,
              color: t.text,
              fontStyle: "italic",
              letterSpacing: -0.5,
            }}
          >
            Community
          </Text>
        </Pressable>
        <Bounce label="Create" onPress={() => setCreate(true)}>
          <PlusSquare size={24} color={t.text} />
        </Bounce>
        <Bounce label="Search" onPress={() => go("/social/explore")}>
          <Search size={23} color={t.text} />
        </Bounce>
        <Bounce
          label={`Activity${newActivity ? `, ${newActivity} new` : ""}`}
          onPress={() => go("/social/activity")}
        >
          <Heart size={24} color={t.text} />
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
          <Send size={23} color={t.text} />
          <Badge count={dmCount} />
        </Bounce>
      </View>
      <GestureDetector gesture={swipe}>
        <FlatList
          ref={list}
          data={data}
          keyExtractor={(p) => p.id}
          onViewableItemsChanged={onViewable}
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
              <StoryTray />
              <View style={{ flexDirection: "row", gap: 8, padding: 12 }}>
                {(
                  [
                    ["following", "Following"],
                    ["foryou", "For you"],
                  ] as const
                ).map(([k, label]) => (
                  <Pressable
                    key={k}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: tab === k }}
                    onPress={() => {
                      haptic.tap()
                      setTab(k)
                    }}
                    style={{
                      paddingHorizontal: 14,
                      minHeight: 34,
                      justifyContent: "center",
                      borderRadius: 17,
                      backgroundColor: tab === k ? t.text : t.soft,
                    }}
                  >
                    <Text
                      style={{
                        color: tab === k ? t.bg : t.text,
                        fontFamily: fonts.semibold,
                        fontSize: 13,
                      }}
                    >
                      {label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          }
          renderItem={({ item, index }) => (
            <Animated.View
              entering={
                reduced || index > 3
                  ? undefined
                  : FadeInDown.delay(index * 60).springify()
              }
              layout={reduced ? undefined : LinearTransition}
            >
              <PostCard
                post={item}
                width={width}
                active={focused && visible === item.id}
              />
            </Animated.View>
          )}
          ListFooterComponent={
            <View style={{ alignItems: "center", gap: 6, paddingVertical: 32 }}>
              <CircleCheck size={40} color={t.good} />
              <Text
                style={{
                  color: t.text,
                  fontFamily: fonts.semibold,
                  fontSize: 16,
                }}
              >
                You're all caught up
              </Text>
              <Text style={{ color: t.muted, fontFamily: fonts.body }}>
                You've seen all new posts from the past 3 days.
              </Text>
            </View>
          }
          contentContainerStyle={{ paddingBottom: safe.bottom + 24 }}
        />
      </GestureDetector>
      <CreateSheet open={create} onClose={() => setCreate(false)} />
    </View>
  )
}
