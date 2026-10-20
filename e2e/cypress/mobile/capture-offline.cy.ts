// Capture offline queue and photo upload (live, no AI provider).
//
// Offline is simulated the way the app's connectivity hook reads it on web:
// NetInfo (`prototype/providers.tsx` -> `setConnectivity`) re-reads
// `navigator.onLine` on the Network Information API's `change` event (or the
// window's `offline` / `online` events where that API is missing). Both the
// capture path (`isOnline`) and the sync engine (`getConnectivity`) read it.
//
// | Screen         | Action                                        | Test |
// |----------------|-----------------------------------------------|------|
// | /capture (Fern) | send while offline → "Queued" (nothing sent)  | queues offline and flushes online |
// | /capture       | reconnect → queue flushes, server reads it    | queues offline and flushes online |
// | /capture/queue | "Pending & offline" lists the queued capture  | queues offline and flushes online |
// | /capture/queue | "Simulate offline" switch → capture queues     | the simulate-offline switch |
// | /capture       | Photo → Library → Send photo (upload)         | uploads a photo capture |
// | /capture       | Photo → Take photo                            | NOT COVERABLE ON WEB: needs a camera |

import {
  captureRow,
  noRows,
  rows,
  sendMessage,
  signIn,
} from "./capture-support"

function setOnline(online: boolean) {
  cy.window().then((win) => {
    Object.defineProperty(win.navigator, "onLine", {
      configurable: true,
      get: () => online,
    })
    win.dispatchEvent(new win.Event(online ? "online" : "offline"))
    // NetInfo (the app's connectivity source) listens to the Network
    // Information API's "change" event when the browser has one, and to
    // the window events otherwise; it then re-reads navigator.onLine.
    const connection = (win.navigator as { connection?: EventTarget })
      .connection
    connection?.dispatchEvent(new win.Event("change"))
  })
}

// A 64×48 PNG (solid colour): a real image the picker and resizer accept.
function tinyPng(): Promise<ReturnType<typeof Cypress.Buffer.from>> {
  return new Promise((resolve) => {
    const c = document.createElement("canvas")
    c.width = 64
    c.height = 48
    const g = c.getContext("2d") as CanvasRenderingContext2D
    g.fillStyle = "#e0b040"
    g.fillRect(0, 0, 64, 48)
    g.fillStyle = "#222"
    g.fillText("RECEIPT 250", 4, 26)
    c.toBlob(async (b) =>
      resolve(Cypress.Buffer.from(await (b as Blob).arrayBuffer())),
    )
  })
}

describe("capture offline queue and photo (live)", () => {
  it("queues offline and flushes online", () => {
    const text = "buy coffee beans"
    cy.newLiveUser("capture").then((user) => {
      signIn(user)
      cy.visit("/capture")
      cy.findByRole("textbox", { name: "Capture message" }).should("exist")

      setOnline(false)
      sendMessage(text)
      cy.findByText("Queued · will process when online").should("exist")
      cy.findAllByText(/Queued — will process when you're back online/).should(
        "exist",
      )
      // Nothing reached the server while offline.
      cy.wait(5000)
      noRows("select 1 from capture where owner_id = $1 and text = $2", [
        user.id,
        text,
      ])
      cy.window().then((win) => {
        expect(win.localStorage.getItem("sop-live:outbox")).to.contain(text)
      })

      // The queue screen lists it.
      cy.findByRole("button", { name: "Companion settings" }).click()
      cy.findByText("Pending & offline").click()
      cy.location("pathname").should("eq", "/capture/queue")
      cy.findAllByText(text).should("have.length.gte", 1)

      // Back online: the outbox flushes and the server reads the capture.
      setOnline(true)
      captureRow(user, text, "done").then((cap) => {
        expect(cap.engine).to.eq("rules")
        rows(
          "select r.refs from record_card r where r.capture_id = $1 and r.state = 'saved'",
          [cap.id],
        ).then(([card]) => {
          const taskId = (card.refs as string[])[0]
          rows("select title from task where id = $1 and owner_id = $2", [
            taskId,
            user.id,
          ]).then(([t]) => expect(t.title).to.match(/coffee beans/i))
        })
      })
      cy.visit("/capture")
      cy.findByText("Queued · will process when online").should("not.exist")
      cy.findByText("✓ Saved").should("exist")
    })
  })

  it("the simulate-offline switch queues captures until it is turned off", () => {
    const text = "buy dish soap"
    cy.newLiveUser("capture").then((user) => {
      signIn(user)
      cy.visit("/capture/queue")
      cy.findByRole("switch", { name: "Simulate offline" }).click()
      cy.visit("/capture")
      sendMessage(text)
      cy.findByText("Queued · will process when online").should("exist")

      // Off again: the queued capture is sent and read by the server.
      cy.visit("/capture/queue")
      cy.findByRole("switch", { name: "Simulate offline" }).click()
      captureRow(user, text, "done").then((cap) =>
        rows(
          "select 1 from record_card where capture_id = $1 and state = 'saved'",
          [cap.id],
        ),
      )
      cy.visit("/capture")
      cy.findByText("✓ Saved").should("exist")
    })
  })

  it("uploads a photo capture", () => {
    cy.newLiveUser("capture").then((user) => {
      signIn(user)
      cy.visit("/capture")
      cy.findByRole("button", { name: "Photo" }).click()
      cy.findByRole("button", { name: "Library" }).click()
      cy.wrap(null)
        .then(() => tinyPng())
        .then((png) => {
          cy.get("input[type=file]", { timeout: 10000 })
            .last()
            .selectFile(
              { contents: png, fileName: "receipt.png", mimeType: "image/png" },
              { force: true },
            )
        })
      cy.findByRole("img", { name: "Preview" }).should("exist")
      cy.findByRole("textbox", { name: "Caption" }).type("lunch receipt")
      cy.findByRole("button", { name: "Send photo" }).click()

      rows(
        "select id, status, source from capture where owner_id = $1 and source = 'photo' and status <> 'processing'",
        [user.id],
      ).then(([cap]) => {
        rows("select media_id from capture_attachment where capture_id = $1", [
          cap.id,
        ])
        cy.liveApi<{ attachments: unknown[]; status: string }>(
          user,
          "GET",
          `/capture/${cap.id}`,
        ).then((d) => {
          expect(d.attachments).to.have.length(1)
          expect(d.status).not.to.eq("failed")
        })
      })
    })
  })
})
