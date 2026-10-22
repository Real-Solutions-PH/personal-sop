// Live social: the /social REST routes and the social events of the per-user
// stream, mapped into the prototype's social store, which the screens keep
// reading. Social is multi-user, so it is not on the owner-scoped sync pull
// (ADR-0011): reads are loaders, writes go straight to the server through
// the store's actions (optimistic, rolled back on failure), and realtime
// arrives as nudges on GET /events/stream that trigger a targeted refetch.
//
// Ids: the server's person ids are UUIDs; the signed-in person is the
// store's ME. A 1:1 chat the device opened may come back with the server's
// existing chat id; the device keeps its own id and aliases the server's.

import {
  type Activity,
  type Chat,
  type Cheer,
  type Comment,
  connectSocial,
  ME,
  type Media,
  type Message,
  type Note,
  type Person,
  type Post,
  type Progress,
  type Scorecard,
  type SocialRemote,
  type SocialState,
  type StoryItem,
  socialStore,
  typingStore,
} from "@/prototype/social/store"
import type { Accent } from "@/prototype/theme"
import { http as authHttp } from "./auth"
import type { ServerEvent } from "./events"
import { ApiError, type Http } from "./http"
import { createUploader, type Uploader } from "./social-media"

// ---------------------------------------------------------------- wire shapes

interface WBrief {
  id: string
  name: string
  handle: string | null
  accent: Accent
  photo_media_id: string | null
  verified: boolean
}
interface WPerson extends WBrief {
  bio: string
  followers: number
  following: number
  is_me: boolean
  is_following: boolean
  close_friend: boolean
  scores_visible: boolean
}
interface WMedia {
  media_id: string
  kind: "image" | "video"
  ratio: number | null
  url: string | null
}
interface WPost {
  id: string
  author: WBrief
  created_at: string
  caption: string
  media: WMedia[]
  progress: Record<string, unknown> | null
  location: string | null
  tags: string[]
  likes: number
  liked: boolean
  /** Absent from a server older than cheer kinds. */
  cheers?: Partial<Record<Cheer, number>>
  my_cheer?: Cheer | null
  saved: boolean
  comments: number
  liked_by: WBrief[]
}
interface WPosts {
  data: WPost[]
  count: number
  next_cursor?: string | null
}
interface WComment {
  id: string
  post_id: string
  author: WBrief
  text: string
  created_at: string
  likes: number
  liked: boolean
  reply_to_id: string | null
}
interface WStory {
  id: string
  owner_id: string
  created_at: string
  kind: StoryItem["kind"]
  media: WMedia | null
  text: string | null
  bg: string[] | null
  progress: Record<string, unknown> | null
  audience: "everyone" | "close"
  seen: boolean
  liked: boolean
  likes: number | null
}
interface WTray {
  data: { person: WBrief; items: WStory[] }[]
}
interface WNote {
  id: string
  person: WBrief
  text: string
  created_at: string
  liked: boolean
}
interface WMessage {
  id: string
  chat_id: string
  sender_id: string
  at: string
  text: string | null
  media: WMedia | null
  post_id: string | null
  story_id: string | null
  reply_to_id: string | null
  system: boolean
  reactions: Record<string, string>
}
interface WChat {
  id: string
  name: string | null
  is_group: boolean
  members: WBrief[]
  muted: boolean
  pinned: boolean
  read_at: string | null
  unread: number
  last_message: WMessage | null
}
interface WActivity {
  id: string
  kind: Activity["kind"]
  actor: WBrief
  at: string
  post_id: string | null
  text: string | null
  unread: boolean
}
interface WScorecard {
  life: number | null
  delta: number | null
  streak: number
  best: number
  rates: { module: string; rate: number | null }[]
  stats: { label: string; value: string; unit: string | null }[]
  trophies: Scorecard["trophies"]
}
interface WLeader {
  person: WBrief
  life: number | null
  streak: number
}
type List<T> = { data: T[] }

// ---------------------------------------------------------------- the client

export interface SocialDeps {
  http: Http
  /** The signed-in person's server id (maps to the store's ME). */
  userId: string
  upload?: Uploader
  now?: () => number
}

export const TYPING_EVERY_MS = 3000
const TYPING_SHOWN_MS = 5000
const PAGE = 20

export type SocialLive = SocialRemote & {
  handleEvent(e: ServerEvent): void
}

/** A share card rendered on web is an inline `data:` image, far over the
 * server's draft size limit; the draft is saved without it and the image
 * stays on this device. */
function draftForServer(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const b = body as { media?: { uri?: string }[] }
  if (!b.media) return { ...body }
  return {
    ...body,
    media: b.media.filter((m) => !m.uri?.startsWith("data:")),
  }
}

/** The server's copy of my post draft, keeping the image only this device
 * holds (see ``draftForServer``) while it is still the same draft. */
