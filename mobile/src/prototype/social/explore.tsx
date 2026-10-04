import { useFocusEffect, useLocalSearchParams } from "expo-router"
import { Layers, Search, Trophy, Video, X } from "lucide-react-native"
import { useCallback, useMemo, useState } from "react"
import {
  FlatList,
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native"
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { back, go } from "../navigation"
import { fonts, useTheme } from "../theme"
import { Empty } from "../ui"
import { Avatar, Bounce, ProgressCard } from "./kit"
import { TopBar } from "./post"
import { FollowButton } from "./profile"
import { useMyScorecard } from "./sources"
import {
  type Activity,
  agoText,
  ME,
  markActivityRead,
  type Post,
  socialStore,
  usePerson,
} from "./store"

function Leaderboard() {
  const t = useTheme()
  const people = socialStore.use((s) => s.people)
  const mine = useMyScorecard()
  const rows = useMemo(
    () =>
      [
        { id: ME, life: mine.life, streak: mine.streak },
        ...people
          .filter((p) => p.isFollowing && p.card)
          .map((p) => ({
            id: p.id,
            life: p.card!.life,
            streak: p.card!.streak,
          })),
      ].sort((a, b) => b.life - a.life),
    [people, mine],
  )
  return (
    <View
      style={{
        marginHorizontal: 12,
        padding: 14,
        borderRadius: 18,
        backgroundColor: t.card,
        borderWidth: 1,
        borderColor: t.line,
        gap: 8,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Trophy size={18} color={t.life} />
        <Text
          style={{
            color: t.text,
            fontFamily: fonts.semibold,
            fontSize: 15,
            flex: 1,
          }}
        >
          Friends leaderboard
        </Text>
        <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 12 }}>
          Life score · 30d
        </Text>
      </View>
      {rows.map((r, i) => (
        <LeaderRow key={r.id} rank={i + 1} {...r} />
      ))}
    </View>
  )
}
function LeaderRow({
  id,
  rank,
  life,
  streak,
}: {
  id: string
  rank: number
  life: number
  streak: number
}) {
  const t = useTheme()
  const p = usePerson(id)
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => go(`/social/u/${id}`)}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingVertical: 4,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Text
        style={{
          width: 20,
          color: rank <= 3 ? t.life : t.muted,
          fontFamily: fonts.display,
          fontSize: 16,
        }}
      >
        {rank}
      </Text>
      <Avatar id={id} size={32} ring={false} />
      <Text
        numberOfLines={1}
        style={{
          flex: 1,
          color: t.text,
          fontFamily: id === ME ? fonts.bold : fonts.medium,
        }}
      >
        {id === ME ? "You" : p?.username}
      </Text>
      <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 12 }}>
        🔥 {streak}d
      </Text>
      <Text
        style={{
          width: 36,
          textAlign: "right",
          color: t.text,
          fontFamily: fonts.display,
          fontSize: 18,
        }}
      >
        {life}
      </Text>
    </Pressable>
  )
}

function Mosaic({ posts, width }: { posts: Post[]; width: number }) {
  const t = useTheme()
  const s = (width - 2) / 3
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 1 }}>
      {posts.map((p, i) => {
        const big = i % 10 === 2
        const w = big ? s * 2 + 1 : s
        const h = big ? s * 2 + 1 : s
        const m = p.media[0]
        return (
          <Pressable
            key={p.id}
            accessibilityRole="button"
            accessibilityLabel={p.caption || "Post"}
            onPress={() => go(`/social/post/${p.id}`)}
            style={{ width: w, height: h, backgroundColor: t.soft }}
          >
            {m?.kind === "image" ? (
              <Image
                source={{ uri: m.uri }}
                style={{ width: "100%", height: "100%" }}
              />
            ) : p.progress ? (
              <ProgressCard
                progress={p.progress}
                width={w}
                height={h}
                compact
              />
            ) : (
              <View style={{ flex: 1, backgroundColor: "#111" }} />
            )}
            <View style={{ position: "absolute", top: 6, right: 6 }}>
              {m?.kind === "video" ? (
                <Video size={16} color="#fff" fill="#fff" />
              ) : p.media.length > 1 ? (
                <Layers size={16} color="#fff" />
              ) : null}
            </View>
          </Pressable>
        )
      })}
    </View>
  )
}

