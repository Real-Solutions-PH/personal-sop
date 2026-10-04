import {
  addComment,
  addStory,
  agoText,
  createGroup,
  directChat,
  ME,
  markChatRead,
  markSeen,
  reactTo,
  sendMessage,
  socialStore,
  storyGroups,
  toggleLike,
  unread,
} from "../social/store"

beforeEach(() => {
  jest.useFakeTimers()
  socialStore.reset()
})
afterEach(() => jest.useRealTimers())

test("story tray puts you first, then unseen people, then seen", () => {
  addStory({ kind: "text", text: "hi" })
  const s = socialStore.get()
  const groups = storyGroups(s)
  expect(groups[0].id).toBe(ME)
  const firstSeen = groups.findIndex((g) => g.id !== ME && !g.unseen)
  const lastUnseen = groups
    .map((g) => g.id !== ME && g.unseen)
    .lastIndexOf(true)
  expect(firstSeen).toBeGreaterThan(lastUnseen)
  for (const item of groups[1].items) markSeen(item.id)
  expect(
    storyGroups(socialStore.get()).find((g) => g.id === groups[1].id)?.unseen,
  ).toBe(false)
})

test("likes toggle and comments thread under their parent", () => {
  const before = socialStore.get().posts.find((p) => p.id === "p1")!
  toggleLike("p1")
  expect(socialStore.get().posts.find((p) => p.id === "p1")!.likes).toBe(
    before.likes + 1,
  )
  toggleLike("p1")
  expect(socialStore.get().posts.find((p) => p.id === "p1")!.likes).toBe(
    before.likes,
  )
  const c = addComment("p1", "nice", "c1")
  expect(c.replyTo).toBe("c1")
})

test("unread counts only others' messages after the read mark; reactions toggle", () => {
  const id = directChat("kim")
  expect(directChat("kim")).toBe(id)
  sendMessage(id, { text: "hey" })
  const chat = () => socialStore.get().chats.find((c) => c.id === id)!
  expect(unread(chat())).toBe(0)
  const m = chat().messages[0]
  reactTo(id, m.id, "🔥")
  expect(chat().messages[0].reactions[ME]).toBe("🔥")
  reactTo(id, m.id, "🔥")
  expect(chat().messages[0].reactions[ME]).toBeUndefined()
  const g = createGroup(["ana", "bea"], "Gym")
  socialStore.set((s) => ({
    ...s,
    chats: s.chats.map((c) =>
      c.id === g
        ? {
            ...c,
            readAt: 0,
            messages: [
              ...c.messages,
              { id: "x", by: "ana", at: 1, reactions: {} },
            ],
          }
        : c,
    ),
  }))
  expect(unread(socialStore.get().chats.find((c) => c.id === g)!)).toBe(1)
  markChatRead(g)
  expect(unread(socialStore.get().chats.find((c) => c.id === g)!)).toBe(0)
})

test("relative time labels", () => {
  expect(agoText(Date.now())).toBe("Just now")
  expect(agoText(Date.now() - 3 * 3_600_000)).toBe("3h ago")
})
