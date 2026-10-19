// Social — chats (live mode).
//
// User A is driven through the UI; users B and C act through the API. Every
// action is proven through the API and in Postgres; the live checks keep A's
// screen open and mark the window so a reload would be caught.
//
// | Screen              | Action                                       | Test |
// |---------------------|----------------------------------------------|------|
// | /social/new-chat    | Search a person, open a direct chat          | "opens a direct chat …" |
// | /social/chat/[id]   | Send a message                               | "opens a direct chat …" |
// | /social/chat/[id]   | React to a message (long press menu)         | "reacts to and unsends …" |
// | /social/chat/[id]   | Unsend my message (long press menu)          | "reacts to and unsends …" |
// | /social/chat/[id]   | Reply / Copy                                 | Copy: NOT COVERABLE ON WEB (clipboard only); Reply is a send with reply_to — "reacts to and unsends …" |
// | /social/chat/[id]   | Send heart                                   | "opens a direct chat …" |
// | /social/chat/[id]   | Send a photo / voice / video call            | NOT COVERABLE ON WEB: native picker; calls are not built (no server effect) |
// | /social/new-chat    | Pick two people → group chat                 | "creates a group chat …" |
// | /social/chat/[id]   | B sends → A sees it live (SSE)               | "B's message, typing and reaction reach A live …" |
// | /social/chat/[id]   | B typing → "typing…" live (SSE)              | "B's message, typing and reaction reach A live …" |
// | /social/inbox       | Unread counts (inbox row, feed header)       | "unread counts …" |
// | post card           | Send a post into a chat                      | "shares a post into a chat" |
import { apiCall, longPress, namedUser, rows } from "./social-helpers"
import type { LiveUser } from "./support"

const stamp = () => Date.now().toString(36)

/** B's direct chat with A, created by B on the server. */
function directFrom(b: LiveUser, aId: string) {
  return cy.liveApi<{ id: string }>(b, "POST", "/social/chats/direct", {
    user_id: aId,
  })
}