function withLocalMedia(
  server: Partial<Post>,
  local: Partial<Post> | undefined,
): Partial<Post> {
  if (server.media?.length || !local?.media?.length) return server
  if ((local.caption ?? "") !== (server.caption ?? "")) return server
  return { ...server, media: local.media }
}

export function createSocialLive(deps: SocialDeps): SocialLive {
  const { http } = deps
  const me = deps.userId
  const now = deps.now ?? Date.now
  const upload = deps.upload ?? createUploader(http)
  const set = socialStore.set
  const get = socialStore.get

  const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : 0)
  const pid = (id: string) => (id === me ? ME : id)
  const sid = (id: string) => (id === ME ? me : id)
  const q = (params: Record<string, string | number | undefined>) => {
    const parts = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    return parts.length ? `?${parts.join("&")}` : ""
  }

  // A 1:1 chat opened on this device keeps its local id; the server's id
  // (when the chat already existed) is an alias used on the wire.
  const toServer = new Map<string, string>()
  const toLocal = new Map<string, string>()
  const cid = (local: string) => toServer.get(local) ?? local
  const lid = (server: string) => toLocal.get(server) ?? server
  const chatReady = new Map<string, Promise<unknown>>()
  // Posts and messages still being created: a refresh keeps them.
  const pending = new Set<string>()
  /** Posts I deleted this session (until restored): stale reads skip them. */
  const deleted = new Set<string>()
  const deleting = new Map<string, Promise<unknown>>()
  /** Messages I unsent this session: stale reads skip them. */
  const unsent = new Set<string>()
  /** The last message send per chat; the next one waits for it. */
  const sending = new Map<string, Promise<unknown>>()
  // When I last wrote my note / each story (client clock): a list read that
  // started earlier does not know about them yet.
  let noteWrittenAt = Number.NEGATIVE_INFINITY
  const storyWrittenAt = new Map<string, number>()
  let followingCursor: string | null | undefined
  let foryouSkip = 0
  const lastTyping = new Map<string, number>()

  // ------------------------------------------------------------ people
  const photos = new Map<string, string | null>()
  async function resolvePhotos(briefs: WBrief[]) {
    const wanted = briefs.filter(
      (b) => b.photo_media_id && !photos.has(b.photo_media_id),
    )
    await Promise.all(
      wanted.map(async (b) => {
        const mid = b.photo_media_id as string
        photos.set(mid, null)
        try {
          const m = await http.request<{ url: string | null }>(
            "GET",
            `/media/${mid}`,
          )
          photos.set(mid, m.url)
        } catch {
          // no photo: the avatar falls back to initials
        }
      }),
    )
    if (!wanted.length) return
    set((s) => ({
      ...s,
      people: s.people.map((p) => {
        const b = briefs.find((x) => x.id === p.id)
        const url = b?.photo_media_id ? photos.get(b.photo_media_id) : null
        return url ? { ...p, photo: url } : p
      }),
    }))
  }

  function fromBrief(b: WBrief, prev?: Person): Person {
    const url = b.photo_media_id ? photos.get(b.photo_media_id) : undefined
    return {
      bio: "",
      followers: 0,
      following: 0,
      isFollowing: false,
      ...prev,
      id: b.id,
      name: b.name,
      username: b.handle ?? "",
      accent: b.accent,
      verified: b.verified || undefined,
      photo: url ?? prev?.photo,
    }
  }
  function fromPublic(p: WPerson, prev?: Person): Person {
    return {
      ...fromBrief(p, prev),
      bio: p.bio,
      followers: p.followers,
      following: p.following,
      isFollowing: p.is_following,
      closeFriend: p.close_friend || undefined,
    }
  }
  /** Upsert people into the store (never ME); returns the state change. */
  function upsertPeople(
    s: SocialState,
    briefs: WBrief[],
    full: WPerson[] = [],
  ): Person[] {
    const people = [...s.people]
    const put = (person: Person) => {
      const i = people.findIndex((x) => x.id === person.id)
      if (i === -1) people.push(person)
      else people[i] = person
    }
    for (const b of briefs) {
      if (b.id === me) continue
      put(
        fromBrief(
          b,
          people.find((x) => x.id === b.id),
        ),
      )
    }
    for (const p of full) {
      if (p.id === me) continue
      put(
        fromPublic(
          p,
          people.find((x) => x.id === p.id),
        ),
      )
    }
    void resolvePhotos([...briefs, ...full])
    return people
  }

  // ------------------------------------------------------------ mappers
  /** The stored card as the screens read it (``before_after`` on the wire). */
  const progressOut = (
    w: Record<string, unknown> | null,
  ): Progress | undefined => {
    if (!w) return undefined
    const { before_after, ...rest } = w
    return { ...(rest as Progress), beforeAfter: before_after === true }
  }
  const mapMedia = (m: WMedia, prev?: Media): Media => ({
    kind: m.kind,
    uri: m.url ?? prev?.uri ?? "",
    ratio: m.ratio ?? prev?.ratio,
  })
  function mapPost(w: WPost, prev?: Post): Post {
    return {
      id: w.id,
      by: pid(w.author.id),
      at: ms(w.created_at),
      caption: w.caption,
      media: w.media.map((m, i) => mapMedia(m, prev?.media[i])),
      progress: progressOut(w.progress),
      location: w.location ?? undefined,
      likes: w.likes,
      liked: w.liked,
      cheers: w.cheers,
      myCheer: w.my_cheer ?? undefined,
      saved: w.saved,
      likedBy: w.liked_by.map((b) => pid(b.id)),
      comments: prev?.comments ?? [],
      commentCount: w.comments,
    }
  }
  const mapComment = (w: WComment): Comment => ({
    id: w.id,
    by: pid(w.author.id),
    text: w.text,
    at: ms(w.created_at),
    likes: w.likes,
    liked: w.liked,
    replyTo: w.reply_to_id ?? undefined,
  })
  const mapStory = (w: WStory, prev?: StoryItem): StoryItem => ({
    id: w.id,
    by: pid(w.owner_id),
    at: ms(w.created_at),
    kind: w.kind,
    uri: w.media?.url ?? prev?.uri,
    text: w.text ?? undefined,
    bg: w.bg ? [w.bg[0], w.bg[1]] : undefined,
    progress: progressOut(w.progress),
    audience: w.audience,
    likes: w.likes ?? undefined,
    liked: w.liked,
  })
  const mapNote = (w: WNote): Note => ({
    id: w.id,
    by: pid(w.person.id),
    text: w.text,
    at: ms(w.created_at),
    liked: w.liked,
  })
  const mapMessage = (w: WMessage, prev?: Message): Message => ({
    id: w.id,
    by: pid(w.sender_id),
    at: ms(w.at),
    text: w.text ?? undefined,
    media: w.media ? mapMedia(w.media, prev?.media) : undefined,
    postId: w.post_id ?? undefined,
    storyReply: w.story_id ?? undefined,
    replyTo: w.reply_to_id ?? undefined,
    reactions: Object.fromEntries(
      Object.entries(w.reactions).map(([k, v]) => [pid(k), v]),
    ),
    system: w.system || undefined,
  })
  function mapChat(w: WChat, prev?: Chat): Chat {
    let messages = prev?.messages ?? []
    const last = w.last_message
    if (last && !unsent.has(last.id) && !messages.some((m) => m.id === last.id))
      messages = [...messages, mapMessage(last)]
    return {
      id: lid(w.id),
      members: w.members.filter((b) => b.id !== me).map((b) => b.id),
      name: w.is_group ? (w.name ?? "Group") : undefined,
      messages,
      muted: w.muted,
      pinned: w.pinned,
      readAt: ms(w.read_at),
      unread: w.unread,
      readBy: prev?.readBy,
    }
  }
  const mapActivity = (w: WActivity): Activity => ({
    id: w.id,
    kind: w.kind,
    by: pid(w.actor.id),
    at: ms(w.at),
    postId: w.post_id ?? undefined,
    text: w.text ?? undefined,
  })
  const AREAS = ["habits", "tasks", "fitness", "finance"] as const
  const mapCard = (w: WScorecard): Scorecard => ({
    life: w.life ?? 0,
    delta: w.delta ?? 0,
    streak: w.streak,
    best: w.best,
    rates: Object.fromEntries(
      AREAS.map((a) => [a, w.rates.find((r) => r.module === a)?.rate ?? 0]),
    ) as Scorecard["rates"],
    stats: w.stats.map((x) => ({ ...x, unit: x.unit ?? undefined })),
    trophies: w.trophies,
  })

  // ------------------------------------------------------------ merges
  function mergePosts(all: WPost[], replace = false) {
    // A read that was in flight when I deleted a post must not restore it.
    const list = all.filter((w) => !deleted.has(w.id))
    set((s) => {
      const byId = new Map(s.posts.map((p) => [p.id, p]))
      const fresh = list.map((w) => mapPost(w, byId.get(w.id)))
      const ids = new Set(fresh.map((p) => p.id))
      const kept = s.posts.filter(
        (p) => !ids.has(p.id) && (!replace || pending.has(p.id)),
      )
      return {
        ...s,
        people: upsertPeople(s, [
          ...list.map((w) => w.author),
          ...list.flatMap((w) => w.liked_by),
        ]),
        posts: replace
          ? [...kept, ...fresh]
          : s.posts
              .map((p) =>
                ids.has(p.id) ? (fresh.find((f) => f.id === p.id) as Post) : p,
              )
              .concat(fresh.filter((p) => !byId.has(p.id))),
      }
    })
  }
  function mergeChat(w: WChat) {
    set((s) => {
      const id = lid(w.id)
      const prev = s.chats.find((c) => c.id === id)
      const chat = mapChat(w, prev)
      return {
        ...s,
        people: upsertPeople(s, w.members),
        chats: prev
          ? s.chats.map((c) => (c.id === id ? chat : c))
          : [chat, ...s.chats],
      }
    })
  }
  function mergeMessages(chatId: string, all: WMessage[]) {
    // A read that was in flight when I unsent a message must not restore it.
    const list = all.filter((w) => !unsent.has(w.id))
    set((s) => ({
      ...s,
      chats: s.chats.map((c) => {
        if (c.id !== chatId) return c
        const byId = new Map(c.messages.map((m) => [m.id, m]))
        const fresh = list.map((w) => mapMessage(w, byId.get(w.id)))
        const ids = new Set(fresh.map((m) => m.id))
        const messages = [
          ...c.messages.filter((m) => !ids.has(m.id)),
          ...fresh,
        ].sort((a, b) => a.at - b.at)
        return { ...c, messages }
      }),
    }))
  }
  function replaceMessage(chatId: string, w: WMessage) {
    mergeMessages(chatId, [w])
  }

  // ------------------------------------------------------------ loaders
  const loaders = {
    async me() {
      const w = await http.request<WPerson>("GET", "/social/me")
      set((s) => ({
        ...s,
        me: { bio: w.bio, followers: w.followers, following: w.following },
      }))
    },
    async following() {
      const page = await http.request<WPosts>(
        "GET",
        `/social/feed${q({ tab: "following", limit: PAGE })}`,
      )
      followingCursor = page.next_cursor ?? null
      return page.data
    },
    async foryou() {
      const page = await http.request<WPosts>(
        "GET",
        `/social/feed${q({ tab: "foryou", limit: PAGE })}`,
      )
      foryouSkip = page.data.length
      return page.data
    },
    async stories() {
      const asked = now()
      const tray = await http.request<WTray>("GET", "/social/stories")
      const items = tray.data.flatMap((g) => g.items)
      set((s) => {
        const byId = new Map(s.stories.map((x) => [x.id, x]))
        const ids = new Set(items.map((w) => w.id))
        // A story I posted while this read was in flight is not in it.
        const mine = s.stories.filter(
          (x) =>
            !ids.has(x.id) &&
            (storyWrittenAt.get(x.id) ?? Number.NEGATIVE_INFINITY) >= asked,
        )
        return {
          ...s,
          people: upsertPeople(
            s,
            tray.data.map((g) => g.person),
          ),
          stories: [...items.map((w) => mapStory(w, byId.get(w.id))), ...mine],
          seen: [
            ...items.filter((w) => w.seen).map((w) => w.id),
            ...mine.map((x) => x.id),
          ],
        }
      })
    },
    async notes() {
      const asked = now()
      const list = await http.request<List<WNote>>("GET", "/social/notes")
      set((s) => {
        const notes = list.data.map(mapNote)
        // A note I left while this read was in flight is not in it.
        const mine =
          noteWrittenAt >= asked ? s.notes.find((n) => n.by === ME) : undefined
        return {
          ...s,
          people: upsertPeople(
            s,
            list.data.map((n) => n.person),
          ),
          notes:
            mine && !notes.some((n) => n.by === ME) ? [mine, ...notes] : notes,
        }
      })
    },
    async chats() {
      const list = await http.request<List<WChat>>(
        "GET",
        `/social/chats${q({ limit: 50 })}`,
      )
      set((s) => {
        const byId = new Map(s.chats.map((c) => [c.id, c]))
        const fresh = list.data.map((w) => mapChat(w, byId.get(lid(w.id))))
        const ids = new Set(fresh.map((c) => c.id))
        return {
          ...s,
          people: upsertPeople(
            s,
            list.data.flatMap((w) => w.members),
          ),
          // A chat this device just opened stays until the server has it.
          chats: [
            ...fresh,
            ...s.chats.filter((c) => !ids.has(c.id) && chatReady.has(c.id)),
          ],
        }
      })
    },
    async activity() {
      const list = await http.request<List<WActivity> & { unread: number }>(
        "GET",
        `/social/activity${q({ limit: 50 })}`,
      )
      const unread = list.data.filter((a) => a.unread)
      const readAt = unread.length
        ? Math.min(...unread.map((a) => ms(a.at))) - 1
        : now()
      set((s) => ({
        ...s,
        people: upsertPeople(
          s,
          list.data.map((a) => a.actor),
        ),
        activity: list.data.map(mapActivity),
        activityReadAt: readAt,
      }))
    },
    async myFollowing() {
      const list = await http.request<List<WPerson>>(
        "GET",
        `/social/people/${me}/following${q({ limit: 100 })}`,
      )
      set((s) => ({ ...s, people: upsertPeople(s, [], list.data) }))
    },
    async drafts() {
      const [post, story] = await Promise.all(
        (["post", "story"] as const).map((k) =>
          http.request<{ body: Record<string, unknown> }>(
            "GET",
            `/social/drafts/${k}`,
          ),
        ),
      )
      const has = (b: Record<string, unknown>) => Object.keys(b).length > 0
      set((s) => ({
        ...s,
        drafts: {
          post: has(post.body)
            ? withLocalMedia(post.body as Partial<Post>, s.drafts.post)
            : undefined,
          story: has(story.body)
            ? (story.body as Partial<StoryItem>)
            : undefined,
        },
      }))
    },
  }

  async function refresh() {
    const feed = Promise.all([loaders.following(), loaders.foryou()]).then(
      ([a, b]) =>
        mergePosts(
          [...a, ...b.filter((w) => !a.some((x) => x.id === w.id))],
          true,
        ),
    )
    const results = await Promise.allSettled([
      loaders.me(),
      feed,
      loaders.stories(),
      loaders.notes(),
      loaders.chats(),
      loaders.activity(),
      loaders.myFollowing(),
      loaders.drafts(),
    ])
    const failed = results.find((r) => r.status === "rejected")
    if (failed) throw (failed as PromiseRejectedResult).reason
  }

  async function loadMoreFeed(tab: "following" | "foryou") {
    if (tab === "following") {
      if (followingCursor === null) return
      const page = await http.request<WPosts>(
        "GET",
        `/social/feed${q({ tab, limit: PAGE, cursor: followingCursor })}`,
      )
      followingCursor = page.next_cursor ?? null
      mergePosts(page.data)
    } else {
      const page = await http.request<WPosts>(
        "GET",
        `/social/feed${q({ tab, limit: PAGE, skip: foryouSkip })}`,
      )
      foryouSkip += page.data.length
      mergePosts(page.data)
    }
  }

  async function openPost(id: string) {
    const [post, comments] = await Promise.all([
      http.request<WPost>("GET", `/social/posts/${id}`),
      http.request<List<WComment>>(
        "GET",
        `/social/posts/${id}/comments${q({ limit: 100 })}`,
      ),
    ])
    mergePosts([post])
    set((s) => ({
      ...s,
      people: upsertPeople(
        s,
        comments.data.map((c) => c.author),
      ),
      posts: s.posts.map((p) =>
        p.id === id ? { ...p, comments: comments.data.map(mapComment) } : p,
      ),
    }))
  }

  async function openPerson(id: string) {
    const uid = sid(id)
    // The follows lists show as soon as they arrive, not after the
    // (slower) scorecard.
    const graph = Promise.all(
      (["followers", "following"] as const).map((d) =>
        http.request<List<WPerson>>(
          "GET",
          `/social/people/${uid}/${d}${q({ limit: 50 })}`,
        ),
      ),
    ).then(([followers, following]) =>
      set((s) => ({
        ...s,
        people: upsertPeople(s, [], [...followers.data, ...following.data]),
        graph: {
          ...s.graph,
          [pid(uid)]: {
            followers: followers.data.map((p) => pid(p.id)),
            following: following.data.map((p) => pid(p.id)),
          },
        },
      })),
    )
    void graph.catch(() => {}) // reported by the await below
    // Each part shows as soon as it arrives; the scorecard is the slowest.
    const person = http
      .request<WPerson>("GET", `/social/people/${uid}`)
      .then((p) => {
        set((s) =>
          p.is_me
            ? {
                ...s,
                me: {
                  bio: p.bio,
                  followers: p.followers,
                  following: p.following,
                },
              }
            : { ...s, people: upsertPeople(s, [], [p]) },
        )
        return p
      })
    const posts = http
      .request<WPosts>("GET", `/social/people/${uid}/posts${q({ limit: 30 })}`)
      .then((page) => mergePosts(page.data))
    const card = http
      .request<WScorecard>("GET", `/social/people/${uid}/scorecard`)
      .catch((e: unknown) => {
        // Not visible to me (followers only, scores hidden): no card.
        if (e instanceof ApiError && e.status === 404) return null
        throw e
      })
    const [p, w] = await Promise.all([person, card, posts])
    if (!p.is_me)
      set((s) => ({
        ...s,
        people: s.people.map((x) =>
          x.id === p.id ? { ...x, card: w ? mapCard(w) : undefined } : x,
        ),
      }))
    await graph
  }

  async function openChat(id: string) {
    await chatReady.get(id)
    // Opened cold (a link or a reload): the chat list may not be here yet.
    if (!get().chats.some((c) => c.id === id))
      mergeChat(await http.request<WChat>("GET", `/social/chats/${cid(id)}`))
    const page = await http.request<List<WMessage>>(
      "GET",
      `/social/chats/${cid(id)}/messages${q({ limit: 50 })}`,
    )
    mergeMessages(id, page.data)
  }

  async function search(text: string) {
    const term = text.trim()
    if (!term) return
    if (term.startsWith("#")) {
      const page = await http.request<WPosts>(
        "GET",
        `/social/search/tags${q({ q: term.slice(1), limit: 30 })}`,
      )
      mergePosts(page.data)
      return
    }
    const list = await http.request<List<WPerson>>(
      "GET",
      `/social/search/people${q({ q: term, limit: 30 })}`,
    )
    set((s) => ({ ...s, people: upsertPeople(s, [], list.data) }))
  }

  async function loadExplore() {
    const [explore, board] = await Promise.all([
      http.request<{ suggested: WBrief[]; popular: WPost[] }>(
        "GET",
        "/social/explore",
      ),
      http.request<List<WLeader>>("GET", "/social/leaderboard"),
    ])
    mergePosts(explore.popular)
    set((s) => ({
      ...s,
      people: upsertPeople(s, [
        ...explore.suggested,
        ...board.data.map((r) => r.person),
      ]).map((p) => {
        const row = board.data.find((r) => r.person.id === p.id)
        if (!row || p.card) return p
        // The leaderboard has only life and streak; the full card loads on
        // the profile.
        return {
          ...p,
          card: {
            life: row.life ?? 0,
            delta: 0,
            streak: row.streak,
            best: row.streak,
            rates: { habits: 0, tasks: 0, fitness: 0, finance: 0 },
            stats: [],
            trophies: [],
          },
        }
      }),
    }))
  }

  // ------------------------------------------------------------ writes
  const progressIn = (p?: Progress) =>
    p
      ? {
          accent: p.accent,
          kind: p.kind,
          title: p.title,
          subtitle: p.subtitle,
          stats: p.stats,
          spark: p.spark,
          day: p.day,
          of: p.of,
          before_after: p.beforeAfter ?? false,
        }
      : null
  const onOff = (on: boolean) => (on ? "PUT" : "DELETE")
  const postWrite = async (method: string, path: string, body?: unknown) =>
    mergePosts([await http.request<WPost>(method, path, body)])
  const commentPath = (postId: string, id: string) =>
    `/social/posts/${postId}/comments/${id}`

  async function personWrite(method: string, path: string, body?: unknown) {
    const p = await http.request<WPerson>(method, path, body)
    set((s) => ({ ...s, people: upsertPeople(s, [], [p]) }))
  }
  async function chatWrite(method: string, path: string, body?: unknown) {
    mergeChat(await http.request<WChat>(method, path, body))
  }
  const chatPath = (id: string, rest = "") => `/social/chats/${cid(id)}${rest}`

  async function postMessage(chatId: string, m: Message) {
    const media_id = m.media ? await upload(m.media.uri, m.media.kind) : null
    const w = await http.request<WMessage>(
      "POST",
      chatPath(chatId, "/messages"),
      {
        id: m.id,
        text: m.text ?? null,
        media_id,
        post_id: m.postId ?? null,
        story_id: m.storyReply ?? null,
        reply_to_id: m.replyTo ?? null,
      },
    )
    replaceMessage(chatId, w)
  }

  const remote: SocialRemote = {
    refresh,
    loadMoreFeed,
    openPost,
    openPerson,
    openChat,
    search,
    loadExplore,

    likePost: (id, on, kind) =>
      postWrite(
        onOff(on),
        `/social/posts/${id}/like${on && kind ? `?kind=${kind}` : ""}`,
      ),
    savePost: (id, on) => postWrite(onOff(on), `/social/posts/${id}/save`),
    async createPost(post) {
      pending.add(post.id)
      try {
        const media = await Promise.all(
          post.media.map(async (m) => ({
            media_id: await upload(m.uri, m.kind),
            kind: m.kind,
            ratio: m.ratio ?? null,
          })),
        )
        await postWrite("POST", "/social/posts", {
          id: post.id,
          caption: post.caption,
          media,
          progress: progressIn(post.progress),
          location: post.location ?? null,
        })
      } finally {
        pending.delete(post.id)
      }
    },
    updateCaption: (id, caption) =>
      postWrite("PATCH", `/social/posts/${id}`, { caption }),
    deletePost(id) {
      deleted.add(id)
      const done = http.request("DELETE", `/social/posts/${id}`).catch((e) => {
        deleted.delete(id)
        throw e
      })
      deleting.set(id, done)
      return done
    },
    async restorePost(id) {
      // Undo right after delete: the delete must land first, or it would
      // land after the restore and win.
      await deleting.get(id)?.catch(() => {})
      deleting.delete(id)
      deleted.delete(id)
      return postWrite("POST", `/social/posts/${id}/restore`)
    },
    async addComment(postId, comment) {
      const w = await http.request<WComment>(
        "POST",
        `/social/posts/${postId}/comments`,
        {
          id: comment.id,
          text: comment.text,
          reply_to_id: comment.replyTo ?? null,
        },
      )
      set((s) => ({
        ...s,
        posts: s.posts.map((p) =>
          p.id === postId
            ? {
                ...p,
                comments: p.comments.map((c) =>
                  c.id === comment.id ? mapComment(w) : c,
                ),
                commentCount: (p.commentCount ?? 0) + 1,
              }
            : p,
        ),
      }))
    },
    likeComment: (postId, id, on) =>
      http.request(onOff(on), `${commentPath(postId, id)}/like`),
    deleteComment: (postId, id) =>
      http.request("DELETE", commentPath(postId, id)),
    async createStory(story) {
      storyWrittenAt.set(story.id, now())
      const media_id =
        (story.kind === "image" || story.kind === "video") && story.uri
          ? await upload(story.uri, story.kind)
          : null
      const w = await http.request<WStory>("POST", "/social/stories", {
        id: story.id,
        kind: story.kind,
        media_id,
        text: story.text ?? null,
        bg: story.bg ?? null,
        progress: progressIn(story.progress),
        audience: story.audience ?? "everyone",
      })
      set((s) => ({
        ...s,
        stories: s.stories.map((x) => (x.id === story.id ? mapStory(w, x) : x)),
      }))
    },
    deleteStory: (id) => http.request("DELETE", `/social/stories/${id}`),
    seen: (id) => http.request("PUT", `/social/stories/${id}/seen`),
    likeStory: (id, on) =>
      http.request(onOff(on), `/social/stories/${id}/like`),
    async setNote(text) {
      noteWrittenAt = now()
      const w = await http.request<WNote>("PUT", "/social/notes/me", { text })
      set((s) => ({
        ...s,
        notes: s.notes.map((n) => (n.by === ME ? mapNote(w) : n)),
      }))
    },
    clearNote: () => http.request("DELETE", "/social/notes/me"),
    likeNote: (id, on) => http.request(onOff(on), `/social/notes/${id}/like`),
    async follow(personId, on) {
      await personWrite(onOff(on), `/social/people/${personId}/follow`)
      // Following unlocks the followers-only scorecard: load it now.
      if (on) quietly(openPerson(personId))
    },
    closeFriend: (personId, on) =>
      personWrite("PUT", `/social/people/${personId}/close-friend`, {
        close_friend: on,
      }),
    showScores: (on) =>
      http.request("PATCH", "/social/me", { show_scores: on }),
    markActivityRead: () => http.request("POST", "/social/activity/read"),
    openDirect(chatId, personId) {
      const ready = http
        .request<WChat>("POST", "/social/chats/direct", {
          user_id: personId,
          id: chatId,
        })
        .then((w) => {
          if (w.id !== chatId) {
            toServer.set(chatId, w.id)
            toLocal.set(w.id, chatId)
          }
          mergeChat(w)
        })
        .finally(() => chatReady.delete(chatId))
      chatReady.set(chatId, ready)
      return ready
    },
    createGroup(chat) {
      const ready = chatWrite("POST", "/social/chats/groups", {
        id: chat.id,
        name: chat.name,
        member_ids: chat.members.map(sid),
      }).finally(() => chatReady.delete(chat.id))
      chatReady.set(chat.id, ready)
      return ready
    },
    sendMessage(chatId, m) {
      // One at a time per chat, so the server keeps the order they were sent.
      const prev = sending.get(chatId) ?? chatReady.get(chatId)
      const next = Promise.resolve(prev)
        .catch(() => {})
        .then(() => postMessage(chatId, m))
      sending.set(chatId, next)
      void next.finally(() => {
        if (sending.get(chatId) === next) sending.delete(chatId)
      })
      return next
    },
    react: (chatId, messageId, emoji) =>
      emoji
        ? http.request(
            "PUT",
            chatPath(chatId, `/messages/${messageId}/reaction`),
            {
              emoji,
            },
          )
        : http.request(
            "DELETE",
            chatPath(chatId, `/messages/${messageId}/reaction`),
          ),
    unsend(chatId, messageId) {
      unsent.add(messageId)
      return http
        .request("DELETE", chatPath(chatId, `/messages/${messageId}`))
        .catch((e) => {
          unsent.delete(messageId)
          throw e
        })
    },
    async markRead(chatId) {
      await chatReady.get(chatId)
      await http.request("POST", chatPath(chatId, "/read"))
    },
    chatSettings: (chatId, body) =>
      chatWrite("PATCH", chatPath(chatId, "/me"), body),
    renameChat: (chatId, name) =>
      chatWrite("PATCH", chatPath(chatId), { name }),
    addMembers: (chatId, ids) =>
      chatWrite("POST", chatPath(chatId, "/members"), {
        user_ids: ids.map(sid),
      }),
    hideChat: (chatId) => http.request("DELETE", chatPath(chatId)),
    leaveChat: (chatId) => http.request("POST", chatPath(chatId, "/leave")),
    restoreChat: (chatId) => chatWrite("POST", chatPath(chatId, "/restore")),
    saveDraft: (kind, body) =>
      body
        ? http.request("PUT", `/social/drafts/${kind}`, {
            body: draftForServer(body),
          })
        : http.request("DELETE", `/social/drafts/${kind}`),
    async typing(chatId) {
      const t = now()
      const last = lastTyping.get(chatId)
      if (last !== undefined && t - last < TYPING_EVERY_MS) return
      lastTyping.set(chatId, t)
      await http.request("POST", chatPath(chatId, "/typing"))
    },
  }

  // ------------------------------------------------------------ realtime
  const str = (v: unknown) => (typeof v === "string" ? v : "")
  const quietly = (p: Promise<unknown>) => void p.catch(() => {})

  function onChatMessage(d: Record<string, unknown>) {
    const chatId = lid(str(d.chat_id))
    const messageId = str(d.message_id)
    if (d.action === "unsent") {
      set((s) => ({
        ...s,
        chats: s.chats.map((c) =>
          c.id === chatId
            ? { ...c, messages: c.messages.filter((m) => m.id !== messageId) }
            : c,
        ),
      }))
      return
    }
    const chat = get().chats.find((c) => c.id === chatId)
    if (chat?.messages.some((m) => m.id === messageId)) return
    clearTyping(chatId)
    if (!chat) {
      quietly(
        http
          .request<WChat>("GET", `/social/chats/${cid(chatId)}`)
          .then(mergeChat),
      )
      return
    }
    quietly(
      http
        .request<List<WMessage>>(
          "GET",
          `/social/chats/${cid(chatId)}/messages${q({ limit: 20 })}`,
        )
        .then((page) => mergeMessages(chatId, page.data)),
    )
  }

  function clearTyping(chatId: string) {
    typingStore.setState((t) => {
      const { [chatId]: _, ...rest } = t
      return rest
    }, true)
  }

  function handleEvent(e: ServerEvent) {
    const d = (e.data ?? {}) as Record<string, unknown>
    switch (e.type) {
      case "chat.message":
        onChatMessage(d)
        return
      case "chat.typing": {
        const by = str(d.user_id)
        if (by === me) return
        const chatId = lid(str(d.chat_id))
        const until = now() + TYPING_SHOWN_MS
        typingStore.setState({ [chatId]: { by: pid(by), until } })
        setTimeout(() => {
          if (typingStore.getState()[chatId]?.until === until)
            clearTyping(chatId)
        }, TYPING_SHOWN_MS)
        return
      }
      case "chat.reaction": {
        const chatId = lid(str(d.chat_id))
        const by = pid(str(d.user_id))
        const emoji = typeof d.emoji === "string" ? d.emoji : null
        set((s) => ({
          ...s,
          chats: s.chats.map((c) =>
            c.id !== chatId
              ? c
              : {
                  ...c,
                  messages: c.messages.map((m) => {
                    if (m.id !== d.message_id) return m
                    const reactions = { ...m.reactions }
                    if (emoji) reactions[by] = emoji
                    else delete reactions[by]
                    return { ...m, reactions }
                  }),
                },
          ),
        }))
        return
      }
      case "chat.read": {
        const chatId = lid(str(d.chat_id))
        const by = pid(str(d.user_id))
        set((s) => ({
          ...s,
          chats: s.chats.map((c) =>
            c.id === chatId
              ? { ...c, readBy: { ...c.readBy, [by]: ms(str(d.at)) } }
              : c,
          ),
        }))
        return
      }
      case "social.activity":
        quietly(loaders.activity())
        return
      case "social.post": {
        const id = str(d.post_id)
        if (d.action === "deleted") {
          set((s) => ({ ...s, posts: s.posts.filter((p) => p.id !== id) }))
          return
        }
        if (pending.has(id)) return
        quietly(
          http
            .request<WPost>("GET", `/social/posts/${id}`)
            .then((w) => mergePosts([w])),
        )
        return
      }
      case "social.story": {
        const id = str(d.story_id)
        if (d.action === "deleted") {
          set((s) => ({ ...s, stories: s.stories.filter((x) => x.id !== id) }))
          return
        }
        if (get().stories.some((x) => x.id === id)) return
        quietly(
          http
            .request<WStory>("GET", `/social/stories/${id}`)
            .then((w) =>
              set((s) => ({ ...s, stories: [...s.stories, mapStory(w)] })),
            ),
        )
        return
      }
    }
  }

  return { ...remote, handleEvent }
}

/** Live mode's social wiring for a signed-in user: connects the store's
 * actions to the server, subscribes to the event stream and loads the
 * screens' data. Returns the stop for sign-out. */
export function startSocialLive(
  userId: string,
  subscribe: (l: (e: ServerEvent) => void) => () => void,
) {
  const live = createSocialLive({ http: authHttp, userId })
  connectSocial(live)
  const off = subscribe(live.handleEvent)
  void live.refresh().catch(() => {
    // offline or the server is down: the store keeps the cached snapshot
  })
  return () => {
    off()
    connectSocial(null)
  }
}
