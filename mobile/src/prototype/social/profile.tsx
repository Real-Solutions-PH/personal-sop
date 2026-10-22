import { levelFor } from "@domain/dash/hooks"
import { LinearGradient } from "expo-linear-gradient"
import {
  Bookmark,
  ChevronDown,
  Copy,
  Flame,
  Grid3x3,
  Layers,
  Lock,
  PlusSquare,
  Settings,
  Star,
  Target,
  UserCheck,
  UserPlus,
  Video,
} from "lucide-react-native"
import { useEffect, useMemo, useState } from "react"
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native"
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { toast } from "sonner-native"
import { liveMode } from "@/live/config"
import { copyText } from "../media"
import { go } from "../navigation"
import { LockedPreview } from "../screens/locked-preview"
import { Switch } from "../switch"
import { fonts, useTheme } from "../theme"
import { Empty } from "../ui"
import { Ring } from "../visual"
import { CreateSheet } from "./feed"
import {
  Avatar,
  Bounce,
  haptic,
  ProgressCard,
  TrophyChip,
  useRing,
} from "./kit"
import { TopBar } from "./post"
import {
  type GoalLine,
  useMyGoals,
  useMyScorecard,
  useMyStreaks,
} from "./sources"
import {
  type Area,
  compact,
  directChat,
  ME,
  openPersonLive,
  type Person,
  type Post,
  type Scorecard,
  socialStore,
  toggleCloseFriend,
  toggleFollow,
  toggleShowScores,
  useMe,
  usePerson,
} from "./store"

const AREAS: {
  key: Area
  label: string
  accent: "hab" | "tsk" | "fit" | "fin"
}[] = [
  { key: "habits", label: "Habits", accent: "hab" },
  { key: "tasks", label: "Tasks", accent: "tsk" },
  { key: "fitness", label: "Fitness", accent: "fit" },
  { key: "finance", label: "Finance", accent: "fin" },
]

function AreaBar({
  label,
  value,
  color,
  delay,
}: {
  label: string
  value: number
  color: string
  delay: number
}) {
  const t = useTheme()
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100)
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text
          style={{ color: t.muted, fontFamily: fonts.medium, fontSize: 12 }}
        >
          {label}
        </Text>
        <Text
          style={{ color: t.text, fontFamily: fonts.semibold, fontSize: 12 }}
        >
          {pct}%
        </Text>
      </View>
      <View
        style={{
          height: 6,
          borderRadius: 3,
          backgroundColor: t.soft,
          overflow: "hidden",
        }}
      >
        <Animated.View
          entering={FadeIn.delay(delay)}
          style={{
            width: `${pct}%`,
            height: 6,
            borderRadius: 3,
            backgroundColor: color,
          }}
        />
      </View>
    </View>
  )
}

const EMPTY_CARD: Scorecard = {
  life: 0,
  delta: 0,
  streak: 0,
  best: 0,
  rates: { habits: 0, tasks: 0, fitness: 0, finance: 0 },
  stats: [
    { label: "Workouts", value: "0" },
    { label: "PRs", value: "0" },
    { label: "Tasks (30d)", value: "0" },
  ],
  trophies: [],
}