describe("social chats (live)", () => {
  it("opens a direct chat from search and sends messages", () => {
    namedUser("Bea").then((b) => {
      namedUser("Ann").then((a) => {
        cy.signInLive(a)
        cy.visit("/social/new-chat")
        cy.findByRole("textbox", { name: "Search people" }).type(b.handle)
        cy.findByRole("checkbox", { name: b.name }).click()
        cy.findByRole("button", { name: "Chat" }).click()
        cy.location("pathname").should("match", /^\/social\/chat\//)
        cy.findByRole("textbox", { name: "Message" }).type("Hi Bea")
        cy.findByRole("button", { name: "Send" }).click()
        cy.findByText("Hi Bea").should("exist")
        cy.findByRole("button", { name: "Send heart" }).click()

        cy.eventuallyRows(
          "select c.id from chat c join chat_member m on m.chat_id = c.id where c.is_group = false and m.owner_id = $1 and c.deleted_at is null",
          [a.id],
        ).then(([c]) => {
          cy.eventuallyRows(
            "select owner_id from chat_member where chat_id = $1 and deleted_at is null and left_at is null",
            [c.id],
            2,
          ).then((ms) => {
            expect(ms.map((m) => m.owner_id).sort()).to.deep.eq(
              [a.id, b.id].sort(),
            )
          })
          cy.eventuallyRows(
            "select text from chat_message where chat_id = $1 and owner_id = $2 and system = false and deleted_at is null order by at",
            [c.id, a.id],
            2,
          ).then((ms) => {
            expect(ms.map((m) => m.text)).to.deep.eq(["Hi Bea", "❤️"])
          })
          // B reads the same thread.
          cy.eventuallyApi<{ data: { text: string | null }[] }>(
            b,
            `/social/chats/${c.id}/messages`,
            (l) => l.data.some((m) => m.text === "Hi Bea"),
          )
        })
      })
    })
  })

  it("reacts to and unsends messages, and replies to one", () => {
    namedUser("Bea").then((b) => {
      namedUser("Ann").then((a) => {
        directFrom(b, a.id).then((chat) => {
          cy.liveApi<{ id: string }>(
            b,
            "POST",
            `/social/chats/${chat.id}/messages`,
            { text: "React to me" },
          ).then((theirs) => {
            cy.signInLive(a)
            cy.visit(`/social/chat/${chat.id}`)
            cy.findByText("React to me").then(($m) => longPress($m))
            cy.findAllByRole("button", { name: /^React / })
              .first()
              .click()
            cy.eventuallyRows(
              "select emoji from message_reaction where owner_id = $1 and message_id = $2 and deleted_at is null",
              [a.id, theirs.id],
            ).then(([r]) => expect(r.emoji).to.eq("❤️"))
            cy.eventuallyApi<{
              data: { id: string; reactions: Record<string, string> }[]
            }>(b, `/social/chats/${chat.id}/messages`, (l) =>
              l.data.some(
                (m) => m.id === theirs.id && m.reactions[a.id] === "❤️",
              ),
            )

            // Reply: the long-press menu's Reply quotes the message.
            cy.findByText("React to me").then(($m) => longPress($m))
            cy.findByRole("button", { name: "Reply" }).click()
            cy.findByRole("textbox", { name: "Message" }).type("Replying")
            cy.findByRole("button", { name: "Send" }).click()
            cy.eventuallyRows(
              "select id from chat_message where chat_id = $1 and owner_id = $2 and text = 'Replying' and reply_to_id = $3",
              [chat.id, a.id, theirs.id],
            )

            // Send, then unsend my own message.
            cy.findByRole("textbox", { name: "Message" }).type("Oops typo")
            cy.findByRole("button", { name: "Send" }).click()
            cy.eventuallyRows(
              "select id from chat_message where chat_id = $1 and owner_id = $2 and text = 'Oops typo' and deleted_at is null",
              [chat.id, a.id],
            ).then(([mine]) => {
              cy.findByText("Oops typo").then(($m) => longPress($m))
              cy.findByRole("button", { name: "Unsend" }).click()
              cy.findByText("Oops typo").should("not.exist")
              cy.eventuallyRows(
                "select id from chat_message where id = $1 and deleted_at is not null",
                [mine.id],
              )
              cy.eventuallyApi<{ data: { id: string }[] }>(
                b,
                `/social/chats/${chat.id}/messages`,
                (l) => !l.data.some((m) => m.id === mine.id),
              )
            })
          })
        })
      })
    })
  })

  it("creates a group chat with two people", () => {
    namedUser("Cy").then((c) => {
      namedUser("Bea").then((b) => {
        namedUser("Ann").then((a) => {
          const name = `Crew ${stamp()}`
          cy.signInLive(a)
          cy.visit("/social/new-chat")
          cy.findByRole("textbox", { name: "Search people" }).type(b.handle)
          cy.findByRole("checkbox", { name: b.name }).click()
          cy.findByRole("textbox", { name: "Search people" })
            .clear()
            .type(c.handle)
          cy.findByRole("checkbox", { name: c.name }).click()
          cy.findByRole("textbox", { name: "Group name" }).type(name)
          cy.findByRole("button", { name: "Create" }).click()
          cy.location("pathname").should("match", /^\/social\/chat\//)
          cy.findByRole("textbox", { name: "Message" }).type("Welcome all")
          cy.findByRole("button", { name: "Send" }).click()

          cy.eventuallyRows(
            "select id from chat where name = $1 and is_group = true and deleted_at is null",
            [name],
          ).then(([chat]) => {
            cy.eventuallyRows(
              "select owner_id from chat_member where chat_id = $1 and left_at is null and deleted_at is null",
              [chat.id],
              3,
            ).then((ms) => {
              expect(ms.map((m) => m.owner_id).sort()).to.deep.eq(
                [a.id, b.id, c.id].sort(),
              )
            })
            cy.eventuallyRows(
              "select id from chat_message where chat_id = $1 and owner_id = $2 and text = 'Welcome all'",
              [chat.id, a.id],
            )
            cy.eventuallyApi<{ data: { id: string; name: string }[] }>(
              c,
              "/social/chats",
              (l) => l.data.some((x) => x.id === chat.id && x.name === name),
            )
          })
        })
      })
    })
  })

  it("B's message, typing and reaction reach A's open chat live", () => {
    namedUser("Bea").then((b) => {
      namedUser("Ann").then((a) => {
        directFrom(b, a.id).then((chat) => {
          cy.liveApi(b, "POST", `/social/chats/${chat.id}/messages`, {
            text: "Opening line",
          })
          cy.signInLive(a)
          cy.visit(`/social/chat/${chat.id}`)
          cy.findByText("Opening line").should("exist")
          cy.findByRole("textbox", { name: "Message" }).type("Mine")
          cy.findByRole("button", { name: "Send" }).click()
          cy.eventuallyRows(
            "select id from chat_message where chat_id = $1 and owner_id = $2 and text = 'Mine'",
            [chat.id, a.id],
          ).then(([mine]) => {
            cy.window().then((win) => {
              ;(win as unknown as { __noReload: boolean }).__noReload = true
            })
            apiCall(b, "POST", `/social/chats/${chat.id}/typing`).should(
              "eq",
              204,
            )
            cy.findByText("typing…", { timeout: 15000 }).should("exist")
            cy.liveApi(b, "POST", `/social/chats/${chat.id}/messages`, {
              text: "Live from Bea",
            })
            cy.findByText("Live from Bea", { timeout: 15000 }).should("exist")
            cy.findByText("typing…").should("not.exist")
            cy.liveApi(
              b,
              "PUT",
              `/social/chats/${chat.id}/messages/${mine.id}/reaction`,
              { emoji: "🔥" },
            )
            cy.findByText("🔥", { timeout: 15000 }).should("exist")
            cy.window().its("__noReload").should("eq", true)
            cy.eventuallyRows(
              "select id from message_reaction where owner_id = $1 and message_id = $2 and emoji = '🔥'",
              [b.id, mine.id],
            )
          })
        })
      })
    })
  })

  it("unread counts show on the inbox and the feed, and clear on read", () => {
    namedUser("Bea").then((b) => {
      namedUser("Ann").then((a) => {
        directFrom(b, a.id).then((chat) => {
          for (const text of ["one", "two"])
            cy.liveApi(b, "POST", `/social/chats/${chat.id}/messages`, {
              text,
            })
          cy.eventuallyApi<{ data: { id: string; unread: number }[] }>(
            a,
            "/social/chats",
            (l) => l.data.some((c) => c.id === chat.id && c.unread === 2),
          )
          cy.signInLive(a)
          cy.visit("/social")
          cy.findByRole("button", { name: "Messages, 1 unread" }).should(
            "exist",
          )
          cy.visit("/social/inbox")
          cy.findByRole("button", { name: /, 2 unread$/ }).click()
          cy.findAllByText("two").should("have.length.at.least", 1)
          cy.eventuallyApi<{ data: { id: string; unread: number }[] }>(
            a,
            "/social/chats",
            (l) => l.data.some((c) => c.id === chat.id && c.unread === 0),
          )
          cy.eventuallyRows(
            "select read_at from chat_member where chat_id = $1 and owner_id = $2 and read_at is not null",
            [chat.id, a.id],
          )
          cy.visit("/social")
          cy.findByRole("button", { name: "Messages" }).should("exist")
        })
      })
    })
  })

  it("shares a post into a chat", () => {
    namedUser("Bea").then((b) => {
      namedUser("Ann").then((a) => {
        directFrom(b, a.id).then((chat) => {
          cy.liveApi<{ id: string }>(b, "POST", "/social/posts", {
            caption: `Share me ${stamp()}`,
            media: [],
            progress: {
              accent: "tsk",
              kind: "tasks",
              title: "This week",
              stats: [],
            },
          }).then((post) => {
            cy.signInLive(a)
            cy.visit(`/social/post/${post.id}`)
            cy.findByRole("button", { name: "Send" }).click()
            cy.findByRole("button", { name: `Send to ${b.name}` }).click()
            cy.eventuallyRows(
              "select id from chat_message where chat_id = $1 and owner_id = $2 and post_id = $3",
              [chat.id, a.id, post.id],
            )
            rows(
              "select id from chat where id = $1 and last_message_at is not null",
              [chat.id],
            ).should("have.length", 1)
          })
        })
      })
    })
  })
})
