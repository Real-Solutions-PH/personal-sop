import {
  activityText,
  addComment,
  deleteComment,
  lastMineSeen,
  liveNotes,
  ME,
  type Message,
  postLink,
  profileLink,
  socialStore,
  storyGroups,
  systemLine,
} from "../social/store"

beforeEach(() => socialStore.reset())

const HOUR = 3_600_000

test("a check-in older than 24 hours leaves the tray, even from a saved store", () => {
  const now = Date.now()
  socialStore.set((s) => ({
    ...s,
    stories: [
      { id: "old", by: "ana", at: now - 25 * HOUR, kind: "text", text: "x" },
      { id: "new", by: "ana", at: now - HOUR, kind: "text", text: "y" },
    ],
  }))
  const ana = storyGroups(socialStore.get()).find((g) => g.id === "ana")
  expect(ana?.items.map((i) => i.id)).toEqual(["new"])
})

test("a note older than 24 hours is not shown", () => {
  const now = Date.now()
  const notes = liveNotes([
    { by: "ana", text: "old", at: now - 25 * HOUR },
    { by: "bea", text: "new", at: now - HOUR },
  ])
  expect(notes.map((n) => n.text)).toEqual(["new"])
})

test("activity reads what really happened: a liked comment or note is not a cheer", () => {
  expect(activityText("like", "proud")).toBe(
    "cheered your progress: 👏 Proud of you.",
  )
  expect(activityText("like", undefined)).toBe("cheered your progress.")
  expect(activityText("like", "liked your comment")).toBe("liked your comment.")
  expect(activityText("like", "liked your note")).toBe("liked your note.")
  expect(activityText("comment", "nice")).toBe("commented: nice")
  expect(activityText("story", undefined)).toBe("liked your story.")
})

test("deleting a comment drops it, its replies and the comment count", () => {
  const post = socialStore.get().posts[0]
  socialStore.set((s) => ({
    ...s,
    posts: s.posts.map((p) =>
      p.id === post.id ? { ...p, commentCount: p.comments.length } : p,
    ),
  }))
  const parent = addComment(post.id, "first")
  addComment(post.id, "reply", parent.id)
  const before = socialStore.get().posts.find((p) => p.id === post.id)
  deleteComment(post.id, parent.id)
  const after = socialStore.get().posts.find((p) => p.id === post.id)
  expect(after?.comments.some((c) => c.replyTo === parent.id)).toBe(false)
  expect(after?.comments.length).toBe((before?.comments.length ?? 0) - 2)
  // Both were counted when added, so both come off.
  expect(before?.commentCount).toBe(post.comments.length + 2)
  expect(after?.commentCount).toBe(post.comments.length)
})

test("a server group line names who did it", () => {
  const line = (by: string, text: string): Message => ({
    id: "m",
    by,
    at: 0,
    text,
    system: true,
    reactions: {},
  })
  expect(systemLine(line(ME, 'created the group "Gym"'), "Ana")).toBe(
    'You created the group "Gym"',
  )
  expect(systemLine(line("ana", "left the group"), "Ana")).toBe(
    "Ana left the group",
  )
  // Lines written on this device already carry their subject.
  expect(systemLine(line(ME, "You added Bea"), "Ana")).toBe("You added Bea")
})

test('"Seen" uses the other members\' read marks, not only their replies', () => {
  const chat = socialStore.get().chats[0]
  const at = Date.now() + 60_000 // after every seeded message
  const mine: Message = {
    id: "x",
    by: ME,
    at,
    text: "hi",
    reactions: {},
  }
  const withMine = { ...chat, messages: [...chat.messages, mine] }
  expect(lastMineSeen({ ...withMine, readBy: {} })).toBe(false)
  expect(lastMineSeen({ ...withMine, readBy: { ana: at - 1 } })).toBe(false)
  expect(lastMineSeen({ ...withMine, readBy: { ana: at } })).toBe(true)
})

test("shared links open the app, not a dead web domain", () => {
  expect(postLink("p1")).toBe("personalsop://social/post/p1")
  expect(profileLink("u1")).toBe("personalsop://social/u/u1")
})
