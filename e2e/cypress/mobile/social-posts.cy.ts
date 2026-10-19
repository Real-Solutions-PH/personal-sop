// Social — drafts, posts, feeds, likes, saves, comments, explore (live mode).
//
// User A is driven through the UI; user B acts through the API. Every action
// is proven through the API and in Postgres.
//
// | Screen                 | Action                                        | Test |
// |------------------------|-----------------------------------------------|------|
// | /tasks/share           | Post → draft saved on the server              | "a share card becomes a server draft …" |
// | /social/compose        | Draft restored after a reload (caption)       | "a share card becomes a server draft …" |
// | /social/compose        | Share a post with an image (media upload)     | "a share card becomes a server draft …" |
// | /social/compose        | Share a progress post with a caption + #tag   | "creates a progress post …" |
// | /social/compose        | Location, also-share-to-story                 | "creates a progress post …" |
// | /social/compose        | Library / Camera pickers                      | NOT COVERABLE ON WEB: native picker; the image path is covered via the share card |
// | /social (feed)         | Following / For you tabs                      | "both feeds, like, save …" |
// | post card              | Like / unlike, save / unsave                  | "both feeds, like, save …" |
// | post card              | Send to a chat                                | social-chats "shares a post into a chat" |
// | /social/post/[id]      | Comment, reply, like a comment, delete own    | "comments, likes a comment …" |
// | post options           | Delete post, Undo (restore), delete for good  | "deletes a post, undoes it …" |
// | post options           | Copy link / Report                            | NOT COVERABLE ON WEB: clipboard / toast only, no server effect |
// | /social/explore        | #tag search, leaderboard, people search       | "explore: #tag search …" |
// | /social/activity       | B likes + comments on A's post, live          | "B liking and commenting reach A's open Activity …" |
import { longPress, namedUser, rows, signIn } from "./social-helpers"

const stamp = () => Date.now().toString(36)
const PROGRESS = { accent: "tsk", kind: "tasks", title: "This week", stats: [] }