/** Scores, stats and achievements — what followers see on a profile. */
export function ScoreCard({
  card,
  name,
  mine,
  compareWith,
}: {
  card: Scorecard
  name: string
  mine: boolean
  compareWith?: Scorecard
}) {
  const t = useTheme()
  const level = levelFor(card.life)
  return (
    <Animated.View
      entering={FadeInDown.springify()}
      style={{ marginHorizontal: 12, gap: 12 }}
    >
      <LinearGradient
        colors={[t["hero-from"], t["hero-via"], t["hero-to"]]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ borderRadius: 20, padding: 16, gap: 14 }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
          <Ring
            value={card.life / 100}
            size={92}
            hero
            gradientColors={[t.hab, t.life]}
          >
            <Text
              style={{ color: "#fff", fontFamily: fonts.display, fontSize: 30 }}
            >
              {card.life}
            </Text>
          </Ring>
          <View style={{ flex: 1, gap: 4 }}>
            <Text
              style={{
                color: "#ffffffb3",
                fontFamily: fonts.medium,
                fontSize: 12,
                letterSpacing: 0.8,
              }}
            >
              LIFE SCORE · 30 DAYS
            </Text>
            <Text
              style={{ color: "#fff", fontFamily: fonts.display, fontSize: 24 }}
            >
              {level.name}
            </Text>
            <Text
              style={{
                color: card.delta >= 0 ? "#6ee7a0" : "#ff8a8a",
                fontFamily: fonts.semibold,
                fontSize: 13,
              }}
            >
              {card.delta >= 0 ? "▲" : "▼"} {Math.abs(card.delta)} vs prior 30
              days
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {[
            { label: "On-target streak", value: `${card.streak}d` },
            { label: "Best streak", value: `${card.best}d` },
            ...card.stats.slice(0, 1),
          ].map((s) => (
            <View
              key={s.label}
              style={{
                flex: 1,
                padding: 10,
                borderRadius: 12,
                backgroundColor: "#ffffff14",
              }}
            >
              <Text
                style={{
                  color: "#fff",
                  fontFamily: fonts.display,
                  fontSize: 20,
                }}
              >
                {s.value}
                {"unit" in s && s.unit ? (
                  <Text style={{ fontSize: 12 }}> {s.unit}</Text>
                ) : null}
              </Text>
              <Text
                numberOfLines={1}
                style={{
                  color: "#ffffffb3",
                  fontFamily: fonts.medium,
                  fontSize: 11,
                }}
              >
                {s.label}
              </Text>
            </View>
          ))}
        </View>
      </LinearGradient>
      {compareWith && (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            padding: 12,
            borderRadius: 16,
            backgroundColor: t.card,
            borderWidth: 1,
            borderColor: t.line,
          }}
        >
          <Text
            style={{
              color: t.text,
              fontFamily: fonts.semibold,
              fontSize: 13,
              flex: 1,
            }}
          >
            {compareWith.life > card.life
              ? `You're ${compareWith.life - card.life} points ahead of ${name.split(" ")[0]}`
              : compareWith.life === card.life
                ? `You and ${name.split(" ")[0]} are tied`
                : `${name.split(" ")[0]} is ${card.life - compareWith.life} points ahead of you`}
          </Text>
          <Text
            style={{ color: t.muted, fontFamily: fonts.display, fontSize: 18 }}
          >
            {compareWith.life} <Text style={{ fontSize: 12 }}>vs</Text>{" "}
            {card.life}
          </Text>
        </View>
      )}
      <View
        style={{
          padding: 14,
          borderRadius: 16,
          backgroundColor: t.card,
          borderWidth: 1,
          borderColor: t.line,
          gap: 10,
        }}
      >
        {AREAS.map((a, i) => (
          <AreaBar
            key={a.key}
            label={a.label}
            value={card.rates[a.key]}
            color={t[a.accent]}
            delay={i * 80}
          />
        ))}
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {card.stats.map((s) => (
          <View
            key={s.label}
            style={{
              flex: 1,
              padding: 12,
              borderRadius: 14,
              backgroundColor: t.card,
              borderWidth: 1,
              borderColor: t.line,
            }}
          >
            <Text
              numberOfLines={1}
              style={{ color: t.text, fontFamily: fonts.display, fontSize: 20 }}
            >
              {s.value}
              {s.unit && (
                <Text style={{ fontSize: 12, color: t.muted }}> {s.unit}</Text>
              )}
            </Text>
            <Text
              numberOfLines={1}
              style={{ color: t.muted, fontFamily: fonts.medium, fontSize: 11 }}
            >
              {s.label}
            </Text>
          </View>
        ))}
      </View>
      {card.trophies.length > 0 && (
        <View style={{ gap: 8 }}>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <Text
              style={{
                color: t.text,
                fontFamily: fonts.semibold,
                fontSize: 15,
              }}
            >
              Achievements
            </Text>
            {mine && (
              <Text
                onPress={() => go("/stats/trophies")}
                style={{
                  color: t.tsk,
                  fontFamily: fonts.semibold,
                  fontSize: 13,
                }}
              >
                See all
              </Text>
            )}
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8 }}
          >
            {card.trophies.map((x) => (
              <TrophyChip key={x.title} trophy={x} />
            ))}
          </ScrollView>
        </View>
      )}
    </Animated.View>
  )
}

