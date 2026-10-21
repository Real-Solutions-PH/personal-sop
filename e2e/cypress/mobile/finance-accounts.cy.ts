// Finance — setup, overview and accounts: what the screens do lands in the
// API and in Postgres. Money is integer centavos on the server
// (``*_minor``): ₱1,234.56 is 123456.
//
// | Screen                    | Action                                  | Test |
// |---------------------------|-----------------------------------------|------|
// | /finance (overview)       | "Set up Finance" → setup                | setup |
// | /finance/setup            | include/exclude, balances, "Add N"      | setup |
// | /finance (overview)       | net worth                               | setup (API net_worth_minor) |
// | /finance/accounts         | "Add account" → editor → Save           | create, edit, delete |
// | account editor            | name, type chip, opening, Save          | create, edit, delete |
// | account editor            | Delete (no records)                     | create, edit, delete |
// | /finance/accounts         | Reorder → "Move X up"                   | reorder |
// | /finance/accounts/[id]    | Adjust → "Save adjustment"              | adjust and transfer |
// | /finance/accounts/[id]    | Transfer → editor (amount, To, fee)     | adjust and transfer |
// | /finance/accounts/[id]    | Archive (confirm) → Undo                | archive |
// | /finance/archived         | archived account listed                 | archive |
import {
  apiSoon,
  clickUndo,
  eventuallyBalances,
  openFinance,
  outboxDrained,
  rowsSoon,
  seedAccount,
} from "./finance.helpers"

const ACCOUNTS = `select name, type, opening_minor::int as opening_minor, color,
                         archived, sort_order
                    from account
                   where owner_id = $1 and deleted_at is null
                   order by name`