export function Explore() {
  const t = useTheme()
  const safe = useSafeAreaInsets()
  const width = Math.min(useWindowDimensions().width, 600)
  const params = useLocalSearchParams<{ q?: string }>()
  const [q, setQ] = useState(params.q ?? "")
  const people = socialStore.use((s) => s.people)
  const posts = socialStore.use((s) => s.posts)
  const query = q.trim().toLowerCase()
  const tag = query.startsWith("#") ? query : null
  const results =
    query && !tag
      ? people.filter(
          (p) =>
            p.name.toLowerCase().includes(query) ||
            p.username.includes(query.replace(/^@/, "")),
        )
      : []
  const tagged = tag
    ? posts.filter((p) => p.caption.toLowerCase().includes(tag))
    : []
  const suggested = people.filter((p) => !p.isFollowing)
  const mosaic = useMemo(
    () => [...posts].sort((a, b) => b.likes - a.likes),
    [posts],
  )
  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: safe.top }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          padding: 8,
        }}
      >
        <View
          style={{
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingHorizontal: 12,
            borderRadius: 12,
            backgroundColor: t.soft,
            minHeight: 40,
          }}
        >
          <Search size={16} color={t.muted} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Search people or #tags"
            placeholderTextColor={t.muted}
            accessibilityLabel="Search"
            autoCapitalize="none"
            style={{
              flex: 1,
              color: t.text,
              fontFamily: fonts.body,
              minHeight: 40,
            }}
          />
          {!!q && (
            <Bounce
              label="Clear search"
              onPress={() => setQ("")}
              style={{ minWidth: 28, minHeight: 28 }}
            >
              <X size={16} color={t.muted} />
            </Bounce>
          )}
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => back("/social")}
          style={{
            paddingHorizontal: 8,
            minHeight: 44,
            justifyContent: "center",
          }}
        >
          <Text style={{ color: t.text, fontFamily: fonts.semibold }}>
            Cancel
          </Text>
        </Pressable>
      </View>
      {query ? (
        tag ? (
          <ScrollView>
            <Text
              style={{
                color: t.text,
                fontFamily: fonts.display,
                fontSize: 24,
                padding: 16,
              }}
            >
              {tag}
            </Text>
            <Text
              style={{
                color: t.muted,
                fontFamily: fonts.body,
                paddingHorizontal: 16,
                paddingBottom: 12,
              }}
            >
              {tagged.length} posts
            </Text>
            {tagged.length ? (
              <Mosaic posts={tagged} width={width} />
            ) : (
              <Empty title="No posts with this tag yet" />
            )}
          </ScrollView>
        ) : (
          <FlatList
            data={results}
            keyExtractor={(p) => p.id}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <Empty
                title="No people found"
                detail="Try a different name or username."
                icon={Search}
              />
            }
            renderItem={({ item }) => (
              <Animated.View entering={FadeIn}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => go(`/social/u/${item.id}`)}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    paddingHorizontal: 16,
                    paddingVertical: 8,
                    backgroundColor: pressed ? t.soft : t.bg,
                  })}
                >
                  <Avatar id={item.id} size={48} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: t.text, fontFamily: fonts.semibold }}>
                      {item.username}
                    </Text>
                    <Text
                      style={{
                        color: t.muted,
                        fontFamily: fonts.body,
                        fontSize: 13,
                      }}
                    >
                      {item.name}
                      {item.isFollowing ? " · Following" : ""}
                    </Text>
                  </View>
                </Pressable>
              </Animated.View>
            )}
          />
        )
      ) : (
        <ScrollView
          contentContainerStyle={{ gap: 16, paddingBottom: safe.bottom + 24 }}
          keyboardShouldPersistTaps="handled"
        >
          <Leaderboard />
          {suggested.length > 0 && (
            <View style={{ gap: 8 }}>
              <Text
                style={{
                  color: t.text,
                  fontFamily: fonts.semibold,
                  fontSize: 15,
                  paddingHorizontal: 16,
                }}
              >
                Suggested for you
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 10, paddingHorizontal: 12 }}
              >
                {suggested.map((p, i) => (
                  <Animated.View key={p.id} entering={FadeInDown.delay(i * 60)}>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => go(`/social/u/${p.id}`)}
                      style={{
                        width: 150,
                        padding: 14,
                        borderRadius: 16,
                        borderWidth: 1,
                        borderColor: t.line,
                        backgroundColor: t.card,
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <Avatar id={p.id} size={64} ring={false} />
                      <Text
                        numberOfLines={1}
                        style={{ color: t.text, fontFamily: fonts.semibold }}
                      >
                        {p.name}
                      </Text>
                      <Text
                        numberOfLines={2}
                        style={{
                          color: t.muted,
                          fontFamily: fonts.body,
                          fontSize: 12,
                          textAlign: "center",
                          minHeight: 32,
                        }}
                      >
                        {p.bio}
                      </Text>
                      <FollowButton person={p} small />
                    </Pressable>
                  </Animated.View>
                ))}
              </ScrollView>
            </View>
          )}
          <Mosaic posts={mosaic} width={width} />
        </ScrollView>
      )}
    </View>
  )
}