function Tile({ post, size }: { post: Post; size: number }) {
  const t = useTheme()
  const first = post.media[0]
  return (
    <Pressable
      cssInterop={false}
      accessibilityRole="button"
      accessibilityLabel={post.caption || "Post"}
      onPress={() => go(`/social/post/${post.id}`)}
      style={({ pressed }) => ({
        width: size,
        height: size * 1.25,
        opacity: pressed ? 0.8 : 1,
        backgroundColor: t.soft,
      })}
    >
      {first?.kind === "image" ? (
        <Image
          source={{ uri: first.uri }}
          style={{ width: "100%", height: "100%" }}
        />
      ) : post.progress ? (
        <ProgressCard
          progress={post.progress}
          width={size}
          height={size * 1.25}
          compact
        />
      ) : (
        <LinearGradient colors={["#333", "#111"]} style={{ flex: 1 }} />
      )}
      <View style={{ position: "absolute", top: 6, right: 6 }}>
        {first?.kind === "video" ? (
          <Video size={16} color="#fff" fill="#fff" />
        ) : post.media.length > 1 ? (
          <Layers size={16} color="#fff" />
        ) : null}
      </View>
      {first && post.progress?.day ? (
        <View
          style={{
            position: "absolute",
            left: 6,
            bottom: 6,
            paddingHorizontal: 6,
            paddingVertical: 2,
            borderRadius: 999,
            backgroundColor: "#000000a6",
          }}
        >
          <Text style={{ color: "#fff", fontFamily: fonts.bold, fontSize: 10 }}>
            DAY {post.progress.day}
          </Text>
        </View>
      ) : null}
    </Pressable>
  )
}

function SectionTitle({ children }: { children: string }) {
  const t = useTheme()
  return (
    <Text
      accessibilityRole="header"
      style={{
        color: t.text,
        fontFamily: fonts.semibold,
        fontSize: 15,
        paddingHorizontal: 16,
      }}
    >
      {children}
    </Text>
  )
}

type StreakLine = { key: string; title: string; day: number; best?: number }

function StreakChip({ s, accent }: { s: StreakLine; accent: string }) {
  const t = useTheme()
  return (
    <View
      style={{
        width: 136,
        padding: 12,
        gap: 4,
        borderRadius: 16,
        backgroundColor: t.card,
        borderWidth: 1,
        borderColor: t.line,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Flame size={16} color={accent} fill={accent} />
        <Text
          style={{ color: t.text, fontFamily: fonts.display, fontSize: 22 }}
        >
          {s.day}
          <Text
            style={{ fontSize: 12, fontFamily: fonts.medium, color: t.muted }}
          >
            {" "}
            {s.day === 1 ? "day" : "days"}
          </Text>
        </Text>
      </View>
      <Text
        numberOfLines={2}
        style={{
          color: t.text,
          fontFamily: fonts.medium,
          fontSize: 13,
          lineHeight: 18,
          minHeight: 36,
        }}
      >
        {s.title}
      </Text>
      {s.best !== undefined && (
        <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 11 }}>
          Best {s.best} days
        </Text>
      )}
    </View>
  )
}

function GoalRow({ g }: { g: GoalLine }) {
  const t = useTheme()
  const c = t[g.accent]
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Target size={16} color={c} />
        <Text
          numberOfLines={1}
          style={{
            flex: 1,
            color: t.text,
            fontFamily: fonts.semibold,
            fontSize: 14,
          }}
        >
          {g.title}
        </Text>
        <Text
          style={{ color: t.muted, fontFamily: fonts.medium, fontSize: 12 }}
        >
          {g.hit ? "Reached" : `${Math.round(g.pct * 100)}%`}
        </Text>
      </View>
      <View
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: Math.round(g.pct * 100) }}
        style={{
          height: 6,
          borderRadius: 3,
          backgroundColor: t.soft,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            width: `${g.pct * 100}%`,
            height: 6,
            borderRadius: 3,
            backgroundColor: c,
          }}
        />
      </View>
      <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 12 }}>
        {g.detail}
      </Text>
    </View>
  )
}

