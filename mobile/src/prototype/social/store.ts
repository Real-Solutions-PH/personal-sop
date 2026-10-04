import { dashStore } from "@domain/dash/store"
import { createStore, uid } from "@domain/lib/store"
import type { Accent } from "../theme"

// ponytail: social is UI-only for the prototype — every action mutates this
// local store. Swap the actions for API calls once the social contract exists.

export type Media = { kind: "image" | "video"; uri: string; ratio?: number }
export type ProgressStat = { label: string; value: string; unit?: string }
export type Progress = {
  accent: Accent
  kind: string
  title: string
  subtitle?: string
  stats: ProgressStat[]
  spark?: number[]
  /** PNG of an exported share card, when the device could capture one. */
  image?: string
}
export type Area = "habits" | "tasks" | "fitness" | "finance"
export type Trophy = {
  type: "pr" | "streak" | "best" | "goal" | "first"
  title: string
  value: string
}
/** Public scorecard shown on a profile: scores, stats and achievements. */
export type Scorecard = {
  life: number
  delta: number
  streak: number
  best: number
  rates: Record<Area, number>
  stats: ProgressStat[]
  trophies: Trophy[]
}
export type Person = {
  id: string
  name: string
  username: string
  bio: string
  accent: Accent
  photo?: string
  verified?: boolean
  followers: number
  following: number
  isFollowing: boolean
  closeFriend?: boolean
  card?: Scorecard
}
export type Comment = {
  id: string
  by: string
  text: string
  at: number
  likes: number
  liked: boolean
  replyTo?: string
}
export type Post = {
  id: string
  by: string
  at: number
  caption: string
  media: Media[]
  progress?: Progress
  location?: string
  likes: number
  liked: boolean
  saved: boolean
  likedBy: string[]
  comments: Comment[]
}
export type StoryItem = {
  id: string
  by: string
  at: number
  kind: "image" | "video" | "text" | "progress"
  uri?: string
  text?: string
  bg?: [string, string]
  progress?: Progress
  audience?: "everyone" | "close"
  likes?: number
  liked?: boolean
}
export type Note = { by: string; text: string; at: number; liked?: boolean }
export type Message = {
  id: string
  by: string
  at: number
  text?: string
  media?: Media
  postId?: string
  storyReply?: string
  replyTo?: string
  reactions: Record<string, string>
  system?: boolean
}
export type Chat = {
  id: string
  members: string[]
  name?: string
  messages: Message[]
  muted: boolean
  pinned: boolean
  readAt: number
}
export type Activity = {
  id: string
  kind: "like" | "comment" | "follow" | "mention" | "story"
  by: string
  at: number
  postId?: string
  text?: string
}
export type SocialState = {
  people: Person[]
  posts: Post[]
  stories: StoryItem[]
  seen: string[]
  notes: Note[]
  chats: Chat[]
  activity: Activity[]
  activityReadAt: number
  drafts: { post?: Partial<Post>; story?: Partial<StoryItem> }
  /** Whether followers can see your scores and achievements. */
  showScores: boolean
}

export const ME = "me"
const MIN = 60_000,
  HOUR = 60 * MIN,
  DAY = 24 * HOUR
const photo = (id: string, w = 900) =>
  `https://images.unsplash.com/${id}?w=${w}&q=70&auto=format&fit=crop`

