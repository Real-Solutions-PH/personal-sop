import { ChevronRight, Send } from "lucide-react-native"
import { useMemo } from "react"
import { Pressable, Text, View } from "react-native"
import { go } from "../navigation"
import { fonts, useTheme } from "../theme"
import { Avatar } from "./kit"
import { agoText, ME, socialStore, storyGroups, unread } from "./store"

/** Today's glance at friends: new stories, the latest highlight, unread DMs. */
export function CommunityCard() {
  const t = useTheme()
  const s = socialStore.use((s) => s)
  const groups = useMemo(
    () => storyGroups(s).filter((g) => g.id !== ME && g.unseen),
    [s],
  )
  const latest = useMemo(
    () =>
      [...s.posts].filter((p) => p.by !== ME).sort((a, b) => b.at - a.at)[0],
    [s.posts],
  )
  const dms = s.chats.filter((c) => !c.muted && unread(c) > 0).length
  const author = s.people.find((p) => p.id === latest?.by)
  return (
    <View
      style={{
        borderRadius: 16,
        borderWidth: 1,
        borderColor: t.line,
        backgroundColor: t.card,
        padding: 14,
        gap: 10,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Community. ${groups.length} new stories`}
          onPress={() => go("/social")}
          hitSlop={8}
          style={({ pressed }) => ({
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Text
            style={{ color: t.text, fontFamily: fonts.semibold, fontSize: 15 }}
          >
            Community
          </Text>
          <ChevronRight size={16} color={t.muted} />
        </Pressable>
        {dms > 0 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${dms} unread messages`}
            onPress={() => go("/social/inbox")}
            hitSlop={8}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              paddingHorizontal: 10,
              height: 28,
              borderRadius: 14,
              backgroundColor: "#ff304026",
            }}
          >
            <Send size={12} color="#ff3040" />
            <Text
              style={{ color: "#ff3040", fontFamily: fonts.bold, fontSize: 12 }}
            >
              {dms}
            </Text>
          </Pressable>
        )}
      </View>
      {groups.length > 0 && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ flexDirection: "row" }}>
            {groups.slice(0, 4).map((g, i) => (
              <View key={g.id} style={{ marginLeft: i ? -10 : 0 }}>
                <Avatar
                  id={g.id}
                  size={30}
                  onPress={() => go(`/social/stories/${g.id}`)}
                />
              </View>
            ))}
          </View>
          <Text
            style={{ color: t.muted, fontFamily: fonts.body, fontSize: 13 }}
          >
            {groups.length} new {groups.length === 1 ? "story" : "stories"}
          </Text>
        </View>
      )}
      {latest && author && (
        <Pressable
          accessibilityRole="button"
          onPress={() => go(`/social/post/${latest.id}`)}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <Text
            numberOfLines={2}
            style={{
              color: t.text,
              fontFamily: fonts.body,
              fontSize: 13,
              lineHeight: 18,
            }}
          >
            <Text style={{ fontFamily: fonts.semibold }}>
              {author.username}
            </Text>{" "}
            {latest.progress
              ? `shared ${latest.progress.kind.toLowerCase()}: ${latest.progress.title}`
              : latest.caption}
            <Text style={{ color: t.muted }}> · {agoText(latest.at)}</Text>
          </Text>
        </Pressable>
      )}
    </View>
  )
}
