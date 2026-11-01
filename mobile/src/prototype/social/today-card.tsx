import { ChevronRight, MessageCircle, Users } from "lucide-react-native"
import { useMemo } from "react"
import { Pressable, Text, View } from "react-native"
import { Copy, Group, Line, Part, Tap } from "../native-kit"
import { go } from "../navigation"
import { fonts, useTheme } from "../theme"
import { Avatar } from "./kit"
import { agoText, ME, socialStore, storyGroups, unread } from "./store"

/** Today's glance at friends: new check-ins, the latest progress, unread DMs.
 * Built on the same Group/Part frame as the module cards around it. */
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
  const quiet = !dms && !groups.length && !(latest && author)
  return (
    <Group title="Community" icon={Users} accent="life" href="/social">
      {dms > 0 && (
        <Part>
          <Tap
            label={`${dms} unread messages`}
            onPress={() => go("/social/inbox")}
          >
            <Line style={{ gap: 8 }}>
              <MessageCircle size={16} color={t.primary} />
              <Copy size={14} style={{ flex: 1 }}>
                {dms} unread {dms === 1 ? "chat" : "chats"}
              </Copy>
              <ChevronRight size={16} color={t.muted} />
            </Line>
          </Tap>
        </Part>
      )}
      {groups.length > 0 && (
        <Part>
          <Line style={{ gap: 10 }}>
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
            <Copy size={14} muted style={{ flex: 1 }}>
              {groups.length} new{" "}
              {groups.length === 1 ? "check-in" : "check-ins"}
            </Copy>
          </Line>
        </Part>
      )}
      {latest && author && (
        <Part>
          <Tap onPress={() => go(`/social/post/${latest.id}`)}>
            <Text
              numberOfLines={2}
              style={{
                color: t.text,
                fontFamily: fonts.body,
                fontSize: 14,
                lineHeight: 20,
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
          </Tap>
        </Part>
      )}
      {quiet && (
        <Part>
          <Copy size={14} muted>
            No new activity from friends
          </Copy>
        </Part>
      )}
    </Group>
  )
}

/** Header entry to Social, with a dot for unread messages or new stories. */
export function CommunityButton() {
  const t = useTheme()
  const dms = socialStore.use(
    (s) => s.chats.filter((c) => !c.muted && unread(c) > 0).length,
  )
  return (
    <Pressable
      cssInterop={false}
      accessibilityRole="button"
      accessibilityLabel={`Community${dms ? `, ${dms} unread messages` : ""}`}
      onPress={() => go("/social")}
      hitSlop={4}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Users size={20} color={t.text} />
      {dms > 0 && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 6,
            right: 4,
            minWidth: 16,
            height: 16,
            paddingHorizontal: 4,
            borderRadius: 8,
            backgroundColor: t.primary,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text
            style={{ color: t.onPrimary, fontFamily: fonts.mono, fontSize: 10 }}
          >
            {dms}
          </Text>
        </View>
      )}
    </Pressable>
  )
}