const people: Person[] = [
  {
    id: "ana",
    name: "Ana Reyes",
    username: "ana.lifts",
    bio: "Powerlifting · 3x/week · coffee first",
    accent: "fit",
    photo: photo("photo-1544367567-0f2fcb009e0b", 200),
    verified: true,
    followers: 2412,
    following: 311,
    isFollowing: true,
    closeFriend: true,
    card: {
      life: 82,
      delta: 4,
      streak: 41,
      best: 63,
      rates: { habits: 0.78, tasks: 0.7, fitness: 0.96, finance: 0.74 },
      stats: [
        { label: "Workouts", value: "142" },
        { label: "PRs", value: "37" },
        { label: "Squat", value: "140", unit: "kg" },
      ],
      trophies: [
        { type: "pr", title: "Squat 140 kg", value: "140 kg" },
        { type: "streak", title: "30-day streak", value: "30d" },
        { type: "best", title: "Heaviest week", value: "41 t" },
        { type: "first", title: "First 100 workouts", value: "100" },
      ],
    },
  },
  {
    id: "marco",
    name: "Marco Santos",
    username: "marcoruns",
    bio: "Sub-20 5K hunter 🏃 Manila",
    accent: "tsk",
    photo: photo("photo-1552674605-db6ffd4facb5", 200),
    followers: 864,
    following: 402,
    isFollowing: true,
    card: {
      life: 74,
      delta: 2,
      streak: 18,
      best: 40,
      rates: { habits: 0.7, tasks: 0.62, fitness: 0.9, finance: 0.6 },
      stats: [
        { label: "Runs", value: "211" },
        { label: "5K best", value: "20:41" },
        { label: "Distance", value: "1,280", unit: "km" },
      ],
      trophies: [
        { type: "best", title: "5K in 20:41", value: "20:41" },
        { type: "streak", title: "7-day streak", value: "7d" },
        { type: "first", title: "First half marathon", value: "21K" },
      ],
    },
  },
  {
    id: "bea",
    name: "Bea Lim",
    username: "bea.eats.clean",
    bio: "Meal prep Sundays. 120g protein or bust.",
    accent: "nut",
    photo: photo("photo-1490645935967-10de6ba17061", 200),
    followers: 5120,
    following: 220,
    isFollowing: true,
    closeFriend: true,
    card: {
      life: 79,
      delta: -1,
      streak: 27,
      best: 52,
      rates: { habits: 0.85, tasks: 0.66, fitness: 0.81, finance: 0.8 },
      stats: [
        { label: "Meals logged", value: "1,904" },
        { label: "Protein hit", value: "91", unit: "%" },
        { label: "Workouts", value: "88" },
      ],
      trophies: [
        { type: "streak", title: "100 days logged", value: "100d" },
        { type: "goal", title: "Hit protein 30 days", value: "30d" },
      ],
    },
  },
  {
    id: "josh",
    name: "Josh Tan",
    username: "joshbuilds",
    bio: "Habits > motivation. Day 214.",
    accent: "hab",
    followers: 377,
    following: 390,
    isFollowing: true,
    card: {
      life: 88,
      delta: 6,
      streak: 214,
      best: 214,
      rates: { habits: 0.97, tasks: 0.84, fitness: 0.72, finance: 0.86 },
      stats: [
        { label: "Habits", value: "9" },
        { label: "Tasks done", value: "2,316" },
        { label: "Routines", value: "412" },
      ],
      trophies: [
        { type: "streak", title: "200-day streak", value: "200d" },
        { type: "best", title: "Perfect month", value: "100%" },
        { type: "goal", title: "Read 24 books", value: "24" },
        { type: "first", title: "First wrap-up", value: "1" },
      ],
    },
  },
  {
    id: "kim",
    name: "Kim Dela Cruz",
    username: "kimsaves",
    bio: "Debt-free journey · ₱0 credit card balance since March",
    accent: "fin",
    followers: 1290,
    following: 180,
    isFollowing: false,
    card: {
      life: 76,
      delta: 3,
      streak: 12,
      best: 33,
      rates: { habits: 0.68, tasks: 0.72, fitness: 0.55, finance: 0.98 },
      stats: [
        { label: "Saved", value: "₱148k" },
        { label: "Budgets kept", value: "11/12" },
        { label: "Debt", value: "₱0" },
      ],
      trophies: [
        { type: "goal", title: "Emergency fund", value: "100%" },
        { type: "best", title: "Lowest spend month", value: "₱18k" },
      ],
    },
  },
  {
    id: "lia",
    name: "Lia Gomez",
    username: "lia.yoga",
    bio: "Mobility, breathwork & morning routines ☀️",
    accent: "life",
    photo: photo("photo-1506126613408-eca07ce68773", 200),
    followers: 9810,
    following: 512,
    isFollowing: false,
    verified: true,
    card: {
      life: 91,
      delta: 1,
      streak: 96,
      best: 120,
      rates: { habits: 0.95, tasks: 0.83, fitness: 0.92, finance: 0.9 },
      stats: [
        { label: "Sessions", value: "604" },
        { label: "Mindful min", value: "9.2k" },
        { label: "Routines", value: "530" },
      ],
      trophies: [
        { type: "streak", title: "100-day streak", value: "100d" },
        { type: "best", title: "Peak level", value: "91" },
        { type: "first", title: "First 1,000 minutes", value: "1k" },
      ],
    },
  },
]

