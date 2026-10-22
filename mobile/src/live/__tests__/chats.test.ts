// Chats with the companion: a new chat is empty and opened, an empty one is
// reused, messages land in the chat on screen and name it, a deleted chat
// takes its messages, and the server's copy merges without losing a name.
import { configureStorage, resetAll } from "@domain/lib/store"
import {
  addMessage,
  chatList,
  chatMessages,
  companionStore,
  currentThread,
  deleteChat,
  newChat,
  openChat,
  titleFrom,
} from "@/prototype/companion/store"
import { messageFromServer, threadMapper } from "../mappers/companion"

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
})

const state = () => companionStore.get()

it("a message with no chat yet makes one, named from the question", () => {
  addMessage({ role: "me", text: "planning a trip to Cebu with Ana" })
  const [chat] = chatList(state())
  expect(chat.title).toBe("planning a trip to Cebu with Ana")
  expect(currentThread(state())).toBe(chat.id)
  expect(chatMessages(state()).map((m) => m.text)).toEqual([
    "planning a trip to Cebu with Ana",
  ])
})

it("a new chat starts empty, and an empty one is reused", () => {
  addMessage({ role: "me", text: "first chat" })
  const first = currentThread(state())
  const second = newChat()
  expect(second).not.toBe(first)
  expect(chatMessages(state())).toEqual([])
  expect(newChat()).toBe(second)
  addMessage({ role: "me", text: "second chat" })
  openChat(first as string)
  expect(chatMessages(state()).map((m) => m.text)).toEqual(["first chat"])
})

it("deleting a chat takes its messages and falls back to the latest", () => {
  addMessage({ role: "me", text: "keep me" })
  const keep = currentThread(state())
  const gone = newChat()
  addMessage({ role: "me", text: "drop me" })
  deleteChat(gone)
  expect(state().messages.map((m) => m.text)).toEqual(["keep me"])
  expect(currentThread(state())).toBe(keep)
})

it("titles are cut on a word", () => {
  const t = titleFrom(
    "add the fixing the bed as a habit and set that as the first habit in the morning routine",
  )
  expect(t.endsWith("…")).toBe(true)
  expect(t.length).toBeLessThanOrEqual(48)
})

it("pulled chats keep a name given on the phone and drop deleted ones", () => {
  const m = threadMapper()
  const id = newChat()
  companionStore.set((s) => ({
    ...s,
    threads: (s.threads ?? []).map((t) =>
      t.id === id ? { ...t, title: "Cebu trip" } : t,
    ),
  }))
  const pulled = m.fromServer(
    { id, title: null, last_at: null, created_at: new Date().toISOString() },
    state(),
  )
  if (!pulled) throw new Error("a chat row maps to a chat")
  let s = m.merge(state(), [pulled], [])
  expect(s.threads?.find((t) => t.id === id)?.title).toBe("Cebu trip")
  s = { ...s, messages: [{ id: "x", role: "me", at: 1, threadId: id }] }
  s = m.merge(s, [], [id])
  expect(s.threads).toEqual([])
  expect(s.messages).toEqual([])
})

it("a server message keeps its chat", () => {
  expect(
    messageFromServer({
      id: "m1",
      role: "sol",
      text: "hi",
      blocks: [],
      created_at: new Date().toISOString(),
      thread_id: "t1",
    }).threadId,
  ).toBe("t1")
})

it("a question the router turns into a capture still names its chat", () => {
  const { ask } =
    require("@/prototype/companion/brain") as typeof import("@/prototype/companion/brain")
  ask("Plan my week of workouts")
  const [chat] = chatList(state())
  expect(chat.title).toBe("Plan my week of workouts")
  expect(chat.lastAt).not.toBeNull()
})