const SAMPLE_STREAKS: StreakLine[] = [
  { key: "a", title: "Morning run", day: 0, best: 0 },
  { key: "b", title: "Read 20 pages", day: 0, best: 0 },
]
const SAMPLE_GOALS: GoalLine[] = [
  {
    id: "a",
    title: "Workouts a week",
    detail: "≥ 3 / week",
    pct: 0,
    hit: false,
    accent: "fit",
  },
]

/** What a person is working on: current streaks, goals (yours) and the
 * progress they shared lately. Shown before posts and follower counts. */
function WorkingOn({
  id,
  mine,
  posts,
  width,
  card,
}: {
  id: string
  mine: boolean
  posts: Post[]
  width: number
  /** Their scorecard, when the viewer may see it. */
  card?: Scorecard
}) {
  const t = useTheme()
  const myStreaks = useMyStreaks()
  const myGoals = useMyGoals()
  // Someone else's streaks: their on-target run (when their scores are
  // visible), then the latest day of each habit streak or check-in their
  // posts and check-ins show. Goals and workouts are not streaks.
  const stories = socialStore.use((s) => s.stories)
  const theirStreaks = useMemo(() => {
    const seen = new Map<string, StreakLine>()
    if (card?.streak)
      seen.set("on-target", {
        key: "on-target",
        title: "On-target days",
        day: card.streak,
        best: card.best,
      })
    const dated = [
      ...posts.map((p) => ({ at: p.at, progress: p.progress })),
      ...stories.filter((x) => x.by === id),
    ].sort((a, b) => b.at - a.at)
    for (const x of dated) {
      const pr = x.progress
      if (!pr?.day || !/streak|check-in/i.test(pr.kind)) continue
      const title = pr.title.replace(/ done$/i, "")
      if (!seen.has(title)) seen.set(title, { key: title, title, day: pr.day })
    }
    return [...seen.values()]
  }, [posts, stories, id, card])
  const streakList: StreakLine[] = mine
    ? myStreaks.map((x) => ({ key: x.id, ...x }))
    : theirStreaks
  const goals = mine ? myGoals : []
  const recent = posts.filter((p) => p.progress).slice(0, 8)
  const empty = !streakList.length && !goals.length
  if (empty && !mine && !recent.length) return null
  const tile = Math.min(132, (width - 48) / 2.6)
  const body = (
    <View style={{ gap: 12 }}>
      <SectionTitle>Streaks</SectionTitle>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}
      >
        {(empty ? SAMPLE_STREAKS : streakList).map((x) => (
          <StreakChip key={x.key} s={x} accent={t.life} />
        ))}
      </ScrollView>
      {(mine || goals.length > 0) && (
        <>
          <SectionTitle>Goals</SectionTitle>
          <View
            style={{
              marginHorizontal: 16,
              padding: 14,
              gap: 14,
              borderRadius: 16,
              backgroundColor: t.card,
              borderWidth: 1,
              borderColor: t.line,
            }}
          >
            {(goals.length ? goals : SAMPLE_GOALS).map((g) => (
              <GoalRow key={g.id} g={g} />
            ))}
          </View>
        </>
      )}
    </View>
  )
  return (
    <View style={{ gap: 12, paddingBottom: 16 }}>
      {mine && empty ? (
        <View style={{ paddingHorizontal: 16 }}>
          <LockedPreview
            locked
            title="Nothing you're working on yet"
            detail="Start a habit or set a goal. Your streaks and goals show here for friends."
            action={{ label: "Start a habit", href: "/habits" }}
            icon={Flame}
          >
            <View style={{ marginHorizontal: -16 }}>{body}</View>
          </LockedPreview>
        </View>
      ) : streakList.length > 0 || goals.length > 0 ? (
        body
      ) : null}
      {recent.length > 0 && (
        <>
          <SectionTitle>Recent progress</SectionTitle>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}
          >
            {recent.map((p) => (
              <Pressable
                cssInterop={false}
                key={p.id}
                accessibilityRole="button"
                accessibilityLabel={`${p.progress?.kind}: ${p.progress?.title}`}
                onPress={() => go(`/social/post/${p.id}`)}
                style={({ pressed }) => ({
                  width: tile,
                  borderRadius: 14,
                  overflow: "hidden",
                  opacity: pressed ? 0.8 : 1,
                })}
              >
                {p.progress && (
                  <ProgressCard
                    progress={p.progress}
                    width={tile}
                    height={tile * 1.2}
                    compact
                  />
                )}
              </Pressable>
            ))}
          </ScrollView>
        </>
      )}
    </View>
  )
}