export function seed(): SocialState {
  const now = Date.now()
  const ago = (ms: number) => now - ms
  return {
    people,
    posts: [
      {
        id: "p1",
        by: "ana",
        at: ago(42 * MIN),
        caption:
          "New squat PR 🎉 140kg finally moved. Twelve weeks of boring 5x5 paid off. #legday #progress",
        media: [
          { kind: "image", uri: photo("photo-1534438327276-14e5300c3a48") },
          { kind: "image", uri: photo("photo-1517836357463-d25dfeac3438") },
        ],
        progress: {
          accent: "fit",
          kind: "Workout",
          title: "Lower A",
          subtitle: "Personal record",
          stats: [
            { label: "Top set", value: "140", unit: "kg" },
            { label: "Volume", value: "8.4", unit: "t" },
            { label: "Time", value: "72", unit: "min" },
          ],
          spark: [118, 120, 124, 125, 128, 131, 133, 136, 140],
        },
        location: "Anytime Fitness BGC",
        likes: 128,
        liked: false,
        saved: false,
        likedBy: ["marco", "bea"],
        comments: [
          {
            id: "c1",
            by: "marco",
            text: "Monster 🔥 what's next, 150?",
            at: ago(30 * MIN),
            likes: 4,
            liked: false,
          },
          {
            id: "c2",
            by: "ana",
            text: "@marcoruns 145 first, then we talk 😅",
            at: ago(25 * MIN),
            likes: 2,
            liked: false,
            replyTo: "c1",
          },
        ],
      },
      {
        id: "p2",
        by: "marco",
        at: ago(3 * HOUR),
        caption: "Track Tuesday. 6 × 800m, legs are jelly.",
        media: [
          {
            kind: "video",
            uri: "https://assets.mixkit.co/videos/32807/32807-360.mp4",
            ratio: 9 / 16,
          },
        ],
        location: "UP Diliman Oval",
        likes: 64,
        liked: true,
        saved: false,
        likedBy: ["ana", "josh"],
        comments: [
          {
            id: "c3",
            by: "josh",
            text: "Form looks so clean",
            at: ago(2 * HOUR),
            likes: 1,
            liked: false,
          },
        ],
      },
      {
        id: "p3",
        by: "bea",
        at: ago(6 * HOUR),
        caption:
          "Sunday prep done ✅ 5 lunches, 2,100 kcal, 160g protein a day. Recipe in comments.",
        media: [
          { kind: "image", uri: photo("photo-1512621776951-a57141f2eefd") },
          { kind: "image", uri: photo("photo-1546483875-ad9014c88eba") },
          { kind: "image", uri: photo("photo-1504674900247-0877df9cc836") },
        ],
        likes: 342,
        liked: false,
        saved: true,
        likedBy: ["ana", "lia"],
        comments: [
          {
            id: "c4",
            by: "lia",
            text: "Saving this!! 🙌",
            at: ago(5 * HOUR),
            likes: 8,
            liked: true,
          },
        ],
      },
      {
        id: "p4",
        by: "josh",
        at: ago(20 * HOUR),
        caption:
          "Day 214 of the morning routine. Not every day is great, but every day counts.",
        media: [],
        progress: {
          accent: "hab",
          kind: "Habit streak",
          title: "Morning routine",
          subtitle: "214-day streak",
          stats: [
            { label: "Streak", value: "214", unit: "days" },
            { label: "30-day rate", value: "97", unit: "%" },
            { label: "Best", value: "214", unit: "days" },
          ],
          spark: [80, 84, 86, 90, 88, 92, 95, 94, 97],
        },
        likes: 51,
        liked: false,
        saved: false,
        likedBy: ["marco"],
        comments: [],
      },
      {
        id: "p5",
        by: "kim",
        at: ago(DAY + 3 * HOUR),
        caption:
          "Emergency fund fully funded 🥹 six months of expenses. Started at ₱0 last year.",
        media: [],
        progress: {
          accent: "fin",
          kind: "Savings goal",
          title: "Emergency fund",
          subtitle: "Goal reached",
          stats: [
            { label: "Saved", value: "100", unit: "%" },
            { label: "Months", value: "11" },
            { label: "Per month", value: "₱13k" },
          ],
          spark: [5, 12, 20, 31, 40, 52, 61, 70, 82, 91, 100],
        },
        likes: 902,
        liked: false,
        saved: false,
        likedBy: ["bea", "lia"],
        comments: [],
      },
      {
        id: "p6",
        by: "lia",
        at: ago(2 * DAY),
        caption:
          "Ten minutes of mobility before coffee. That's the whole post.",
        media: [
          { kind: "image", uri: photo("photo-1506126613408-eca07ce68773") },
        ],
        likes: 1204,
        liked: false,
        saved: false,
        likedBy: ["ana"],
        comments: [],
      },
      {
        id: "p7",
        by: ME,
        at: ago(3 * DAY),
        caption: "First 10K of the year ✅",
        media: [
          { kind: "image", uri: photo("photo-1476480862126-209bfaa8edc8") },
        ],
        likes: 37,
        liked: false,
        saved: false,
        likedBy: ["ana", "marco"],
        comments: [
          {
            id: "c9",
            by: "marco",
            text: "Let's run the next one together!",
            at: ago(3 * DAY - HOUR),
            likes: 1,
            liked: true,
          },
        ],
      },
      {
        id: "p8",
        by: ME,
        at: ago(9 * DAY),
        caption: "Week 3 of meal prep",
        media: [
          { kind: "image", uri: photo("photo-1490645935967-10de6ba17061") },
        ],
        likes: 22,
        liked: false,
        saved: false,
        likedBy: ["bea"],
        comments: [],
      },
    ],
    stories: [
      {
        id: "s1",
        by: "ana",
        at: ago(HOUR),
        kind: "image",
        uri: photo("photo-1583454110551-21f2fa2afe61", 720),
      },
      {
        id: "s2",
        by: "ana",
        at: ago(50 * MIN),
        kind: "progress",
        progress: {
          accent: "fit",
          kind: "Workout",
          title: "Squat PR",
          stats: [
            { label: "Top set", value: "140", unit: "kg" },
            { label: "Reps", value: "1" },
          ],
        },
      },
      {
        id: "s3",
        by: "bea",
        at: ago(2 * HOUR),
        kind: "image",
        uri: photo("photo-1546483875-ad9014c88eba", 720),
        audience: "close",
      },
      {
        id: "s4",
        by: "marco",
        at: ago(4 * HOUR),
        kind: "video",
        uri: "https://assets.mixkit.co/videos/32807/32807-360.mp4",
      },
      {
        id: "s5",
        by: "josh",
        at: ago(7 * HOUR),
        kind: "text",
        text: "Discipline is choosing between what you want now and what you want most.",
        bg: ["#7246cf", "#06070a"],
      },
      {
        id: "s6",
        by: "lia",
        at: ago(9 * HOUR),
        kind: "image",
        uri: photo("photo-1502904550040-7534597429ae", 720),
      },
    ],
    seen: ["s6"],
    notes: [
      { by: "ana", text: "deadlift day 💀", at: ago(2 * HOUR) },
      {
        by: "bea",
        text: "who wants my overnight oats recipe",
        at: ago(5 * HOUR),
      },
      { by: "marco", text: "5K Sunday 6am?", at: ago(8 * HOUR) },
      { by: "lia", text: "🧘‍♀️ breathe", at: ago(10 * HOUR) },
    ],
    chats: [
      {
        id: "d1",
        members: ["ana"],
        muted: false,
        pinned: true,
        readAt: ago(40 * MIN),
        messages: [
          {
            id: "m1",
            by: "ana",
            at: ago(HOUR),
            text: "Are you training tomorrow?",
            reactions: {},
          },
          {
            id: "m2",
            by: ME,
            at: ago(58 * MIN),
            text: "Yes! Upper body at 7",
            reactions: { ana: "👍" },
          },
          {
            id: "m3",
            by: "ana",
            at: ago(20 * MIN),
            text: "Perfect, I'll spot you on bench 💪",
            reactions: {},
          },
        ],
      },
      {
        id: "g1",
        members: ["marco", "josh", "ana"],
        name: "Sunday Run Club 🏃",
        muted: false,
        pinned: false,
        readAt: ago(3 * HOUR),
        messages: [
          {
            id: "m4",
            by: "marco",
            at: ago(5 * HOUR),
            text: "Route this week: BGC loop, 8K easy pace",
            reactions: { josh: "🔥", ana: "🔥" },
          },
          {
            id: "m5",
            by: "josh",
            at: ago(4 * HOUR),
            text: "I'm in. Bringing electrolytes",
            reactions: {},
          },
          {
            id: "m6",
            by: "ana",
            at: ago(2 * HOUR),
            postId: "p2",
            text: "This is the pace Marco means by 'easy' 😂",
            reactions: { marco: "😂" },
          },
        ],
      },
      {
        id: "d2",
        members: ["bea"],
        muted: false,
        pinned: false,
        readAt: ago(DAY),
        messages: [
          {
            id: "m7",
            by: "bea",
            at: ago(DAY + HOUR),
            text: "Sent you the macro sheet!",
            reactions: {},
          },
          {
            id: "m8",
            by: ME,
            at: ago(DAY),
            text: "Thank you!! Starting Monday",
            reactions: { bea: "❤️" },
          },
        ],
      },
    ],
    activity: [
      { id: "a1", kind: "like", by: "ana", at: ago(15 * MIN), postId: "p7" },
      {
        id: "a2",
        kind: "comment",
        by: "marco",
        at: ago(3 * DAY - HOUR),
        postId: "p7",
        text: "Let's run the next one together!",
      },
      { id: "a3", kind: "follow", by: "kim", at: ago(5 * HOUR) },
      { id: "a4", kind: "follow", by: "lia", at: ago(2 * DAY) },
      {
        id: "a5",
        kind: "mention",
        by: "josh",
        at: ago(DAY),
        postId: "p4",
        text: "@you keeping me honest every morning",
      },
      { id: "a6", kind: "like", by: "bea", at: ago(9 * DAY), postId: "p8" },
    ],
    activityReadAt: ago(DAY),
    drafts: {},
    showScores: true,
  }
}