function ActivityRow({ a, isNew }: { a: Activity; isNew: boolean }) {
  const t = useTheme()
  const person = usePerson(a.by)
  const post = socialStore.use((s) => s.posts.find((p) => p.id === a.postId))
  const thumb = post?.media.find((m) => m.kind === "image")
  const verb = {
    like: "liked your post.",
    comment: `commented: ${a.text ?? ""}`,
    follow: "started following you.",
    mention: `mentioned you: ${a.text ?? ""}`,
    story: "liked your story.",
  }[a.kind]
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() =>
        go(a.postId ? `/social/post/${a.postId}` : `/social/u/${a.by}`)
      }
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 10,
        backgroundColor: pressed ? t.soft : isNew ? `${t.tsk}10` : t.bg,
      })}
    >
      <Avatar id={a.by} size={44} />
      <Text
        style={{
          flex: 1,
          color: t.text,
          fontFamily: fonts.body,
          fontSize: 14,
          lineHeight: 19,
        }}
      >
        <Text style={{ fontFamily: fonts.semibold }}>{person?.username} </Text>
        {verb} <Text style={{ color: t.muted }}>{agoText(a.at)}</Text>
      </Text>
      {a.kind === "follow" && person ? (
        <FollowButton person={person} small />
      ) : thumb ? (
        <Image
          source={{ uri: thumb.uri }}
          style={{ width: 44, height: 44, borderRadius: 6 }}
        />
      ) : post?.progress ? (
        <View
          style={{ width: 44, height: 44, borderRadius: 6, overflow: "hidden" }}
        >
          <ProgressCard
            progress={post.progress}
            width={44}
            height={44}
            compact
          />
        </View>
      ) : null}
    </Pressable>
  )
}

export function ActivityScreen() {
  const t = useTheme()
  const safe = useSafeAreaInsets()
  const activity = socialStore.use((s) => s.activity)
  const readAt = socialStore.use((s) => s.activityReadAt)
  const [seenAt] = useState(readAt)
  useFocusEffect(useCallback(() => () => markActivityRead(), []))
  const now = Date.now()
  const sections = [
    { title: "New", items: activity.filter((a) => a.at > seenAt) },
    {
      title: "This week",
      items: activity.filter(
        (a) => a.at <= seenAt && now - a.at < 7 * 86_400_000,
      ),
    },
    {
      title: "Earlier",
      items: activity.filter(
        (a) => a.at <= seenAt && now - a.at >= 7 * 86_400_000,
      ),
    },
  ].filter((s) => s.items.length)
  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: safe.top }}>
      <TopBar title="Activity" />
      <ScrollView contentContainerStyle={{ paddingBottom: safe.bottom + 24 }}>
        {sections.length === 0 && (
          <Empty
            title="No activity yet"
            detail="Likes, comments and follows show up here."
          />
        )}
        {sections.map((s) => (
          <View key={s.title}>
            <Text
              style={{
                color: t.text,
                fontFamily: fonts.bold,
                fontSize: 16,
                paddingHorizontal: 16,
                paddingTop: 16,
                paddingBottom: 6,
              }}
            >
              {s.title}
            </Text>
            {[...s.items]
              .sort((a, b) => b.at - a.at)
              .map((a, i) => (
                <Animated.View key={a.id} entering={FadeInDown.delay(i * 40)}>
                  <ActivityRow a={a} isNew={s.title === "New"} />
                </Animated.View>
              ))}
          </View>
        ))}
      </ScrollView>
    </View>
  )
}
