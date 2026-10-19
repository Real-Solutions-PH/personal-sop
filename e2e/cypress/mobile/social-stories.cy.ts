// Social — stories and notes (live mode).
//
// User A is driven through the UI; user B acts through the API. Every action
// is proven through the API and in Postgres.
//
// | Screen               | Action                                       | Test |
// |----------------------|----------------------------------------------|------|
// | /social/story-new    | Text story → "Share to your story"           | "shares a text story …" (+ 24 h expiry in SQL) |
// | /social/story-new    | "Share to close friends"                     | "a close-friends story …" |
// | /social/story-new    | Photo / video / progress story               | NOT COVERABLE ON WEB: native picker for photo/video; progress uses the same create call as text |
// | /social/stories/[id] | View B's story (seen), like it               | "sees and likes B's story …" |
// | /social/stories/[id] | Reply / quick reaction                       | "sees and likes B's story …" (reply lands as a chat message) |
// | /social/stories/[me] | Delete my story                              | "shares a text story …" |
// | /social/inbox        | Leave a note, delete it                      | "leaves a note …" |
// | /social/inbox        | Open B's note, like it, reply to it          | "likes B's note …" |
import { namedUser, signIn } from "./social-helpers"

const stamp = () => Date.now().toString(36)

describe("social stories & notes (live)", () => {
  it("shares a text story that expires in 24 hours, then deletes it", () => {
    namedUser("Bea").then((b) => {
      namedUser("Ann").then((a) => {
        const text = `Morning run ${stamp()}`
        cy.liveApi(b, "PUT", `/social/people/${a.id}/follow`)
        signIn(a)
        cy.visit("/social/story-new")
        cy.findByRole("textbox", { name: "Story text" }).type(text)
        cy.findByRole("button", { name: "Share to your story" }).click()
        cy.eventuallyRows(
          "select id, kind, audience, extract(epoch from expires_at - created_at)::int as ttl, expires_at > now() as live from story where owner_id = $1 and text = $2 and deleted_at is null",
          [a.id, text],
        ).then(([s]) => {
          expect(s.kind).to.eq("text")
          expect(s.audience).to.eq("everyone")
          expect(s.ttl).to.eq(24 * 3600)
          expect(s.live).to.eq(true)
          // B follows A, so B's tray carries it.
          cy.eventuallyApi<{
            data: { person: { id: string }; items: { id: string }[] }[]
          }>(b, "/social/stories", (t) =>
            t.data.some(
              (g) => g.person.id === a.id && g.items.some((i) => i.id === s.id),
            ),
          )

          cy.visit("/social/stories/me")
          cy.findByText(text).should("exist")
          cy.findByRole("button", { name: "Delete story" }).click()
          cy.eventuallyRows(
            "select id from story where id = $1 and deleted_at is not null",
            [s.id],
          )
          cy.eventuallyApi<{ data: { items: { id: string }[] }[] }>(
            b,
            "/social/stories",
            (t) => !t.data.some((g) => g.items.some((i) => i.id === s.id)),
          )
        })
      })
    })
  })

  it("a close-friends story reaches close friends only", () => {
    namedUser("Cy").then((c) => {
      namedUser("Bea").then((b) => {
        namedUser("Ann").then((a) => {
          const text = `Close only ${stamp()}`
          // B is on A's close friends; C only follows A.
          cy.liveApi(b, "PUT", `/social/people/${a.id}/follow`)
          cy.liveApi(c, "PUT", `/social/people/${a.id}/follow`)
          cy.liveApi(a, "PUT", `/social/people/${b.id}/close-friend`, {
            close_friend: true,
          })
          signIn(a)
          cy.visit("/social/story-new")
          cy.findByRole("textbox", { name: "Story text" }).type(text)
          cy.findByRole("button", { name: "Share to close friends" }).click()
          cy.eventuallyRows(
            "select id from story where owner_id = $1 and text = $2 and audience = 'close' and deleted_at is null",
            [a.id, text],
          ).then(([s]) => {
            cy.eventuallyApi<{ data: { items: { id: string }[] }[] }>(
              b,
              "/social/stories",
              (t) => t.data.some((g) => g.items.some((i) => i.id === s.id)),
            )
            cy.liveApi<{ data: { items: { id: string }[] }[] }>(
              c,
              "GET",
              "/social/stories",
            ).then((t) => {
              expect(t.data.some((g) => g.items.some((i) => i.id === s.id))).to
                .be.false
            })
          })
        })
      })
    })
  })

  it("sees and likes B's story, and replies to it", () => {
    namedUser("Bea").then((b) => {
      namedUser("Ann").then((a) => {
        const text = `Bea's day ${stamp()}`
        cy.liveApi(a, "PUT", `/social/people/${b.id}/follow`)
        cy.liveApi<{ id: string }>(b, "POST", "/social/stories", {
          kind: "text",
          text,
          audience: "everyone",
        }).then((story) => {
          signIn(a)
          cy.visit(`/social/stories/${b.id}`)
          cy.findByText(text).should("exist")
          // The viewer moves on when the story's timer ends. Typing a reply
          // pauses it (and hides Like), so reply first, then like at once;
          // the like is proven on the server below, not by the button.
          cy.findByRole("textbox", { name: "Reply to story" }).type(
            "Looks great",
          )
          cy.findByRole("button", { name: "Send reply" }).click()
          cy.findByRole("textbox", { name: "Reply to story" }).blur()
          cy.findByRole("button", { name: "Like story" }).click()

          cy.eventuallyRows(
            "select id from story_seen where owner_id = $1 and story_id = $2 and deleted_at is null",
            [a.id, story.id],
          )
          cy.eventuallyRows(
            "select id from story_like where owner_id = $1 and story_id = $2 and deleted_at is null",
            [a.id, story.id],
          )
          cy.eventuallyRows(
            "select id from activity where owner_id = $1 and actor_id = $2 and kind = 'story' and deleted_at is null",
            [b.id, a.id],
          )
          cy.eventuallyApi<{ seen: boolean; liked: boolean }>(
            a,
            `/social/stories/${story.id}`,
            (s) => s.seen && s.liked,
          )
          cy.eventuallyRows(
            "select m.id from chat_message m where m.owner_id = $1 and m.story_id = $2 and m.text = 'Looks great' and m.deleted_at is null",
            [a.id, story.id],
          )
        })
      })
    })
  })

  it("leaves a note that a follower can read", () => {
    namedUser("Bea").then((b) => {
      namedUser("Ann").then((a) => {
        const text = `Deep work ${stamp()}`.slice(0, 40)
        cy.liveApi(b, "PUT", `/social/people/${a.id}/follow`)
        signIn(a)
        cy.visit("/social/inbox")
        cy.findByRole("button", { name: "Leave a note" }).click()
        cy.findByRole("textbox", { name: "Note text" }).type(text)
        cy.findByRole("button", { name: "Share" }).click()
        cy.findByRole("button", { name: `Your note: ${text}` }).should("exist")
        cy.eventuallyRows(
          "select id, expires_at > now() as live from note where owner_id = $1 and text = $2 and deleted_at is null",
          [a.id, text],
        ).then(([n]) => {
          expect(n.live).to.eq(true)
          cy.eventuallyApi<{ data: { id: string; text: string }[] }>(
            b,
            "/social/notes",
            (l) => l.data.some((x) => x.id === n.id && x.text === text),
          )
          // Delete it from the same sheet.
          cy.findByRole("button", { name: `Your note: ${text}` }).click()
          cy.findByRole("button", { name: "Delete note" }).click()
          cy.eventuallyRows(
            "select id from note where id = $1 and deleted_at is not null",
            [n.id],
          )
          cy.eventuallyApi<{ data: { id: string }[] }>(
            b,
            "/social/notes",
            (l) => !l.data.some((x) => x.id === n.id),
          )
        })
      })
    })
  })

  it("likes B's note", () => {
    namedUser("Bea").then((b) => {
      namedUser("Ann").then((a) => {
        const text = `Bea note ${stamp()}`.slice(0, 40)
        cy.liveApi(a, "PUT", `/social/people/${b.id}/follow`)
        cy.liveApi<{ id: string }>(b, "PUT", "/social/notes/me", {
          text,
        }).then((note) => {
          signIn(a)
          cy.visit("/social/inbox")
          cy.findByRole("button", {
            name: `Note from ${b.handle}: ${text}`,
          }).click()
          cy.findByRole("button", { name: "Like note" }).click()
          cy.findByRole("button", { name: "Unlike note" }).should("exist")
          cy.eventuallyRows(
            "select id from note_like where owner_id = $1 and note_id = $2 and deleted_at is null",
            [a.id, note.id],
          )
          cy.eventuallyApi<{ data: { id: string; liked: boolean }[] }>(
            a,
            "/social/notes",
            (l) => l.data.some((x) => x.id === note.id && x.liked),
          )
          // A reply to a note is a direct message to its author.
          cy.findByRole("textbox", { name: "Reply to note" }).type(
            "Same here{enter}",
          )
          cy.eventuallyRows(
            "select m.id from chat_message m join chat_member cm on cm.chat_id = m.chat_id and cm.owner_id = $2 where m.owner_id = $1 and m.text like '%Same here%'",
            [a.id, b.id],
          )
        })
      })
    })
  })
})