export const socialStore = createStore<SocialState>("social", seed)
const set = socialStore.set
const mapPost = (id: string, fn: (p: Post) => Post) =>
  set((s) => ({ ...s, posts: s.posts.map((p) => (p.id === id ? fn(p) : p)) }))
const mapChat = (id: string, fn: (c: Chat) => Chat) =>
  set((s) => ({ ...s, chats: s.chats.map((c) => (c.id === id ? fn(c) : c)) }))

export function useMe(): Person {
  const profile = dashStore.use((s) => s.profile)
  const followers = socialStore.use(
    (s) => s.activity.filter((a) => a.kind === "follow").length,
  )
  const following = socialStore.use(
    (s) => s.people.filter((p) => p.isFollowing).length,
  )
  const name = profile.name || "You"
  return {
    id: ME,
    name,
    username:
      profile.handle?.replace(/^@/, "") ||
      name.toLowerCase().replace(/[^a-z0-9]+/g, ".") ||
      "you",
    bio: "Building better days, one rep at a time.",
    accent: "primary",
    photo: profile.photo || undefined,
    followers: 128 + followers,
    following: 90 + following,
    isFollowing: false,
  }
}
export function usePerson(id: string): Person | undefined {
  const me = useMe()
  const other = socialStore.use((s) => s.people.find((p) => p.id === id))
  return id === ME ? me : other
}