type Tab = "posts" | "scores" | "saved"

export function Profile({ id }: { id: string }) {
  const t = useTheme()
  const safe = useSafeAreaInsets()
  const width = Math.min(useWindowDimensions().width, 600)
  const person = usePerson(id)
  const ring = useRing(id)
  const [opening, setOpening] = useState(true)
  useEffect(() => {
    setOpening(true)
    void openPersonLive(id).finally(() => setOpening(false))
  }, [id])
  const posts = socialStore.use((s) => s.posts)
  const showScores = socialStore.use((s) => s.showScores)
  const myCard = useMyScorecard()
  const mine = id === ME
  const [tab, setTab] = useState<Tab>("posts")
  const [create, setCreate] = useState(false)
  const theirs = useMemo(
    () => posts.filter((p) => p.by === id).sort((a, b) => b.at - a.at),
    [posts, id],
  )
  const tabs: { key: Tab; Icon: typeof Grid3x3; label: string }[] = [
    { key: "posts", Icon: Grid3x3, label: "Progress posts" },
    { key: "scores", Icon: Star, label: "Scores" },
    ...(mine ? [{ key: "saved" as Tab, Icon: Bookmark, label: "Saved" }] : []),
  ]
  const index = tabs.findIndex((x) => x.key === tab)
  const underline = useSharedValue(index)
  useEffect(() => {
    underline.value = withSpring(index, { damping: 20, stiffness: 220 })
  }, [index, underline])
  const lineStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: underline.value * (width / tabs.length) }],
  }))
  // No sideways swipe between tabs: the streak and recent-progress rows
  // above them scroll sideways, and a swipe there changed the tab instead.
  if (!person)
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: safe.top }}>
        <TopBar title="Profile" />
        {opening ? (
          <ActivityIndicator
            accessibilityLabel="Loading profile"
            style={{ marginTop: 32 }}
          />
        ) : (
          <Empty title="Profile not found" />
        )}
      </View>
    )
  const following = person.isFollowing
  const canSeeScores = mine || following
  const card: Scorecard | undefined = mine ? myCard : person.card
  const shown =
    tab === "posts"
      ? theirs
      : tab === "saved"
        ? posts.filter((p) => p.saved)
        : []
  const size = width / 3 - 1
  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: safe.top }}>
      <TopBar
        title={person.username}
        right={
          mine ? (
            <View style={{ flexDirection: "row" }}>
              <Bounce label="Create" onPress={() => setCreate(true)}>
                <PlusSquare size={23} color={t.text} />
              </Bounce>
              <Bounce label="Settings" onPress={() => go("/me/settings")}>
                <Settings size={23} color={t.text} />
              </Bounce>
            </View>
          ) : undefined
        }
      />
      <FlatList
        key={tab === "scores" ? "scores" : "grid"}
        data={shown}
        numColumns={3}
        keyExtractor={(p) => p.id}
        columnWrapperStyle={{ gap: 1.5 }}
        contentContainerStyle={{ gap: 1.5, paddingBottom: safe.bottom + 64 }}
        ListHeaderComponent={
          <View>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 16,
                paddingHorizontal: 16,
                paddingTop: 16,
              }}
            >
              <Avatar
                id={id}
                size={80}
                onPress={ring ? () => go(`/social/stories/${id}`) : undefined}
              />
              <View style={{ flex: 1, gap: 2 }}>
                <Text
                  numberOfLines={1}
                  style={{
                    color: t.text,
                    fontFamily: fonts.display,
                    fontSize: 22,
                  }}
                >
                  {person.name}
                  {person.verified && <Text style={{ color: t.tsk }}> ✓</Text>}
                </Text>
                <Text
                  numberOfLines={1}
                  style={{
                    color: t.muted,
                    fontFamily: fonts.body,
                    fontSize: 13,
                  }}
                >
                  @{person.username}
                </Text>
                {card && canSeeScores && (!mine || showScores) && (
                  <Text
                    style={{
                      color: t.text,
                      fontFamily: fonts.medium,
                      fontSize: 13,
                    }}
                  >
                    Life score {card.life} · {levelFor(card.life).name}
                  </Text>
                )}
              </View>
            </View>
            <View style={{ paddingHorizontal: 16, paddingTop: 12, gap: 6 }}>
              {!!person.bio && (
                <Text
                  style={{
                    color: t.text,
                    fontFamily: fonts.body,
                    fontSize: 14,
                    lineHeight: 20,
                  }}
                >
                  {person.bio}
                </Text>
              )}
              <Text
                style={{
                  color: t.muted,
                  fontFamily: fonts.body,
                  fontSize: 12,
                }}
              >
                {theirs.length} {theirs.length === 1 ? "post" : "posts"} ·{" "}
                <Text
                  accessibilityRole="link"
                  onPress={() => go(`/social/follows/${id}?tab=following`)}
                >
                  following {compact(person.following)}
                </Text>{" "}
                ·{" "}
                <Text
                  accessibilityRole="link"
                  onPress={() => go(`/social/follows/${id}?tab=followers`)}
                >
                  {compact(person.followers)} followers
                </Text>
              </Text>
            </View>
            <View style={{ flexDirection: "row", gap: 6, padding: 16 }}>
              {mine ? (
                <>
                  <ProfileButton
                    label="Edit profile"
                    onPress={() => go("/me/profile")}
                  />
                  <ProfileButton
                    label="Share profile"
                    onPress={() =>
                      copyText(`https://personal-sop.app/@${person.username}`)
                    }
                  />
                </>
              ) : (
                <>
                  <FollowButton person={person} />
                  <ProfileButton
                    label="Message"
                    onPress={() => go(`/social/chat/${directChat(id)}`)}
                  />
                  <Bounce
                    label={
                      person.closeFriend
                        ? "Remove from close friends"
                        : "Add to close friends"
                    }
                    onPress={() => {
                      haptic.tap()
                      toggleCloseFriend(id)
                      toast.success(
                        person.closeFriend
                          ? "Removed from close friends"
                          : "Added to close friends",
                      )
                    }}
                    style={{
                      width: 40,
                      height: 34,
                      borderRadius: 10,
                      backgroundColor: t.soft,
                    }}
                  >
                    <Star
                      size={16}
                      color={person.closeFriend ? "#1aa34a" : t.text}
                      fill={person.closeFriend ? "#1aa34a" : "none"}
                    />
                  </Bounce>
                </>
              )}
            </View>
            <WorkingOn
              id={id}
              mine={mine}
              posts={theirs}
              width={width}
              card={canSeeScores ? card : undefined}
            />
            <View
              style={{
                flexDirection: "row",
                borderTopWidth: 1,
                borderColor: t.line,
              }}
            >
              {tabs.map(({ key, Icon, label }) => (
                <Pressable
                  key={key}
                  accessibilityRole="tab"
                  accessibilityLabel={label}
                  accessibilityState={{ selected: tab === key }}
                  onPress={() => {
                    haptic.tap()
                    setTab(key)
                  }}
                  style={{
                    flex: 1,
                    minHeight: 46,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Icon size={22} color={tab === key ? t.text : t.muted} />
                </Pressable>
              ))}
              <Animated.View
                style={[
                  {
                    position: "absolute",
                    bottom: 0,
                    left: 0,
                    width: width / tabs.length,
                    height: 1.5,
                    backgroundColor: t.text,
                  },
                  lineStyle,
                ]}
              />
            </View>
            {tab === "scores" && (
              <View style={{ paddingTop: 16, gap: 12 }}>
                {!canSeeScores ? (
                  <View style={{ alignItems: "center", gap: 10, padding: 32 }}>
                    <View
                      style={{
                        width: 64,
                        height: 64,
                        borderRadius: 32,
                        borderWidth: 2,
                        borderColor: t.text,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Lock size={28} color={t.text} />
                    </View>
                    <Text
                      style={{
                        color: t.text,
                        fontFamily: fonts.semibold,
                        fontSize: 16,
                      }}
                    >
                      Scores are for followers
                    </Text>
                    <Text
                      style={{
                        color: t.muted,
                        fontFamily: fonts.body,
                        textAlign: "center",
                      }}
                    >
                      Follow {person.name.split(" ")[0]} to see their life
                      score, stats and achievements.
                    </Text>
                    <FollowButton person={person} />
                  </View>
                ) : !card ? (
                  <View style={{ paddingHorizontal: 12 }}>
                    <LockedPreview
                      locked
                      title={`${person.name.split(" ")[0]} hasn't shared scores`}
                      detail="Their life score, streaks and achievements show here once they share them."
                      action={{
                        label: "Send encouragement",
                        onPress: () => go(`/social/chat/${directChat(id)}`),
                      }}
                    >
                      <View style={{ marginHorizontal: -12 }}>
                        <ScoreCard
                          card={EMPTY_CARD}
                          name={person.name}
                          mine={false}
                        />
                      </View>
                    </LockedPreview>
                  </View>
                ) : (
                  <>
                    {mine && (
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 10,
                          marginHorizontal: 12,
                          padding: 12,
                          borderRadius: 14,
                          backgroundColor: t.soft,
                        }}
                      >
                        <View style={{ flex: 1 }}>
                          <Text
                            style={{
                              color: t.text,
                              fontFamily: fonts.semibold,
                            }}
                          >
                            Show on my profile
                          </Text>
                          <Text
                            style={{
                              color: t.muted,
                              fontFamily: fonts.body,
                              fontSize: 12,
                            }}
                          >
                            Followers see your scores and achievements
                          </Text>
                        </View>
                        <Switch
                          label="Show scores to followers"
                          value={showScores}
                          onChange={() => toggleShowScores()}
                        />
                      </View>
                    )}
                    <ScoreCard
                      card={card}
                      name={person.name}
                      mine={mine}
                      compareWith={mine ? undefined : myCard}
                    />
                  </>
                )}
              </View>
            )}
          </View>
        }
        renderItem={({ item }) => <Tile post={item} size={size} />}
        ListEmptyComponent={
          tab === "scores" ? null : (
            <View style={{ paddingHorizontal: 12 }}>
              <LockedPreview
                locked
                title={
                  tab === "saved"
                    ? "Nothing saved yet"
                    : mine
                      ? "Your progress posts land here"
                      : "No progress posts yet"
                }
                detail={
                  tab === "saved"
                    ? "Save a post from its ⋯ menu to keep it here."
                    : mine
                      ? "Share a photo with the streak, workout or goal it shows."
                      : "When they share progress, it shows up here."
                }
                action={
                  tab === "saved"
                    ? { label: "Open the feed", href: "/social" }
                    : mine
                      ? {
                          label: "Share progress",
                          href: "/social/compose?progress=1",
                        }
                      : {
                          label: "Send encouragement",
                          onPress: () => go(`/social/chat/${directChat(id)}`),
                        }
                }
              >
                <View
                  style={{
                    flexDirection: "row",
                    gap: 1.5,
                    marginHorizontal: -12,
                  }}
                >
                  {[0, 1, 2].map((i) => (
                    <View
                      key={i}
                      style={{
                        width: size,
                        height: size * 1.25,
                        backgroundColor: t.soft,
                      }}
                    />
                  ))}
                </View>
              </LockedPreview>
            </View>
          )
        }
      />
      <CreateSheet open={create} onClose={() => setCreate(false)} />
    </View>
  )
}