describe("social posts (live)", () => {
  it("a share card becomes a server draft, then an image post that clears it", () => {
    namedUser("Ann").then((a) => {
      signIn(a)
      cy.visit("/tasks/share")
      cy.findByRole("button", { name: "Post" }).click()
      cy.location("pathname").should("eq", "/social/compose")
      cy.eventuallyRows(
        "select body from social_draft where owner_id = $1 and kind = 'post' and deleted_at is null",
        [a.id],
      ).then(([d]) => {
        const body = d.body as { caption: string; media: unknown[] }
        expect(body.caption).to.match(/^Tasks this week/)
        // The inline web image stays on the device (over the size limit).
        expect(body.media).to.have.length(0)
      })
      cy.eventuallyApi<{ body: { caption?: string } }>(
        a,
        "/social/drafts/post",
        (d) => !!d.body.caption?.startsWith("Tasks this week"),
      )

      // The draft survives a reload: its caption comes back from the server.
      // (The web-rendered card image is device-only and may not survive.)
      cy.reload()
      cy.findByRole("textbox", { name: "Caption", timeout: 60000 }).should(
        "contain.value",
        "Tasks this week",
      )

      // Post it with the image: a fresh card, straight to Share.
      cy.visit("/tasks/share")
      cy.findByRole("button", { name: "Post" }).click()
      cy.location("pathname").should("eq", "/social/compose")
      cy.findByRole("button", { name: "Remove item 1" }).should("exist")
      cy.findByRole("button", { name: "Share" }).click()
      cy.location("pathname").should("eq", "/social")

      cy.eventuallyRows(
        "select p.id, p.caption, count(m.id)::int as media from post p join post_media m on m.post_id = p.id where p.owner_id = $1 and p.deleted_at is null group by p.id",
        [a.id],
      ).then(([p]) => {
        expect(p.caption).to.match(/^Tasks this week/)
        expect(p.media).to.eq(1)
        cy.eventuallyApi<{ media: { kind: string }[] }>(
          a,
          `/social/posts/${p.id}`,
          (w) => w.media.length === 1 && w.media[0].kind === "image",
        )
      })
      // Posting clears the draft on the server.
      cy.eventuallyApi<{ body: Record<string, unknown> }>(
        a,
        "/social/drafts/post",
        (d) => Object.keys(d.body).length === 0,
      )
    })
  })

  it("creates a progress post with a caption, #tag and location", () => {
    namedUser("Ann").then((a) => {
      const tag = `e2e${stamp()}`
      signIn(a)
      cy.visit("/social/compose?progress=1")
      cy.findAllByRole("button", { name: /^Attach / })
        .first()
        .click()
      cy.findByRole("textbox", { name: "Caption" })
        .clear()
        .type(`Progress check #${tag}`)
      cy.findByRole("textbox", { name: "Location" }).type("Manila")
      cy.findByRole("switch", { name: "Also share to your story" }).click()
      cy.findByRole("button", { name: "Share" }).click()
      cy.location("pathname").should("eq", "/social")
      cy.eventuallyRows(
        "select id, caption, location, tags, progress from post where owner_id = $1 and deleted_at is null",
        [a.id],
      ).then(([p]) => {
        expect(p.caption).to.eq(`Progress check #${tag}`)
        expect(p.location).to.eq("Manila")
        expect(p.tags).to.deep.eq([tag])
        expect(p.progress).to.have.property("title")
        cy.eventuallyApi<{ tags: string[]; caption: string }>(
          a,
          `/social/posts/${p.id}`,
          (w) => w.tags.includes(tag),
        )
      })
      // "Also share to your story" adds the progress card as a story.
      cy.eventuallyRows(
        "select id from story where owner_id = $1 and kind = 'progress' and deleted_at is null",
        [a.id],
      )
    })
  })

  it("both feeds, like, save and unsave reach the server", () => {
    namedUser("Bea").then((b) => {
      namedUser("Ann").then((a) => {
        const caption = `From Bea ${stamp()}`
        cy.liveApi<{ id: string }>(b, "POST", "/social/posts", {
          caption,
          media: [],
          progress: PROGRESS,
        }).then((post) => {
          signIn(a)
          // For you shows every post in the tenant; Following only followees.
          cy.visit("/social")
          cy.findByRole("tab", { name: "For you" }).click()
          // For you ranks by likes, then newest: a new post with no likes
          // can sit past the first page, so page down until it shows.
          scrollFeedUntil(caption)
          cy.findByRole("tab", { name: "Following" }).click()
          cy.findByText(caption).should("not.exist")
          cy.liveApi(a, "PUT", `/social/people/${b.id}/follow`)
          cy.reload()
          cy.findByRole("tab", { name: "Following" }).click()
          cy.findByText(caption).should("exist")
          cy.eventuallyApi<{ data: { id: string }[] }>(
            a,
            "/social/feed?tab=following",
            (f) => f.data.some((p) => p.id === post.id),
          )

          cy.findAllByRole("button", { name: "Like" }).first().click()
          cy.findAllByRole("button", { name: "Unlike" }).should("exist")
          cy.findAllByRole("button", { name: "Save" }).first().click()
          cy.findAllByRole("button", { name: "Unsave" }).should("exist")
          cy.eventuallyApi<{ liked: boolean; saved: boolean; likes: number }>(
            a,
            `/social/posts/${post.id}`,
            (p) => p.liked && p.saved && p.likes === 1,
          )
          cy.eventuallyRows(
            "select id from post_like where owner_id = $1 and post_id = $2 and deleted_at is null",
            [a.id, post.id],
          )
          cy.eventuallyRows(
            "select id from post_save where owner_id = $1 and post_id = $2 and deleted_at is null",
            [a.id, post.id],
          )
          cy.eventuallyApi<{ data: { id: string }[] }>(
            a,
            "/social/saved",
            (l) => l.data.some((p) => p.id === post.id),
          )
          // Liking B's post is activity for B.
          cy.eventuallyRows(
            "select id from activity where owner_id = $1 and actor_id = $2 and kind = 'like' and post_id = $3 and deleted_at is null",
            [b.id, a.id, post.id],
          )

          cy.findAllByRole("button", { name: "Unlike" }).first().click()
          cy.findAllByRole("button", { name: "Unsave" }).first().click()
          cy.eventuallyApi<{ liked: boolean; saved: boolean; likes: number }>(
            a,
            `/social/posts/${post.id}`,
            (p) => !p.liked && !p.saved && p.likes === 0,
          )
          rows(
            "select id from post_like where owner_id = $1 and post_id = $2 and deleted_at is null",
            [a.id, post.id],
          ).should("have.length", 0)
          rows(
            "select id from post_save where owner_id = $1 and post_id = $2 and deleted_at is null",
            [a.id, post.id],
          ).should("have.length", 0)
        })
      })
    })
  })

  it("comments, likes a comment and deletes its own comment", () => {
    namedUser("Bea").then((b) => {
      namedUser("Ann").then((a) => {
        cy.liveApi<{ id: string }>(b, "POST", "/social/posts", {
          caption: "Comment on me",
          media: [],
          progress: PROGRESS,
        }).then((post) => {
          cy.liveApi<{ id: string }>(
            b,
            "POST",
            `/social/posts/${post.id}/comments`,
            { text: "First from Bea" },
          ).then((theirs) => {
            signIn(a)
            cy.visit(`/social/post/${post.id}`)
            cy.findByText("First from Bea").should("exist")
            cy.findAllByRole("button", { name: "Like comment" }).first().click()
            cy.findAllByRole("button", { name: "Unlike comment" }).should(
              "exist",
            )
            cy.eventuallyRows(
              "select id from comment_like where owner_id = $1 and comment_id = $2 and deleted_at is null",
              [a.id, theirs.id],
            )

            // Reply to B's comment.
            cy.findAllByRole("button", { name: "Reply" }).first().click()
            cy.findByRole("textbox", { name: "Add a comment" }).type("Thanks!")
            cy.findByRole("button", { name: "Post" }).click()
            cy.eventuallyRows(
              "select id from comment where owner_id = $1 and post_id = $2 and text like '%Thanks!%' and reply_to_id = $3",
              [a.id, post.id, theirs.id],
            )

            cy.findByRole("textbox", { name: "Add a comment" }).type(
              "Nice work, Bea",
            )
            cy.findByRole("button", { name: "Post" }).click()
            cy.findByText("Nice work, Bea").should("exist")
            cy.eventuallyRows(
              "select id from comment where owner_id = $1 and post_id = $2 and text = 'Nice work, Bea' and deleted_at is null",
              [a.id, post.id],
            ).then(([mine]) => {
              cy.eventuallyApi<{ data: { id: string; text: string }[] }>(
                b,
                `/social/posts/${post.id}/comments`,
                (l) => l.data.some((c) => c.id === mine.id),
              )
              cy.eventuallyRows(
                "select id from activity where owner_id = $1 and actor_id = $2 and kind = 'comment' and deleted_at is null",
                [b.id, a.id],
              )
              // Long press deletes my own comment (confirm auto-accepted).
              cy.findByText("Nice work, Bea").then(($t) => longPress($t))
              cy.findByText("Nice work, Bea").should("not.exist")
              cy.eventuallyRows(
                "select id from comment where id = $1 and deleted_at is not null",
                [mine.id],
              )
            })
          })
        })
      })
    })
  })

  it("deletes a post, undoes it, then deletes it for good", () => {
    namedUser("Ann").then((a) => {
      const caption = `Delete me ${stamp()}`
      cy.liveApi<{ id: string }>(a, "POST", "/social/posts", {
        caption,
        media: [],
        progress: PROGRESS,
      }).then((post) => {
        let v0 = 0
        rows("select version from post where id = $1", [post.id]).then(
          ([r]) => {
            v0 = Number(r.version)
          },
        )
        signIn(a)
        cy.visit(`/social/post/${post.id}`)
        cy.findByRole("button", { name: "Post options" }).click()
        cy.findByRole("button", { name: "Delete" }).click()
        cy.findByText("Post not found").should("exist")
        // The undo toast lasts 6 s: take it before polling the database.
        // (sonner-native renders its action without a button role.)
        cy.findByText("Undo").click()
        cy.findByText("Post not found").should("not.exist")
        // Live again only after both writes landed: delete, then restore.
        cy.then(() =>
          cy.eventuallyRows(
            "select id from post where id = $1 and deleted_at is null and version >= $2::bigint + 2",
            [post.id, v0],
          ),
        )
        cy.eventuallyApi<{ caption: string }>(
          a,
          `/social/posts/${post.id}`,
          (p) => p.caption === caption,
        )

        cy.visit(`/social/post/${post.id}`)
        cy.findByRole("button", { name: "Post options" }).click()
        cy.findByRole("button", { name: "Delete" }).click()
        cy.eventuallyRows(
          "select id from post where id = $1 and deleted_at is not null",
          [post.id],
        )
        cy.eventuallyApi<{ data: { id: string }[] }>(
          a,
          `/social/people/${a.id}/posts`,
          (l) => !l.data.some((p) => p.id === post.id),
        )
      })
    })
  })

  it("explore: #tag search, people search and the leaderboard", () => {
    namedUser("Bea").then((b) => {
      namedUser("Ann").then((a) => {
        const tag = `find${stamp()}`
        cy.liveApi(b, "POST", "/social/posts", {
          caption: `Tagged #${tag}`,
          media: [],
          progress: PROGRESS,
        })
        signIn(a)
        cy.visit("/social/explore")
        // The friends leaderboard: me plus the people I follow.
        cy.findByText("Friends leaderboard").should("exist")
        cy.findByText(b.handle).should("not.exist")
        cy.liveApi(a, "PUT", `/social/people/${b.id}/follow`)
        cy.reload()
        // The server computes every friend's Life Score: slow on a busy host.
        cy.findByText(b.handle, { timeout: 60000 }).should("exist")
        cy.eventuallyApi<{ data: { person: { id: string } }[] }>(
          a,
          "/social/leaderboard",
          (l) => l.data.some((r) => r.person.id === b.id),
        )

        cy.findByRole("textbox", { name: "Search" }).type(`#${tag}`)
        cy.findByRole("button", { name: `Tagged #${tag}` }).should("exist")
        cy.task<Record<string, unknown>[]>("sql", {
          text: "select id from post where owner_id = $1 and tags ? $2",
          values: [b.id, tag],
        }).should("have.length", 1)

        cy.findByRole("textbox", { name: "Search" }).clear().type(b.handle)
        cy.findByText(b.handle).should("exist")
      })
    })
  })

  it("B liking and commenting reach A's open Activity screen without a reload", () => {
    namedUser("Bea").then((b) => {
      namedUser("Ann").then((a) => {
        cy.liveApi<{ id: string }>(a, "POST", "/social/posts", {
          caption: "Mine",
          media: [],
          progress: PROGRESS,
        }).then((post) => {
          signIn(a)
          cy.visit("/social/activity")
          cy.findByText("No activity yet").should("exist")
          cy.window().then((win) => {
            ;(win as unknown as { __noReload: boolean }).__noReload = true
          })
          cy.liveApi(b, "PUT", `/social/posts/${post.id}/like`)
          cy.findByText(/liked your post/, { timeout: 15000 }).should("exist")
          cy.liveApi(b, "POST", `/social/posts/${post.id}/comments`, {
            text: "Live comment",
          })
          cy.findByText(/commented: Live comment/, { timeout: 15000 }).should(
            "exist",
          )
          cy.window().its("__noReload").should("eq", true)
          cy.eventuallyRows(
            "select kind from activity where owner_id = $1 and actor_id = $2 and post_id = $3 and deleted_at is null",
            [a.id, b.id, post.id],
            2,
          )
        })
      })
    })
  })
})

/** Scroll the feed to its end (loading the next page) until ``text`` shows. */
function scrollFeedUntil(text: string, pages = 15) {
  cy.get("body").then(($b) => {
    if ($b.text().includes(text)) return
    if (pages <= 0) throw new Error(`"${text}" never showed in the feed`)
    cy.findByText("You're all caught up").scrollIntoView()
    cy.wait(1500, { log: false })
    scrollFeedUntil(text, pages - 1)
  })
  cy.findByText(text).should("exist")
}