export const toggleLike = (id: string) =>
  mapPost(id, (p) => ({
    ...p,
    liked: !p.liked,
    likes: p.likes + (p.liked ? -1 : 1),
  }))
export const like = (id: string) =>
  mapPost(id, (p) => (p.liked ? p : { ...p, liked: true, likes: p.likes + 1 }))
export const toggleSave = (id: string) =>
  mapPost(id, (p) => ({ ...p, saved: !p.saved }))
export function addComment(postId: string, text: string, replyTo?: string) {
  const comment: Comment = {
    id: uid(),
    by: ME,
    text,
    at: Date.now(),
    likes: 0,
    liked: false,
    replyTo,
  }
  mapPost(postId, (p) => ({ ...p, comments: [...p.comments, comment] }))
  return comment
}
export const toggleCommentLike = (postId: string, commentId: string) =>
  mapPost(postId, (p) => ({
    ...p,
    comments: p.comments.map((c) =>
      c.id === commentId
        ? { ...c, liked: !c.liked, likes: c.likes + (c.liked ? -1 : 1) }
        : c,
    ),
  }))
export const deleteComment = (postId: string, commentId: string) =>
  mapPost(postId, (p) => ({
    ...p,
    comments: p.comments.filter((c) => c.id !== commentId),
  }))