function ProfileButton({
  label,
  onPress,
}: {
  label: string
  onPress: () => void
}) {
  const t = useTheme()
  return (
    <Pressable
      cssInterop={false}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 34,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: t.soft,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text style={{ color: t.text, fontFamily: fonts.semibold, fontSize: 14 }}>
        {label}
      </Text>
    </Pressable>
  )
}

export function FollowButton({
  person,
  small = false,
}: {
  person: Person
  small?: boolean
}) {
  const t = useTheme()
  const on = person.isFollowing
  return (
    <Pressable
      cssInterop={false}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={
        on
          ? `Following ${person.name}. Tap to unfollow`
          : `Follow ${person.name}`
      }
      onPress={() => {
        haptic.tap()
        toggleFollow(person.id)
        if (!on) toast.success(`Following ${person.username}`)
      }}
      style={({ pressed }) => ({
        flex: small ? undefined : 1,
        minHeight: small ? 32 : 34,
        paddingHorizontal: small ? 16 : 12,
        borderRadius: 10,
        flexDirection: "row",
        gap: 6,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: on ? t.soft : t.tsk,
        transform: [{ scale: pressed ? 0.96 : 1 }],
      })}
    >
      {!small &&
        (on ? (
          <UserCheck size={16} color={t.text} />
        ) : (
          <UserPlus size={16} color="#fff" />
        ))}
      <Text
        style={{
          color: on ? t.text : "#fff",
          fontFamily: fonts.semibold,
          fontSize: 14,
        }}
      >
        {on ? "Following" : "Follow"}
      </Text>
      {on && !small && <ChevronDown size={14} color={t.text} />}
    </Pressable>
  )
}

