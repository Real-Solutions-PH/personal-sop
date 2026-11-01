import { palette } from "@domain/design/tokens"
import {
  Bookmark,
  Check,
  Ellipsis,
  Forward,
  Link2,
  MessageCircle,
  PlusCircle,
  Share2,
  Trash2,
  UserMinus,
} from "lucide-react-native"
import { memo, useMemo, useState } from "react"
import { Pressable, Share, Text, TextInput, View } from "react-native"
import Animated, { FadeIn } from "react-native-reanimated"
import { toast } from "sonner-native"
import { copyText } from "../media"
import { go } from "../navigation"
import { fonts, useTheme } from "../theme"
import { confirm, Sheet, undo } from "../ui"
import {
  Avatar,
  Bounce,
  CheerBar,
  haptic,
  MediaCarousel,
  Name,
  PersonAvatar,
  ProgressContext,
  StatStrip,
} from "./kit"
import {
  addStory,
  agoText,
  compact,
  deletePost,
  directChat,
  like,
  ME,
  type Post,
  postLink,
  sendMessage,
  simulateReply,
  socialStore,
  toggleFollow,
  toggleSave,
  usePerson,
} from "./store"

/** Caption with tappable #tags and @mentions, collapsed to two lines. */
export function Caption({
  by,
  text,
  full = false,
}: {
  by: string
  text: string
  full?: boolean
}) {
  const t = useTheme()
  const [open, setOpen] = useState(full)
  const long = text.length > 90
  const parts = text.split(/([#@][\w.]+)/g)
  return (
    <Text
      numberOfLines={open ? undefined : 2}
      onPress={() => setOpen(true)}
      style={{
        color: t.text,
        fontFamily: fonts.body,
        fontSize: 14,
        lineHeight: 20,
      }}
    >
      <Name id={by} />{" "}
      {parts.map((p, i) =>
        /^[#@]/.test(p) ? (
          <Text
            key={i}
            style={{ color: t.primary }}
            onPress={() => go(`/social/explore?q=${encodeURIComponent(p)}`)}
          >
            {p}
          </Text>
        ) : (
          p
        ),
      )}
      {!open && long && <Text style={{ color: t.muted }}> … more</Text>}
    </Text>
  )
}

/** "Send to" sheet: DM a post to people or groups, add to story, copy link. */
export function SendSheet({
  postId,
  open,
  onClose,
}: {
  postId: string
  open: boolean
  onClose: () => void
}) {
  const t = useTheme()
  const s = socialStore.use((s) => s)
  const [sent, setSent] = useState<string[]>([])
  const [note, setNote] = useState("")
  const [q, setQ] = useState("")
  const post = s.posts.find((p) => p.id === postId)
  const targets = useMemo(() => {
    const groups = s.chats
      .filter((c) => c.name)
      .map((c) => ({
        key: c.id,
        label: c.name!,
        chat: c.id,
        avatar: c.members[0],
      }))
    const people = s.people
      .filter(
        (p) => p.isFollowing || s.chats.some((c) => c.members.includes(p.id)),
      )
      .map((p) => ({ key: p.id, label: p.name, chat: null, avatar: p.id }))
    return [...people, ...groups].filter((x) =>
      x.label.toLowerCase().includes(q.toLowerCase()),
    )
  }, [s.chats, s.people, q])
  const send = (x: (typeof targets)[number]) => {
    const chat = x.chat ?? directChat(x.key)
    sendMessage(chat, { postId, text: note.trim() || undefined })
    setSent((v) => [...v, x.key])
    haptic.tap()
    simulateReply(chat, 2600)
  }
  return (
    <Sheet
      title="Share"
      open={open}
      onClose={() => {
        setSent([])
        setNote("")
        onClose()
      }}
    >
      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="Search"
        placeholderTextColor={t.muted}
        accessibilityLabel="Search people"
        style={{
          backgroundColor: t.soft,
          borderRadius: 12,
          paddingHorizontal: 12,
          minHeight: 40,
          color: t.text,
          fontFamily: fonts.body,
          marginBottom: 12,
        }}
      />
      <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: 16 }}>
        {targets.map((x) => {
          const done = sent.includes(x.key)
          return (
            <Pressable
              key={x.key}
              accessibilityRole="button"
              accessibilityLabel={`Send to ${x.label}`}
              accessibilityState={{ selected: done }}
              onPress={() => !done && send(x)}
              style={{ width: "25%", alignItems: "center", gap: 6 }}
            >
              <View>
                <Avatar id={x.avatar} size={56} ring={false} />
                {done && (
                  <Animated.View
                    entering={FadeIn}
                    style={{
                      position: "absolute",
                      right: -2,
                      bottom: -2,
                      width: 22,
                      height: 22,
                      borderRadius: 11,
                      backgroundColor: t.primary,
                      borderWidth: 2,
                      borderColor: t.bg,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Check size={12} color={t.onPrimary} strokeWidth={3} />
                  </Animated.View>
                )}
              </View>
              <Text
                numberOfLines={2}
                style={{
                  color: t.text,
                  fontSize: 12,
                  textAlign: "center",
                  fontFamily: fonts.body,
                }}
              >
                {done ? "Sent" : x.label}
              </Text>
            </Pressable>
          )
        })}
      </View>
      <TextInput
        value={note}
        onChangeText={setNote}
        placeholder="Write a message…"
        placeholderTextColor={t.muted}
        accessibilityLabel="Message to send with the post"
        style={{
          marginTop: 16,
          borderTopWidth: 1,
          borderColor: t.line,
          paddingVertical: 12,
          color: t.text,
          fontFamily: fonts.body,
        }}
      />
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-around",
          paddingTop: 8,
          borderTopWidth: 1,
          borderColor: t.line,
        }}
      >
        {[
          {
            label: "Add to story",
            Icon: PlusCircle,
            run: () => {
              if (!post) return
              addStory(
                post.progress
                  ? { kind: "progress", progress: post.progress }
                  : post.media[0]?.kind === "image"
                    ? {
                        kind: "image",
                        uri: post.media[0].uri,
                        // My own photo is already on the server: no upload.
                        mediaId: post.by === ME ? post.media[0].id : undefined,
                      }
                    : {
                        kind: "text",
                        text: post.caption,
                        bg: [palette.dark.background, palette.light.moss],
                      },
              )
              toast.success("Added to your story")
              onClose()
            },
          },
          {
            label: "Copy link",
            Icon: Link2,
            run: () => copyText(postLink(postId)),
          },
          {
            label: "Share to…",
            Icon: Share2,
            run: () =>
              void Share.share({
                message: `${post?.caption ?? ""}\n${postLink(postId)}`,
              }).catch(() => {}),
          },
        ].map(({ label, Icon, run }) => (
          <Pressable
            key={label}
            accessibilityRole="button"
            onPress={run}
            style={{ alignItems: "center", gap: 6, padding: 8, minWidth: 80 }}
          >
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: 24,
                backgroundColor: t.soft,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon size={20} color={t.text} />
            </View>
            <Text
              style={{ color: t.text, fontSize: 12, fontFamily: fonts.body }}
            >
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
    </Sheet>
  )
}

function PostMenu({
  post,
  open,
  onClose,
}: {
  post: Post
  open: boolean
  onClose: () => void
}) {
  const t = useTheme()
  const author = usePerson(post.by)
  const mine = post.by === ME
  const rows = [
    {
      label: post.saved ? "Remove from saved" : "Save",
      Icon: Bookmark,
      run: () => toggleSave(post.id),
    },
    {
      label: "Copy link",
      Icon: Link2,
      run: () => copyText(postLink(post.id)),
    },
    ...(mine
      ? [
          {
            label: "Delete",
            Icon: Trash2,
            danger: true,
            run: () =>
              confirm(
                "Delete post?",
                "This removes it from your profile.",
                () => {
                  const restore = deletePost(post.id)
                  undo("Post deleted", restore)
                },
              ),
          },
        ]
      : [
          {
            label: author?.isFollowing ? "Unfollow" : "Follow",
            Icon: UserMinus,
            run: () => toggleFollow(post.by),
          },
          {
            label: "Report",
            Icon: Ellipsis,
            danger: true,
            run: () => toast("Thanks — we'll review this post."),
          },
        ]),
  ]
  return (
    <Sheet title="Post options" open={open} onClose={onClose}>
      {rows.map(({ label, Icon, run, ...r }) => (
        <Pressable
          cssInterop={false}
          key={label}
          accessibilityRole="button"
          onPress={() => {
            onClose()
            run()
          }}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 14,
            minHeight: 52,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Icon size={20} color={"danger" in r ? t.bad : t.text} />
          <Text
            style={{
              fontFamily: fonts.medium,
              fontSize: 16,
              color: "danger" in r ? t.bad : t.text,
            }}
          >
            {label}
          </Text>
        </Pressable>
      ))}
    </Sheet>
  )
}

/** The feed card's gap from the screen edge. */
const CARD_INSET = 12

export const PostCard = memo(function PostCard({
  post,
  width,
  active = true,
  detail = false,
}: {
  post: Post
  width: number
  active?: boolean
  detail?: boolean
}) {
  const t = useTheme()
  const [menu, setMenu] = useState(false)
  const [send, setSend] = useState(false)
  const hasMedia = post.media.length > 0 || !!post.progress
  const likedBy = post.likedBy[0]
  const liker = usePerson(likedBy ?? "")
  const commentCount = Math.max(post.commentCount ?? 0, post.comments.length)
  const photoFirst = post.media.length > 0
  // A flat card, progress first: what moved, then the picture, then what
  // they said, then the cheers. The media sits inside the card's border.
  const inner = width - CARD_INSET * 2 - 2
  return (
    <View
      style={{
        marginHorizontal: CARD_INSET,
        marginBottom: 16,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: t.line,
        backgroundColor: t.card,
        overflow: "hidden",
        paddingBottom: 4,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingHorizontal: 12,
          paddingVertical: 10,
        }}
      >
        <PersonAvatar id={post.by} size={36} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text numberOfLines={1}>
            <Name id={post.by} />
            <Text
              style={{ color: t.muted, fontFamily: fonts.body, fontSize: 12 }}
            >
              {"  "}
              {agoText(post.at)}
            </Text>
          </Text>
          {post.progress ? (
            <ProgressContext progress={post.progress} />
          ) : post.location ? (
            <Text
              numberOfLines={1}
              style={{ color: t.muted, fontSize: 12, fontFamily: fonts.body }}
            >
              {post.location}
            </Text>
          ) : null}
        </View>
        <Bounce label="Post options" onPress={() => setMenu(true)}>
          <Ellipsis size={20} color={t.text} />
        </Bounce>
      </View>
      {post.progress && photoFirst && (
        <View style={{ marginBottom: 12 }}>
          <StatStrip progress={post.progress} />
        </View>
      )}
      {hasMedia ? (
        <MediaCarousel
          media={post.media}
          progress={post.progress}
          width={inner}
          active={active}
          onDoubleTap={() => {
            haptic.pop()
            like(post.id)
          }}
        />
      ) : null}
      {(!!post.caption || (!detail && commentCount > 0)) && (
        <View style={{ paddingHorizontal: 14, paddingTop: 12, gap: 4 }}>
          {!!post.caption && (
            <Caption by={post.by} text={post.caption} full={detail} />
          )}
          {!detail && commentCount > 0 && (
            <Text
              onPress={() => go(`/social/post/${post.id}`)}
              style={{ color: t.muted, fontSize: 14, fontFamily: fonts.body }}
            >
              View {commentCount > 1 ? `all ${commentCount} ` : ""}
              comment{commentCount > 1 ? "s" : ""}
            </Text>
          )}
        </View>
      )}
      <View style={{ gap: 8, marginTop: 12 }}>
        <CheerBar post={post} />
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingLeft: 14,
            paddingRight: 4,
            minHeight: 40,
          }}
        >
          <Text
            numberOfLines={1}
            style={{
              flex: 1,
              color: post.likes ? t.text : t.muted,
              fontFamily: fonts.medium,
              fontSize: 13,
            }}
          >
            {liker && post.likes > 1 ? (
              <>
                <Name id={likedBy} size={13} /> and {compact(post.likes - 1)}{" "}
                {post.likes - 1 === 1 ? "other" : "others"} cheered
              </>
            ) : post.likes === 1 ? (
              "1 cheer"
            ) : post.likes > 1 ? (
              `${compact(post.likes)} cheers`
            ) : (
              "Be the first to cheer this on"
            )}
          </Text>
          <Bounce
            label={`Comment${commentCount ? `, ${commentCount} comments` : ""}`}
            onPress={() => go(`/social/post/${post.id}`)}
          >
            <MessageCircle size={22} color={t.text} />
          </Bounce>
          <Bounce label="Share" onPress={() => setSend(true)}>
            <Forward size={20} color={t.text} />
          </Bounce>
        </View>
      </View>
      <PostMenu post={post} open={menu} onClose={() => setMenu(false)} />
      <SendSheet postId={post.id} open={send} onClose={() => setSend(false)} />
    </View>
  )
})