export function createPost(
  p: Pick<Post, "caption" | "media"> &
    Partial<Pick<Post, "progress" | "location">>,
) {
  const post: Post = {
    id: uid(),
    by: ME,
    at: Date.now(),
    likes: 0,
    liked: false,
    saved: false,
    likedBy: [],
    comments: [],
    ...p,
  }
  set((s) => ({ ...s, posts: [post, ...s.posts], drafts: {} }))
  // Friends react a moment later so the post feels alive.
  setTimeout(() => {
    mapPost(post.id, (x) => ({
      ...x,
      likes: x.likes + 3,
      likedBy: ["ana", "marco", "bea"],
    }))
    set((s) => ({
      ...s,
      activity: [
        {
          id: uid(),
          kind: "like",
          by: "ana",
          at: Date.now(),
          postId: post.id,
        },
        ...s.activity,
      ],
    }))
  }, 4000)
  return post
}
export const updateCaption = (id: string, caption: string) =>
  mapPost(id, (p) => ({ ...p, caption }))
export function deletePost(id: string) {
  const before = socialStore.get().posts
  set((s) => ({ ...s, posts: s.posts.filter((p) => p.id !== id) }))
  return () => set((s) => ({ ...s, posts: before }))
}
export function addStory(item: Omit<StoryItem, "id" | "by" | "at">) {
  const story: StoryItem = { id: uid(), by: ME, at: Date.now(), ...item }
  set((s) => ({
    ...s,
    stories: [...s.stories, story],
    seen: [...s.seen, story.id],
    drafts: {},
  }))
  return story
}
export const deleteStory = (id: string) =>
  set((s) => ({ ...s, stories: s.stories.filter((x) => x.id !== id) }))
export const markSeen = (id: string) =>
  set((s) => (s.seen.includes(id) ? s : { ...s, seen: [...s.seen, id] }))
export const toggleStoryLike = (id: string) =>
  set((s) => ({
    ...s,
    stories: s.stories.map((x) =>
      x.id === id ? { ...x, liked: !x.liked } : x,
    ),
  }))
export const setNote = (text: string) =>
  set((s) => ({
    ...s,
    notes: [
      { by: ME, text, at: Date.now() },
      ...s.notes.filter((n) => n.by !== ME),
    ],
  }))
export const clearNote = () =>
  set((s) => ({ ...s, notes: s.notes.filter((n) => n.by !== ME) }))
export const toggleNoteLike = (by: string) =>
  set((s) => ({
    ...s,
    notes: s.notes.map((n) => (n.by === by ? { ...n, liked: !n.liked } : n)),
  }))
export function toggleFollow(id: string) {
  set((s) => ({
    ...s,
    people: s.people.map((p) =>
      p.id === id
        ? {
            ...p,
            isFollowing: !p.isFollowing,
            followers: p.followers + (p.isFollowing ? -1 : 1),
          }
        : p,
    ),
  }))
}
export const toggleCloseFriend = (id: string) =>
  set((s) => ({
    ...s,
    people: s.people.map((p) =>
      p.id === id ? { ...p, closeFriend: !p.closeFriend } : p,
    ),
  }))
export const toggleShowScores = () =>
  set((s) => ({ ...s, showScores: !s.showScores }))
export const markActivityRead = () =>
  set((s) => ({ ...s, activityReadAt: Date.now() }))

/** Open (or create) the 1:1 chat with a person; returns its id. */
export function directChat(personId: string) {
  const existing = socialStore
    .get()
    .chats.find(
      (c) => !c.name && c.members.length === 1 && c.members[0] === personId,
    )
  if (existing) return existing.id
  const chat: Chat = {
    id: uid(),
    members: [personId],
    messages: [],
    muted: false,
    pinned: false,
    readAt: Date.now(),
  }
  set((s) => ({ ...s, chats: [chat, ...s.chats] }))
  return chat.id
}
export function createGroup(members: string[], name: string) {
  const chat: Chat = {
    id: uid(),
    members,
    name,
    muted: false,
    pinned: false,
    readAt: Date.now(),
    messages: [
      {
        id: uid(),
        by: ME,
        at: Date.now(),
        text: `You created the group "${name}"`,
        system: true,
        reactions: {},
      },
    ],
  }
  set((s) => ({ ...s, chats: [chat, ...s.chats] }))
  return chat.id
}
export function sendMessage(
  chatId: string,
  m: Omit<Message, "id" | "by" | "at" | "reactions">,
) {
  const message: Message = {
    id: uid(),
    by: ME,
    at: Date.now(),
    reactions: {},
    ...m,
  }
  mapChat(chatId, (c) => ({
    ...c,
    readAt: Date.now(),
    messages: [...c.messages, message],
  }))
  return message
}
const replies = [
  "Haha love it 😂",
  "Let's go!! 💪",
  "Wait that's actually so good",
  "Same time tomorrow?",
  "🔥🔥🔥",
  "Proud of you fr",
  "Ok I'm stealing this idea",
]
/** Simulated friend reply; returns the replying person's id, if any. */
export function simulateReply(chatId: string, delay = 1800) {
  const chat = socialStore.get().chats.find((c) => c.id === chatId)
  if (!chat || chat.members.length === 0) return null
  const by = chat.members[Math.floor(Math.random() * chat.members.length)]
  setTimeout(() => {
    const message: Message = {
      id: uid(),
      by,
      at: Date.now(),
      text: replies[Math.floor(Math.random() * replies.length)],
      reactions: {},
    }
    mapChat(chatId, (c) => ({ ...c, messages: [...c.messages, message] }))
  }, delay)
  return by
}
export const reactTo = (chatId: string, messageId: string, emoji: string) =>
  mapChat(chatId, (c) => ({
    ...c,
    messages: c.messages.map((m) => {
      if (m.id !== messageId) return m
      const reactions = { ...m.reactions }
      if (reactions[ME] === emoji) delete reactions[ME]
      else reactions[ME] = emoji
      return { ...m, reactions }
    }),
  }))