/** Followers / following lists with follow buttons. */
export function Follows({
  id,
  initialTab = "followers",
}: {
  id: string
  initialTab?: "followers" | "following"
}) {
  const t = useTheme()
  const safe = useSafeAreaInsets()
  const person = usePerson(id)
  const me = useMe()
  const people = socialStore.use((s) => s.people)
  const graph = socialStore.use((s) => s.graph?.[id])
  const [tab, setTab] = useState<"followers" | "following">(initialTab)
  useEffect(() => void openPersonLive(id), [id])
  // Live mode lists the server's graph (nothing until it loads); the
  // prototype has one small network, so both lists draw from it.
  const list: Person[] = graph
    ? graph[tab].flatMap((pid) => {
        const p = pid === ME ? me : people.find((x) => x.id === pid)
        return p ? [p] : []
      })
    : liveMode
      ? []
      : tab === "following"
        ? people.filter((p) => (id === ME ? p.isFollowing : p.id !== id))
        : people.filter((p) => p.id !== id)
  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: safe.top }}>
      <TopBar title={person?.username ?? ""} />
      <View
        style={{
          flexDirection: "row",
          borderBottomWidth: 1,
          borderColor: t.line,
        }}
      >
        {(["followers", "following"] as const).map((k) => (
          <Pressable
            key={k}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === k }}
            onPress={() => setTab(k)}
            style={{
              flex: 1,
              minHeight: 44,
              alignItems: "center",
              justifyContent: "center",
              borderBottomWidth: 1.5,
              borderColor: tab === k ? t.text : "transparent",
            }}
          >
            <Text
              style={{
                color: tab === k ? t.text : t.muted,
                fontFamily: fonts.semibold,
              }}
            >
              {k === "followers"
                ? `${compact(person?.followers ?? 0)} followers`
                : `${compact(person?.following ?? 0)} following`}
            </Text>
          </Pressable>
        ))}
      </View>
      <FlatList
        data={list}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ paddingBottom: safe.bottom + 64 }}
        renderItem={({ item, index }) => (
          <Animated.View entering={FadeInDown.delay(index * 40)}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                paddingHorizontal: 16,
                paddingVertical: 8,
              }}
            >
              <Pressable
                cssInterop={false}
                accessibilityRole="button"
                onPress={() => go(`/social/u/${item.id}`)}
                style={({ pressed }) => ({
                  flex: 1,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
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
                    {item.card ? ` · Score ${item.card.life}` : ""}
                  </Text>
                </View>
              </Pressable>
              {item.id !== ME && <FollowButton person={item} small />}
            </View>
          </Animated.View>
        )}
        ListEmptyComponent={
          liveMode && !graph ? (
            <ActivityIndicator
              accessibilityLabel="Loading"
              style={{ marginTop: 32 }}
            />
          ) : (
            <Empty title="No one here yet" icon={Copy} />
          )
        }
      />
    </View>
  )
}