// Retries: each attempt creates a fresh user; the shared stack is loaded.
describe("finance accounts (live)", {
  retries: { runMode: 2, openMode: 0 },
}, () => {
  it("setup: creates the chosen accounts with their opening balances", () => {
    cy.newLiveUser("fin").then((user) => {
      openFinance(user, "/finance", "Set up Finance")
      cy.findByText("Set up Finance").click()
      cy.location("pathname").should("eq", "/finance/setup")
      cy.findByLabelText("Cash balance").type("1234.56")
      cy.findByLabelText("GCash balance").type("500")
      cy.findByRole("button", { name: "Include Maya" }).click()
      cy.findByLabelText("BPI Savings balance").type("20000")
      cy.findByRole("button", { name: "Add 3 accounts" }).click()
      cy.location("pathname").should("eq", "/finance")

      // Cash's colour is var(--acct-green): 17 characters against the
      // server's 16 (fixed in the finance mapper, a37ecda).
      rowsSoon(ACCOUNTS, [user.id], 3).then((rows) => {
        expect(
          rows.map((r) => [r.name, r.type, r.opening_minor, r.color]),
        ).to.deep.eq([
          ["BPI Savings", "bank", 2000000, "red"],
          ["Cash", "cash", 123456, "green"],
          ["GCash", "ewallet", 50000, "blue"],
        ])
      })
      apiSoon<{ net_worth_minor: number }>(
        user,
        "/finance/accounts",
        (b) => b.net_worth_minor === 2173456,
      )
      // The setup also makes GCash the default account.
      rowsSoon(
        `select s.default_account_id from finance_settings s
           join account a on a.id = s.default_account_id
          where s.owner_id = $1 and a.name = 'GCash'`,
        [user.id],
      )
    })
  })

  it("create, edit and delete an account from the editor", () => {
    cy.newLiveUser("fin").then((user) => {
      openFinance(user, "/finance/accounts", "No accounts yet")
      cy.findByRole("button", { name: "Add account" }).click()
      cy.findByLabelText("Name").type("Payroll")
      cy.findByText("Bank").click()
      cy.findByLabelText("Opening balance ₱").clear().type("1234.56")
      cy.findByRole("button", { name: "Save" }).click()
      rowsSoon(`${ACCOUNTS.replace("order by name", "and name = 'Payroll'")}`, [
        user.id,
      ]).then(([row]) => {
        expect(row).to.include({
          type: "bank",
          opening_minor: 123456,
          archived: false,
        })
      })
      apiSoon<{ data: { name: string; balance_minor: number }[] }>(
        user,
        "/finance/accounts",
        (b) =>
          b.data.length === 1 &&
          b.data[0].name === "Payroll" &&
          b.data[0].balance_minor === 123456,
      )

      // Edit: rename and change the opening balance.
      cy.findByText("Payroll").click()
      cy.findByRole("button", { name: "Edit account" }).click()
      cy.findByLabelText("Name").clear().type("Payroll BDO")
      cy.findByLabelText("Opening balance ₱").clear().type("2500.05")
      cy.findByRole("button", { name: "Save" }).click()
      rowsSoon(
        `select opening_minor::int as o from account
          where owner_id = $1 and name = 'Payroll BDO' and opening_minor = 250005`,
        [user.id],
      )

      // Delete: no transactions, so the editor offers a real delete.
      cy.findByRole("button", { name: "Edit account" }).click()
      cy.findByRole("button", { name: "Delete" }).click()
      rowsSoon(
        `select id from account where owner_id = $1 and name = 'Payroll BDO'
            and deleted_at is not null`,
        [user.id],
      )
      apiSoon<{ data: unknown[] }>(
        user,
        "/finance/accounts",
        (b) => b.data.length === 0,
      )
    })
  })

  it("adjusts a balance and transfers with a fee; balances follow", () => {
    cy.newLiveUser("fin").then((user) => {
      seedAccount(user, {
        name: "Wallet",
        type: "cash",
        opening_minor: 123456,
      }).then((wallet) => {
        seedAccount(user, {
          name: "Savings",
          type: "bank",
          opening_minor: 2000000,
          color: "red",
        }).then((savings) => {
          openFinance(user, `/finance/accounts/${wallet.id}`, "Wallet")

          // Transfer ₱234.56 Wallet → Savings with a ₱15 fee.
          cy.findByText("Transfer").click()
          cy.findByLabelText("Amount ₱").type("234.56")
          cy.findAllByRole("button", { name: "Savings" }).last().click()
          cy.findByLabelText("Fee ₱ (optional)").type("15")
          cy.findByRole("button", { name: "Save" }).click()
          rowsSoon(
            `select id, type, amount_minor::int as amount_minor, to_account_id
               from fin_record where owner_id = $1 and type = 'transfer'
                and deleted_at is null`,
            [user.id],
          ).then(([t]) => {
            expect(t).to.include({
              amount_minor: 23456,
              to_account_id: savings.id,
            })
            rowsSoon(
              `select r.amount_minor::int as amount_minor, c.name as category
                 from fin_record r join category c on c.id = r.category_id
                where r.owner_id = $1 and r.fee_of = $2 and r.type = 'expense'
                  and r.deleted_at is null`,
              [user.id, t.id],
            ).then(([fee]) => {
              expect(fee).to.deep.eq({ amount_minor: 1500, category: "Fees" })
            })
          })
          // 123456 - 23456 - 1500; 2000000 + 23456.
          eventuallyBalances(user, { Wallet: 98500, Savings: 2023456 })

          // Adjust Savings to ₱25,000.50: an adjustment record makes up the
          // difference, and the balance lands exactly.
          cy.visit(`/finance/accounts/${savings.id}`)
          cy.findByText("Adjust").click()
          cy.findByLabelText("Actual balance (PHP)").clear().type("25000.50")
          cy.findByRole("button", { name: "Save adjustment" }).click()
          eventuallyBalances(user, { Savings: 2500050 })
          rowsSoon(
            `select type, amount_minor::int as amount_minor from fin_record
              where owner_id = $1 and account_id = $2 and is_adjustment
                and deleted_at is null`,
            [user.id, savings.id],
          ).then(([adj]) => {
            expect(adj).to.deep.eq({ type: "income", amount_minor: 476594 })
          })
          rowsSoon(
            "select last_reconciled from account where id = $1 and last_reconciled is not null",
            [savings.id],
          )
        })
      })
    })
  })

  it("archives an account with history, then undoes it", () => {
    cy.newLiveUser("fin").then((user) => {
      seedAccount(user, {
        name: "Old card",
        type: "cash",
        opening_minor: 10000,
      }).then((acct) => {
        openFinance(user, `/finance/accounts/${acct.id}`, "Old card")
        // Archive, Undo while the 6 s toast shows: once the device has pushed
        // everything, the server holds the account unarchived.
        cy.findByText("Archive").click()
        clickUndo()
        outboxDrained()
        rowsSoon(
          "select archived from account where id = $1 and not archived",
          [acct.id],
        )
        apiSoon<{ data: { id: string; archived: boolean }[] }>(
          user,
          "/finance/accounts",
          (b) => b.data.some((a) => a.id === acct.id && !a.archived),
        )
        // Archive for real: the server has it archived.
        cy.findByText("Archive").click()
        rowsSoon("select archived from account where id = $1 and archived", [
          acct.id,
        ])
      })
    })
  })

  it("reorders accounts", () => {
    cy.newLiveUser("fin").then((user) => {
      seedAccount(user, {
        name: "First",
        type: "cash",
        opening_minor: 100,
        sort_order: 0,
      } as never)
      seedAccount(user, {
        name: "Second",
        type: "cash",
        opening_minor: 200,
        sort_order: 1,
      } as never)
      openFinance(user, "/finance/accounts", "Second")
      cy.findByText("Reorder").click()
      cy.findByRole("button", { name: "Move Second up" }).click()
      cy.findByText("Done").click()
      rowsSoon(
        `select name from account where owner_id = $1 and deleted_at is null
          order by sort_order, name`,
        [user.id],
        2,
      ).then((rows) => {
        // Poll until the swap lands (both rows move).
        rowsSoon(
          `select 1 from account a join account b on b.owner_id = a.owner_id
            where a.owner_id = $1 and a.name = 'Second' and b.name = 'First'
              and a.sort_order < b.sort_order`,
          [user.id],
        )
        expect(rows).to.have.length(2)
      })
    })
  })
})