export const unsend = (chatId: string, messageId: string) =>
  mapChat(chatId, (c) => ({
    ...c,
    messages: c.messages.filter((m) => m.id !== messageId),
  }))
export const markChatRead = (chatId: string) =>
  mapChat(chatId, (c) => ({ ...c, readAt: Date.now() }))
export const toggleMute = (chatId: string) =>
  mapChat(chatId, (c) => ({ ...c, muted: !c.muted }))
export const togglePin = (chatId: string) =>
  mapChat(chatId, (c) => ({ ...c, pinned: !c.pinned }))
export const renameChat = (chatId: string, name: string) =>
  mapChat(chatId, (c) => ({ ...c, name }))
export const addMembers = (chatId: string, ids: string[]) =>
  mapChat(chatId, (c) => ({
    ...c,
    members: [...new Set([...c.members, ...ids])],
  }))
export function deleteChat(chatId: string) {
  const before = socialStore.get().chats
  set((s) => ({ ...s, chats: s.chats.filter((c) => c.id !== chatId) }))
  return () => set((s) => ({ ...s, chats: before }))
}
export const setPostDraft = (post: Partial<Post>) =>
  set((s) => ({ ...s, drafts: { ...s.drafts, post } }))
export const setStoryDraft = (story: Partial<StoryItem>) =>
  set((s) => ({ ...s, drafts: { ...s.drafts, story } }))

export const unread = (c: Chat) =>
  c.messages.filter((m) => m.by !== ME && m.at > c.readAt).length
export function timeAgo(at: number, now = Date.now()) {
  const d = Math.max(0, now - at)
  if (d < MIN) return "now"
  if (d < HOUR) return `${Math.floor(d / MIN)}m`
  if (d < DAY) return `${Math.floor(d / HOUR)}h`
  if (d < 7 * DAY) return `${Math.floor(d / DAY)}d`
  return new Date(at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })
}
export const compact = (n: number) =>
  n >= 10_000
    ? `${Math.round(n / 1000)}K`
    : n >= 1000
      ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`
      : String(n)
/** Story groups for the tray: me first, then unseen, then seen. */
export function storyGroups(s: SocialState) {
  const by = new Map<string, StoryItem[]>()
  for (const item of [...s.stories].sort((a, b) => a.at - b.at))
    by.set(item.by, [...(by.get(item.by) ?? []), item])
  const groups = [...by.entries()].map(([id, items]) => ({
    id,
    items,
    unseen: items.some((i) => !s.seen.includes(i.id)),
    close: items.some((i) => i.audience === "close"),
    latest: items[items.length - 1].at,
  }))
  return groups.sort((a, b) =>
    a.id === ME
      ? -1
      : b.id === ME
        ? 1
        : Number(b.unseen) - Number(a.unseen) || b.latest - a.latest,
  )
}
/** "3h ago", "Just now", or a date for older items. */
export function agoText(at: number) {
  const x = timeAgo(at)
  return x === "now" ? "Just now" : /\d[mhd]$/.test(x) ? `${x} ago` : x
}
export const clearDrafts = () => set((s) => ({ ...s, drafts: {} }))
