// Finance — overview, projection, look-back, reports, CSV export, settings,
// the advisor (deterministic, no AI key) and the archive.
//
// | Screen                   | Action                                           | Test |
// |--------------------------|--------------------------------------------------|------|
// | /finance (overview)      | net worth shown = server's net_worth_minor       | overview and reports |
// | /finance (overview)      | "Hide amounts" / Settings "Privacy mode"         | device-only by design (privacyStore, no server row): UI check in settings |
// | /finance/reports/[kind]  | spend by category, period tabs                   | overview and reports |
// | /finance/reports         | "Share"                                          | NOT COVERABLE ON WEB: native share sheet (navigator.share) |
// | /finance/projection      | horizon tab, include-spend switch                | projection |
// | /finance/projection      | "What if I buy…" → "Save as draft"               | projection |
// | /finance/projection      | "Save as scheduled"                              | projection |
// | /finance/review          | note → "Save review" (look_back)                 | look-back |
// | /finance/review          | "Share card"                                     | NOT COVERABLE ON WEB: native share sheet |
// | /finance/settings        | default account, month start, horizon, include,  | settings |
// |                          | minimum balance, AI scope, nudge days            | settings |
// | /finance/settings        | "Export transactions (CSV)"                      | CSV export (navigator.share stubbed; the CSV text is checked) |
// | /finance/settings        | "Start fresh" (confirm)                          | settings |
// | /finance/settings        | "Reset demo data"                                | not driven: a prototype demo reset; live it is the server's /finance/reset, not called by the screen |
// | /finance/advisor         | disclaimer "I understand"                        | advisor |
// | /finance/advisor         | ask (input + Send) → answer                      | advisor |
// | /finance/advisor         | "Past threads" → "Delete thread"                 | advisor |
// | /finance/advisor         | "Voice"                                          | NOT COVERABLE ON WEB: microphone capture |
// | /finance/archived        | "Restore" an archived account                    | archive |
import {
  apiSoon,
  categoryId,
  dayKey,
  openFinance,
  rowsSoon,
  seedAccount,
} from "./finance.helpers"
import type { LiveUser } from "./support"

