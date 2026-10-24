import { ChevronLeft, Heart, X } from "lucide-react-native"
import { useEffect, useRef, useState } from "react"
import type { TextInputInstance } from "react-native"
import {
  FlatList,
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
import { back } from "../navigation"
import { fonts, useTheme } from "../theme"
import { confirm, Empty } from "../ui"
import { Avatar, Bounce, haptic, LikeHeart, Name, PersonAvatar } from "./kit"
import { PostCard } from "./post-card"
import {
  addComment,
  type Comment,
  deleteComment,
  ME,
  openPostLive,
  socialStore,
  timeAgo,
  toggleCommentLike,
  usePerson,
} from "./store"

export function TopBar({
  title,
  right,
  onBack = () => back("/social"),
}: {
  title: string
  right?: React.ReactNode
  onBack?: () => void
}) {
  const t = useTheme()
  return (
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
      <Bounce label="Back" onPress={onBack} style={{ width: 44 }}>
        <ChevronLeft size={26} color={t.text} />
      </Bounce>
      <Text
        accessibilityRole="header"
        numberOfLines={1}
        style={{
          flex: 1,
          fontFamily: fonts.semibold,
          fontSize: 17,
          color: t.text,
        }}
      >
        {title}
      </Text>
      {right}
    </View>
  )
}

function CommentRow({
  postId,
  c,
  onReply,
}: {
  postId: string
  c: Comment
  onReply: (c: Comment) => void
}) {
  const t = useTheme()
  return (
    <Pressable
      onLongPress={() => {
        if (c.by !== ME) return
        haptic.pop()
        confirm("Delete comment?", c.text, () => deleteComment(postId, c.id))
      }}
      accessibilityHint={c.by === ME ? "Long press to delete" : undefined}
      style={{
        flexDirection: "row",
        gap: 10,
        paddingVertical: 10,
        paddingHorizontal: 14,
        paddingLeft: c.replyTo ? 58 : 14,
      }}
    >
      <PersonAvatar id={c.by} size={c.replyTo ? 26 : 34} />
      <View style={{ flex: 1, gap: 3 }}>
        <Text
          style={{
            color: t.text,
            fontFamily: fonts.body,
            fontSize: 14,
            lineHeight: 20,
          }}
        >
          <Name id={c.by} size={13} />{" "}
          <Text style={{ color: t.muted, fontSize: 12 }}>{timeAgo(c.at)}</Text>
          {"\n"}
          {c.text}
        </Text>
        <View style={{ flexDirection: "row", gap: 16 }}>
          {c.likes > 0 && (
            <Text
              style={{
                color: t.muted,
                fontSize: 12,
                fontFamily: fonts.semibold,
              }}
            >
              {c.likes} like{c.likes > 1 ? "s" : ""}
            </Text>
          )}
          <Text
            accessibilityRole="button"
            onPress={() => onReply(c)}
            style={{ color: t.muted, fontSize: 12, fontFamily: fonts.semibold }}
          >
            Reply
          </Text>
        </View>
      </View>
      <Bounce
        label={c.liked ? "Unlike comment" : "Like comment"}
        onPress={() => {
          haptic.tap()
          toggleCommentLike(postId, c.id)
        }}
        style={{ minWidth: 32 }}
      >
        <LikeHeart liked={c.liked} size={14} color={t.muted} />
      </Bounce>
    </Pressable>
  )
}

const QUICK = ["❤️", "🙌", "🔥", "👏", "💪", "😍", "😮", "😂"]

export function PostDetail({ id }: { id: string }) {
  const t = useTheme()
  const safe = useSafeAreaInsets()
  const width = Math.min(useWindowDimensions().width, 600)
  const post = socialStore.use((s) => s.posts.find((p) => p.id === id))
  const author = usePerson(post?.by ?? "")
  useEffect(() => void openPostLive(id), [id])
  const [text, setText] = useState("")
  const [replyTo, setReplyTo] = useState<Comment | null>(null)
  const input = useRef<TextInputInstance>(null)
  const list = useRef<FlatList<Comment>>(null)
  if (!post)
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: safe.top }}>
        <TopBar title="Post" />
        <Empty title="Post not found" detail="It may have been deleted." />
      </View>
    )
  // Replies render directly under their parent comment.
  const roots = post.comments.filter((c) => !c.replyTo)
  const ordered = roots.flatMap((r) => [
    r,
    ...post.comments.filter((c) => c.replyTo === r.id),
  ])
  const submit = (value = text) => {
    const v = value.trim()
    if (!v) return
    const parent = replyTo ? (replyTo.replyTo ?? replyTo.id) : undefined
    addComment(post.id, v, parent)
    haptic.tap()
    setText("")
    setReplyTo(null)
    setTimeout(() => list.current?.scrollToEnd({ animated: true }), 80)
  }
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: t.bg, paddingTop: safe.top }}
    >
      <TopBar title={author ? `${author.username}'s post` : "Post"} />
      <FlatList
        ref={list}
        data={ordered}
        keyExtractor={(c) => c.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={{ borderBottomWidth: 1, borderColor: t.line }}>
            <PostCard post={post} width={width} detail />
          </View>
        }
        ListEmptyComponent={
          <View style={{ alignItems: "center", padding: 32, gap: 6 }}>
            <Text
              style={{ color: t.text, fontFamily: fonts.display, fontSize: 22 }}
            >
              No comments yet
            </Text>
            <Text style={{ color: t.muted, fontFamily: fonts.body }}>
              Start the conversation.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Animated.View entering={FadeInDown.duration(220)}>
            <CommentRow
              postId={post.id}
              c={item}
              onReply={(c) => {
                setReplyTo(c)
                const who =
                  c.by === ME
                    ? ""
                    : `@${socialStore.get().people.find((p) => p.id === c.by)?.username} `
                setText(who)
                input.current?.focus()
              }}
            />
          </Animated.View>
        )}
        contentContainerStyle={{ paddingBottom: 12 }}
      />
      <View
        style={{
          borderTopWidth: 1,
          borderColor: t.line,
          paddingBottom: Math.max(safe.bottom, 8),
        }}
      >
        {replyTo && (
          <Animated.View
            entering={FadeIn}
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingHorizontal: 14,
              paddingVertical: 8,
              backgroundColor: t.soft,
            }}
          >
            <Text
              style={{
                flex: 1,
                color: t.muted,
                fontFamily: fonts.body,
                fontSize: 13,
              }}
            >
              Replying to <Name id={replyTo.by} size={13} />
            </Text>
            <Bounce label="Cancel reply" onPress={() => setReplyTo(null)}>
              <X size={16} color={t.muted} />
            </Bounce>
          </Animated.View>
        )}
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-around",
            paddingVertical: 8,
          }}
        >
          {QUICK.map((e) => (
            <Pressable
              cssInterop={false}
              key={e}
              accessibilityRole="button"
              accessibilityLabel={`Comment ${e}`}
              onPress={() => submit(e)}
              hitSlop={4}
              style={({ pressed }) => ({
                transform: [{ scale: pressed ? 1.3 : 1 }],
              })}
            >
              <Text style={{ fontSize: 24 }}>{e}</Text>
            </Pressable>
          ))}
        </View>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            paddingHorizontal: 12,
          }}
        >
          <Avatar id={ME} size={34} ring={false} />
          <View
            style={{
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              borderWidth: 1,
              borderColor: t.line,
              borderRadius: 22,
              paddingLeft: 14,
              paddingRight: 6,
              minHeight: 44,
            }}
          >
            <TextInput
              ref={input}
              value={text}
              onChangeText={setText}
              placeholder={`Add a comment for ${author?.username ?? "them"}…`}
              placeholderTextColor={t.muted}
              accessibilityLabel="Add a comment"
              multiline
              returnKeyType="send"
              onSubmitEditing={() => submit()}
              style={{
                flex: 1,
                color: t.text,
                fontFamily: fonts.body,
                fontSize: 14,
                maxHeight: 100,
                paddingVertical: 10,
              }}
            />
            {text.trim() ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => submit()}
                style={{
                  backgroundColor: t.tsk,
                  borderRadius: 16,
                  paddingHorizontal: 14,
                  height: 32,
                  justifyContent: "center",
                }}
              >
                <Text style={{ color: "#fff", fontFamily: fonts.semibold }}>
                  Post
                </Text>
              </Pressable>
            ) : (
              <Heart size={18} color={t.muted} style={{ marginRight: 8 }} />
            )}
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  )
}