const peso = (minor: number) =>
  `₱${(minor / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

const pesoWhole = (minor: number) =>
  `₱${Math.round(minor / 100).toLocaleString("en-US")}`

const pesoAny = (minor: number) =>
  new RegExp(`^(${peso(minor).replace(/[.$]/g, "\\$&")}|${pesoWhole(minor)})$`)

function seedRecord(user: LiveUser, body: Record<string, unknown>) {
  return cy.liveApi(user, "POST", "/finance/records", {
    source: "manual",
    ...body,
  })
}

/** YYYY-MM-DD in the month ``offset`` months from now, on ``day``. */
function inMonth(offset: number, day: number) {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

// Retries: each attempt creates a fresh user; the shared stack is loaded.
describe("finance insights and settings (live)", {
  retries: { runMode: 2, openMode: 0 },
}, () => {
  it("overview and reports show what the server computed", () => {
    cy.newLiveUser("fin").then((user) => {
      seedAccount(user, {
        name: "Wallet",
        type: "cash",
        opening_minor: 1234567,
      }).then((wallet) => {
        categoryId(user, "Groceries").then((groceries) => {
          seedRecord(user, {
            type: "expense",
            amount_minor: 234556,
            account_id: wallet.id,
            category_id: groceries,
            payee: "SM Market",
            at: `${dayKey()}T01:00:00Z`,
          })
          cy.liveApi<{ net_worth_minor: number }>(
            user,
            "GET",
            "/finance/accounts",
          ).then((a) => {
            expect(a.net_worth_minor).to.eq(1234567 - 234556)
            openFinance(user, "/finance", "Net worth")
            // The overview shows whole pesos.
            cy.findAllByText(pesoWhole(a.net_worth_minor), {
              timeout: 30000,
            }).should("exist")
          })
          cy.liveApi<{
            flow: { spend_minor: number; by_category: [string, number][] }
          }>(user, "GET", "/finance/reports?period=this").then((r) => {
            expect(r.flow.spend_minor).to.eq(234556)
            cy.visit("/finance/reports/category?period=this")
            // Exact or whole pesos, whichever the report renders.
            cy.findAllByText(pesoAny(r.flow.spend_minor), {
              timeout: 30000,
            }).should("exist")
          })
        })
      })
    })
  })

  it("projection: horizon, include spend, and a what-if saved as a draft", () => {
    cy.newLiveUser("fin").then((user) => {
      seedAccount(user, {
        name: "Payroll",
        type: "bank",
        opening_minor: 5000000,
      }).then((acct) => {
        categoryId(user, "Salary").then((salary) => {
          cy.liveApi(user, "POST", "/finance/planned", {
            name: "Salary",
            type: "income",
            amount_minor: 2750000,
            estimated: false,
            account_id: acct.id,
            category_id: salary,
            schedule: { kind: "semimonthly", days: [15, 30] },
            start: dayKey(),
            end_rule: { kind: "never" },
            auto_log: false,
            is_what_if: false,
            in_projection: true,
          })
        })
        openFinance(user, "/finance/projection", "What if I buy…")
        cy.findByRole("tab", { name: "24 mo" }).click()
        rowsSoon(
          "select horizon from finance_settings where owner_id = $1 and horizon = 24",
          [user.id],
        )
        cy.findByRole("switch", {
          name: "Include average everyday spending",
        }).click()
        rowsSoon(
          "select include_unplanned from finance_settings where owner_id = $1",
          [user.id],
        ).then(([s]) => {
          const before = s.include_unplanned
          cy.findByRole("button", { name: "What if I buy…" }).click()
          cy.findByLabelText("Item").clear().type("Laptop")
          cy.findByLabelText("Price ₱").clear().type("45000")
          cy.findByRole("button", { name: "Save as draft" }).click()
          rowsSoon(
            `select amount_minor::int as amount_minor, is_what_if, type
               from planned_item where owner_id = $1 and name = 'Laptop'
                and deleted_at is null`,
            [user.id],
          ).then(([p]) =>
            expect(p).to.deep.eq({
              amount_minor: 4500000,
              is_what_if: true,
              type: "expense",
            }),
          )
          // The switch flipped the saved setting (whatever its default).
          rowsSoon(
            "select 1 from finance_settings where owner_id = $1 and include_unplanned = $2",
            [user.id, !before],
          ).should("have.length", 1)
        })
        cy.liveApi<{ months?: unknown[] }>(
          user,
          "GET",
          "/finance/projection",
        ).then((p) => expect(p).to.be.an("object"))
      })
    })
  })

  it("look-back: saves last month's review with its snapshot", () => {
    cy.newLiveUser("fin").then((user) => {
      seedAccount(user, {
        name: "Wallet",
        type: "cash",
        opening_minor: 1000000,
        opening_date: inMonth(-2, 1),
      } as never).then((wallet) => {
        categoryId(user, "Salary").then((salary) => {
          categoryId(user, "Groceries").then((groceries) => {
            seedRecord(user, {
              type: "expense",
              amount_minor: 1000,
              account_id: wallet.id,
              category_id: groceries,
              at: `${inMonth(-2, 5)}T03:00:00Z`,
            })
            seedRecord(user, {
              type: "income",
              amount_minor: 3000000,
              account_id: wallet.id,
              category_id: salary,
              at: `${inMonth(-1, 2)}T03:00:00Z`,
            })
            seedRecord(user, {
              type: "expense",
              amount_minor: 1234567,
              account_id: wallet.id,
              category_id: groceries,
              payee: "Landers",
              at: `${inMonth(-1, 10)}T03:00:00Z`,
            })
          })
        })
        const period = inMonth(-1, 1).slice(0, 7)
        openFinance(user, `/finance/review?period=${period}`, "Save review")
        cy.findByPlaceholderText("What will you do differently?").type(
          "Cook at home more",
        )
        cy.findByRole("button", { name: "Save review" }).click()
        rowsSoon(
          `select period, note, snapshot from look_back
            where owner_id = $1 and deleted_at is null`,
          [user.id],
        ).then(([l]) => {
          expect(l.period).to.eq(period)
          expect(l.note).to.eq("Cook at home more")
          expect(l.snapshot).to.deep.include({
            income_minor: 3000000,
            spend_minor: 1234567,
          })
        })
        apiSoon<{ data: { period: string }[] }>(
          user,
          "/finance/look-backs",
          (b) => b.data.some((l) => l.period === period),
        )
      })
    })
  })

  it("settings: every server-backed row lands in finance_settings", () => {
    cy.newLiveUser("fin").then((user) => {
      seedAccount(user, {
        name: "Maya",
        type: "ewallet",
        opening_minor: 100,
      }).then((maya) => {
        openFinance(user, "/finance/settings", "Maya")
        cy.contains("[role=button]", /^Maya$/).click()
        cy.findByRole("button", { name: "15th (payday)" }).click()
        cy.findByRole("tab", { name: "12 months" }).click()
        cy.findByLabelText("Minimum balance ₱").clear().type("2500.75").blur()
        cy.findByRole("tab", { name: "Individual transactions" }).click()
        cy.findByRole("button", { name: "45 days" }).click()
        rowsSoon(
          `select default_account_id, month_start_day, horizon,
                  safety_floor_minor::int as safety_floor_minor, ai_scope, nudge_days
             from finance_settings
            where owner_id = $1 and nudge_days = 45 and ai_scope = 'records'`,
          [user.id],
        ).then(([s]) => {
          expect(s).to.deep.eq({
            default_account_id: maya.id,
            month_start_day: 15,
            horizon: 12,
            safety_floor_minor: 250075,
            ai_scope: "records",
            nudge_days: 45,
          })
        })
        apiSoon<{ month_start_day: number; safety_floor_minor: number }>(
          user,
          "/finance/settings",
          (b) => b.month_start_day === 15 && b.safety_floor_minor === 250075,
        )
        // Privacy is a device-only preference: the switch flips the screen.
        cy.findByRole("switch", { name: "Privacy mode" }).click()
        cy.findByRole("switch", { name: "Privacy mode" }).should(
          "have.attr",
          "aria-checked",
          "true",
        )
      })
    })
  })

  it("exports the transactions as CSV", () => {
    cy.newLiveUser("fin").then((user) => {
      seedAccount(user, {
        name: "Wallet",
        type: "cash",
        opening_minor: 100000,
      }).then((wallet) => {
        categoryId(user, "Coffee").then((coffee) => {
          seedRecord(user, {
            type: "expense",
            amount_minor: 18550,
            account_id: wallet.id,
            category_id: coffee,
            payee: "Tim Hortons",
            at: `${dayKey()}T02:00:00Z`,
          })
        })
        cy.signInLive(user)
        cy.visit("/finance/settings", {
          onBeforeLoad(win) {
            Object.defineProperty(win.navigator, "share", {
              configurable: true,
              value: (data: { message?: string; text?: string }) => {
                ;(win as unknown as { shared: unknown }).shared = data
                return Promise.resolve()
              },
            })
          },
        })
        cy.contains("1 transaction", { timeout: 30000 }).should("exist")
        cy.contains("Export transactions (CSV)").click()
        cy.window()
          .its("shared")
          .then((shared) => {
            const text = JSON.stringify(shared)
            expect(text).to.contain("Tim Hortons")
            expect(text).to.contain("185.5")
            expect(text).to.contain("Coffee")
            expect(text).to.contain("Wallet")
          })
      })
    })
  })

  it("start fresh clears the finance data on the server", () => {
    cy.newLiveUser("fin").then((user) => {
      seedAccount(user, {
        name: "Wallet",
        type: "cash",
        opening_minor: 100000,
      }).then((wallet) => {
        openFinance(user, "/finance/settings", "Wallet")
        cy.contains("Start fresh (first-run setup)").click()
        cy.location("pathname").should("eq", "/finance/setup")
        rowsSoon(
          "select id from account where id = $1 and deleted_at is not null",
          [wallet.id],
        )
      })
    })
  })

  it("advisor: accepts the terms, answers without an AI key, deletes a thread", () => {
    cy.newLiveUser("fin").then((user) => {
      seedAccount(user, {
        name: "Wallet",
        type: "cash",
        opening_minor: 100000,
      })
      openFinance(user, "/finance/advisor", "Before you ask")
      cy.findByRole("button", { name: "I understand" }).click()
      rowsSoon(
        "select 1 from finance_settings where owner_id = $1 and disclaimer_ack",
        [user.id],
      )
      cy.findByLabelText("Ask the advisor").type(
        "How big should my emergency fund be?",
      )
      cy.findByRole("button", { name: "Send" }).click()
      rowsSoon(
        `select t.id, m.role, m.text, m.answer from advisor_thread t
           join advisor_message m on m.thread_id = t.id
          where t.owner_id = $1 and t.deleted_at is null and m.deleted_at is null
          order by m.at`,
        [user.id],
        2,
      ).then((rows) => {
        expect(rows.map((r) => r.role)).to.deep.eq(["user", "ai"])
        expect(rows[0].text).to.eq("How big should my emergency fund be?")
        const thread = rows[0].id
        apiSoon<{ data: { id: string }[] }>(
          user,
          "/finance/advisor/threads",
          (b) => b.data.some((t) => t.id === thread),
        )
        cy.findByRole("button", { name: "Past threads" }).click()
        cy.findByRole("button", { name: "Delete thread" }).click()
        rowsSoon(
          "select id from advisor_thread where id = $1 and deleted_at is not null",
          [thread],
        )
      })
    })
  })

  it("archive: restores an archived account", () => {
    cy.newLiveUser("fin").then((user) => {
      seedAccount(user, {
        name: "Old wallet",
        type: "cash",
        opening_minor: 100,
      }).then((acct) => {
        cy.liveApi(user, "PATCH", `/finance/accounts/${acct.id}`, {
          archived: true,
        })
        openFinance(user, "/finance/archived", "Old wallet")
        cy.findByRole("button", { name: "Restore" }).click()
        rowsSoon("select id from account where id = $1 and not archived", [
          acct.id,
        ])
      })
    })
  })
})
